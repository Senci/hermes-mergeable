"""Collector and cache: open MRs of every member project, one Item each (spec: API contract).

Cold: list the member projects, list their open MRs, read project meta and one detail per MR. Warm
(`refresh`): re-list, and re-read a detail only for an MR whose head `sha` or `updated_at` moved, whose
pipeline was not green, or that is new. merge status, conflicts, draft and notes always come from the
list call, which GitLab recomputes. Facts persist in $HERMES_HOME/mergeable/facts.json (created on the
first collect) so a backend restart starts warm.
"""

from __future__ import annotations

import datetime
import json
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import mg_glab
import mg_rules
import mg_sessions
import mg_store

log = logging.getLogger("mergeable.collect")

UNSETTLED = {"unchecked", "checking"}
SETTLE_SECONDS = 2.5
SETTLE_ROUNDS = 2
SNAPSHOT_TTL = 45.0
DISCOVERY_TTL = 600.0
META_TTL = 3600.0
WORKERS = 16
NOTE_WINDOW = 20
LIST_KEYS = ("iid", "sha", "title", "author", "source_branch", "target_branch", "detailed_merge_status", "updated_at", "created_at", "web_url")


class CollectError(Exception):
    """glab could not list anything (not logged in, host unreachable)."""


def iso(text: str | None) -> str | None:
    if not text:
        return None
    try:
        when = datetime.datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return text
    return when.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def age_days(created: str | None, now: datetime.datetime) -> int:
    if not created:
        return 0
    when = datetime.datetime.fromisoformat(created.replace("Z", "+00:00"))
    return max((now - when).days, 0)


def _changes(raw) -> int:
    try:
        return int(str(raw).rstrip("+"))
    except (TypeError, ValueError):
        return 0


