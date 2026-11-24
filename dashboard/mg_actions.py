"""Write actions behind the jobs: rebase, merge, retry pipeline, ready, Renovate hold, trivial batch, audit.

Every write re-reads the MR first (D59) and appends one JSONL line to $HERMES_HOME/mergeable/actions.log.
GitLab is reached only through mg_glab (argv lists). Merge never uses `glab mr merge`, never `--rebase`,
never merge_when_pipeline_succeeds: it polls the head pipeline itself and then PUTs .../merge with sha=<head>.
A second rebase of one MR ends the job failed instead (glab-mr-merge trap 1).
"""

from __future__ import annotations

import importlib
import json
import os
import re
import threading
import time
from pathlib import Path

import mg_glab
import mg_rules
import mg_store

POLL_SECONDS = 20.0
REBASE_POLL_SECONDS = 3.0
NOOP_POLLS = 3
VERIFY_POLLS = 5
VERIFY_SECONDS = 2.0
BAD_PIPELINE = {"failed", "canceled", "skipped"}
RETRYABLE = {"failed", "canceled"}
LOG_LOCK = threading.Lock()


class Clock:
    """Wall-clock seam: tests swap CLOCK for one that advances virtual time instead of sleeping."""

    def sleep(self, seconds: float) -> None:
        time.sleep(seconds)

    def now(self) -> float:
        return time.monotonic()


CLOCK = Clock()


class Stop(Exception):
    """A deliberate refusal: the job ends `stopped`."""


class Fail(Exception):
    """An error: the job ends `failed`."""


class Refused(Exception):
    """A pre-flight refusal the route turns into an HTTP error before any job starts."""

    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


def refusal(action: str, mr: dict, owner: str) -> Refused | None:
    """Why `action` may not run on this freshly read MR, or None. Shared by the routes and the jobs."""
    if mr.get("state") != "opened":
        return Refused(404, f"MR is not open ({mr.get('state')})")
    if owner == "other":
        return Refused(403, "colleague's MR: read only")
    if action == "ready":
        return None if mr.get("draft") else Refused(409, "MR is not a draft")
    if action == "retry-pipeline":
        pipeline = mr.get("head_pipeline")
        if not pipeline:
            return Refused(409, "MR has no pipeline")
        if pipeline.get("status") not in RETRYABLE:
            return Refused(409, f"pipeline is {pipeline.get('status')}, only failed or canceled can be retried")
        return None
    if action in ("rebase", "merge"):
        if mr.get("draft"):
            return Refused(409, "MR is a draft")
        if mr.get("has_conflicts") and not (action == "rebase" and owner == "renovate"):
            return Refused(409, "MR has conflicts")
    if action == "rebase" and mr.get("detailed_merge_status") != "need_rebase" and not mr.get("has_conflicts"):
        return Refused(409, f"MR is already current with {mr.get('target_branch')}")
    if action == "renovate-hold" and owner != "renovate":
        return Refused(422, "not a Renovate MR")
    return None


