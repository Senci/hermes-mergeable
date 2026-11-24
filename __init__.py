"""mergeable: open GitLab merge requests of this profile's projects, with guarded rebase and merge.

The surface is dashboard/plugin_api.py (backend routes) and desktop/plugin.js (pane, page, sidebar row).
The agent half registers no tools or hooks; every GitLab call goes through the operator's own glab login.
"""


def register(ctx) -> None:
    return None
