"""Stand-in for api.github.com and raw.githubusercontent.com: a loopback HTTP server the audit tests point at.

`FakeGithub` serves, from plain dicts, the four reads the audit makes: `GET /api/repos/<o>/<r>/releases`,
`/api/repos/<o>/<r>/security-advisories/<ghsa>`, `/api/advisories/<ghsa>`, `/api/repos/<o>/<r>/commits` and
`GET /raw/<o>/<r>/<ref>/CHANGELOG.md`. Item key sets are the ones recorded from the real API on 2026-10-23
(`curl https://api.github.com/repos/traefik/traefik/releases?per_page=2` and the advisory and commit
endpoints, jq keys), so code cannot lean on a field the real answer lacks. The API side counts hits and
sends `x-ratelimit-limit: 60` with a falling `x-ratelimit-remaining` like the unauthenticated API; a path in
`rate_limited` answers 403 with remaining 0. A request for something unknown is a 404 with GitHub's body.
"""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

RELEASE_KEYS = (
    "assets assets_url author body created_at draft html_url id immutable mentions_count name node_id prerelease "
    "published_at reactions tag_name tarball_url target_commitish updated_at upload_url url zipball_url"
).split()
REPO_ADVISORY_KEYS = (
    "author closed_at collaborating_teams collaborating_users comments created_at credits credits_detailed cve_id cvss "
    "cvss_severities cwe_ids cwes description ghsa_id html_url identifiers private_fork published_at publisher severity "
    "state submission summary updated_at url vulnerabilities withdrawn_at"
).split()
GLOBAL_ADVISORY_KEYS = (
    "comments credits cve_id cvss cvss_severities cwes description epss ghsa_id github_reviewed_at html_url identifiers "
    "nvd_published_at published_at references repository_advisory_url severity source_code_location summary type "
    "updated_at url vulnerabilities withdrawn_at"
).split()
COMMIT_KEYS = "author comments_url commit committer html_url node_id parents sha url".split()


def release(tag: str, body: str = "", published: str = "2026-10-01T10:00:00Z", prerelease: bool = False, draft: bool = False) -> dict:
    out = dict.fromkeys(RELEASE_KEYS)
    out.update(tag_name=tag, name=tag, body=body, published_at=published, prerelease=prerelease, draft=draft)
    return out


def advisory(ghsa: str, severity: str = "high", cve: str | None = None, v3: float | None = None, v4: float | None = None,
             summary: str = "an advisory", repo_level: bool = True) -> dict:
    out = dict.fromkeys(REPO_ADVISORY_KEYS if repo_level else GLOBAL_ADVISORY_KEYS)
    out.update(ghsa_id=ghsa, cve_id=cve, severity=severity, summary=summary,
               cvss={"vector_string": None, "score": v3},
               cvss_severities={"cvss_v3": {"vector_string": None, "score": v3}, "cvss_v4": {"vector_string": None, "score": v4}})
    return out


def commit(sha: str, message: str, date: str = "2026-10-16T20:20:26Z") -> dict:
    out = dict.fromkeys(COMMIT_KEYS)
    out.update(sha=sha, commit={"author": {"name": "x", "email": "x@example.invalid", "date": date}, "message": message})
    return out


class FakeGithub:
    def __init__(self):
        self.releases: dict[str, list[dict]] = {}
        self.repo_advisories: dict[tuple[str, str], dict] = {}
        self.global_advisories: dict[str, dict] = {}
        self.commits: dict[str, list[dict]] = {}
        self.changelogs: dict[str, str] = {}
        self.rate_limited: set[str] = set()
        self.remaining = 60
        self.hits: list[str] = []
        self._lock = threading.Lock()
        handler = self._handler()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    @property
    def api(self) -> str:
        return f"http://127.0.0.1:{self.server.server_port}/api"

    @property
    def raw(self) -> str:
        return f"http://127.0.0.1:{self.server.server_port}/raw"

    def __enter__(self) -> FakeGithub:
        self.thread.start()
        return self

    def __exit__(self, *_exc) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(5)

    def api_hits(self) -> list[str]:
        return [h for h in self.hits if h.startswith("/api/")]

    def _handler(self):
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                return

            def _send(self, code: int, body, content_type: str = "application/json", api: bool = True) -> None:
                data = body.encode() if isinstance(body, str) else json.dumps(body).encode()
                self.send_response(code)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(data)))
                if api:
                    self.send_header("x-ratelimit-limit", "60")
                    self.send_header("x-ratelimit-remaining", str(outer.remaining))
                self.end_headers()
                self.wfile.write(data)

            def do_GET(self):
                url = urlsplit(self.path)
                query = parse_qs(url.query)
                with outer._lock:
                    outer.hits.append(self.path)
                    if url.path.startswith("/api/"):
                        outer.remaining = max(0, outer.remaining - 1)
                parts = url.path.strip("/").split("/")
                if parts[0] == "raw":
                    text = outer.changelogs.get("/".join(parts[1:]))
                    if text is None:
                        return self._send(404, "404: Not Found", "text/plain", api=False)
                    return self._send(200, text, "text/plain", api=False)
                if url.path in outer.rate_limited or any(url.path.startswith(p) for p in outer.rate_limited):
                    with outer._lock:
                        outer.remaining = 0
                    return self._send(403, {"message": "API rate limit exceeded", "documentation_url": "https://docs.github.com/rest"})
                rest = parts[1:]
                if len(rest) == 4 and rest[0] == "repos" and rest[3] == "releases":
                    repo = f"{rest[1]}/{rest[2]}"
                    per, page = int(query.get("per_page", ["30"])[0]), int(query.get("page", ["1"])[0])
                    rows = outer.releases.get(repo, [])
                    return self._send(200, rows[(page - 1) * per: page * per])
                if len(rest) == 5 and rest[0] == "repos" and rest[3] == "security-advisories":
                    found = outer.repo_advisories.get((f"{rest[1]}/{rest[2]}", rest[4]))
                    return self._send(200 if found else 404, found or {"message": "Not Found", "documentation_url": "x", "status": "404"})
                if len(rest) == 2 and rest[0] == "advisories":
                    found = outer.global_advisories.get(rest[1])
                    return self._send(200 if found else 404, found or {"message": "Not Found", "documentation_url": "x", "status": "404"})
                if len(rest) == 4 and rest[0] == "repos" and rest[3] == "commits":
                    key = f"{rest[1]}/{rest[2]}" + (f":{query['path'][0]}" if "path" in query else "")
                    return self._send(200, outer.commits.get(key, []))
                return self._send(404, {"message": "Not Found", "documentation_url": "x", "status": "404"})

        return Handler
