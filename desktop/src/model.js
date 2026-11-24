// Constants shared by the desktop half. No imports: the node test loads this file as is.

export const ID = 'mergeable'
export const PATH = '/mergeable'
export const PANE_ID = `${ID}:pane`
export const ACTION_ID = 'mergeable.reveal'
export const KEYBIND = 'mod+alt+m'
export const NAV_ORDER = 54
export const STALE_MS = 15_000
export const JOB_POLL_MS = 3_000
export const SETTINGS_HOST_FALLBACK = '/settings'

// Stacks into the Files zone (not a column of its own) so Ctrl+J folds both; no `enforce`, a drag sticks.
// maxWidth is required: one uncapped tenant uncaps the whole zone and makes it absorb all leftover
// width (tree-split.tsx zone caps, track-model.ts allFixedAbsorberIndex), so the zone fills the window.
export const PANE_DATA = {
  placement: 'right',
  dock: { pane: 'files', pos: 'center' },
  collapsible: true,
  hideOnly: true,
  width: '340px',
  minWidth: '15rem',
  maxWidth: '36rem',
  tabTitleText: () => 'Mergeable'
}
export const NAV_DATA = { path: PATH, label: 'Mergeable', codicon: 'git-merge' }

export const HIDE_NOTE =
  'The Mergeable tab only hides: use its tab menu or Ctrl+K (Mergeable) to hide or show it, and Ctrl+J to fold the whole Files zone with it. The plugin stays on.'

// Pane filter chips and sort order, as the prototype names them.
export const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'mine', label: 'Mine' },
  { id: 'renovate', label: 'Renovate' },
  { id: 'colleagues', label: 'Colleagues' }
]
export const SORTS = [
  { id: 'urgency', label: 'Urgency' },
  { id: 'age', label: 'Age' },
  { id: 'project', label: 'Project' }
]
export const POLLS = [
  { id: '60', label: '60 s' },
  { id: '300', label: '5 min' },
  { id: '0', label: 'Manual' }
]

// D78 chip icons (codicons 0.0.45, the host's set). The pane draws a chip as its icon only; the page adds the label.
// The conflict glyph is open (the operator's git-pull-request-error does not exist in 0.0.45): change it here.
export const CONFLICT_ICON = 'git-pull-request-new-changes'
export const CHIP_ICON = {
  draft: 'git-pull-request-draft',
  renovate: 'robot',
  colleague: 'person',
  importance: 'flame',
  ease: 'tools',
  escalated: 'sparkle',
  unsure: 'question',
  running: 'loading',
  stale: 'history',
  error: 'error',
  batch: 'smiley',
  mergeable: 'git-pull-request-done',
  rebase: 'git-pull-request-create',
  conflict: CONFLICT_ICON,
  noci: 'workspace-untrusted'
}

// D80 notification events: one toggle each on the settings page (all on by default). `kind` is the host toast kind.
export const EVENTS = [
  { id: 'bump', setting: 'notifyBump', kind: 'warning', label: 'Renovate bump rated high or critical', hint: 'A new audit rates a bump high or critical.', summary: 'bumps rated high or critical' },
  { id: 'audit', setting: 'notifyAudit', kind: 'warning', label: 'Audit says hold or needs change', hint: 'The verdict of a Renovate audit is hold or needs_change.', summary: 'audits that say hold or needs change' },
  { id: 'pipeline-failed', setting: 'notifyPipelineFailed', kind: 'error', label: 'Pipeline failed on my MR', hint: 'The head pipeline of one of your own MRs turns failed.', summary: 'failed pipelines' },
  { id: 'pipeline-green', setting: 'notifyPipelineGreen', kind: 'success', label: 'Pipeline green after my rebase', hint: 'An MR you rebased here has a green pipeline on its new head.', summary: 'green pipelines after a rebase' },
  { id: 'job', setting: 'notifyJob', kind: 'success', label: 'Merge or batch job finished or stopped', hint: 'A merge or trivial batch job ends, also when it fails or stops.', summary: 'merge or batch jobs ended' },
  { id: 'comment', setting: 'notifyComment', kind: 'info', label: 'New comment on my MR from someone else', hint: 'Needs the backend that reports last_note; bots and system notes do not count.', summary: 'new comments' },
  { id: 'review', setting: 'notifyReview', kind: 'info', label: 'A colleague asks me to review', hint: 'Needs the backend that reports reviewers.', summary: 'review requests' }
]
// More than this many events in one poll become one summary.
export const SUMMARY_ABOVE = 3
// Dedupe keys kept in ctx.storage (a restart must not repeat old events).
export const KEEP_KEYS = 400

// Display settings (D67, ctx.storage, per machine). Merge rules live in config_schema, not here.
// ageWarn and ageStale count working days since the MR opened (D79).
export const STORE = { settings: 'display', notified: 'notified' }
export const DEFAULT_SETTINGS = {
  showColleagues: true,
  showDrafts: true,
  chipRatings: true,
  chipState: true,
  chipOwner: true,
  sessionBtn: true,
  ageWarn: 1,
  ageStale: 3,
  sort: 'urgency',
  poll: '60',
  ...Object.fromEntries(EVENTS.map(e => [e.setting, true]))
}

// A session is shown as a button only from this score (map_mr_sessions.py: 10 for author markers, 1 per mention).
export const SESSION_MIN_SCORE = 5
export const SESSION_CREATED_SCORE = 10

// Importance and verdict tones, as the prototype's impTone, easeTone and verdictTone.
export const IMPORTANCE_ORDER = { critical: 0, high: 1, medium: 2, low: 3, none: 4 }
export const IMPORTANCE_TONE = { critical: 'destructive', high: 'destructive', medium: 'warn', low: 'muted', none: 'muted' }
export const EASE_TONE = { trivial: 'success', easy: 'success', medium: 'warn', hard: 'destructive' }
export const VERDICT_TONE = { merge: 'success', merge_with_followup: 'success', needs_change: 'warn', hold: 'destructive' }

// Per-MR write routes (spec, API contract). Every body carries expected_sha.
export const WRITE_PATH = {
  rebase: 'rebase',
  merge: 'merge',
  retry: 'retry-pipeline',
  ready: 'ready',
  audit: 'audit',
  hold: 'renovate-hold'
}
export const HOLD_DAYS = 30
export const DONE_STATES = ['done', 'failed', 'stopped']
