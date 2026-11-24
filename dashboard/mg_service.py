"""Service layer behind the routes: collect, validate, start jobs, render status.

The hooks the audit layer (W3) uses: `audit_candidates` (Renovate MRs with no audit for their head sha),
`mg_store.put_audit`, `mg_store.set_state`, and `glab_for(settings)` for its own GitLab reads. The job
calls `mg_audit.audit_mr(home, settings, item) -> dict` and stores the returned audit under the item's sha.
"""

from __future__ import annotations

import datetime
import importlib
import logging
import os
import re
import threading
from pathlib import Path

import mg_actions
import mg_collect
import mg_glab
import mg_jobs
import mg_rules
import mg_settings
import mg_sessions
import mg_status
import mg_store

log = logging.getLogger("mergeable.service")
SHA_RE = re.compile(r"^[0-9a-f]{7,64}$")
UNTIL_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
PACKAGE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/@:+-]{0,199}$")
_COLLECTORS: dict[str, mg_collect.Collector] = {}
_LOCK = threading.Lock()


class ServiceError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


def reset() -> None:
    """Drop every cache and job (tests and the sandbox probe)."""
    with _LOCK:
        _COLLECTORS.clear()
    mg_jobs.REGISTRY.reset()
    mg_sessions.reset()
    mg_store.forget_sweeps()


def glab_for(settings: dict) -> mg_glab.Glab:
    return mg_glab.Glab(settings["gitlab_host"])


def collector(home: Path, profile: str) -> mg_collect.Collector:
    settings = mg_settings.load()
    with _LOCK:
        current = _COLLECTORS.get(str(home))
        if current is not None and current.settings["gitlab_host"] == settings["gitlab_host"]:
            current.settings = settings
            current.profile = profile
            return current
        current = mg_collect.Collector(home, settings, glab_for(settings), profile)
        _COLLECTORS[str(home)] = current
        return current


def _collect(coll: mg_collect.Collector, refresh: bool, strict: bool = False) -> dict:
    try:
        return coll.collect(refresh, strict)
    except mg_collect.CollectError as exc:
        raise ServiceError(502, str(exc)) from exc


def _view(home: Path, profile: str, refresh: bool = False, strict: bool = False) -> tuple[mg_collect.Collector, dict]:
    coll = collector(home, profile)
    return coll, coll.view(_collect(coll, refresh, strict))


def mrs_payload(home: Path, profile: str, refresh: bool) -> dict:
    coll, view = _view(home, profile, refresh)
    maybe_auto_audit(home, coll, view)
    out = dict(view, items=[mg_collect.public(i) for i in view["items"]], timing=dict(coll.last_stats))
    return out


# ---- audit hooks ----
def audit_candidates(home: Path, profile: str, force: bool = False) -> list[dict]:
    """Renovate items that need an audit for their head sha (W3 hook); `force` includes finished and failed ones."""
    _coll, view = _view(home, profile)
    return mg_store.needing_audit(home, view["items"], force)


def maybe_auto_audit(home: Path, coll: mg_collect.Collector, view: dict) -> None:
    if not coll.settings["auto_audit"] or not _audit_available():
        return
    items = mg_store.needing_audit(home, view["items"])
    if items:
        try:
            _start_audit(home, coll, items)
        except ServiceError:
            return


def _audit_available() -> bool:
    try:
        importlib.import_module("mg_audit")
    except ImportError:
        return False
    return True


def _start_audit(home: Path, coll: mg_collect.Collector, items: list[dict]) -> str:
    user = coll.current_user()

    def runner(job):
        for item in items:
            mg_store.set_state(home, item["ref"], item["sha"], "queued")
        actor = mg_actions.Actor(home, coll.glab, coll.settings, job, user, coll.project_meta)
        return mg_actions.run_audit(actor, items)

    try:
        job = mg_jobs.REGISTRY.start("audit", [mg_jobs.AUDIT_LOCK], [i["ref"] for i in items], runner)
    except mg_jobs.Busy as exc:
        raise ServiceError(423, "an audit job is already running") from exc
    return job.id


# ---- writes ----
def _body_sha(body, required: bool) -> str | None:
    if body is None:
        body = {}
    if not isinstance(body, dict):
        raise ServiceError(422, "body must be an object")
    sha = body.get("expected_sha")
    if sha is None and not required:
        return None
    if not isinstance(sha, str) or not SHA_RE.match(sha):
        raise ServiceError(422, "expected_sha must be the head commit sha as hex")
    return sha


