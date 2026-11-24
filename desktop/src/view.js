// Shared views of Mergeable: chips, row actions and menu, the confirm dialogs, the job strip, the
// header actions. The pane and the page are built from these. Rows are buttons, not links; titles
// of MRs are third-party data and never reach the chat input (this half has no door to it).
import {
  Badge, Button, Codicon, ConfirmDialog, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuTrigger, host, Input, Tip, useValue
} from '@hermes/plugin-sdk'
import * as sdk from '@hermes/plugin-sdk'
import { createContext, createElement as h, Fragment, useContext, useEffect, useState } from 'react'

import {
  ageClass, ageLabel, ageTip, auditOf, chipsOf, fmtUtc, glabCommand, holdDefaultUntil, isDone, isIsoDay, jobLine, mergeAbility, menuItems,
  plural, rebaseAbility, refLabel, sessionKind, sessionTip, stepFor, trivialCount, trivialPlan, workingAge
} from './logic.js'
import { SETTINGS_HOST_FALLBACK, ID, VERDICT_TONE } from './model.js'
import { $jobData, $jobs, $settings, dismissJob, putJobData } from './state.js'
import {
  auditAll, copyText, fetchStatus, openExternal, openSession, postBatch, postMr, refresh, settleJob, useBackend, useJob
} from './data.js'

const stop = e => e.stopPropagation()
export const say = (kind, message) => host.notify({ kind, message })
const fail = (what, e) => say('error', `Mergeable: ${what} failed: ${(e && e.message) || e}`)

// --- the dialog host: one ConfirmDialog per surface, opened through ask() ---

const Ask = createContext(null)
export const useAsk = () => useContext(Ask)

export function Surface({ meta, children }) {
  const [ask, setAsk] = useState(null)
  const close = () => setAsk(null)
  return h(Ask.Provider, { value: { ask: setAsk, meta } },
    children,
    ask && ask.kind === 'merge' ? h(MergeDialog, { key: ask.item.ref, it: ask.item, rules: meta.rules, close }) : null,
    ask && ask.kind === 'trivial' ? h(TrivialDialog, { key: 'trivial', plan: ask.plan, close }) : null,
    ask && ask.kind === 'hold' ? h(HoldDialog, { key: ask.item.ref, it: ask.item, close }) : null)
}

const KV = ({ k, children, mono }) => [
  h('span', { key: `${k}-k`, className: 'k' }, k),
  h('span', { key: `${k}-v`, className: `v${mono ? ' mg-mono' : ''}` }, children)
]

// Merge: ref, target, method, pipeline and audit verdict repeated; confirming is the go for this MR.
function MergeDialog({ it, rules, close }) {
  const a = auditOf(it)
  const keeps = rules && rules.delete_source_branch === false
  return h(ConfirmDialog, {
    open: true, onClose: close, title: `Merge ${it.ref}?`, confirmLabel: 'Merge', busyLabel: 'Merging', doneLabel: 'Started',
    description: 'Confirming is the go for this one MR. The backend re-reads it first and refuses if the head moved.',
    onConfirm: async () => { await postMr(it, 'merge') }
  },
  h('div', { className: 'mg-kv', 'data-dialog': 'merge' },
    h(KV, { k: 'Title' }, it.title),
    h(KV, { k: 'Into', mono: true }, `${it.target_branch} (merge method ${it.merge_method})`),
    h(KV, { k: 'Pipeline' }, it.pipeline ? it.pipeline.status : 'no CI for this MR'),
    h(KV, { k: 'Branch', mono: true }, `${it.source_branch} is ${keeps ? 'kept' : 'deleted'} after the merge`),
    a ? h(KV, { k: 'Audit' }, `${a.verdict}: ${a.summary}`) : null),
  a && a.verdict === 'hold' ? h('div', { className: 'mg-warnbox' }, 'The audit says hold. Merging moves this pin on the next deploy.') : null)
}

function PlanTable({ plan }) {
  return h('table', { className: 'mg-plan', 'data-plan': '1' },
    h('thead', null, h('tr', null, ['#', 'MR', 'Step', 'CI runs'].map(c => h('th', { key: c, title: c === 'CI runs' ? 'Extra MR pipelines this step starts' : undefined }, c)))),
    h('tbody', null, plan.steps.map((s, i) =>
      h('tr', { key: s.item.ref, 'data-step': s.item.ref },
        h('td', null, i + 1),
        h('td', { className: 'mg-mono' }, refLabel(s.item)),
        h('td', null, s.rebase ? (s.item.owner === 'renovate' ? 'Renovate rebase box, wait green, merge' : 'rebase once, wait green, merge') : 'merge', ' ', h('span', { className: 'mg-count' }, s.item.title)),
        h('td', null, s.pipelines)))))
}

