"""Pure rules: owner, Renovate parse, what an action may do (`can`), the trivial set, urgency order.

Ported from the operator-reviewed prototype (page_template.html: rebaseState, mergeState, urgency,
trivialMiss, trivialPlan) and collect_mr_facts.py (owner). No I/O here.
"""

from __future__ import annotations

import datetime
import re

BOT_RE = re.compile(r"^(?:group|project)_\d+_bot(?:_\w+)?$")
UPDATE_TYPES = {"major", "minor", "patch", "digest", "pin", "pinDigest"}
IMPORTANCE_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3, "none": 4}
# detailed_merge_status values that only mean "not decided yet": a merge job waits through them.
TRANSIENT = {"checking", "unchecked", "ci_still_running", "preparing", "approvals_syncing"}
DRAFT_PREFIX = re.compile(r"^\s*(?:\[draft\]|\(draft\)|draft:)\s*", re.IGNORECASE)
TITLE_RE = re.compile(r"update (?P<pkg>\S+?)(?::(?P<tag>\S+))? (?:docker )?(?:tag|digest|image)?\s*to (?P<to>\S+)", re.IGNORECASE)


def owner_of(author: str, source_branch: str, user: str | None, prefix: str) -> str:
    """self = the glab user; renovate = bot author AND branch prefix; any other bot or user = other."""
    if user and author == user:
        return "self"
    if BOT_RE.match(author or "") and (source_branch or "").startswith(prefix):
        return "renovate"
    return "other"


def human_note(notes: list | None) -> dict | None:
    """{author, at} of the first note in a newest-first list that is neither a system note nor a bot's."""
    for note in notes or []:
        author = (note.get("author") or {}).get("username") or ""
        if note.get("system") or not author or BOT_RE.match(author) or not note.get("created_at"):
            continue
        return {"author": author, "at": _iso_utc(note["created_at"])}
    return None


def _iso_utc(text: str) -> str:
    try:
        when = datetime.datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return text
    return when.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def strip_draft(title: str) -> str:
    out = title or ""
    while True:
        new = DRAFT_PREFIX.sub("", out, count=1)
        if new == out:
            return out.strip()
        out = new


def _short(value: str | None) -> str | None:
    """A digest reads as its first 7 hex digits; versions stay as written."""
    if not value:
        return value
    if value.startswith("sha256:") or re.fullmatch(r"[0-9a-f]{12,}", value):
        return value.split(":")[-1][:7]
    return value


def _vtuple(text: str | None) -> tuple[int, ...] | None:
    nums = re.findall(r"\d+", (text or "").split("@")[0].split("-")[0])
    return tuple(int(n) for n in nums[:3]) if nums else None


def _infer_type(frm: str | None, to: str | None) -> str | None:
    a, b = _vtuple(frm), _vtuple(to)
    if frm and to and re.fullmatch(r"[0-9a-f]{6,}", frm) and re.fullmatch(r"[0-9a-f]{6,}", to):
        return "digest"
    if not a or not b:
        return None
    for index, name in enumerate(("major", "minor", "patch")):
        if index >= len(a) or index >= len(b):
            return None
        if a[index] != b[index]:
            return name
    return "patch"