def _preflight(home: Path, profile: str, pid: int, iid: int, action: str, expected: str | None):
    coll = collector(home, profile)
    try:
        user = coll.current_user()
    except mg_collect.CollectError as exc:
        raise ServiceError(502, str(exc)) from exc
    actor = mg_actions.Actor(home, coll.glab, coll.settings, _NoJob(), user, coll.project_meta)
    try:
        mr = coll.glab.get(actor.mr_path(pid, iid, "?include_rebase_in_progress=true"))
    except mg_glab.GlabError as exc:
        if exc.status == 404:
            raise ServiceError(404, f"unknown MR {pid}!{iid}") from exc
        raise ServiceError(502, f"glab could not read the MR: {exc.message}") from exc
    owner = actor.owner(mr)
    no = mg_actions.refusal(action, mr, owner)
    if no is not None:
        raise ServiceError(no.status, no.detail)
    if expected and mr.get("sha") != expected:
        raise ServiceError(409, f"expected_sha {expected[:8]} differs from the head {str(mr.get('sha'))[:8]}")
    path = _project_path(coll, pid, mr)
    return coll, user, mr, owner, f"{path}!{iid}"


def _project_path(coll: mg_collect.Collector, pid: int, mr: dict) -> str:
    known = coll.projects.get(pid, {}).get("path")
    if known:
        return known
    try:
        return coll.project_meta(pid)["path"]
    except mg_glab.GlabError:
        return str((mr.get("references") or {}).get("full", pid)).rsplit("!", 1)[0]


class _NoJob:
    """Stand-in job for pre-flight reads: Actor only needs it to exist."""

    id = "preflight"
    rebases = 0

    def step(self, *_args, **_kw) -> None:
        return None


def _start(coll: mg_collect.Collector, kind: str, keys: list, refs: list[str], runner) -> dict:
    def finishing(job):
        try:
            return runner(job)
        finally:
            coll.invalidate(refs)

    try:
        job = mg_jobs.REGISTRY.start(kind, keys, refs, finishing)
    except mg_jobs.Busy as exc:
        raise ServiceError(423, f"another write job ({exc.job_id}) runs on project {exc.key}") from exc
    return {"job_id": job.id}


def start_rebase(home: Path, profile: str, pid: int, iid: int, body) -> dict:
    expected = _body_sha(body, True)
    coll, user, _mr, _owner, ref = _preflight(home, profile, pid, iid, "rebase", expected)

    def runner(job):
        actor = mg_actions.Actor(home, coll.glab, coll.settings, job, user, coll.project_meta)
        return mg_actions.run_guarded(job, ref, lambda: actor.rebase_flow(ref, pid, iid, expected))

    return _start(coll, "rebase", [pid], [ref], runner)


def start_merge(home: Path, profile: str, pid: int, iid: int, body) -> dict:
    expected = _body_sha(body, True)
    coll, user, _mr, _owner, ref = _preflight(home, profile, pid, iid, "merge", expected)

    def runner(job):
        actor = mg_actions.Actor(home, coll.glab, coll.settings, job, user, coll.project_meta)
        return mg_actions.run_guarded(job, ref, lambda: actor.merge_flow(ref, pid, iid, expected))

    return _start(coll, "merge", [pid], [ref], runner)


def start_retry(home: Path, profile: str, pid: int, iid: int, body) -> dict:
    _body_sha(body, False)
    coll, user, _mr, _owner, ref = _preflight(home, profile, pid, iid, "retry-pipeline", None)

    def runner(job):
        actor = mg_actions.Actor(home, coll.glab, coll.settings, job, user, coll.project_meta)
        return mg_actions.run_guarded(job, ref, lambda: actor.retry_flow(ref, pid, iid))

    return _start(coll, "retry-pipeline", [pid], [ref], runner)


def start_ready(home: Path, profile: str, pid: int, iid: int, body) -> dict:
    _body_sha(body, False)
    coll, user, _mr, _owner, ref = _preflight(home, profile, pid, iid, "ready", None)

    def runner(job):
        actor = mg_actions.Actor(home, coll.glab, coll.settings, job, user, coll.project_meta)
        return mg_actions.run_guarded(job, ref, lambda: actor.ready_flow(ref, pid, iid))

    return _start(coll, "ready", [pid], [ref], runner)