// Trivial (D65): the list shown is the go for exactly these MRs; the backend refuses if the set changed.
function TrivialDialog({ plan, close }) {
  return h(ConfirmDialog, {
    open: true, onClose: close, title: `Merge ${plural(plan.steps.length, 'trivial MR', 'trivial MRs')}?`,
    confirmLabel: `Merge ${plan.steps.length}`, busyLabel: 'Starting', doneLabel: 'Started',
    description: `Landed one at a time in this order; the run stops at the first failure. ${plural(plan.rebases, 'rebase', 'rebases')}, ${plural(plan.pipelines, 'MR pipeline', 'MR pipelines')}.`,
    onConfirm: async () => { await postBatch(plan) }
  },
  h('div', { 'data-dialog': 'trivial' }, h(PlanTable, { plan })))
}

// Renovate hold: the backend drafts a packageRules entry as its own MR; it needs the date it holds until.
function HoldDialog({ it, close }) {
  const [until, setUntil] = useState(() => holdDefaultUntil())
  const pkg = it.renovate.package
  return h(ConfirmDialog, {
    open: true, onClose: close, title: `Hold ${pkg}?`, confirmLabel: 'Draft hold MR', busyLabel: 'Starting', doneLabel: 'Started',
    description: 'The backend commits a packageRules entry to renovate.json on a new branch and opens a Draft MR. Nothing merges.',
    onConfirm: async () => {
      if (!isIsoDay(until)) throw new Error('Pick a date as YYYY-MM-DD')
      await postMr(it, 'hold', { package: pkg, until })
    }
  },
  h('div', { className: 'mg-hold', 'data-dialog': 'hold' },
    h('label', null, 'Hold until'),
    h(Input, { type: 'date', value: until, 'aria-label': 'Hold until', 'data-field': 'until', onChange: e => setUntil(e.target.value) })))
}

// --- jobs: a strip in each header and a progress line on the row ---

function JobWatch({ job }) {
  const q = useJob(job.id)
  useEffect(() => {
    if (!q.data) return
    putJobData(q.data)
    settleJob(q.data, job)
  }, [q.data])
  return null
}

function useJobsHere() {
  const { conn, profile } = useBackend()
  const jobs = useValue($jobs)
  const data = useValue($jobData)
  return jobs.filter(j => j.conn === conn && j.profile === profile).map(j => ({ meta: j, job: data[j.id] || null }))
}

export function useBusyProjects() {
  const here = useJobsHere()
  const busy = new Set()
  for (const { meta, job } of here) {
    if (job && isDone(job)) continue
    for (const ref of meta.refs) busy.add(ref.split('!')[0])
  }
  return busy
}

export function JobStrip() {
  const here = useJobsHere()
  if (!here.length) return null
  return h(Fragment, null, here.map(({ meta, job }) =>
    h('div', { key: meta.id, className: `mg-job ${job ? job.state : 'running'}`, 'data-job': meta.id, 'data-state': job ? job.state : 'running' },
      h(JobWatch, { job: meta }),
      h(Codicon, { name: !job || !isDone(job) ? 'loading' : job.state === 'done' ? 'pass' : 'error', spinning: !job || !isDone(job) }),
      h('span', { className: 'mg-grow' }, job ? jobLine(job) : `${meta.label}: starting`),
      h(Button, { size: 'icon-xs', variant: 'ghost', 'aria-label': 'Dismiss', 'data-dismiss': meta.id, onClick: () => dismissJob(meta.id) }, h(Codicon, { name: 'close' })))))
}

export function RowJob({ it }) {
  const here = useJobsHere()
  const hit = here.filter(x => x.meta.refs.includes(it.ref)).pop()
  if (!hit) return null
  const step = hit.job ? stepFor(hit.job, it.ref) : null
  const done = hit.job && isDone(hit.job)
  const bad = done && hit.job.state !== 'done'
  if (done && !bad) return null
  return h('div', { className: `mg-l3${bad ? ' failed' : ''}`, 'data-rowjob': it.ref },
    h(Codicon, { name: bad ? 'error' : 'loading', spinning: !bad }),
    `${hit.meta.kind}: ${step ? `${step.step}${step.detail ? `, ${step.detail}` : ''}` : hit.job ? hit.job.state : 'starting'}`)
}

// --- chips, dot, age ---

export const Dot = ({ status }) =>
  h('span', { className: `mg-dot ${status === 'success' ? 'success' : status === 'failed' ? 'failed' : status === 'running' || status === 'pending' ? 'running' : ''}`, 'data-dot': status || 'none', title: `Pipeline: ${status || 'none'}` })

// Age: the label is calendar time, the colour and the tooltip count working days (D79) as of `now`, the moment the
// list was built (the payload's generated_at).
export const Age = ({ it, now }) => {
  const s = useValue($settings)
  const wd = workingAge(it, now)
  const cls = ageClass(wd, s)
  return h(Tip, { label: ageTip(it, wd) },
    h('span', { className: `mg-age ${cls}`, 'data-age': cls || 'fresh', 'data-wd': wd }, ageLabel(it.age_days)))
}

