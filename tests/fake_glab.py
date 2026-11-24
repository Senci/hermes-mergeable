#!/usr/bin/env python3
"""Stand-in for `glab api`, installed as <tmp>/bin/glab by support.World.

A small stateful GitLab: projects, merge requests with the key sets of the real list and detail
payloads (tests/fixtures/real_shapes.json, recorded from the real host with GET calls), a pipeline that
finishes after N reads, a rebase that completes after N reads, a merge that makes ff siblings need_rebase.
Every call appends {"argv", "stdin"} to $FAKE_GLAB_LOG; state lives in $FAKE_GLAB_STATE under an flock.
Errors mimic the real binary: rc 1, stdout {"message": ...}, stderr `glab: <message> (HTTP <code>)`.
The write paths follow the GitLab API docs only: no live write was allowed while this was built.
"""

import fcntl
import hashlib
import json
import os
import sys
import urllib.parse

STATE = os.environ["FAKE_GLAB_STATE"]
LOG = os.environ["FAKE_GLAB_LOG"]

LIST_DROP = {"head_pipeline", "changes_count", "rebase_in_progress", "merge_error", "diff_refs", "first_contribution",
             "latest_build_finished_at", "latest_build_started_at", "pipeline", "subscribed", "user", "first_deployed_to_production_at"}


class HttpError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code, self.message = code, message


def parse(argv):
    out = {"method": None, "path": None, "fields": {}, "raw": {}, "input": False, "host": None}
    it = iter(argv)
    for token in it:
        if token == "--hostname":
            out["host"] = next(it)
        elif token == "--method":
            out["method"] = next(it)
        elif token == "--field":
            key, _, value = next(it).partition("=")
            out["fields"][key] = value
        elif token == "--raw-field":
            key, _, value = next(it).partition("=")
            out["raw"][key] = value
        elif token == "--input":
            next(it)
            out["input"] = True
        elif token == "--header":
            next(it)
        elif out["path"] is None:
            out["path"] = token
        else:
            raise HttpError(400, f"fake glab: unexpected argument {token}")
    out["method"] = out["method"] or ("POST" if (out["fields"] or out["raw"] or out["input"]) else "GET")
    return out


def sha_of(text):
    return hashlib.sha1(text.encode()).hexdigest()


def tick(state, mr):
    k = mr["_"]
    if k.get("renovate_pending") is not None:
        k["renovate_pending"] -= 1
        if k["renovate_pending"] <= 0:
            k.pop("renovate_pending")
            complete_rebase(state, mr)
    elif k.get("rebase_pending") is not None:
        k["rebase_pending"] -= 1
        if k["rebase_pending"] <= 0:
            k.pop("rebase_pending")
            complete_rebase(state, mr)
    elif k.get("pipeline_pending") is not None:
        k["pipeline_pending"] -= 1
        if k["pipeline_pending"] <= 0:
            k.pop("pipeline_pending")
            mr["head_pipeline"]["status"] = "failed" if k.get("pipeline_fails") else "success"
            mr["detailed_merge_status"] = "ci_must_pass" if k.get("pipeline_fails") else "mergeable"
            if k.get("sibling_wins") and not k.get("pipeline_fails"):
                k["sibling_wins"] -= 1
                mr["detailed_merge_status"] = "need_rebase"


def complete_rebase(state, mr):
    k = mr["_"]
    state["counter"] += 1
    mr["sha"] = sha_of(mr["sha"] + f"rebase{state['counter']}")
    mr["rebase_in_progress"] = False
    mr["updated_at"] = "2026-10-23T12:00:00.000Z"
    project = state["projects"][str(mr["project_id"])]
    if project["has_ci"]:
        mr["head_pipeline"] = {"id": 9000 + state["counter"], "status": "running", "sha": mr["sha"],
                               "web_url": f"https://fake/{project['path_with_namespace']}/-/pipelines/{9000 + state['counter']}"}
        mr["detailed_merge_status"] = "ci_still_running"
        k["pipeline_pending"] = k.get("pipeline_polls", 1)
    else:
        mr["detailed_merge_status"] = "mergeable"
    if k.get("conflict_after_rebase"):
        mr["has_conflicts"], mr["detailed_merge_status"] = True, "conflict"


