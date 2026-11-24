# Decisions

The choices that shape Mergeable, in plain words. Each row has its id in the repository's
[decision log](../../../../wiki/decisions.md), which holds the full text and the date. Rows are not
reopened here: a new question is a new row.

## What it is and where it sits

| Id | Decision |
|---|---|
| D57 | The plugin is called `mergeable`: plugin id, route `/mergeable`, folder `plugins/mergeable/`, data under `$HERMES_HOME/mergeable/`. |
| D58 | It has two surfaces: a pane as a tab in the Files zone (`dock: files, center`, hide-only, collapsible, width with min and max caps, so Ctrl+J folds it) and a full page with a sidebar row, a palette entry and a keybind. |
| D62 | It lists open MRs in every project you are a member of, and shows colleagues' MRs with every action disabled. |

## Writing to GitLab

| Id | Decision |
|---|---|
| D59 | Actions run in the backend through `glab` against your GitLab host. Merge sits behind a confirm dialog that is the go for that one MR. Every action re-reads the MR first; merge waits for a green pipeline, rebases at most once and never uses `glab mr merge --rebase`. Colleagues' MRs are read only; Renovate MRs rebase through Renovate's own rebase checkbox. |
| D63 | The row menu has Open in GitLab, Open pipeline, Retry failed pipeline, Copy branch and glab command, Mark ready, Re-run audit and Add Renovate hold rule (drafted as its own MR). Close and Approve are not built. |
| D65 | A Trivial batch button lists every matching MR in landing order with its rebases and pipeline cost; that list is the go for exactly those MRs. The backend re-checks the set, refuses if it changed, lands one MR at a time and stops at the first failure. |
| D66 | The default trivial rules: a Renovate MR whose audit says merge, trivial and sure; an own MR titled `chore`, `ci`, `docs` or `build` that changes at most 10 files; one rebase allowed; source branch deleted after merge. Never a draft, a colleague's MR, a red pipeline or a conflict. |
| D68 | Global actions: Trivial, Refresh, Settings, Copy status (a Markdown summary) and Re-audit all, which ignores the head-sha cache. Not built: a GitLab list link, and Rebase all stale (in fast-forward projects every merge makes the others stale again). |

## Renovate audits

| Id | Decision |
|---|---|
| D60 | Audits name models by tier: cheapest first, a stronger one when the first is not sure or fails validation. Release notes, changelog sections and advisories are fetched by code, never by the model. |
| D61 | An audit runs when an MR's head changes and is cached per project, MR and head sha in `audits.db`; a row action forces a re-run. |
| D69 | The model is called through a tool-less `hermes chat --oneshot ... -t clarify` child, not through `ctx.llm`, which a dashboard router does not get. Changelog text is untrusted, so the child has no tools. |
| D77 | The model sees the release notes plus up to 150 lines of the project's own repository text; lines with secret words or key shapes are dropped. |

## Settings

| Id | Decision |
|---|---|
| D67 | Settings live in Settings, Plugins, opened by the pane's cog. Display preferences are per machine (`ctx.storage`); merge rules and backend settings are per profile (`config_schema`, the Agent settings sub-page), because the backend enforces them. |

## Round 3: icons, working days, notifications

| Id | Decision |
|---|---|
| D76 | Backend leftovers kept and specified: `GET /mrs` carries `batch`, `timing`, `warnings` and `can.rebase_reason`; age limits compare with `>=`; audit rows a dead process left `queued` or `running` become `error` ("interrupted by a restart") on the first collect after a start. |
| D78 | Pane chips are icons only, with label and reason in the tooltip; colour keeps the level; the page keeps icon plus label. The icon of each chip is in [chips-and-icons.md](../reference/chips-and-icons.md). |
| D79 | Age colour counts working days (Monday to Friday minus the Hamburg public holidays, computed from the Easter date, no yearly table). Defaults: amber from 1, orange from 3. |
| D80 | Seven notification events, each a toggle: native while Hermes is in the background, a toast while focused, no quiet hours, more than 3 in one poll become one summary, a click opens the MR row, silent except high or critical security and failures. The backend adds `reviewers` and `last_note` to each item. |
| D102 | The merge-conflict chip uses `git-pull-request-new-changes`, because the codicon set the host ships has no `git-pull-request-error`. |
