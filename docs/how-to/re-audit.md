# Re-audit a Renovate MR

Use this when an audit is missing, failed or looks stale, or when you changed the audit models.
An audit rates one Renovate bump; it never merges anything.

## When audits run by themselves

With `auto_audit` on (default), a refresh audits every non-draft Renovate MR whose head commit has
no finished, queued or running audit. An audit is cached per MR and head sha, so the same head is
never audited twice, and a new head makes the old rating `stale` until the new audit lands. An
audit that failed is not retried on every refresh (that would loop on a broken model call); it
waits for you.

## Re-audit one MR

Open the **More** menu of the Renovate MR and choose **Re-run audit**. It starts an audit job for
that MR and ignores the cache.

## Re-audit all

Click **Re-audit all** (`debug-rerun`) in the header. It starts one job that audits every
non-draft Renovate MR, one after another, ignoring the cache. Only one audit job runs at a time;
a second request is answered with 423.

## Read the state

| Chip | Meaning |
|---|---|
| `loading` (spinning) | queued or running |
| `history` | stale: the MR head moved since this audit |
| `error` | the last audit failed; the job step says why |
| importance and ease chips, `sparkle`, `question` | a finished audit; `sparkle` means the first model was not sure and a stronger one decided; `question` means the final answer is still not sure |

After a backend restart, an audit that was queued or running when the process died shows as
`error` with the detail `interrupted by a restart`. Re-run it.

The page shows one card per audited MR: what was read, advisories and CVEs, the summary, the
reasons for importance and ease, breaking changes, and which model decided and when.

## What the audit does

1. Code, not the model, fetches the release notes for every version from the old to the new one,
   changelog sections when a release only links to a changelog, and the security advisories those
   notes name. GitHub is called anonymously and fetches are cached per tag.
2. Code adds up to 150 lines of the project's own repository text that mention the package, with
   lines that look like secrets or keys dropped.
3. One tool-less model call per model in `audit_models` rates the bump: first the cheapest. When
   it answers `not_sure`, or its reply fails validation, the next model gets the first answer as
   a `first_pass` to check. The call is
   `hermes -p <profile> chat --query-file <0600 file> --oneshot -Q -m <model> --provider anthropic --safe-mode --source tool -t clarify`;
   `-t clarify` gives the child no tools, because release notes are third-party text.

The reply is checked against fixed value sets (importance, ease, verdict, confidence) and must
list every release that was fetched; a reply that skips one is invalid.

## Related

- Models and the other settings: [reference/settings.md](../reference/settings.md).
- Holding a package the audit rates `hold`: [hold-renovate-package.md](hold-renovate-package.md).
