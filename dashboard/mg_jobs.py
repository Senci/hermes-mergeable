"""Write jobs: an in-memory registry, one running write job per project (423), steps for the UI to poll.

A job runs in its own thread; the route returns 202 {job_id} at once. States: running, then done, failed
(an error: a red pipeline, a refused merge, a timeout, a second rebase of one MR) or stopped (a deliberate
refusal: a head that moved, a conflict). The registry keeps the last KEEP jobs; GET /jobs lists the newest LIST.
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from collections import OrderedDict

log = logging.getLogger("mergeable.jobs")

KEEP = 100
LIST = 20
AUDIT_LOCK = "audit"


class Busy(Exception):
    def __init__(self, key, job_id: str):
        super().__init__(f"another write job runs on {key}")
        self.key = key
        self.job_id = job_id


class Job:
    def __init__(self, kind: str, refs: list[str]):
        self.id = uuid.uuid4().hex[:12]
        self.kind = kind
        self.refs = refs
        self.state = "running"
        self.steps: list[dict] = []
        self.rebases = 0
        self.created = time.time()
        self.thread: threading.Thread | None = None
        self.lock = threading.Lock()

    def step(self, ref: str, step: str, state: str, detail: str = "") -> None:
        entry = {"ref": ref, "step": step, "state": state, "detail": detail,
                 "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        with self.lock:
            self.steps.append(entry)

    def to_dict(self) -> dict:
        with self.lock:
            return {"id": self.id, "kind": self.kind, "state": self.state, "refs": list(self.refs),
                    "rebases": self.rebases, "steps": [dict(s) for s in self.steps]}


class Registry:
    def __init__(self):
        self.lock = threading.Lock()
        self.jobs: OrderedDict[str, Job] = OrderedDict()
        self.busy: dict = {}

    def start(self, kind: str, keys: list, refs: list[str], runner) -> Job:
        """Claim `keys` (project ids, or AUDIT_LOCK), all or none, and run `runner(job)` in a thread.

        `runner` returns a final state ("done", "failed" or "stopped") or raises; a raise is a failed job.
        """
        job = Job(kind, refs)
        with self.lock:
            for key in keys:
                if key in self.busy:
                    raise Busy(key, self.busy[key])
            for key in keys:
                self.busy[key] = job.id
            self.jobs[job.id] = job
            while len(self.jobs) > KEEP:
                oldest = next(iter(self.jobs))
                if self.jobs[oldest].state == "running":
                    break
                self.jobs.pop(oldest)
        job.thread = threading.Thread(target=self._run, args=(job, keys, runner), name=f"mergeable-{job.id}", daemon=True)
        job.thread.start()
        return job

    def _run(self, job: Job, keys: list, runner) -> None:
        final = "failed"
        try:
            final = runner(job) or "done"
        except Exception as exc:
            log.exception("mergeable job %s crashed", job.id)
            job.step(job.refs[0] if job.refs else "", "crash", "failed", f"{type(exc).__name__}: {exc}"[:300])
        finally:
            with self.lock:
                job.state = final if final in ("done", "failed", "stopped") else "failed"
                for key in keys:
                    if self.busy.get(key) == job.id:
                        del self.busy[key]

    def get(self, job_id: str) -> Job | None:
        with self.lock:
            return self.jobs.get(job_id)

    def recent(self) -> list[dict]:
        with self.lock:
            jobs = list(self.jobs.values())[-LIST:]
        return [j.to_dict() for j in reversed(jobs)]

    def wait(self, job_id: str, timeout: float = 30.0) -> dict:
        """Test and script helper: join a job's thread and return its dict."""
        job = self.get(job_id)
        if job is None:
            raise KeyError(job_id)
        if job.thread is not None:
            job.thread.join(timeout)
        return job.to_dict()

    def reset(self) -> None:
        with self.lock:
            self.jobs.clear()
            self.busy.clear()


REGISTRY = Registry()