// One chip. The pane draws the icon only (D78): the colour carries the level, name and reason are the tooltip. The page
// keeps icon plus label. `group` picks the chips of one table column; the page ignores the display toggles.
export function Chips({ it, iconOnly = true, group, skip = [], fallback = null }) {
  const s = useValue($settings)
  const shown = iconOnly ? s : { ...s, chipRatings: true, chipState: true, chipOwner: true }
  const list = chipsOf(it, shown).filter(c => (!group || c.group === group) && !skip.includes(c.key))
  if (!list.length) return fallback
  return h(Fragment, null, list.map(c => {
    // 12px: the host's codicon default is 16px, which makes a chip taller than the row text.
    const icon = h(Codicon, { name: c.icon, spinning: !!c.spinning, size: 12 })
    const props = { variant: c.tone, 'data-chip': c.key, 'data-tone': c.tone, 'data-icon': c.icon }
    return iconOnly
      ? h(Tip, { key: `${c.key}-${c.icon}`, label: c.tip }, h(Badge, { ...props, size: 'xs', 'aria-label': c.tip }, icon))
      : h(Badge, { key: `${c.key}-${c.icon}`, ...props, title: c.tip }, icon, c.label || c.name)
  }))
}

// --- row actions: Rebase, Merge, Open session, More ---

function Icon({ it, act, icon, label, why, disabled, dim, onClick }) {
  const text = why || label
  const btn = h(Button, {
    size: 'icon-xs', variant: 'ghost', disabled, 'aria-label': label, 'data-act': act, 'data-ref': it.ref, 'data-why': disabled ? why : undefined,
    className: dim ? 'mg-dim' : undefined, onClick: e => { stop(e); onClick() }
  }, h(Codicon, { name: icon }))
  // A disabled button gets no pointer events, so the tooltip sits on a wrapper that does.
  return h(Tip, { label: text }, h('span', { className: 'mg-tw', title: text }, btn))
}

async function run(it, kind) {
  try {
    await postMr(it, kind)
  } catch (e) {
    fail(`${kind} ${it.ref}`, e)
  }
}

async function copy(text, what) {
  try {
    const ok = await copyText(text)
    say(ok ? 'success' : 'warning', ok ? `Copied ${what}` : `Could not copy ${what}`)
  } catch (e) {
    fail(`copy ${what}`, e)
  }
}

function MoreMenu({ it }) {
  const { ask, meta } = useAsk()
  const pick = {
    open: () => openExternal(it.web_url),
    pipeline: () => openExternal(it.pipeline.url),
    retry: () => run(it, 'retry'),
    'copy-branch': () => copy(it.source_branch, it.source_branch),
    'copy-glab': () => copy(glabCommand(it, meta.host), 'the glab command'),
    ready: () => run(it, 'ready'),
    audit: () => run(it, 'audit'),
    hold: () => ask({ kind: 'hold', item: it })
  }
  return h(DropdownMenu, null,
    h(DropdownMenuTrigger, { asChild: true },
      h(Button, { size: 'icon-xs', variant: 'ghost', 'aria-label': 'More actions', 'data-act': 'menu', 'data-ref': it.ref, onClick: stop }, h(Codicon, { name: 'ellipsis' }))),
    h(DropdownMenuContent, { align: 'end', onClick: stop },
      menuItems(it).map((m, i) => (m === null
        ? h(DropdownMenuSeparator, { key: `sep${i}` })
        : h(DropdownMenuItem, { key: m.id, 'data-item': m.id, disabled: !m.enabled, title: m.enabled ? undefined : m.why, onSelect: () => pick[m.id]() },
          h(Codicon, { name: m.icon }), m.label)))))
}

export function Actions({ it }) {
  const { ask, meta } = useAsk()
  const s = useValue($settings)
  const busy = useBusyProjects().has(it.project)
  const lock = busy ? `A write job is running on ${it.project}` : null
  const rb = rebaseAbility(it)
  const mg = mergeAbility(it)
  const kind = sessionKind(it.session)
  return h('span', { className: 'mg-acts' },
    h(Icon, { it, act: 'rebase', icon: 'sync', label: 'Rebase', why: lock || rb.why, disabled: !rb.ok || busy, onClick: () => run(it, 'rebase') }),
    h(Icon, { it, act: 'merge', icon: 'git-merge', label: 'Merge', why: lock || mg.why, disabled: !mg.ok || busy, onClick: () => ask({ kind: 'merge', item: it }) }),
    s.sessionBtn
      ? h(Icon, { it, act: 'session', icon: 'comment-discussion', label: 'Open session', why: sessionTip(it), disabled: !kind, dim: kind === 'mentioned', onClick: () => openSession(it) })
      : null,
    h(MoreMenu, { it }))
}

