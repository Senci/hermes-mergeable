"""Renovate audit (D60 as amended by D69, D61): code fetches the upstream notes, the model only rates.

`audit_mr(home, settings, item)` is the hook W1's audit job calls. It reads the MR through glab (GET only),
fetches every release note of the bump range from GitHub (releases, CHANGELOG sections, GHSA advisories,
official-images commits for digest bumps), asks the first model of `audit_models` and escalates to the next
one (with the first reply as `first_pass`) when it is not sure or its reply fails validation, and returns the
audit dict. The job stores it under `<ref>@<sha>` through mg_store.put_audit and keeps the state rows.

The model call is `hermes chat --query-file <0600 file> ... --safe-mode --source tool -t clarify`: the notes
are third-party text, so the child gets no tools (`-t clarify`, the tool-less form; `-t none` is rejected),
the text travels in a file never in argv, and `--source tool` keeps the call out of the Sessions sidebar.
Ported from the Renovate audit prototype; its enums, `parse_reply` and caps are kept.
"""

from __future__ import annotations

import contextlib
import datetime
import json
import logging
import os
import re
import signal
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

import mg_glab
import mg_jobs
import mg_rules

log = logging.getLogger("mergeable.audit")

PROMPT_FILE = Path(__file__).resolve().parent / "audit_prompt.md"
API_BASE = "https://api.github.com"
RAW_BASE = "https://raw.githubusercontent.com"
CALL_TIMEOUT = 300
HTTP_TIMEOUT = 60
CACHE_TTL = 3600
PROVIDER = "anthropic"
CHILD_HOME_VAR = "MERGEABLE_AUDIT_CHILD_HERMES_HOME"
DEFAULT_MODELS = ["claude-haiku-5-5", "claude-opus-5-5"]
NOTE_CAP, CHANGELOG_CAP, TOTAL_CAP = 8000, 24000, 90000
DIFF_CAP, CONTEXT_LINES, CONTEXT_LINE_CAP, CONTEXT_FILES = 3000, 150, 220, 50
BAD_CHARS = re.compile("[\u2014\u2013\u2026\u201c\u201d\u2018\u2019\u2192\u2190]")
SECRETISH = re.compile(r"(?i)(password|secret|token|api[_-]?key|vault)")
KEY_SHAPE = re.compile(r"(?i)(^|[^a-z0-9])(sk-|glpat-|gh[pousr]_|xox[a-z]-|akia)|-----BEGIN|authorization:|bearer ")
GITHUB_REPO = re.compile(r"https://github\.com/([\w.-]+/[\w.-]+?)(?:\.git)?(?=[/)\s#]|$)")
# Renovate links the packaging repo; the changelog lives in the app repo.
UPSTREAM = {
    "docker.io/library/traefik": ("traefik/traefik", "traefik"),
    "docker.io/onlyoffice/documentserver": ("ONLYOFFICE/DocumentServer", "onlyoffice"),
    "docker.io/library/postgres": ("docker-library/postgres", "postgres"),
}
ENUMS = {
    "importance": {"critical", "high", "medium", "low", "none"},
    "ease": {"trivial", "easy", "medium", "hard"},
    "verdict": {"merge", "merge_with_followup", "needs_change", "hold"},
    "confidence": {"sure", "not_sure"},
}
FENCE = "audit-input"

_CACHE: dict[str, tuple[float, Any]] = {}
_CACHE_LOCK = threading.Lock()
RATE: dict[str, int | None] = {"remaining": None, "limit": None}


class AuditError(Exception):
    """No usable reply from any model; the job stores the message as the audit error."""


def reset_cache() -> None:
    with _CACHE_LOCK:
        _CACHE.clear()
    RATE.update(remaining=None, limit=None)


# ---- GitHub (unauthenticated, 60 requests an hour: every fetch is cached for CACHE_TTL) ----
def _cached(key: str, fetch):
    now = time.time()
    with _CACHE_LOCK:
        hit = _CACHE.get(key)
        if hit and hit[0] > now:
            return hit[1]
    value = fetch()
    with _CACHE_LOCK:
        _CACHE[key] = (now + CACHE_TTL, value)
    return value


def _open(url: str, accept: str):
    req = urllib.request.Request(url, headers={"Accept": accept, "User-Agent": "hermes-mergeable-audit"})
    return urllib.request.urlopen(req, timeout=HTTP_TIMEOUT)  # noqa: S310 - https GitHub, or the test server


