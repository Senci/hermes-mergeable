"""Plugin settings: plugins.entries.mergeable.settings with the config_schema defaults.

SCHEMA mirrors plugin.yaml (a test pins the two together). A value of the wrong type falls back to its
default, so a hand-edited config never breaks a route.
"""

from __future__ import annotations

import logging
from typing import Any

log = logging.getLogger("mergeable.settings")

PLUGIN_ID = "mergeable"

SCHEMA: dict[str, tuple[str, Any]] = {
    "gitlab_host": ("string", "gitlab.com"),
    "include_groups": ("array", []),
    "exclude_projects": ("array", []),
    "renovate_branch_prefix": ("string", "renovate/"),
    "session_profiles": ("array", []),
    "auto_audit": ("boolean", True),
    "trivial_renovate": ("boolean", True),
    "trivial_require_sure": ("boolean", True),
    "trivial_own": ("boolean", True),
    "trivial_title_prefixes": ("array", ["chore", "ci", "docs", "build"]),
    "trivial_max_files": ("integer", 10),
    "trivial_allow_rebase": ("boolean", True),
    "trivial_never_projects": ("array", []),
    "delete_source_branch": ("boolean", True),
    "merge_wait_minutes": ("integer", 45),
    "audit_models": ("array", ["claude-haiku-5-5", "claude-opus-5-5"]),
}
# Keys whose value must be positive to make sense.
POSITIVE = {"trivial_max_files", "merge_wait_minutes"}


def defaults() -> dict[str, Any]:
    return {key: (list(default) if isinstance(default, list) else default) for key, (_t, default) in SCHEMA.items()}


def read_entry() -> dict:
    """plugins.entries.mergeable.settings of the active profile's config; {} when Hermes is not importable."""
    try:
        from hermes_cli import config as hermes_config
    except ImportError:
        return {}
    loader = getattr(hermes_config, "load_config_readonly", None) or getattr(hermes_config, "load_config", None)
    if loader is None:
        return {}
    try:
        cfg = loader() or {}
        entry = ((cfg.get("plugins") or {}).get("entries") or {}).get(PLUGIN_ID) or {}
        settings = entry.get("settings")
        if settings is None:
            settings = entry.get("config")
        return settings if isinstance(settings, dict) else {}
    except Exception:
        log.debug("mergeable: config unreadable, using defaults", exc_info=True)
        return {}


def _coerce(kind: str, value: Any, default: Any, key: str) -> Any:
    if kind == "string":
        return value.strip() if isinstance(value, str) and value.strip() else default
    if kind == "boolean":
        return value if isinstance(value, bool) else default
    if kind == "integer":
        if isinstance(value, bool) or not isinstance(value, int):
            return default
        return value if (value > 0 or key not in POSITIVE) else default
    if kind == "array":
        if isinstance(value, list) and all(isinstance(v, str) for v in value):
            return [v.strip() for v in value if v.strip()]
        return list(default)
    return default


def load() -> dict[str, Any]:
    raw = read_entry()
    out = defaults()
    for key, (kind, default) in SCHEMA.items():
        if key in raw:
            out[key] = _coerce(kind, raw[key], out[key] if kind != "array" else default, key)
    return out


def rules(settings: dict) -> dict:
    """The part of the settings the trivial batch and merge jobs apply, echoed in GET /mrs."""
    keys = [k for k in SCHEMA if k.startswith("trivial_")] + ["delete_source_branch", "merge_wait_minutes"]
    return {k: settings[k] for k in keys}