// --- header actions shared by the pane and the page ---

export const settingsHref = () => (typeof sdk.pluginSettingsHref === 'function' ? sdk.pluginSettingsHref(ID) : SETTINGS_HOST_FALLBACK)

export function Tool({ icon, label, act, onClick, disabled, spinning }) {
  return h(Tip, { label },
    h(Button, { size: 'icon-xs', variant: 'ghost', 'aria-label': label, 'data-act': act, disabled, onClick }, h(Codicon, { name: icon, spinning })))
}

export function HeaderTools({ q, children }) {
  const { ask } = useAsk()
  const [busy, setBusy] = useState('')
  const items = (q.data && q.data.items) || []
  const n = trivialCount(items)
  const wrap = (name, fn) => async () => {
    setBusy(name)
    try {
      await fn()
    } catch (e) {
      fail(name, e)
    } finally {
      setBusy('')
    }
  }
  const copyStatus = wrap('copy status', async () => {
    const { text, local } = await fetchStatus(q.data)
    const ok = await copyText(text)
    say(ok ? 'success' : 'warning', ok ? `Copied the status${local ? ' (built from the list in hand)' : ''}` : 'Could not copy the status')
  })
  return h(Fragment, null,
    h(Tip, { label: n ? 'Merge every MR that matches the trivial rules (Settings, Plugins, Mergeable)' : 'No MR matches the trivial rules' },
      h('span', { className: 'mg-tw' },
        h(Button, { size: 'xs', variant: 'secondary', 'data-act': 'trivial', disabled: !n, onClick: () => ask({ kind: 'trivial', plan: trivialPlan(items) }) },
          h(Codicon, { name: 'git-merge' }), 'Trivial ', h('span', { 'data-trivial-n': '1' }, n)))),
    h(Tool, { icon: 'refresh', label: 'Refresh (collector plus audits for changed heads)', act: 'refresh', disabled: !!busy || q.isFetching, spinning: busy === 'refresh' || q.isFetching, onClick: wrap('refresh', refresh) }),
    h(Tool, { icon: 'copy', label: 'Copy status as Markdown', act: 'copy-status', disabled: !q.data || busy === 'copy status', onClick: copyStatus }),
    h(Tool, { icon: 'debug-rerun', label: 'Re-audit all (ignores the head-sha cache)', act: 'audit-all', disabled: !!busy, onClick: wrap('re-audit all', auditAll) }),
    h(Tool, { icon: 'settings-gear', label: 'Settings (Settings, Plugins, Mergeable)', act: 'settings', onClick: () => host.navigate(settingsHref()) }),
    children)
}

// --- states ---

export const where = (conn, profile) => `backend ${conn || 'this device'}, profile ${profile || 'default'}`

export function unreachable(error, conn, profile) {
  const hint = /404|not found/i.test(String((error && error.message) || error))
    ? ' A 404 means that backend does not have the mergeable plugin.'
    : ' The Python half loads only when mergeable is in plugins.enabled of that profile and the backend was restarted.'
  return { title: `Mergeable backend unreachable (${where(conn, profile)})`, description: `${(error && error.message) || error}.${hint}` }
}

// The detail block under an opened pane row (prototype detail()).
export function Detail({ it, now }) {
  const a = auditOf(it)
  const dl = []
  const add = (k, v, mono) => dl.push(h('dt', { key: `${k}-t` }, k), h('dd', { key: `${k}-d`, className: mono ? 'mg-mono' : undefined }, v))
  add('Branch', `${it.source_branch} into ${it.target_branch}`, true)
  add('Opened', `${fmtUtc(it.created_at)}, ${it.age_days} days ago, ${plural(workingAge(it, now), 'working day', 'working days')}`)
  add('Project', `merge method ${it.merge_method}, ${it.pipeline ? 'CI yes' : 'CI no'}, ${it.files_changed} files, ${plural(it.user_notes_count || 0, 'note', 'notes')}`)
  if (sessionKind(it.session)) add('Session', `${it.session.title || it.session.id} (${it.session.profile}, ${sessionKind(it.session)}, score ${it.session.score})`)
  if (a && it.renovate) {
    add('Bump', `${it.renovate.from} to ${it.renovate.to} (${it.renovate.update_type})`, true)
    add('Verdict', h(Fragment, null, h(Badge, { variant: VERDICT_TONE[a.verdict] || 'muted' }, a.verdict), ` ${a.summary}`))
    add('Importance', a.importance_reason)
    add('Ease', a.ease_reason)
    if (a.confidence !== 'sure') add('Not sure', a.not_sure_reason)
  }
  return h('div', { className: 'mg-detail', 'data-detail': it.ref, onClick: stop }, h('dl', null, dl))
}