def start_hold(home: Path, profile: str, pid: int, iid: int, body) -> dict:
    if not isinstance(body, dict):
        raise ServiceError(422, "body must be an object with package and until")
    package, until = body.get("package"), body.get("until")
    if not isinstance(package, str) or not PACKAGE_RE.match(package):
        raise ServiceError(422, "package must be a package name")
    if not isinstance(until, str) or not UNTIL_RE.match(until):
        raise ServiceError(422, "until must be a date like 2026-12-31")
    try:
        until_date = datetime.date.fromisoformat(until)
    except ValueError as exc:
        raise ServiceError(422, "until is not a calendar date") from exc
    today = datetime.date.today()
    if until_date <= today:
        raise ServiceError(422, "until must be in the future")
    coll, user, _mr, _owner, ref = _preflight(home, profile, pid, iid, "renovate-hold", None)
    try:
        default = coll.project_meta(pid)["default_branch"]
    except mg_glab.GlabError as exc:
        raise ServiceError(502, f"glab could not read the project: {exc.message}") from exc
    try:
        current = coll.glab.get_text(f"projects/{pid}/repository/files/renovate.json/raw?ref={mg_glab.quote(default)}")
    except mg_glab.GlabError as exc:
        if exc.status == 404:
            raise ServiceError(422, _hand_snippet(package, until, today, "no plain renovate.json on the default branch")) from exc
        raise ServiceError(502, f"glab could not read renovate.json: {exc.message}") from exc
    try:
        content = mg_actions.build_hold(current, package, until, today.isoformat())
    except ValueError as exc:
        raise ServiceError(422, _hand_snippet(package, until, today, f"renovate.json cannot be edited safely: {exc}")) from exc
    plan = {
        "branch": f"mergeable/hold-{mg_actions.slug(package)}", "default_branch": default, "content": content,
        "commit_message": f"Hold Renovate updates of {package} until {until}",
        "mr_title": f"Draft: Hold Renovate updates of {package} until {until}",
        "mr_description": (
            f"Adds a packageRules entry that disables Renovate updates of `{package}` until {until}.\n\n"
            f"Made from {ref} by the mergeable plugin. Remove the rule from renovate.json after {until}."
        ),
    }

    def runner(job):
        actor = mg_actions.Actor(home, coll.glab, coll.settings, job, user, coll.project_meta)
        return mg_actions.run_guarded(job, ref, lambda: actor.hold_flow(ref, pid, iid, plan))

    return _start(coll, "renovate-hold", [pid], [ref], runner)


def _hand_snippet(package: str, until: str, today: datetime.date, why: str) -> str:
    return f"{why}. Add this to the project's Renovate config by hand:\n{mg_actions.hold_snippet(package, until, today.isoformat())}"


def start_audit(home: Path, profile: str, pid: int, iid: int, body) -> dict:
    _body_sha(body, False)
    coll, view = _view(home, profile)
    item = next((i for i in view["items"] if i["project_id"] == pid and i["iid"] == iid), None)
    if item is None:
        raise ServiceError(404, f"unknown MR {pid}!{iid}")
    if item["owner"] == "other":
        raise ServiceError(403, "colleague's MR: read only")
    if item["owner"] != "renovate":
        raise ServiceError(422, "only Renovate MRs are audited")
    return {"job_id": _start_audit(home, coll, [item])}


def start_audit_all(home: Path, profile: str, body) -> dict:
    if body is not None and not isinstance(body, dict):
        raise ServiceError(422, "body must be an object")
    coll, view = _view(home, profile)
    items = [i for i in view["items"] if i["owner"] == "renovate" and not i["draft"]]
    if not items:
        raise ServiceError(422, "no Renovate MRs to audit")
    return {"job_id": _start_audit(home, coll, items)}


def start_batch(home: Path, profile: str, body) -> dict:
    if not isinstance(body, dict):
        raise ServiceError(422, "body must be an object with refs and shas")
    refs, shas = body.get("refs"), body.get("shas")
    if (not isinstance(refs, list) or not isinstance(shas, list) or len(refs) != len(shas) or not refs
            or not all(isinstance(r, str) for r in refs) or not all(isinstance(s, str) and SHA_RE.match(s) for s in shas)):
        raise ServiceError(422, "refs and shas must be equal-length non-empty lists of strings")
    coll, view = _view(home, profile, refresh=True, strict=True)
    plan = view["batch"]
    server, client = dict(zip(plan["refs"], plan["shas"])), dict(zip(refs, shas))
    if server != client or len(set(refs)) != len(refs):
        added = sorted(set(server) - set(client))
        gone = sorted(set(client) - set(server))
        moved = sorted(r for r in set(server) & set(client) if server[r] != client[r])
        raise ServiceError(409, f"the trivial set changed: new {added}, no longer trivial {gone}, head moved {moved}")
    by_ref = {i["ref"]: i for i in view["items"]}
    order = [{"ref": r, "project_id": by_ref[r]["project_id"], "iid": by_ref[r]["iid"], "sha": by_ref[r]["sha"]} for r in plan["refs"]]
    user = coll.current_user()
    keys = sorted({e["project_id"] for e in order})

    def runner(job):
        actor = mg_actions.Actor(home, coll.glab, coll.settings, job, user, coll.project_meta)
        return mg_actions.run_batch(actor, order)

    return _start(coll, "batch", keys, plan["refs"], runner)


# ---- reads ----
def jobs_payload() -> list[dict]:
    return mg_jobs.REGISTRY.recent()


def job_payload(job_id: str) -> dict:
    job = mg_jobs.REGISTRY.get(job_id)
    if job is None:
        raise ServiceError(404, f"unknown job {job_id}")
    return job.to_dict()


def status_markdown(home: Path, profile: str) -> str:
    _coll, view = _view(home, profile)
    return mg_status.render(view)


def home_dir() -> Path:
    try:
        from hermes_constants import get_hermes_home

        return Path(get_hermes_home())
    except ImportError:
        return Path(os.environ.get("HERMES_HOME") or Path.home() / ".hermes")
