# Hold a Renovate package

Use this when Renovate keeps opening MRs for a package you do not want to move yet (the audit
says `hold`, or a staging run has to happen first). The plugin drafts a rule that disables the
package in the project's Renovate config, as its own Draft MR. Nothing merges and nothing is
changed on a branch you already use.

## Steps

1. Open the **More** menu (`ellipsis`) of a Renovate MR and choose **Add Renovate hold rule**.
   The item is disabled for an MR that is not a Renovate MR and for a colleague's MR.
2. The dialog is titled `Hold <package>?`. Pick the date to hold until (default: 30 days from
   today, as `YYYY-MM-DD`; it must be in the future).
3. Click **Draft hold MR**. A job starts with the steps `reread`, `hold-commit` and `hold-mr`.
4. When the job is done, the last step carries the web address of the new Draft MR. Review it in
   GitLab like any other MR and merge it when you agree.

## What the backend writes

On a new branch `mergeable/hold-<package slug>` it commits one entry to `renovate.json` on the
default branch and opens a Draft MR titled `Draft: Hold Renovate updates of <package> until
<date>`:

```json
{
  "description": "mergeable hold set 2026-10-23 until 2026-11-22",
  "matchPackageNames": ["flux-capacitor"],
  "enabled": false
}
```

The rule has no end date of its own: remove it from `renovate.json` after the date you chose. The
date is in the entry's description so the next reader knows when.

## When it cannot do it

Only a plain `renovate.json` on the default branch is edited. For `renovate.json5`, a
`.renovaterc`, a missing file or a file the plugin cannot edit and re-read as the expected JSON,
the route answers 422 with the snippet to paste by hand. Nothing is written in that case.

## Related

- The route: `POST /mrs/{project_id}/{iid}/renovate-hold` in
  [reference/api.md](../reference/api.md).
- Deciding whether to hold: [re-audit.md](re-audit.md).