class Actor:
    def __init__(self, home: Path, glab: mg_glab.Glab, settings: dict, job, user: str, meta_for):
        self.home = Path(home)
        self.glab = glab
        self.settings = settings
        self.job = job
        self.user = user
        self.meta_for = meta_for
        self.rebased: set[str] = set()
        self.deadline = 0.0

    # ---- plumbing ----
    def mr_path(self, pid: int, iid: int, tail: str = "") -> str:
        return f"projects/{pid}/merge_requests/{iid}{tail}"

    def read(self, pid: int, iid: int) -> dict:
        try:
            return self.glab.get(self.mr_path(pid, iid, "?include_rebase_in_progress=true&with_merge_status_recheck=true")) or {}
        except mg_glab.GlabError as exc:
            if exc.status == 404:
                raise Fail("MR no longer exists") from exc
            raise Fail(f"cannot read the MR: {exc.message}") from exc

    def owner(self, mr: dict) -> str:
        author = (mr.get("author") or {}).get("username") or "?"
        return mg_rules.owner_of(author, mr.get("source_branch") or "", self.user, self.settings["renovate_branch_prefix"])

    def log_write(self, action: str, ref: str, before: str | None, after: str | None, result: str) -> None:
        line = {
            "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "job": self.job.id, "action": action,
            "ref": ref, "sha_before": before, "sha_after": after, "result": result,
        }
        directory = self.home / "mergeable"
        with LOG_LOCK:
            directory.mkdir(parents=True, exist_ok=True)
            fd = os.open(directory / "actions.log", os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
            try:
                os.write(fd, (json.dumps(line, ensure_ascii=True) + "\n").encode())
            finally:
                os.close(fd)

    def wait(self, seconds: float, what: str) -> None:
        if CLOCK.now() + seconds > self.deadline:
            raise Fail(f"gave up waiting for {what} after {self.settings['merge_wait_minutes']} minutes")
        CLOCK.sleep(seconds)

    def start_clock(self) -> None:
        self.deadline = CLOCK.now() + self.settings["merge_wait_minutes"] * 60

    def write(self, action: str, ref: str, before: str | None, call):
        """Run one GitLab write, log it, and turn a glab failure into Fail (409 on merge is handled by the caller)."""
        try:
            result = call()
        except mg_glab.GlabError as exc:
            self.log_write(action, ref, before, None, f"error: {exc.message}"[:200])
            raise
        after = (result.get("merge_commit_sha") or result.get("sha")) if isinstance(result, dict) else None
        self.log_write(action, ref, before, after if action == "merge" else None, "ok")
        return result

    # ---- rebase ----
    def rebase(self, ref: str, pid: int, iid: int, mr: dict, owner: str) -> dict:
        if ref in self.rebased:
            raise Fail(f"{ref} needs a second rebase: stopped (one rebase per MR)")
        before = mr["sha"]
        self.job.step(ref, "rebase", "running", "Renovate rebase box" if owner == "renovate" else "server-side rebase")
        if owner == "renovate":
            new_description, state = mg_rules.checkbox_edit(mr.get("description") or "")
            if state == "missing":
                raise Fail("the MR description has no rebase checkbox")
            if state == "changed":
                self._put_description(ref, pid, iid, before, new_description)
        else:
            try:
                self.write("rebase", ref, before, lambda: self.glab.put(self.mr_path(pid, iid, "/rebase")))
            except mg_glab.GlabError as exc:
                raise Fail(f"rebase refused: {exc.message}") from exc
        self.rebased.add(ref)
        self.job.rebases += 1
        new = self.wait_new_head(ref, pid, iid, before, owner)
        self.job.step(ref, "rebase", "done", f"new head {new['sha'][:8]}")
        return new

    def _put_description(self, ref: str, pid: int, iid: int, before: str, description: str) -> None:
        try:
            self.write("renovate_rebase", ref, before, lambda: self.glab.put(self.mr_path(pid, iid), raw_fields={"description": description}))
        except mg_glab.GlabError as exc:
            raise Fail(f"could not tick the rebase box: {exc.message}") from exc

    def wait_new_head(self, ref: str, pid: int, iid: int, before: str, owner: str) -> dict:
        idle = 0
        while True:
            mr = self.read(pid, iid)
            if mr.get("state") != "opened":
                raise Fail(f"MR is {mr.get('state')}")
            if mr.get("merge_error"):
                raise Fail(f"rebase failed: {mr['merge_error']}"[:300])
            if not mr.get("rebase_in_progress") and mr.get("sha") != before:
                return mr
            if owner != "renovate" and not mr.get("rebase_in_progress"):
                idle += 1
                if idle >= NOOP_POLLS:
                    raise Fail("the rebase did not change the head")
            self.wait(POLL_SECONDS if owner == "renovate" else REBASE_POLL_SECONDS, "the new head after the rebase")

    # ---- merge ----
    def merge_flow(self, ref: str, pid: int, iid: int, expected_sha: str | None) -> None:
        meta = self.meta_for(pid)
        self.start_clock()
        self.job.step(ref, "reread", "running", "")
        first = True
        announced = False
        while True:
            mr = self.read(pid, iid)
            owner = self.owner(mr)
            no = refusal("merge", mr, owner)
            if no is not None:
                raise Stop(no.detail)
            if first:
                self.job.step(ref, "reread", "done", f"head {mr['sha'][:8]}, {mr.get('detailed_merge_status')}")
                if expected_sha and mr["sha"] != expected_sha:
                    raise Stop(f"head moved: expected {expected_sha[:8]}, now {mr['sha'][:8]}")
                first = False
            status = mr.get("detailed_merge_status")
            if status == "need_rebase":
                mr = self.rebase(ref, pid, iid, mr, owner)
                announced = False
                continue
            pipeline = mr.get("head_pipeline")
            if meta.get("has_ci", True):
                if not pipeline or pipeline.get("sha") not in (None, mr["sha"]):
                    self._announce_wait(ref, announced, "waiting for the pipeline of the new head")
                    announced = True
                    self.wait(POLL_SECONDS, "a pipeline for the head")
                    continue
                if pipeline.get("status") in BAD_PIPELINE:
                    raise Fail(f"pipeline {pipeline.get('status')}")
                if pipeline.get("status") == "manual":
                    raise Fail("the pipeline waits for a manual action")
                if pipeline.get("status") != "success":
                    self._announce_wait(ref, announced, f"pipeline {pipeline.get('status')}")
                    announced = True
                    self.wait(POLL_SECONDS, "the pipeline to succeed")
                    continue
            if status in mg_rules.TRANSIENT:
                self.wait(POLL_SECONDS, f"merge status {status} to settle")
                continue
            if status != "mergeable":
                raise Fail(f"not mergeable: {status}")
            break
        if announced:
            self.job.step(ref, "wait-green", "done", "pipeline success")
        self._merge(ref, pid, iid, mr)

    def _announce_wait(self, ref: str, announced: bool, detail: str) -> None:
        if not announced:
            self.job.step(ref, "wait-green", "running", detail)

    def _merge(self, ref: str, pid: int, iid: int, mr: dict) -> None:
        sha = mr["sha"]
        self.job.step(ref, "merge", "running", f"sha={sha[:8]}")
        remove = "true" if self.settings["delete_source_branch"] else "false"
        try:
            self.write(
                "merge", ref, sha,
                lambda: self.glab.put(self.mr_path(pid, iid, "/merge"), fields={"should_remove_source_branch": remove}, raw_fields={"sha": sha}),
            )
        except mg_glab.GlabError as exc:
            if exc.status == 409:
                raise Stop(f"head moved during the merge: {exc.message}") from exc
            raise Fail(f"merge refused: {exc.message}") from exc
        for _ in range(VERIFY_POLLS):
            now = self.read(pid, iid)
            if now.get("state") == "merged":
                self.job.step(ref, "merge", "done", f"merged {sha[:8]}")
                return
            CLOCK.sleep(VERIFY_SECONDS)
        raise Fail("the merge call succeeded but the MR is not merged")

    # ---- single-MR writes ----
    def rebase_flow(self, ref: str, pid: int, iid: int, expected_sha: str | None) -> None:
        self.start_clock()
        self.job.step(ref, "reread", "running", "")
        mr = self.read(pid, iid)
        owner = self.owner(mr)
        no = refusal("rebase", mr, owner)
        if no is not None:
            raise Stop(no.detail)
        if expected_sha and mr["sha"] != expected_sha:
            raise Stop(f"head moved: expected {expected_sha[:8]}, now {mr['sha'][:8]}")
        self.job.step(ref, "reread", "done", f"head {mr['sha'][:8]}")
        self.rebase(ref, pid, iid, mr, owner)

    def retry_flow(self, ref: str, pid: int, iid: int) -> None:
        self.job.step(ref, "reread", "running", "")
        mr = self.read(pid, iid)
        no = refusal("retry-pipeline", mr, self.owner(mr))
        if no is not None:
            raise Stop(no.detail)
        pipeline = mr["head_pipeline"]
        self.job.step(ref, "reread", "done", f"pipeline {pipeline['id']} {pipeline['status']}")
        self.job.step(ref, "retry-pipeline", "running", "")
        try:
            result = self.write("retry_pipeline", ref, mr["sha"], lambda: self.glab.post(f"projects/{pid}/pipelines/{pipeline['id']}/retry"))
        except mg_glab.GlabError as exc:
            raise Fail(f"retry refused: {exc.message}") from exc
        self.job.step(ref, "retry-pipeline", "done", f"pipeline {(result or {}).get('status', 'started')}")

    def ready_flow(self, ref: str, pid: int, iid: int) -> None:
        self.job.step(ref, "reread", "running", "")
        mr = self.read(pid, iid)
        no = refusal("ready", mr, self.owner(mr))
        if no is not None:
            raise Stop(no.detail)
        self.job.step(ref, "reread", "done", "draft")
        self.job.step(ref, "ready", "running", "")
        title = mg_rules.strip_draft(mr.get("title") or "")
        try:
            self.write("ready", ref, mr["sha"], lambda: self.glab.put(self.mr_path(pid, iid), raw_fields={"title": title}))
        except mg_glab.GlabError as exc:
            raise Fail(f"could not mark ready: {exc.message}") from exc
        after = self.read(pid, iid)
        if after.get("draft"):
            raise Fail("the title was changed but GitLab still reports a draft")
        self.job.step(ref, "ready", "done", "no longer a draft")

    # ---- Renovate hold (D63) ----
    def hold_flow(self, ref: str, pid: int, iid: int, plan: dict) -> None:
        self.job.step(ref, "reread", "running", "")
        mr = self.read(pid, iid)
        no = refusal("renovate-hold", mr, self.owner(mr))
        if no is not None:
            raise Stop(no.detail)
        self.job.step(ref, "reread", "done", f"head {mr['sha'][:8]}")
        self.job.step(ref, "hold-commit", "running", plan["branch"])
        body = {
            "branch": plan["branch"], "start_branch": plan["default_branch"], "commit_message": plan["commit_message"],
            "actions": [{"action": "update", "file_path": "renovate.json", "content": plan["content"]}],
        }
        try:
            self.write("hold_commit", ref, None, lambda: self.glab.post(f"projects/{pid}/repository/commits", body=body))
        except mg_glab.GlabError as exc:
            raise Fail(f"could not commit the hold rule: {exc.message}") from exc
        self.job.step(ref, "hold-commit", "done", plan["branch"])
        self.job.step(ref, "hold-mr", "running", "")
        mr_body = {
            "source_branch": plan["branch"], "target_branch": plan["default_branch"], "title": plan["mr_title"],
            "description": plan["mr_description"], "remove_source_branch": True,
        }
        try:
            made = self.write("hold_mr", ref, None, lambda: self.glab.post(f"projects/{pid}/merge_requests", body=mr_body))
        except mg_glab.GlabError as exc:
            raise Fail(f"hold branch committed but the draft MR failed: {exc.message}") from exc
        self.job.step(ref, "hold-mr", "done", (made or {}).get("web_url", ""))


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:60] or "package"


