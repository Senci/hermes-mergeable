# REST routes and payload

The backend (`dashboard/plugin_api.py`) mounts under `/api/plugins/mergeable/` on the Hermes
backend. The desktop half calls it through `ctx.rest`, which follows the window's active
gateway. Handlers are plain `def`, so GitLab calls and SQLite run in the thread pool. Times are ISO
8601 UTC. A complete example payload with fictional data is
[../fixtures/example.json](../fixtures/example.json).

## Routes

| Route | Body | Answer |
|---|---|---|
| `GET /mrs[?refresh=1]` | none | the list, below; `refresh=1` re-collects |
| `POST /mrs/{project_id}/{iid}/rebase` | `{expected_sha}` | 202 `{job_id}` |
| `POST /mrs/{project_id}/{iid}/merge` | `{expected_sha}` | 202 `{job_id}` |
| `POST /mrs/{project_id}/{iid}/retry-pipeline` | `{}` or `{expected_sha}` | 202 `{job_id}` |
| `POST /mrs/{project_id}/{iid}/ready` | `{}` or `{expected_sha}` | 202 `{job_id}` |
| `POST /mrs/{project_id}/{iid}/audit` | `{}` or `{expected_sha}` | 202 `{job_id}`; Renovate MRs only |
| `POST /mrs/{project_id}/{iid}/renovate-hold` | `{package, until}` | 202 `{job_id}` |
| `POST /audit/all` | `{}` | 202 `{job_id}` |
| `POST /batch/trivial` | `{refs, shas}` | 202 `{job_id}` |
| `GET /jobs` | none | the last 20 jobs, newest first |
| `GET /jobs/{id}` | none | one job |
| `GET /status.md` | none | the Copy status text, `text/markdown` |

Every per-MR write re-reads the MR from GitLab first. `expected_sha` is the head the caller saw;
`rebase` and `merge` require it, and the desktop half sends it with every per-MR write and refuses
to send without one. `until` is a future date as `YYYY-MM-DD`.

### Errors

| Status | Meaning |
|---|---|
| 403 | the action targets a colleague's MR (read only) |
| 404 | unknown MR, or the MR is no longer open |
| 409 | `expected_sha` differs from the re-read head; the batch set differs from the server's; a draft or an MR already current for rebase |
| 422 | bad body (`expected_sha` not a hex sha, `refs` and `shas` not equal-length lists, bad `package` or `until`), or a hold the plugin cannot write (the answer carries the snippet to paste by hand) |
| 423 | another write job runs on that project (an audit job: another audit runs) |
| 502 | `glab` could not read from GitLab |

## `GET /mrs`

Top level:

| Key | Meaning |
|---|---|
| `generated_at` | when the list was built; the desktop half counts working days up to this moment |
| `profile`, `host`, `user` | the Hermes profile, the GitLab host and your GitLab user name |
| `schema_ok` | false when GitLab's list lacked a field the collector reads, or the facts of an MR are missing |
| `warnings` | strings naming a project or MR that could not be read |
| `rules` | the trivial and merge settings in force (`trivial_*`, `delete_source_branch`, `merge_wait_minutes`) |
| `batch` | the trivial batch: `refs`, `shas` in landing order, `rebases`, `pipelines` |
| `timing` | `ms`, `full`, `projects_scanned`, `details_fetched`, `glab_calls`, `items` of the last collect |
| `items` | the merge requests, in urgency order |

### Item

| Key | Type | Meaning |
|---|---|---|
| `ref` | string | `<project>!<iid>`, unique |
| `project`, `project_id`, `iid` | string, int, int | project path, id, MR number |
| `title`, `full_title` | string | for a Renovate MR `title` is `<package> <from> to <to>`; `full_title` is GitLab's title |
| `author` | string | GitLab user name |
| `owner` | string | `self`, `renovate` (a bot author and a branch with the Renovate prefix) or `other` (read only) |
| `draft` | bool | |
| `created_at`, `updated_at` | string | |
| `age_days` | int | calendar days since opened |
| `sha` | string | head commit |
| `source_branch`, `target_branch`, `web_url` | string | |
| `merge_status` | string | GitLab's detailed merge status, for example `mergeable`, `need_rebase`, `draft_status`, `conflict` |
| `has_conflicts` | bool | |
| `merge_method` | string | the project's merge method, for example `ff` or `merge` |
| `pipeline` | object or null | `{status, url}` of the head pipeline; null means no CI for this MR |
| `files_changed`, `user_notes_count` | int | |
| `renovate` | object or null | `{package, from, to, update_type}` for a Renovate MR |
| `audit` | object or null | the rating, below; kept visible while `audit_state` is `queued`, `running`, `error` or `stale` |
| `audit_state` | string | `none`, `queued`, `running`, `done`, `stale`, `error` |
| `session` | object or null | `{id, profile, title, score}` of the Hermes session that made the branch |
| `reviewers` | array | user names asked to review |
| `last_note` | object or null | `{author, at}` of the newest note that is not a system note |
| `trivial` | object | `{in_batch, miss}`; `miss` is the first rule that keeps the MR out, empty when it is in |
| `can` | object | `{rebase, merge, renovate_rebase, reason, rebase_reason}`; what the buttons may do and the tooltip reasons |

### Audit

| Key | Meaning |
|---|---|
| `importance` | `critical`, `high`, `medium`, `low`, `none` |
| `ease` | `trivial`, `easy`, `medium`, `hard` |
| `verdict` | `merge`, `merge_with_followup`, `needs_change`, `hold` |
| `confidence` | `sure`, `not_sure`; with `not_sure_reason` |
| `importance_reason`, `ease_reason`, `summary` | short texts |
| `cves` | `[{id, severity, cvss, fixed_in}]` named in the notes |
| `breaking_changes` | `[{version, change, affects_us, evidence}]` |
| `releases_read` | every version the audit read; it must cover the whole range |
| `advisories` | `[{ghsa, cve, severity, cvss}]` resolved from GitHub |
| `model`, `escalated` | the model that decided; true when the first model was not sure |
| `sha`, `audited_at` | the head the audit belongs to and when |

## Jobs

Every write returns 202 `{job_id}` and runs in a thread. A job is
`{id, kind, state, refs, rebases, steps}`; `state` is `running`, `done`, `failed` or `stopped`; a
step is `{ref, step, state, detail, at}`. Step names include `reread`, `rebase`, `wait-green`,
`merge`, `hold-commit`, `hold-mr`, `audit` and `skipped`. One write job runs per project at a
time, one audit job at a time. The desktop half polls `GET /jobs/{id}` every 3 s while a job
runs. Jobs live in memory: a backend restart forgets them, and audit rows they left `queued` or
`running` become `error` with the detail `interrupted by a restart` on the first collect.

## `GET /status.md`

Open MRs grouped by project with owner, state and audit verdict, and the trivial batch size. The
backend answers `text/markdown`, but `ctx.rest` JSON-parses every answer, so the desktop half
cannot read it and builds the same kind of summary from the list on screen, and says so in the
toast. The route is useful from `curl` with a session token.

## Files the backend keeps

All under `$HERMES_HOME/mergeable/`: `audits.db` (audits keyed by `ref` and head sha), `facts.json`
(per-MR facts, so a restart starts warm), `actions.log` (one JSON line per GitLab write:
`{at, job, action, ref, sha_before, sha_after, result}`) and a private `tmp/` for the query files
of audit calls.