class Collector:
    def __init__(self, home: Path, settings: dict, glab: mg_glab.Glab, profile: str):
        self.home = Path(home)
        self.settings = settings
        self.glab = glab
        self.profile = profile
        self.lock = threading.RLock()
        self.meta_lock = threading.Lock()
        self.user: str | None = None
        self.projects: dict[int, dict] = {}
        self.discovered_at = 0.0
        self.active: set[int] = set()
        self.meta: dict[int, tuple[float, dict]] = {}
        self.facts: dict[str, dict] = {}
        self.snapshot: dict | None = None
        self.snapshot_at = 0.0
        self.last_stats: dict = {}
        self._load()

    # ---- persistence ----
    def _path(self) -> Path:
        return self.home / "mergeable" / "facts.json"

    def _load(self) -> None:
        try:
            data = json.loads(self._path().read_text())
        except (OSError, ValueError):
            return
        if data.get("host") != self.settings["gitlab_host"]:
            return
        self.facts = data.get("facts", {})
        self.meta = {int(k): (v["at"], v["meta"]) for k, v in data.get("meta", {}).items()}

    def _save(self) -> None:
        directory = self.home / "mergeable"
        try:
            directory.mkdir(parents=True, exist_ok=True)
            tmp = directory / "facts.json.tmp"
            tmp.write_text(json.dumps({
                "host": self.settings["gitlab_host"], "facts": self.facts,
                "meta": {str(k): {"at": at, "meta": m} for k, (at, m) in self.meta.items()},
            }))
            os.replace(tmp, directory / "facts.json")
        except OSError:
            log.debug("mergeable: facts cache not written", exc_info=True)

    # ---- GitLab reads ----
    def current_user(self) -> str:
        if self.user is None:
            try:
                data = self.glab.get("user")
            except mg_glab.GlabError as exc:
                raise CollectError(f"glab cannot read the GitLab user on {self.glab.host}: {exc.message}") from exc
            self.user = (data or {}).get("username")
            if not self.user:
                raise CollectError(f"GitLab user unknown on {self.glab.host}")
        return self.user

    def _discover(self) -> list[str]:
        warnings: list[str] = []
        try:
            raw = self.glab.paged("projects?membership=true&archived=false&simple=true")
        except mg_glab.GlabError as exc:
            raise CollectError(f"glab cannot list projects on {self.glab.host}: {exc.message}") from exc
        groups = [g.strip("/") for g in self.settings["include_groups"]]
        excluded = set(self.settings["exclude_projects"])
        projects: dict[int, dict] = {}
        for entry in raw:
            path = entry.get("path_with_namespace")
            if not path or "id" not in entry or path in excluded:
                continue
            if groups and not any(path == g or path.startswith(g + "/") for g in groups):
                continue
            projects[int(entry["id"])] = {"id": int(entry["id"]), "path": path}
        self.projects = projects
        self.discovered_at = time.time()
        return warnings

    def _list_open(self, pid: int):
        try:
            return pid, self.glab.paged(f"projects/{pid}/merge_requests?state=opened"), None
        except mg_glab.GlabError as exc:
            return pid, None, exc.message

    def project_meta(self, pid: int) -> dict:
        with self.meta_lock:
            hit = self.meta.get(pid)
        if hit and time.time() - hit[0] < META_TTL:
            return hit[1]
        project = self.glab.get(f"projects/{pid}") or {}
        default = project.get("default_branch") or "main"
        try:
            self.glab.get(f"projects/{pid}/repository/files/{mg_glab.quote('.gitlab-ci.yml')}?ref={mg_glab.quote(default)}")
            has_ci = True
        except mg_glab.GlabError as exc:
            if exc.status != 404:
                raise
            has_ci = False
        meta = {
            "path": project.get("path_with_namespace") or self.projects.get(pid, {}).get("path", str(pid)),
            "default_branch": default,
            "merge_method": project.get("merge_method") or "merge",
            "has_ci": has_ci,
        }
        with self.meta_lock:
            self.meta[pid] = (time.time(), meta)
        return meta

    def _needs_detail(self, ref: str, mr: dict) -> bool:
        fact = self.facts.get(ref)
        if not fact or fact.get("sha") != mr.get("sha") or fact.get("updated_at") != mr.get("updated_at"):
            return True
        if "reviewers" not in fact or fact.get("note_for") != fact.get("updated_at"):
            return True
        if mr.get("detailed_merge_status") in UNSETTLED:
            return True
        return (fact.get("pipeline") or {}).get("status") != "success"

    def _last_note(self, pid: int, iid: int) -> dict | None:
        """Newest note by a person: one one-note read, a second wider read only when that note is a system or bot note."""
        base = f"projects/{pid}/merge_requests/{iid}/notes?sort=desc&order_by=created_at"
        newest = self.glab.get(f"{base}&per_page=1") or []
        found = mg_rules.human_note(newest)
        if found or not newest:
            return found
        return mg_rules.human_note(self.glab.get(f"{base}&per_page={NOTE_WINDOW}") or [])

    def _read_detail(self, pid: int, mr: dict) -> dict:
        detail = self.glab.get(f"projects/{pid}/merge_requests/{mr['iid']}?with_merge_status_recheck=true") or {}
        head = detail.get("head_pipeline") or None
        updated = detail.get("updated_at") or mr.get("updated_at")
        before = self.facts.get(f"{self.projects[pid]['path']}!{mr['iid']}") or {}
        if "last_note" in before and before.get("note_for") == updated:
            note, note_for = before["last_note"], updated
        else:
            try:
                note, note_for = self._last_note(pid, mr["iid"]), updated
            except mg_glab.GlabError:
                log.debug("mergeable: notes of %s!%s unreadable", pid, mr["iid"], exc_info=True)
                note, note_for = before.get("last_note"), None
        return {
            "sha": detail.get("sha") or mr.get("sha"),
            "updated_at": updated,
            "files_changed": _changes(detail.get("changes_count")),
            "pipeline": {"status": head.get("status"), "url": head.get("web_url")} if head else None,
            "merge_status": detail.get("detailed_merge_status"),
            "has_conflicts": bool(detail.get("has_conflicts")),
            "reviewers": [r["username"] for r in detail.get("reviewers") or [] if r.get("username")],
            "last_note": note, "note_for": note_for,
        }

    # ---- build ----
    def collect(self, refresh: bool = False, strict: bool = False) -> dict:
        with self.lock:
            mg_store.sweep_interrupted(self.home)
            now = time.time()
            if not refresh and not strict and self.snapshot and now - self.snapshot_at < SNAPSHOT_TTL:
                return self.snapshot
            started = time.perf_counter()
            calls_before = self.glab_calls()
            user = self.current_user()
            full = refresh or not self.projects or now - self.discovered_at > DISCOVERY_TTL
            warnings: list[str] = []
            if full:
                self._discover()
            scan = list(self.projects) if full else [p for p in self.active if p in self.projects]
            listed: dict[int, list[dict]] = {}
            with ThreadPoolExecutor(WORKERS) as pool:
                for pid, mrs, err in pool.map(self._list_open, scan):
                    if err is not None:
                        warnings.append(f"{self.projects[pid]['path']}: {err}")
                    elif mrs:
                        listed[pid] = mrs
                if full:
                    self.active = set(listed)
                else:
                    self.active = self.active | set(listed)
                pairs = [(pid, mr) for pid, mrs in listed.items() for mr in mrs]
                metas = dict(zip(listed, pool.map(self._safe_meta, listed)))
                refs = {f"{self.projects[pid]['path']}!{mr['iid']}": (pid, mr) for pid, mr in pairs}
                todo = [(r, pid, mr) for r, (pid, mr) in refs.items() if strict or self._needs_detail(r, mr)]
                fresh, detail_warnings = self._read_details(pool, todo)
            warnings.extend(detail_warnings)
            self.facts = {r: f for r, f in self.facts.items() if r in refs or self.projects_not_scanned(r, scan)}
            items, schema_ok = [], True
            for ref, (pid, mr) in refs.items():
                item, ok = self._item(ref, pid, mr, metas.get(pid) or {}, user, ref in fresh)
                schema_ok = schema_ok and ok
                items.append(item)
            self._finish(items)
            payload = {
                "generated_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "profile": self.profile, "host": self.settings["gitlab_host"], "user": user, "schema_ok": schema_ok,
                "warnings": warnings, "items": items,
            }
            self._save()
            self.snapshot, self.snapshot_at = payload, time.time()
            self.last_stats = {
                "ms": round((time.perf_counter() - started) * 1000), "full": full, "projects_scanned": len(scan),
                "details_fetched": len(todo), "glab_calls": self.glab_calls() - calls_before, "items": len(items),
            }
            return payload

    def _read_details(self, pool, todo: list) -> tuple[set[str], list[str]]:
        """Read the detail of every (ref, project_id, list_entry) in `todo`; re-read the ones GitLab has not settled."""
        fresh: set[str] = set()
        failed: dict[str, str] = {}
        pending = todo
        for round_no in range(SETTLE_ROUNDS + 1):
            results = list(pool.map(lambda t: self._safe_detail(t[1], t[2]), pending))
            unsettled = []
            for entry, result in zip(pending, results):
                ref = entry[0]
                if isinstance(result, str):
                    failed[ref] = result
                    continue
                failed.pop(ref, None)
                self.facts[ref] = result
                fresh.add(ref)
                if result.get("merge_status") in UNSETTLED:
                    unsettled.append(entry)
            if not unsettled or round_no == SETTLE_ROUNDS:
                break
            time.sleep(SETTLE_SECONDS)
            pending = unsettled
        return fresh, [f"{ref}: {why}" for ref, why in failed.items()]

    def invalidate(self, refs: list[str]) -> None:
        """Forget the facts of `refs` and the snapshot age, so the next read after a write sees GitLab again."""
        with self.lock:
            for ref in refs:
                self.facts.pop(ref, None)
            self.snapshot_at = 0.0

    def projects_not_scanned(self, ref: str, scanned: list[int]) -> bool:
        path = ref.rsplit("!", 1)[0]
        return not any(self.projects.get(pid, {}).get("path") == path for pid in scanned)

    def glab_calls(self) -> int:
        return getattr(self.glab, "calls", 0)

    def _safe_meta(self, pid: int) -> dict | None:
        try:
            return self.project_meta(pid)
        except mg_glab.GlabError:
            log.debug("mergeable: project meta %s unreadable", pid, exc_info=True)
            return None

    def _safe_detail(self, pid: int, mr: dict):
        try:
            return self._read_detail(pid, mr)
        except mg_glab.GlabError as exc:
            return exc.message

    def _item(self, ref: str, pid: int, mr: dict, meta: dict, user: str, fresh: bool) -> tuple[dict, bool]:
        fact = self.facts.get(ref) or {}
        ok = all(key in mr for key in LIST_KEYS) and bool(fact)
        author = (mr.get("author") or {}).get("username") or "?"
        branch = mr.get("source_branch") or ""
        owner = mg_rules.owner_of(author, branch, user, self.settings["renovate_branch_prefix"])
        now = datetime.datetime.now(datetime.timezone.utc)
        full_title = mr.get("title") or ""
        title = mg_rules.strip_draft(full_title)
        renovate = None
        if owner == "renovate":
            renovate = mg_rules.parse_renovate(full_title, mr.get("description"))
            title = mg_rules.renovate_title(renovate, title)
        created = iso(mr.get("created_at"))
        status = mr.get("detailed_merge_status") or "unknown"
        conflicts = bool(mr.get("has_conflicts"))
        if fresh and fact.get("merge_status"):
            status, conflicts = fact["merge_status"], fact["has_conflicts"]
        item = {
            "ref": ref, "project": self.projects[pid]["path"], "project_id": pid, "iid": mr.get("iid"),
            "title": title, "full_title": full_title, "author": author, "owner": owner,
            "draft": bool(mr.get("draft", mr.get("work_in_progress", False))),
            "created_at": created, "age_days": age_days(created, now), "updated_at": iso(mr.get("updated_at")),
            "sha": mr.get("sha"), "source_branch": branch, "target_branch": mr.get("target_branch"),
            "web_url": mr.get("web_url"), "merge_status": status,
            "has_conflicts": conflicts, "merge_method": meta.get("merge_method", "merge"),
            "pipeline": fact.get("pipeline"), "files_changed": fact.get("files_changed", 0),
            "user_notes_count": mr.get("user_notes_count", 0), "renovate": renovate,
            "reviewers": list(fact.get("reviewers") or []), "last_note": fact.get("last_note"),
            "audit": None, "audit_state": "none", "session": None,
            "_has_ci": meta.get("has_ci", True), "_default_branch": meta.get("default_branch"),
            "_description": mr.get("description") or "",
        }
        return item, ok

    def _finish(self, items: list[dict]) -> None:
        branches = [i["source_branch"] for i in items if i["source_branch"]]
        sessions = mg_sessions.map_branches(self.home, self.settings["session_profiles"], branches) if branches else {}
        for item in items:
            item["session"] = sessions.get(item["source_branch"])
        items.sort(key=lambda m: (m["project"], m["iid"]))

    # ---- views derived on every read (audit rows and settings can change between collects) ----
    def view(self, payload: dict) -> dict:
        items = [dict(i) for i in payload["items"]]
        mg_store.attach(self.home, items)
        for item in items:
            item["can"] = mg_rules.can_act(item)
        for item in items:
            miss = mg_rules.trivial_miss(item, self.settings)
            item["trivial"] = {"in_batch": miss == "", "miss": miss}
        plan = mg_rules.batch_plan(items)
        ordered = mg_rules.sort_items(items)
        return {
            **{k: v for k, v in payload.items() if k != "items"},
            "rules": _rules(self.settings), "batch": plan, "items": ordered,
        }


def _rules(settings: dict) -> dict:
    import mg_settings

    return mg_settings.rules(settings)


def public(item: dict) -> dict:
    """The item as the API returns it: internal `_` fields dropped."""
    return {k: v for k, v in item.items() if not k.startswith("_")}