def hold_snippet(package: str, until: str, today: str) -> str:
    rule = {"description": f"mergeable hold set {today} until {until}", "matchPackageNames": [package], "enabled": False}
    return json.dumps({"packageRules": [rule]}, indent=2)


def build_hold(renovate_json: str, package: str, until: str, today: str) -> str:
    """renovate.json text with one packageRules entry added; raises ValueError when it cannot be done safely."""
    data = json.loads(renovate_json)
    if not isinstance(data, dict):
        raise ValueError("renovate.json is not an object")
    rule = {"description": f"mergeable hold set {today} until {until}", "matchPackageNames": [package], "enabled": False}
    indent_match = re.search(r"^([ \t]+)\S", renovate_json, re.M)
    indent = indent_match.group(1) if indent_match else "  "
    trailing = "\n" if renovate_json.endswith("\n") else ""
    if "packageRules" not in data:
        body = renovate_json.rstrip()
        if not body.endswith("}"):
            raise ValueError("renovate.json does not end with a closing brace")
        block = json.dumps([rule], indent=indent).replace("\n", "\n" + indent)
        text = body[:-1].rstrip() + f",\n{indent}\"packageRules\": {block}\n}}" + trailing
    else:
        if not isinstance(data["packageRules"], list):
            raise ValueError("packageRules is not a list")
        data["packageRules"].append(rule)
        text = json.dumps(data, indent=indent, ensure_ascii=False) + trailing
    expected = json.loads(renovate_json)
    expected["packageRules"] = [*expected.get("packageRules", []), rule]
    if json.loads(text) != expected:
        raise ValueError("the edited renovate.json does not parse to the expected content")
    return text