def parse_renovate(title: str, description: str | None) -> dict:
    """{package, from, to, update_type} from Renovate's description table, else from the title.

    The table row is `| package | update | `from` -> `to` |`; the arrow is whatever glyph Renovate wrote,
    so the two backticked cells are read instead.
    """
    for line in (description or "").splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) == 3 and cells[1] in UPDATE_TYPES:
            package = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", cells[0]).split(" (")[0].strip()
            ticks = re.findall(r"`([^`]+)`", cells[2])
            if len(ticks) == 2:
                return {"package": package, "from": _short(ticks[0]), "to": _short(ticks[1]), "update_type": cells[1]}
    match = TITLE_RE.search(title or "")
    if match:
        package = match.group("pkg")
        to = _short(match.group("to"))
        return {"package": package, "from": None, "to": to, "update_type": None}
    return {"package": None, "from": None, "to": None, "update_type": None}


def renovate_title(parsed: dict, fallback: str) -> str:
    """`<package> <from> to <to>` with the registry prefix dropped, the prototype's pane title."""
    if not parsed.get("package") or not parsed.get("to"):
        return fallback
    package = parsed["package"]
    for prefix in ("docker.io/library/", "docker.io/"):
        if package.startswith(prefix):
            package = package[len(prefix):]
            break
    if parsed.get("from"):
        return f"{package} {parsed['from']} to {parsed['to']}"
    return f"{package} to {parsed['to']}"


def can_act(item: dict) -> dict:
    """What the row buttons may do now, with the reason the first disabled one gives (tooltip)."""
    owner, status = item["owner"], item["merge_status"]
    pipeline = (item.get("pipeline") or {}).get("status")
    has_ci = item.get("_has_ci", True)
    for blocked, why in ((owner == "other", "Colleague's MR, read only"), (item["draft"], "Draft")):
        if blocked:
            return {"rebase": False, "merge": False, "renovate_rebase": False, "reason": why, "rebase_reason": why}
    renovate = owner == "renovate"
    behind = status == "need_rebase"
    conflict = bool(item["has_conflicts"])
    if conflict and not renovate:
        rebase, rebase_reason = False, "Conflict: resolve it in the branch first"
    elif behind or (conflict and renovate):
        rebase = True
        rebase_reason = "Ask Renovate to rebase (ticks its rebase box)" if renovate else "Rebase once on the server (starts one pipeline)"
    else:
        rebase, rebase_reason = False, f"Already current with {item['target_branch']}"
    if conflict:
        merge, merge_reason = False, "Conflict"
    elif status == "need_rebase":
        merge, merge_reason = True, "Rebases once, waits for the pipeline, then merges"
    elif status in ("mergeable", "ci_still_running", "checking", "unchecked"):
        if has_ci and pipeline in ("failed", "canceled", "skipped"):
            merge, merge_reason = False, f"Pipeline {pipeline}"
        elif status == "mergeable" and (not has_ci or pipeline == "success"):
            merge, merge_reason = True, f"Merge into {item['target_branch']}"
        else:
            merge, merge_reason = True, "Waits for the pipeline, then merges"
    else:
        merge, merge_reason = False, f"Not mergeable: {status}"
    return {"rebase": rebase, "merge": merge, "renovate_rebase": rebase and renovate, "reason": merge_reason,
            "rebase_reason": rebase_reason}


def trivial_miss(item: dict, settings: dict) -> str:
    """First rule an MR fails, or '' when it is in the trivial batch (the prototype's trivialMiss)."""
    if item["draft"]:
        return "draft"
    if item["owner"] == "other":
        return "colleague's MR"
    if item["project"] in settings["trivial_never_projects"]:
        return "project is on the never-batch list"
    pipeline = (item.get("pipeline") or {}).get("status")
    if item.get("_has_ci", True) and pipeline != "success":
        return f"pipeline {pipeline or 'missing'}"
    if item["has_conflicts"]:
        return "conflict"
    status = item["merge_status"]
    if status != "mergeable" and not (settings["trivial_allow_rebase"] and status == "need_rebase"):
        return f"state {status}"
    if item["owner"] == "renovate":
        if not settings["trivial_renovate"]:
            return "Renovate rule off"
        audit = item.get("audit") if item.get("audit_state") == "done" else None
        if not audit:
            return "no audit yet"
        if audit.get("verdict") != "merge":
            return f"audit verdict {audit.get('verdict')}"
        if audit.get("ease") != "trivial":
            return f"audit ease {audit.get('ease')}"
        if settings["trivial_require_sure"] and audit.get("confidence") != "sure":
            return "audit not sure"
        return ""
    if not settings["trivial_own"]:
        return "own-MR rule off"
    title = (item["full_title"] or item["title"]).lower()
    prefixes = [p.lower() for p in settings["trivial_title_prefixes"]]
    if not any(title.startswith(p + ":") or title.startswith(p + "(") for p in prefixes):
        return "title prefix not in the list"
    if item["files_changed"] > settings["trivial_max_files"]:
        return f"{item['files_changed']} files (max {settings['trivial_max_files']})"
    return ""


def batch_plan(items: list[dict]) -> dict:
    """Landing order of the in-batch items: by project, mergeable first, then iid; rebase and pipeline cost."""
    chosen = [i for i in items if i["trivial"]["in_batch"]]
    by_project: dict[str, list[dict]] = {}
    for item in chosen:
        by_project.setdefault(item["project"], []).append(item)
    order: list[dict] = []
    rebases = pipelines = 0
    for project in sorted(by_project):
        group = sorted(by_project[project], key=lambda m: (0 if m["merge_status"] == "mergeable" else 1, m["iid"]))
        for index, item in enumerate(group):
            rebase = item["merge_status"] == "need_rebase" or (index > 0 and item["merge_method"] == "ff")
            rebases += 1 if rebase else 0
            pipelines += 1 if rebase and item.get("_has_ci", True) else 0
            order.append(item)
    return {"refs": [i["ref"] for i in order], "shas": [i["sha"] for i in order], "rebases": rebases, "pipelines": pipelines}


def urgency(item: dict) -> int:
    score = 50
    if item["draft"]:
        score += 40
    if item["owner"] == "other":
        score += 30
    if item["merge_status"] == "mergeable":
        score -= 20
    audit = item.get("audit")
    if audit:
        score -= (4 - IMPORTANCE_ORDER.get(audit.get("importance"), 4)) * 6
    if item["merge_status"] == "need_rebase":
        score -= 5
    return score


def sort_items(items: list[dict]) -> list[dict]:
    return sorted(items, key=lambda m: (urgency(m), -(m.get("age_days") or 0), m["project"], m["iid"]))


def checkbox_edit(description: str) -> tuple[str, str]:
    """Tick Renovate's rebase box: `[ ]` to `[x]` on the rebase-check line only, every other byte kept.

    Returns (new_description, state) with state "changed", "ticked" (already `[x]`) or "missing".
    """
    lines = (description or "").splitlines(keepends=True)
    for index, line in enumerate(lines):
        if "<!-- rebase-check -->" not in line:
            continue
        new = re.sub(r"\[ \]", "[x]", line, count=1)
        if new == line:
            return description, "ticked" if re.search(r"\[[xX]\]", line) else "missing"
        lines[index] = new
        return "".join(lines), "changed"
    return description, "missing"