def gh(path: str, missing_ok: bool = False) -> Any:
    """JSON from the GitHub API. A 404 is None when `missing_ok` (and cached, it costs rate); other errors raise."""

    def fetch():
        try:
            with _open(f"{API_BASE}/{path}", "application/vnd.github+json") as resp:
                _note_rate(resp.headers)
                return json.loads(resp.read())
        except urllib.error.HTTPError as exc:
            _note_rate(exc.headers)
            if exc.code == 404 and missing_ok:
                return None
            raise

    return _cached("api:" + path, fetch)


def raw(repo: str, ref: str, path: str) -> str:
    def fetch():
        with _open(f"{RAW_BASE}/{repo}/{ref}/{path}", "text/plain") as resp:
            return resp.read().decode("utf-8", "replace")

    return _cached(f"raw:{repo}/{ref}/{path}", fetch)


def _note_rate(headers) -> None:
    for key, name in (("remaining", "x-ratelimit-remaining"), ("limit", "x-ratelimit-limit")):
        value = (headers or {}).get(name)
        if value is not None and str(value).isdigit():
            RATE[key] = int(value)


def rate_note() -> str:
    if RATE["remaining"] is None:
        return "GitHub rate limit not reported"
    return f"GitHub rate remaining {RATE['remaining']}" + (f" of {RATE['limit']}" if RATE["limit"] else "")


# ---- fetchers (ported) ----
def vtuple(text: str | None) -> tuple[int, ...]:
    """Up to three leading version numbers; () when the text has none."""
    nums = re.findall(r"\d+", (text or "").split("@")[0].split("-")[0])
    return tuple(int(n) for n in nums[:3])


def releases_in_range(repo: str, frm: str, to: str) -> tuple[list[dict], list[str]]:
    lo, hi = vtuple(frm), vtuple(to)
    out: list[dict] = []
    seen: set = set()
    for page in (1, 2, 3):
        batch = gh(f"repos/{repo}/releases?per_page=100&page={page}") or []
        for rel in batch:
            ver = vtuple(rel.get("tag_name", ""))
            if rel.get("prerelease") or rel.get("draft") or not ver or ver in seen:
                continue
            if lo <= ver <= hi:
                seen.add(ver)
                out.append({"tag": rel["tag_name"], "published_at": (rel.get("published_at") or "")[:10],
                            "body": (rel.get("body") or "")[:NOTE_CAP]})
        if len(batch) < 100 or (batch and vtuple(batch[-1].get("tag_name", "")) and vtuple(batch[-1]["tag_name"]) < lo):
            break
    out.sort(key=lambda r: vtuple(r["tag"]))
    missing = [".".join(map(str, v)) for v in sorted({lo, hi} - seen)]
    return out, missing


def changelog_sections(repo: str, ref: str, frm: str, to: str) -> list[dict]:
    """Sections of CHANGELOG.md whose heading version lies in [frm, to]; used when release bodies only link to it."""
    lo, hi = vtuple(frm), vtuple(to)
    text = raw(repo, ref, "CHANGELOG.md")
    heads = [(m.start(), vtuple(m.group(1))) for m in re.finditer(r"^#{1,3}\s*\[?v?(\d+\.\d+(?:\.\d+)*)", text, re.M)]
    out = []
    for i, (pos, ver) in enumerate(heads):
        if ver and lo <= ver <= hi:
            end = heads[i + 1][0] if i + 1 < len(heads) else len(text)
            out.append({"tag": ".".join(map(str, ver)), "source": "CHANGELOG.md", "body": text[pos:end][:CHANGELOG_CAP]})
    return out


def advisories(repo: str | None, texts: list[str]) -> list[dict]:
    """Resolve GHSA ids named in the notes to severity and CVSS (repository advisories first, then reviewed ones)."""
    out = []
    for ghsa in sorted(set(re.findall(r"GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}", " ".join(texts)))):
        found, err = None, None
        paths = ([f"repos/{repo}/security-advisories/{ghsa}"] if repo else []) + [f"advisories/{ghsa}"]
        for path in paths:
            try:
                found = gh(path, missing_ok=True)
            except Exception as exc:  # rate limit or network: say so, do not guess
                err = str(exc)[:120]
                continue
            if found:
                break
        if not found:
            out.append({"ghsa": ghsa, "error": err or "not found"})
            continue
        sev = found.get("cvss_severities") or {}
        out.append({
            "ghsa": ghsa, "cve": found.get("cve_id"), "severity": found.get("severity"),
            "cvss": (sev.get("cvss_v4") or {}).get("score") or (sev.get("cvss_v3") or {}).get("score")
            or (found.get("cvss") or {}).get("score"),
            "summary": (found.get("summary") or "")[:200],
        })
    return out