# ---- job runners (called from mg_service in a job thread) ----
def run_guarded(job, ref: str, fn) -> str:
    try:
        fn()
        return "done"
    except Stop as exc:
        job.step(ref, "stopped", "failed", str(exc))
        return "stopped"
    except Fail as exc:
        job.step(ref, "failed", "failed", str(exc))
        return "failed"


def run_batch(actor: Actor, order: list[dict]) -> str:
    """Land `order` (items: ref, project_id, iid, sha) one at a time; stop at the first failure."""
    job = actor.job
    for index, entry in enumerate(order):
        outcome = run_guarded(job, entry["ref"], lambda e=entry: actor.merge_flow(e["ref"], e["project_id"], e["iid"], e["sha"]))
        if outcome != "done":
            for rest in order[index + 1:]:
                job.step(rest["ref"], "skipped", "skipped", f"not attempted: the batch stopped at {entry['ref']}")
            return outcome
    return "done"


def run_audit(actor: Actor, items: list[dict]) -> str:
    """Audit Renovate MRs one at a time through mg_audit.audit_mr (the model layer); store each result."""
    job = actor.job
    try:
        audit_module = importlib.import_module("mg_audit")
    except ImportError:
        job.step(items[0]["ref"] if items else "", "audit", "failed", "the audit module is not installed")
        return "failed"
    final = "done"
    for item in items:
        ref, sha = item["ref"], item["sha"]
        job.step(ref, "audit", "running", "")
        mg_store.set_state(actor.home, ref, sha, "running")
        try:
            result = audit_module.audit_mr(actor.home, actor.settings, {k: v for k, v in item.items() if not k.startswith("_")})
            mg_store.put_audit(actor.home, ref, sha, result)
        except Exception as exc:
            mg_store.set_state(actor.home, ref, sha, "error", f"{type(exc).__name__}: {exc}"[:300])
            job.step(ref, "audit", "failed", f"{type(exc).__name__}: {exc}"[:300])
            final = "failed"
            continue
        job.step(ref, "audit", "done", str((result or {}).get("verdict", "")))
    return final
