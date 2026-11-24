# Settings keys and defaults

Two sets, kept in two places (why: [how-to/settings-and-notifications.md](../how-to/settings-and-notifications.md)).

## Agent settings (per profile)

Declared in `plugin.yaml` under `config_schema` and read by the backend from
`plugins.entries.mergeable.settings` in the profile's config, on every request. A value of the
wrong type falls back to its default, so a hand-edited config never breaks a route. The host shows
the form as Settings, Plugins, Mergeable, Agent settings.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `gitlab_host` | string | `gitlab.com`; set your own | GitLab host `glab` is called against |
| `include_groups` | list | `[]` | only list projects under these groups (full paths); empty means every project you are a member of |
| `exclude_projects` | list | `[]` | project paths never listed |
| `renovate_branch_prefix` | string | `renovate/` | source branch prefix of Renovate MRs |
| `session_profiles` | list | `[]` | profiles whose sessions are searched for the session that made a branch; empty means all |
| `auto_audit` | bool | `true` | audit a Renovate MR when its head commit changes |
| `trivial_renovate` | bool | `true` | the batch takes Renovate MRs whose audit says merge and trivial |
| `trivial_require_sure` | bool | `true` | such an audit must also be `sure` |
| `trivial_own` | bool | `true` | the batch takes your own MRs with a matching title prefix |
| `trivial_title_prefixes` | list | `[chore, ci, docs, build]` | prefixes (before a colon or parenthesis) of your own trivial MRs |
| `trivial_max_files` | int | `10` | most files an own MR may change and still be trivial; must be positive |
| `trivial_allow_rebase` | bool | `true` | an MR that needs one rebase may still be in the batch |
| `trivial_never_projects` | list | `[]` | project paths that never join the batch |
| `delete_source_branch` | bool | `true` | remove the source branch when an MR is merged |
| `merge_wait_minutes` | int | `45` | longest wait for a rebase or a green pipeline before a merge job gives up; must be positive |
| `audit_models` | list | `[claude-haiku-5-5, claude-opus-5-5]` | models for the Renovate audit, cheapest first; the next one runs when the first is not sure or invalid |

`GET /mrs` echoes the rules in force under `rules`.

## Display settings (per machine)

Kept in the plugin's storage (`ctx.storage`) under `display`, edited on the Display page. The
defaults are in `DEFAULT_SETTINGS`, [`desktop/src/model.js`](../../desktop/src/model.js).

| Key | Default | Meaning |
|---|---|---|
| `showColleagues` | `true` | list colleagues' MRs (they stay read-only either way) |
| `showDrafts` | `true` | drafts shown by default; the pane header can switch it per session |
| `chipRatings` | `true` | importance, ease, escalation and audit state chips |
| `chipState` | `true` | mergeable, rebase, conflict and batch chips |
| `chipOwner` | `true` | Renovate bot icon and colleague name |
| `sessionBtn` | `true` | the Open session button |
| `ageWarn` | `1` | working days from which the age is amber |
| `ageStale` | `3` | working days from which the age is orange; never below `ageWarn` |
| `sort` | `urgency` | `urgency`, `age` or `project` |
| `poll` | `60` | seconds between polls: `60`, `300` or `0` (manual) |
| `notifyBump`, `notifyAudit`, `notifyPipelineFailed`, `notifyPipelineGreen`, `notifyJob`, `notifyComment`, `notifyReview` | all `true` | one toggle per notification event, see [notifications.md](notifications.md) |

Limits compare with `>=`. A stored 30 and 90 (the calendar-day defaults before working days) are
read as the new defaults, because as working days they would never colour anything.
