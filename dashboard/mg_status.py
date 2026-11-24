"""GET /status.md: the Copy status text (D68), open MRs grouped by project."""

from __future__ import annotations


def _state(item: dict) -> str:
    if item["draft"]:
        return "draft"
    if item["has_conflicts"]:
        return "conflict"
    return item["merge_status"]


def _audit(item: dict) -> str:
    audit = item.get("audit")
    if not audit or item.get("audit_state") in ("none", None):
        return "-"
    text = f"{audit.get('importance', '?')}/{audit.get('ease', '?')}/{audit.get('verdict', '?')}"
    return text if item["audit_state"] == "done" else f"{text} ({item['audit_state']})"


def render(view: dict) -> str:
    items = view["items"]
    projects: dict[str, list[dict]] = {}
    for item in items:
        projects.setdefault(item["project"], []).append(item)
    counts = {o: sum(1 for i in items if i["owner"] == o) for o in ("self", "renovate", "other")}
    batch = view["batch"]
    lines = [
        "# Open merge requests",
        "",
        f"{len(items)} open in {len(projects)} projects on {view['host']} ({view['generated_at']}): "
        f"{counts['self']} mine, {counts['renovate']} Renovate, {counts['other']} colleagues.",
        f"Trivial batch: {len(batch['refs'])} MRs, {batch['rebases']} rebases, {batch['pipelines']} extra pipelines.",
        "",
    ]
    for project in sorted(projects):
        lines.append(f"## {project} ({len(projects[project])})")
        for item in sorted(projects[project], key=lambda m: m["iid"]):
            pipeline = (item.get("pipeline") or {}).get("status") or "no pipeline"
            lines.append(
                f"- !{item['iid']} {item['title']} | {item['owner']} | {item['age_days']}d | {_state(item)} | "
                f"pipeline {pipeline} | audit {_audit(item)} | {item['web_url']}"
            )
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"