def packaging_commits(repo: str | None, created_at: str, path_hint: str | None, library: str | None = None) -> list[dict]:
    """Upstream packaging commits plus official-images rebuild commits for library/<name> (a digest-only bump)."""
    stamp = datetime.datetime.fromisoformat(created_at.replace("Z", "+00:00")) - datetime.timedelta(days=21)
    since = stamp.strftime("%Y-%m-%dT%H:%M:%SZ")
    sources = ([(repo, path_hint)] if repo else []) + ([("docker-library/official-images", f"library/{library}")] if library else [])
    out = []
    for src, path in sources:
        data = gh(f"repos/{src}/commits?since={since}&per_page=40" + (f"&path={path}" if path else "")) or []
        out += [{"repo": src, "sha": c["sha"][:10], "date": c["commit"]["author"]["date"][:10],
                 "message": c["commit"]["message"][:600]} for c in data]
    return out


def our_context(glab, project_id: int, keyword: str) -> list[str]:
    """Lines of the project's default branch that name the package (GitLab blob search, GET): config, templates, defaults."""
    hits = glab.get(f"projects/{project_id}/search?scope=blobs&per_page={CONTEXT_FILES}&search={mg_glab.quote(keyword)}") or []
    out: list[str] = []
    for hit in hits:
        path = hit.get("path") or ""
        if path.startswith(".") or "/." in path or path.endswith((".md", ".txt")):
            continue
        for offset, line in enumerate((hit.get("data") or "").splitlines()):
            if keyword.lower() in line.lower() and not SECRETISH.search(line) and not KEY_SHAPE.search(line):
                out.append(f"{path}:{(hit.get('startline') or 1) + offset}:{line.strip()}"[:CONTEXT_LINE_CAP])
    return out[:CONTEXT_LINES]


# ---- document for the model ----
def source_repo(package: str, description: str) -> tuple[str | None, str]:
    """Upstream repo and the keyword for our_context: the table above, else the first github link of the package cell."""
    if package in UPSTREAM:
        return UPSTREAM[package]
    for line in (description or "").splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) == 3 and cells[1] in mg_rules.UPDATE_TYPES:
            match = GITHUB_REPO.search(cells[0])
            if match:
                return match.group(1), package.rsplit("/", 1)[-1]
    return None, package.rsplit("/", 1)[-1]


def _gl(glab, path: str, missing: list[str], what: str):
    try:
        return glab.get(path) or {}
    except mg_glab.GlabError as exc:
        missing.append(f"{what} could not be read: {exc.message[:120]}")
        return {}


def build_doc(item: dict, glab) -> dict:
    """The JSON the prompt describes. Every network gap lands in `missing` so the model sees it."""
    pid, iid = item["project_id"], item["iid"]
    missing: list[str] = []
    detail = _gl(glab, f"projects/{pid}/merge_requests/{iid}", missing, "the MR")
    changes = _gl(glab, f"projects/{pid}/merge_requests/{iid}/changes", missing, "the MR diff")
    row = item.get("renovate") or {}
    package, utype, frm, to = row.get("package"), row.get("update_type"), row.get("from"), row.get("to")
    if not package:
        raise AuditError("no Renovate package in the MR title or description")
    repo, keyword = source_repo(package, detail.get("description") or "")
    diff = "\n".join((c.get("diff") or "")[:DIFF_CAP] for c in changes.get("changes", []))
    doc: dict[str, Any] = {
        "mr": {"ref": item["ref"], "title": item.get("full_title") or item.get("title"), "diff": diff},
        "package": package, "update_type": utype, "from": frm, "to": to,
        "releases": [], "missing": missing, "commits": [], "our_context": [],
    }
    try:
        doc["our_context"] = our_context(glab, pid, keyword)
    except mg_glab.GlabError as exc:
        missing.append(f"our_context could not be read: {exc.message[:120]}")
    try:
        if utype == "digest":
            pinned = re.search(r'^\+\s*\S+: "([^"@]+)@sha256', diff, re.M)
            major = re.match(r"\d+", pinned.group(1)) if pinned else None
            doc["pinned_tag"] = pinned.group(1) if pinned else None
            library = package.split("docker.io/library/", 1)[1] if "docker.io/library/" in package else None
            doc["commits"] = packaging_commits(repo, item["created_at"], major.group(0) if major else None, library)
        elif repo and frm and to and vtuple(frm) and vtuple(to):
            doc["releases"], gone = releases_in_range(repo, frm, to)
            missing.extend(gone)
            _changelog_fallback(doc, repo, frm, to)
        else:
            missing.append("no upstream repository or version range known for this package")
        doc["advisories"] = advisories(repo, [r["body"] for r in doc["releases"] + doc.get("changelog", [])])
    except Exception as exc:  # network or rate limit: the model must see the gap
        missing.append(f"fetch failed: {exc}")
    _shrink(doc)
    return doc


