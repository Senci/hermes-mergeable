"""Source branch to the Hermes session that made it (port of map_mr_sessions.py).

Every state.db is opened `mode=ro`. A message that names the branch inside a tool call that pushes it or
opens the MR scores 10, any other mention 1; scores sum per lineage root (the id openSession takes).
Sessions with source `tool` (model-call children) are skipped, and the `sanitizer` profile is never read.
"""

from __future__ import annotations

import logging
import sqlite3
import threading
import time
import urllib.parse
from pathlib import Path

log = logging.getLogger("mergeable.sessions")

AUTHOR_MARKERS = ("git push", "glab mr create", "mr create", "--source-branch")
MIN_SCORE = 5
TTL_SECONDS = 300
# Profiles that are never opened, whatever session_profiles says.
NEVER_READ = {"sanitizer"}
_CACHE: dict[tuple[str, str], tuple[float, dict | None]] = {}
_LOCK = threading.Lock()


def open_readonly(path: Path) -> sqlite3.Connection:
    return sqlite3.connect("file:" + urllib.parse.quote(str(path)) + "?mode=ro", uri=True, timeout=5.0)


def state_dbs(home: Path, wanted: list[str]) -> list[tuple[str, Path]]:
    """(profile, state.db) for the default home and every profile, filtered by `wanted` (empty = all)."""
    home = Path(home)
    root = home.parent.parent if home.parent.name == "profiles" else home
    found: list[tuple[str, Path]] = []
    if (root / "state.db").exists():
        found.append(("default", root / "state.db"))
    profiles = root / "profiles"
    if profiles.is_dir():
        for entry in sorted(profiles.iterdir()):
            if (entry / "state.db").exists():
                found.append((entry.name, entry / "state.db"))
    return [(p, d) for p, d in found if p not in NEVER_READ and (not wanted or p in wanted)]


def _scan_db(profile: str, path: Path, branches: list[str]) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    try:
        con = open_readonly(path)
    except sqlite3.Error:
        log.debug("mergeable: %s unreadable", path, exc_info=True)
        return out
    try:
        meta = {
            row[0]: row[1:]
            for row in con.execute(
                "select id, parent_session_id, title, source, coalesce(last_activity_at, ended_at, started_at) from sessions"
            )
        }

        def root(sid: str) -> str:
            seen = set()
            while sid in meta and meta[sid][0] and sid not in seen:
                seen.add(sid)
                sid = meta[sid][0]
            return sid

        where = " or ".join("instr(coalesce(tool_calls,'') || ' ' || coalesce(content,''), ?) > 0" for _ in branches)
        rows = con.execute(f"select session_id, coalesce(tool_calls,''), coalesce(content,'') from messages where {where}", branches)
        scores: dict[tuple[str, str], int] = {}
        for sid, calls, content in rows:
            if sid in meta and meta[sid][2] == "tool":
                continue
            top = root(sid)
            for branch in branches:
                if branch in calls and any(marker in calls for marker in AUTHOR_MARKERS):
                    scores[(branch, top)] = scores.get((branch, top), 0) + 10
                elif branch in calls or branch in content:
                    scores[(branch, top)] = scores.get((branch, top), 0) + 1
        for (branch, top), score in scores.items():
            info = meta.get(top, (None, None, None, None))
            if info[2] == "tool":
                continue
            out.setdefault(branch, []).append({
                "id": top, "profile": profile, "title": (info[1] or "").replace("\u2026", "").strip() or None,
                "score": score, "last": info[3] or 0,
            })
    except sqlite3.Error:
        log.debug("mergeable: %s schema not as expected", path, exc_info=True)
    finally:
        con.close()
    return out


def map_branches(home: Path, wanted: list[str], branches: list[str]) -> dict[str, dict | None]:
    """branch -> {id, profile, title, score} for the best session scoring at least MIN_SCORE, else None."""
    now = time.time()
    key_home = str(home)
    result: dict[str, dict | None] = {}
    todo = []
    with _LOCK:
        for branch in dict.fromkeys(branches):
            hit = _CACHE.get((key_home, branch))
            if hit and now - hit[0] < TTL_SECONDS:
                result[branch] = hit[1]
            else:
                todo.append(branch)
    if todo:
        found: dict[str, list[dict]] = {}
        for profile, path in state_dbs(home, wanted):
            for branch, cands in _scan_db(profile, path, todo).items():
                found.setdefault(branch, []).extend(cands)
        with _LOCK:
            for branch in todo:
                cands = sorted(found.get(branch, []), key=lambda c: (-c["score"], -c["last"]))
                best = cands[0] if cands and cands[0]["score"] >= MIN_SCORE else None
                value = {k: best[k] for k in ("id", "profile", "title", "score")} if best else None
                _CACHE[(key_home, branch)] = (now, value)
                result[branch] = value
    return result


def reset() -> None:
    with _LOCK:
        _CACHE.clear()
