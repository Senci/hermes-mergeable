"""glab client: argv lists only, never a shell, the operator's own glab login.

Every call is `glab api --hostname <host> --method <M> <path> ...`. The merge request endpoints are used
directly (PUT .../rebase, PUT .../merge with sha=), never `glab mr merge`, never `--rebase`, never
`merge_when_pipeline_succeeds` (glab-mr-merge rules); `_argv` refuses those spellings outright.
"""

from __future__ import annotations

import json
import re
import subprocess
import urllib.parse
from typing import Any

FORBIDDEN = ("--rebase", "merge_when_pipeline_succeeds")
HTTP_RE = re.compile(r"\(HTTP (\d{3})\)")
DEFAULT_TIMEOUT = 120


class GlabError(Exception):
    """glab exited non-zero. `status` is the HTTP status glab reports, or None (login, network, timeout)."""

    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status
        self.message = message


def quote(part: str) -> str:
    return urllib.parse.quote(str(part), safe="")


class Glab:
    def __init__(self, host: str, binary: str = "glab", timeout: int = DEFAULT_TIMEOUT):
        self.host = host
        self.binary = binary
        self.timeout = timeout
        self.calls = 0

    def _argv(self, method: str, path: str, fields: dict | None, raw_fields: dict | None, with_input: bool) -> list[str]:
        argv = [self.binary, "api", "--hostname", self.host]
        if method != "GET":
            argv += ["--method", method]
        argv.append(path)
        for key, value in (fields or {}).items():
            argv += ["--field", f"{key}={value}"]
        for key, value in (raw_fields or {}).items():
            argv += ["--raw-field", f"{key}={value}"]
        if with_input:
            argv += ["--input", "-", "--header", "Content-Type: application/json"]
        for part in argv:
            if any(bad in part for bad in FORBIDDEN):
                raise ValueError(f"refused glab argument: {part}")
        return argv

    def _run(self, method: str, path: str, fields=None, raw_fields=None, body: Any = None) -> str:
        argv = self._argv(method, path, fields, raw_fields, body is not None)
        self.calls += 1
        stdin = json.dumps(body) if body is not None else None
        try:
            done = subprocess.run(
                argv, input=stdin, stdin=None if stdin is not None else subprocess.DEVNULL,
                capture_output=True, text=True, timeout=self.timeout, check=False,
            )
        except FileNotFoundError as exc:
            raise GlabError("glab is not installed or not on PATH") from exc
        except subprocess.TimeoutExpired as exc:
            raise GlabError(f"glab timed out after {self.timeout}s: {method} {path}") from exc
        if done.returncode != 0:
            err = (done.stderr or "").strip() or (done.stdout or "").strip()
            match = HTTP_RE.search(err)
            raise GlabError(err[-300:] or f"glab exited {done.returncode}", int(match.group(1)) if match else None)
        return done.stdout

    def get(self, path: str) -> Any:
        text = self._run("GET", path)
        return json.loads(text) if text.strip() else None

    def get_text(self, path: str) -> str:
        return self._run("GET", path)

    def put(self, path: str, fields=None, raw_fields=None) -> Any:
        text = self._run("PUT", path, fields, raw_fields)
        return json.loads(text) if text.strip() else None

    def post(self, path: str, fields=None, raw_fields=None, body: Any = None) -> Any:
        text = self._run("POST", path, fields, raw_fields, body)
        return json.loads(text) if text.strip() else None

    def paged(self, path: str, per_page: int = 100, max_pages: int = 20) -> list:
        out: list = []
        sep = "&" if "?" in path else "?"
        for page in range(1, max_pages + 1):
            data = self.get(f"{path}{sep}per_page={per_page}&page={page}")
            if not data:
                break
            out.extend(data)
            if len(data) < per_page:
                break
        return out