def _changelog_fallback(doc: dict, repo: str, frm: str, to: str) -> None:
    releases = doc["releases"]
    if releases and not all(len(r["body"]) < 400 and "CHANGELOG" in r["body"] for r in releases):
        return
    sections = changelog_sections(repo, releases[-1]["tag"] if releases else "master", frm, to)
    if sections:
        doc["changelog"] = sections
    else:
        doc["missing"].append("release bodies only link to CHANGELOG.md and it has no matching section")


def _shrink(doc: dict) -> None:
    """Halve release and changelog bodies until the document fits TOTAL_CAP (floor 1500); the model is told."""
    notes = doc["releases"] + doc.get("changelog", [])
    shrunk = False
    while len(json.dumps(doc)) > TOTAL_CAP and any(len(r["body"]) > 1500 for r in notes):
        for rel in notes:
            rel["body"] = rel["body"][: max(1500, len(rel["body"]) // 2)]
        shrunk = True
    if shrunk:
        doc["missing"].append("some release notes truncated to fit")


# ---- model call ----
def _json_text(obj) -> str:
    # "<" as \u003c keeps a planted closing fence in a release note from ending the data block
    return json.dumps(obj, ensure_ascii=False).replace("<", "\\u003c")


def build_query(doc: dict, first_pass: dict | None) -> str:
    payload = doc if first_pass is None else {**doc, "first_pass": first_pass}
    return f"{PROMPT_FILE.read_text(encoding='utf-8').rstrip()}\n\n<{FENCE}>\n{_json_text(payload)}\n</{FENCE}>\n"


def profile_of(home: Path) -> str:
    return Path(home).name if Path(home).parent.name == "profiles" else "default"


def argv_for(profile: str, query_file: Path, model: str) -> list[str]:
    return [
        "hermes", "-p", profile, "chat", "--query-file", str(query_file), "--oneshot", "-Q", "-m", model,
        "--provider", PROVIDER, "--safe-mode", "--source", "tool", "-t", "clarify",
    ]


def child_env() -> dict:
    """The backend's environment without its dashboard token (the child needs none).

    `MERGEABLE_AUDIT_CHILD_HERMES_HOME` points the child at another HERMES_HOME: a sandbox backend home has no
    subscription (and the child would try to start a gateway there), so sandbox trials name the real home here.
    """
    env = {k: v for k, v in os.environ.items() if not k.startswith("HERMES_DASHBOARD")}
    if os.environ.get(CHILD_HOME_VAR):
        env["HERMES_HOME"] = os.environ[CHILD_HOME_VAR]
    return env


def call_model(home: Path, model: str, text: str, timeout: float | None = None) -> str:
    """One oneshot call; the reply text. The query file is 0600 under mergeable/tmp and removed in `finally`."""
    tmp_dir = Path(home) / "mergeable" / "tmp"
    tmp_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix="audit-", suffix=".txt", dir=tmp_dir)
    query_file = Path(name)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        try:
            proc = subprocess.Popen(
                argv_for(profile_of(home), query_file, model), env=child_env(), stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True,
            )
        except FileNotFoundError as exc:
            raise RuntimeError("hermes is not on PATH") from exc
        try:
            out, err = proc.communicate(timeout=timeout or CALL_TIMEOUT)
        except subprocess.TimeoutExpired:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(proc.pid, signal.SIGKILL)
            proc.communicate()
            raise RuntimeError(f"{model} timed out after {timeout or CALL_TIMEOUT}s") from None
        if proc.returncode != 0:
            raise RuntimeError(f"{model}: hermes exited {proc.returncode}: {' '.join((err or '').split())[:150]}")
        return out
    finally:
        query_file.unlink(missing_ok=True)


def split_reply(stdout: str) -> str:
    """The reply without a trailing blank line or `session_id:` line (the CLI prints those on stderr, kept for safety)."""
    lines = stdout.rstrip().splitlines()
    while lines and (not lines[-1].strip() or lines[-1].lstrip().startswith("session_id:")):
        lines.pop()
    return "\n".join(lines).strip()


def parse_reply(text: str, doc: dict) -> tuple[dict, list[str]]:
    """Exactly the prototype's check: enums, every release tag read, no dashes or curly quotes in a string."""
    start, end = text.find("{"), text.rfind("}")
    reply = json.loads(text[start:end + 1])
    if not isinstance(reply, dict):
        raise ValueError("reply is not a JSON object")
    errors = [f"bad {k}: {reply.get(k)}" for k, allowed in ENUMS.items() if reply.get(k) not in allowed]
    want = {r["tag"] for r in doc["releases"] + doc.get("changelog", [])}
    read = {str(x) for x in reply.get("releases_read", [])}
    unread = [t for t in want if t not in read and t.lstrip("v") not in {x.lstrip("v") for x in read}]
    if unread:
        errors.append(f"releases not read: {sorted(unread)}")
    if BAD_CHARS.search(json.dumps(reply, ensure_ascii=False)):
        errors.append("dash, ellipsis, curly quote or arrow in a string")
    return reply, errors


# ---- orchestration ----
def _report(ref: str, step: str, state: str, detail: str) -> None:
    """Add a step to the running audit job that owns `ref`, so the row shows progress (best effort)."""
    try:
        with mg_jobs.REGISTRY.lock:
            jobs = [j for j in mg_jobs.REGISTRY.jobs.values() if j.kind == "audit" and j.state == "running" and ref in j.refs]
        for job in jobs:
            job.step(ref, step, state, detail)
    except Exception:  # progress is cosmetic
        log.debug("mergeable: audit progress step dropped", exc_info=True)


def _log_run(home: Path, record: dict) -> None:
    try:
        directory = Path(home) / "mergeable"
        directory.mkdir(parents=True, exist_ok=True)
        with open(directory / "audit-runs.log", "a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")
    except OSError:
        log.debug("mergeable: audit run log not written", exc_info=True)


def _public_advisories(doc: dict) -> list[dict]:
    return [{"ghsa": a.get("ghsa"), "cve": a.get("cve"), "severity": a.get("severity"), "cvss": a.get("cvss")}
            for a in doc.get("advisories", [])]


def audit_mr(home: Path, settings: dict, item: dict, glab=None) -> dict:
    """Audit one Renovate item; returns the Audit dict, raises AuditError when no model gave a valid reply."""
    ref = item["ref"]
    started = time.time()
    glab = glab or mg_glab.Glab(settings["gitlab_host"])
    models = list(settings.get("audit_models") or DEFAULT_MODELS)
    doc = build_doc(item, glab)
    _report(ref, "fetch", "done", f"{len(doc['releases'])} releases, {len(doc.get('changelog', []))} changelog sections, "
            f"{len(doc.get('advisories', []))} advisories, {len(doc['commits'])} commits; {rate_note()}")
    runs: list[dict] = []
    errors_seen: list[str] = []
    best: tuple[str, dict] | None = None
    first_pass: dict | None = None
    for model in models:
        t0 = time.time()
        reply: dict = {}
        try:
            reply, errors = parse_reply(split_reply(call_model(home, model, build_query(doc, first_pass))), doc)
        except (RuntimeError, ValueError, TypeError, AttributeError) as exc:
            errors = [str(exc)[:200]]
        runs.append({"model": model, "seconds": round(time.time() - t0, 1), "errors": errors,
                     "confidence": reply.get("confidence") if not errors else None})
        _report(ref, model, "failed" if errors else "done",
                f"{runs[-1]['seconds']}s, " + (", ".join(errors) if errors else f"confidence {reply['confidence']}"))
        if errors:
            errors_seen.append(f"{model}: {'; '.join(errors)}")
            continue
        best, first_pass = (model, reply), reply
        if reply["confidence"] == "sure":
            break
    _log_run(home, {"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "ref": ref, "sha": item.get("sha"),
                    "runs": runs, "seconds": round(time.time() - started, 1), "github_rate_remaining": RATE["remaining"]})
    if best is None:
        raise AuditError("; ".join(errors_seen)[:300] or "no model reply")
    model, reply = best
    return {**reply, "model": model, "escalated": len(runs) > 1, "advisories": _public_advisories(doc)}
