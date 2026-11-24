"""Audit store: $HERMES_HOME/mergeable/audits.db, one row per `<ref>@<sha>` (D61).

The hooks the audit layer (mg_audit) uses are `put_audit`, `set_state` and `needing_audit`. The database
is created on the first write; a read before that sees an empty store. Audits are keyed on the head sha,
so a new commit leaves the old row behind as a `stale` audit until the new one lands.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
import urllib.parse
from pathlib import Path

STATES = ("queued", "running", "done", "error")
INTERRUPTED = "interrupted by a restart"
_LOCK = threading.Lock()
_SWEPT: set[str] = set()
SCHEMA = (
    "create table if not exists audits ("
    " ref text not null, sha text not null, state text not null, audit text, error text, updated_at real not null,"
    " primary key (ref, sha))"
)


def store_dir(home: Path) -> Path:
    return Path(home) / "mergeable"


def db_path(home: Path) -> Path:
    return store_dir(home) / "audits.db"


def _read_conn(home: Path) -> sqlite3.Connection | None:
    path = db_path(home)
    if not path.exists():
        return None
    return sqlite3.connect("file:" + urllib.parse.quote(str(path)) + "?mode=ro", uri=True, timeout=5.0)


def _write_conn(home: Path) -> sqlite3.Connection:
    directory = store_dir(home)
    directory.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path(home), timeout=10.0)
    conn.execute(SCHEMA)
    return conn


def read_all(home: Path) -> dict[str, list[dict]]:
    """ref -> rows (newest first): {sha, state, audit, error, updated_at}."""
    conn = _read_conn(home)
    if conn is None:
        return {}
    try:
        rows = conn.execute("select ref, sha, state, audit, error, updated_at from audits order by updated_at desc").fetchall()
    except sqlite3.OperationalError:
        return {}
    finally:
        conn.close()
    out: dict[str, list[dict]] = {}
    for ref, sha, state, audit, error, updated in rows:
        out.setdefault(ref, []).append({
            "sha": sha, "state": state, "audit": json.loads(audit) if audit else None, "error": error, "updated_at": updated,
        })
    return out


def attach(home: Path, items: list[dict]) -> None:
    """Fill `audit` and `audit_state` on every item from the store."""
    stored = read_all(home)
    for item in items:
        item["audit"], item["audit_state"] = None, "none"
        if item["owner"] != "renovate":
            continue
        rows = stored.get(item["ref"], [])
        current = next((r for r in rows if r["sha"] == item["sha"]), None)
        if current is not None:
            item["audit"], item["audit_state"] = current["audit"], current["state"]
            if current["state"] in ("queued", "running", "error") and current["audit"] is None:
                older = next((r for r in rows if r["audit"] and r["state"] == "done"), None)
                item["audit"] = older["audit"] if older else None
            continue
        older = next((r for r in rows if r["audit"]), None)
        if older is not None:
            item["audit"], item["audit_state"] = older["audit"], "stale"


def put_audit(home: Path, ref: str, sha: str, audit: dict) -> None:
    """Store a finished audit for `ref@sha` (state done). `sha` and `audited_at` are set on the stored copy."""
    if not isinstance(audit, dict):
        raise TypeError("audit must be a dict")
    stored = dict(audit, sha=sha)
    stored.setdefault("audited_at", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    with _LOCK:
        conn = _write_conn(home)
        try:
            conn.execute(
                "insert into audits (ref, sha, state, audit, error, updated_at) values (?, ?, 'done', ?, null, ?) "
                "on conflict (ref, sha) do update set state='done', audit=excluded.audit, error=null, updated_at=excluded.updated_at",
                (ref, sha, json.dumps(stored, ensure_ascii=False), time.time()),
            )
            conn.commit()
        finally:
            conn.close()


def set_state(home: Path, ref: str, sha: str, state: str, error: str | None = None) -> None:
    """Mark `ref@sha` queued, running or error; an existing audit text stays so the old rating stays visible."""
    if state not in STATES or state == "done":
        raise ValueError(f"state must be one of queued, running, error (done goes through put_audit): {state!r}")
    with _LOCK:
        conn = _write_conn(home)
        try:
            conn.execute(
                "insert into audits (ref, sha, state, audit, error, updated_at) values (?, ?, ?, null, ?, ?) "
                "on conflict (ref, sha) do update set state=excluded.state, error=excluded.error, updated_at=excluded.updated_at",
                (ref, sha, state, error, time.time()),
            )
            conn.commit()
        finally:
            conn.close()


def sweep_interrupted(home: Path) -> int:
    """Once per backend start and home: queued or running rows left by a dead process become error rows."""
    key = str(home)
    with _LOCK:
        if key in _SWEPT:
            return 0
        _SWEPT.add(key)
    if not db_path(home).exists():
        return 0
    with _LOCK:
        conn = _write_conn(home)
        try:
            cur = conn.execute(
                "update audits set state='error', error=?, updated_at=? where state in ('queued', 'running')",
                (INTERRUPTED, time.time()),
            )
            conn.commit()
            return cur.rowcount
        finally:
            conn.close()


def forget_sweeps() -> None:
    """Tests and `service.reset()`: the next collect counts as the first after a start."""
    with _LOCK:
        _SWEPT.clear()


def needing_audit(home: Path, items: list[dict], force: bool = False) -> list[dict]:
    """Renovate items with no finished audit for their head sha and none queued or running.

    `error` rows are retried only when `force` is set, so a failing model call does not loop on every refresh.
    With `force` a finished audit for the sha counts as needing one again.
    """
    stored = read_all(home)
    out = []
    for item in items:
        if item["owner"] != "renovate" or item["draft"]:
            continue
        row = next((r for r in stored.get(item["ref"], []) if r["sha"] == item["sha"]), None)
        state = row["state"] if row else "none"
        if state in ("queued", "running"):
            continue
        if state == "done" and not force:
            continue
        if state == "error" and not force:
            continue
        out.append(item)
    return out
