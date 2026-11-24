"""mergeable backend, mounted at /api/plugins/mergeable/.

GET  /mrs[?refresh=1]                    open MRs of the profile's GitLab projects, one Item each
POST /mrs/{project_id}/{iid}/rebase      {expected_sha}; own MR: server rebase, Renovate MR: its rebase box
POST /mrs/{project_id}/{iid}/merge       {expected_sha}; re-read, one rebase if needed, wait for green, PUT merge with sha=
POST /mrs/{project_id}/{iid}/retry-pipeline | ready | audit | renovate-hold {package, until}
POST /audit/all                          audit every Renovate MR again
POST /batch/trivial                      {refs, shas}; the server's trivial set must equal it
GET  /jobs, /jobs/{id}                   write jobs (202 {job_id} from every POST); /status.md Markdown summary

Writes return 202 {job_id}; errors: 403 colleague's MR, 404 unknown MR, 409 head or set changed, 422 bad
body, 423 another write job on that project. GitLab is reached through glab argv lists only. Handlers are
plain `def` so the threadpool runs glab and sqlite, never the event loop. The logic sits in the mg_*
modules beside this file; the dashboard imports this file by path, so the directory goes on sys.path first.
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Response

_HERE = str(Path(__file__).resolve().parent)
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import mg_service as svc  # noqa: E402

log = logging.getLogger(__name__)
router = APIRouter()


def _profile(home: Path) -> str:
    try:
        from hermes_cli.profiles import get_active_profile_name

        return str(get_active_profile_name())
    except Exception:
        log.debug("mergeable: profile name falls back to the home directory name", exc_info=True)
        return "default" if home.name == ".hermes" else home.name


def _guard(call, *args):
    try:
        return call(*args)
    except svc.ServiceError as exc:
        raise HTTPException(exc.status, exc.detail) from exc


@router.get("/mrs")
def mrs(refresh: int = Query(0)) -> dict:
    home = svc.home_dir()
    return _guard(svc.mrs_payload, home, _profile(home), bool(refresh))


@router.post("/mrs/{project_id}/{iid}/rebase", status_code=202)
def rebase(project_id: int, iid: int, body: dict | None = None) -> dict:
    home = svc.home_dir()
    return _guard(svc.start_rebase, home, _profile(home), project_id, iid, body)


@router.post("/mrs/{project_id}/{iid}/merge", status_code=202)
def merge(project_id: int, iid: int, body: dict | None = None) -> dict:
    home = svc.home_dir()
    return _guard(svc.start_merge, home, _profile(home), project_id, iid, body)


@router.post("/mrs/{project_id}/{iid}/retry-pipeline", status_code=202)
def retry_pipeline(project_id: int, iid: int, body: dict | None = None) -> dict:
    home = svc.home_dir()
    return _guard(svc.start_retry, home, _profile(home), project_id, iid, body)


@router.post("/mrs/{project_id}/{iid}/ready", status_code=202)
def ready(project_id: int, iid: int, body: dict | None = None) -> dict:
    home = svc.home_dir()
    return _guard(svc.start_ready, home, _profile(home), project_id, iid, body)


@router.post("/mrs/{project_id}/{iid}/audit", status_code=202)
def audit(project_id: int, iid: int, body: dict | None = None) -> dict:
    home = svc.home_dir()
    return _guard(svc.start_audit, home, _profile(home), project_id, iid, body)


@router.post("/mrs/{project_id}/{iid}/renovate-hold", status_code=202)
def renovate_hold(project_id: int, iid: int, body: dict | None = None) -> dict:
    home = svc.home_dir()
    return _guard(svc.start_hold, home, _profile(home), project_id, iid, body)


@router.post("/audit/all", status_code=202)
def audit_all(body: dict | None = None) -> dict:
    home = svc.home_dir()
    return _guard(svc.start_audit_all, home, _profile(home), body)


@router.post("/batch/trivial", status_code=202)
def batch_trivial(body: dict | None = None) -> dict:
    home = svc.home_dir()
    return _guard(svc.start_batch, home, _profile(home), body)


@router.get("/jobs")
def jobs() -> list:
    return svc.jobs_payload()


@router.get("/jobs/{job_id}")
def job(job_id: str) -> dict:
    return _guard(svc.job_payload, job_id)


@router.get("/status.md")
def status_md() -> Response:
    home = svc.home_dir()
    return Response(content=_guard(svc.status_markdown, home, _profile(home)), media_type="text/markdown")