def find_mr(state, pid, iid):
    mr = state["mrs"].get(f"{pid}/{iid}")
    if mr is None:
        raise HttpError(404, "404 Not found")
    return mr


def public(mr, listing):
    out = {k: v for k, v in mr.items() if k != "_"}
    if listing:
        out = {k: v for k, v in out.items() if k not in LIST_DROP}
    return out


def route(state, req, stdin):
    method, path = req["method"], req["path"]
    url = urllib.parse.urlsplit(path)
    parts = [urllib.parse.unquote(p) for p in url.path.split("/")]
    query = dict(urllib.parse.parse_qsl(url.query))
    if method == "GET":
        if parts == ["user"]:
            return {"id": 1, "username": state["user"], "state": "active"}
        if parts == ["projects"]:
            per, page = int(query.get("per_page", 20)), int(query.get("page", 1))
            simple = [{"id": p["id"], "path_with_namespace": p["path_with_namespace"], "name": p["path_with_namespace"].split("/")[-1],
                       "default_branch": p["default_branch"], "web_url": "https://fake/" + p["path_with_namespace"]}
                      for p in state["projects"].values()]
            return simple[(page - 1) * per: page * per]
        if parts[0] == "projects" and len(parts) == 2:
            return project_or_404(state, parts[1])
        if parts[0] == "projects" and parts[2:4] == ["repository", "files"]:
            project = project_or_404(state, parts[1])
            name = parts[4]
            if name == ".gitlab-ci.yml":
                if project["has_ci"]:
                    return {"file_name": name, "ref": query.get("ref")}
                raise HttpError(404, "404 File Not Found")
            if name == "renovate.json" and parts[5:] == ["raw"] and project.get("renovate_json") is not None:
                return ("text", project["renovate_json"])
            raise HttpError(404, "404 File Not Found")
        if parts[0] == "projects" and parts[2] == "merge_requests":
            project_or_404(state, parts[1])
            if len(parts) == 3:
                if state["projects"][parts[1]].get("list_http_error"):
                    raise HttpError(state["projects"][parts[1]]["list_http_error"], "500 Internal Server Error")
                per, page = int(query.get("per_page", 20)), int(query.get("page", 1))
                rows = [m for m in state["mrs"].values() if str(m["project_id"]) == parts[1] and m["state"] == "opened"]
                dropped = state.get("drop_list_keys", [])
                shown = []
                for m in rows:
                    row = {k: v for k, v in public(m, True).items() if k not in dropped}
                    if m["_"].get("list_status"):
                        row["detailed_merge_status"] = m["_"]["list_status"]
                    shown.append(row)
                return shown[(page - 1) * per: page * per]
            mr = find_mr(state, parts[1], parts[3])
            if len(parts) == 5 and parts[4] == "notes":
                if state.get("notes_http_error"):
                    raise HttpError(state["notes_http_error"], "500 Internal Server Error")
                notes = list(state.get("notes", {}).get(f"{parts[1]}/{parts[3]}", []))
                notes.sort(key=lambda n: n["created_at"], reverse=query.get("sort", "desc") == "desc")
                per, page = int(query.get("per_page", 20)), int(query.get("page", 1))
                return notes[(page - 1) * per: page * per]
            tick(state, mr)
            out = public(mr, False)
            if mr["_"].get("unchecked_reads"):
                mr["_"]["unchecked_reads"] -= 1
                out["detailed_merge_status"] = "unchecked"
            return out
    if method == "PUT" and parts[0] == "projects" and parts[2] == "merge_requests" and len(parts) >= 4:
        mr = find_mr(state, parts[1], parts[3])
        k = mr["_"]
        if len(parts) == 5 and parts[4] == "rebase":
            if k.get("rebase_http_error"):
                raise HttpError(k["rebase_http_error"], "Rebase refused")
            k["rebase_pending"] = k.get("rebase_polls", 1)
            mr["rebase_in_progress"] = True
            return {"rebase_in_progress": True}
        if len(parts) == 5 and parts[4] == "merge":
            if k.get("merge_http_error"):
                raise HttpError(k["merge_http_error"], k.get("merge_http_message", "Method Not Allowed"))
            if mr["state"] != "opened" or mr["detailed_merge_status"] != "mergeable":
                raise HttpError(405, "405 Method Not Allowed")
            if req["raw"].get("sha") != mr["sha"]:
                raise HttpError(409, "SHA does not match HEAD of source branch")
            if k.get("merge_noop"):
                return public(mr, False)
            mr["state"], mr["merged_at"] = "merged", "2026-10-23T12:30:00.000Z"
            state["counter"] += 1
            mr["merge_commit_sha"] = sha_of(mr["sha"] + f"merge{state['counter']}")
            project = state["projects"][str(mr["project_id"])]
            for other in state["mrs"].values():
                if (other["project_id"] == mr["project_id"] and other["state"] == "opened"
                        and other["target_branch"] == mr["target_branch"] and project["merge_method"] == "ff"
                        and not other["draft"] and other["detailed_merge_status"] == "mergeable"):
                    other["detailed_merge_status"] = "need_rebase"
            return public(mr, False)
        if len(parts) == 4:
            if "description" in req["raw"]:
                mr["description"] = req["raw"]["description"]
                if k.get("renovate_polls") is not None and "[x]" in mr["description"]:
                    k["renovate_pending"] = k["renovate_polls"]
            if "title" in req["raw"]:
                mr["title"] = req["raw"]["title"]
                mr["draft"] = mr["title"].lower().startswith(("draft:", "[draft]", "(draft)"))
            return public(mr, False)
    if method == "POST":
        if parts[0] == "projects" and parts[2:] == ["repository", "commits"]:
            project = project_or_404(state, parts[1])
            body = json.loads(stdin)
            if body["branch"] in state["branches"]:
                raise HttpError(400, f"A branch called '{body['branch']}' already exists. Switch to that branch in order to make changes")
            state["branches"].append(body["branch"])
            state["commits"].append(dict(body, project_id=project["id"]))
            return {"id": sha_of(body["branch"]), "title": body["commit_message"]}
        if parts[0] == "projects" and parts[2:] == ["merge_requests"]:
            project = project_or_404(state, parts[1])
            body = json.loads(stdin)
            state["counter"] += 1
            iid = 500 + state["counter"]
            made = {"iid": iid, "project_id": project["id"], "title": body["title"], "state": "opened", "draft": True,
                    "web_url": f"https://fake/{project['path_with_namespace']}/-/merge_requests/{iid}", "_": {}}
            state["created_mrs"].append(dict(body, project_id=project["id"], iid=iid))
            return made
        if parts[0] == "projects" and parts[2] == "pipelines" and parts[4:] == ["retry"]:
            for mr in state["mrs"].values():
                pipeline = mr.get("head_pipeline")
                if pipeline and str(pipeline["id"]) == parts[3] and str(mr["project_id"]) == parts[1]:
                    pipeline["status"] = "running"
                    mr["detailed_merge_status"] = "ci_still_running"
                    mr["_"]["pipeline_pending"] = mr["_"].get("pipeline_polls", 1)
                    return {"id": pipeline["id"], "status": "running", "sha": pipeline["sha"]}
            raise HttpError(404, "404 Not found")
    raise HttpError(404, f"404 fake glab has no route for {method} {path}")


def project_or_404(state, pid):
    project = state["projects"].get(str(pid))
    if project is None:
        raise HttpError(404, "404 Project Not Found")
    return project


def main():
    argv = sys.argv[1:]
    stdin = sys.stdin.read() if "--input" in argv else None
    if not argv or argv[0] != "api":
        print("fake glab only answers `glab api`", file=sys.stderr)
        return 2
    with open(LOG, "a") as log:
        fcntl.flock(log, fcntl.LOCK_EX)
        log.write(json.dumps({"argv": argv, "stdin": stdin or None}) + "\n")
    with open(STATE + ".lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        with open(STATE) as handle:
            state = json.load(handle)
        try:
            result = route(state, parse(argv[1:]), stdin)
        except HttpError as exc:
            sys.stdout.write(json.dumps({"message": exc.message}))
            sys.stderr.write(f"glab: {exc.message} (HTTP {exc.code})\n")
            return 1
        finally:
            with open(STATE, "w") as handle:
                json.dump(state, handle)
    if isinstance(result, tuple) and result[0] == "text":
        sys.stdout.write(result[1])
    else:
        sys.stdout.write(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
