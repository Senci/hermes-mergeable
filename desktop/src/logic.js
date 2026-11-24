// Pure logic of the Mergeable desktop half: ages, filters, sort, chips, action state, the trivial
// plan, settings repair. No SDK, no React, no DOM: tests/desktop.test.mjs runs it in plain node and
// compares it with what the prototype computes (tests/fixtures/prototype-parity.json).

import {
  CHIP_ICON, DEFAULT_SETTINGS, DONE_STATES, EASE_TONE, EVENTS, FILTERS, IMPORTANCE_ORDER, IMPORTANCE_TONE, KEEP_KEYS, POLLS,
  SESSION_CREATED_SCORE, SESSION_MIN_SCORE, SORTS, SUMMARY_ABOVE
} from './model.js'

const num = n => (Number.isFinite(n) ? n : 0)
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
export { plural }

// --- item accessors ---

export const shortOf = project => String(project || '').split('/').pop()
export const refLabel = it => `${shortOf(it.project)}!${it.iid}`
export const isMine = it => it.owner !== 'other'
export const isRenovate = it => it.owner === 'renovate'
export const hasCi = it => !!it.pipeline
export const auditOf = it => (it.audit && typeof it.audit === 'object' ? it.audit : null)
export const inBatch = it => !!(it.trivial && it.trivial.in_batch)
export const modelFamily = model => {
  const m = /^(?:claude-)?([a-z]+)/.exec(String(model || ''))
  return m ? m[1] : 'opus'
}

// Prototype age(): today, days to two weeks, weeks to two months, then months.
export function ageLabel(d) {
  if (d === null || d === undefined) return ''
  if (d < 1) return 'today'
  if (d < 14) return `${d}d`
  if (d < 60) return `${Math.round(d / 7)}w`
  return `${Math.round(d / 30)}mo`
}
// Colour of the age (D79, limits compare with >= per D76): amber from the warn limit, orange from the stale limit,
// both in WORKING days. The label above stays calendar time.
export const ageClass = (wd, s = DEFAULT_SETTINGS) => (wd >= s.ageStale ? 'stale' : wd >= s.ageWarn ? 'old' : '')

// --- working days (D79): Mo to Fr minus the Hamburg public holidays, computed from the Easter date ---

const DAY_MS = 86_400_000
const pad = n => String(n).padStart(2, '0')
const isoOf = ms => new Date(ms).toISOString().slice(0, 10)
const msOf = iso => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))
export const addDays = (iso, n) => isoOf(msOf(iso) + n * DAY_MS)

// Gregorian Easter Sunday (Meeus/Jones/Butcher), as YYYY-MM-DD.
export function easterSunday(year) {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return `${year}-${pad(month)}-${pad(day)}`
}

const holidayCache = new Map()
// The ten Hamburg public holidays of a year, sorted by date.
export function hamburgHolidays(year) {
  if (holidayCache.has(year)) return holidayCache.get(year)
  const easter = easterSunday(year)
  const list = [
    { date: `${year}-01-01`, name: 'New Year' },
    { date: addDays(easter, -2), name: 'Good Friday' },
    { date: addDays(easter, 1), name: 'Easter Monday' },
    { date: `${year}-05-01`, name: 'Labour Day' },
    { date: addDays(easter, 39), name: 'Ascension' },
    { date: addDays(easter, 50), name: 'Whit Monday' },
    { date: `${year}-10-03`, name: 'German Unity Day' },
    { date: `${year}-10-31`, name: 'Reformation Day' },
    { date: `${year}-12-25`, name: 'Christmas Day' },
    { date: `${year}-12-26`, name: 'Boxing Day' }
  ].sort((x, y) => (x.date < y.date ? -1 : 1))
  holidayCache.set(year, list)
  return list
}
export const holidayOn = iso => hamburgHolidays(Number(iso.slice(0, 4))).find(h => h.date === iso) || null
export function isWorkingDay(iso) {
  const dow = new Date(msOf(iso)).getUTCDay()
  return dow !== 0 && dow !== 6 && !holidayOn(iso)
}

// The Hamburg calendar day of an instant (an ISO string or a Date), as YYYY-MM-DD. Holidays are local dates.
const berlin = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' })
export function berlinDay(when) {
  const d = when instanceof Date ? when : new Date(when)
  return Number.isNaN(d.getTime()) ? null : berlin.format(d)
}

// Working days after the day `from` up to and including the day `to` (opened Friday, looked at on Monday: 1).
export function workingDaysBetween(from, to) {
  const a = berlinDay(from)
  const b = berlinDay(to)
  if (!a || !b || b <= a) return 0
  let n = 0
  for (let day = addDays(a, 1); day <= b; day = addDays(day, 1)) if (isWorkingDay(day)) n++
  return n
}
// An MR's age in working days as of the moment the list was built (the payload's generated_at).
export const workingAge = (it, now) => workingDaysBetween(it.created_at, Number.isNaN(new Date(now).getTime()) ? new Date() : now)
export function ageTip(it, wd) {
  return `Opened ${berlinDay(it.created_at) || it.created_at}, ${plural(num(it.age_days), 'day', 'days')} ago, ${plural(wd, 'working day', 'working days')}`
}
export const pipeTone = status => (status === 'success' ? 'success' : status === 'failed' ? 'failed' : status === 'running' || status === 'pending' ? 'running' : 'none')

// Session button: absent below the score floor, solid for an author marker, dim for a mention.
export function sessionKind(session) {
  if (!session || !session.id || !(num(session.score) >= SESSION_MIN_SCORE)) return null
  return session.score >= SESSION_CREATED_SCORE ? 'created' : 'mentioned'
}

// --- urgency, filter, sort (the prototype's urgency(), filtered(), renderTable()) ---

export function urgency(it) {
  let s = 50
  if (it.draft) s += 40
  if (!isMine(it)) s += 30
  if (it.merge_status === 'mergeable') s -= 20
  const a = auditOf(it)
  if (a) s -= (4 - (IMPORTANCE_ORDER[a.importance] ?? 4)) * 6
  if (it.merge_status === 'need_rebase') s -= 5
  return s
}

const SORT_KEYS = {
  urgency: it => [urgency(it), -num(it.age_days)],
  age: it => [-num(it.age_days), 0],
  project: it => [it.project, num(it.iid)]
}
export function sortItems(items, sort) {
  const key = SORT_KEYS[sort] || SORT_KEYS.urgency
  return items.slice().sort((a, b) => {
    const ka = key(a)
    const kb = key(b)
    return ka[0] < kb[0] ? -1 : ka[0] > kb[0] ? 1 : ka[1] - kb[1]
  })
}

// Header counts run over every item, not over the drafts and colleague settings (as the prototype's).
export function filterCounts(items) {
  return {
    all: items.length,
    mine: items.filter(it => it.owner === 'self').length,
    renovate: items.filter(isRenovate).length,
    colleagues: items.filter(it => it.owner === 'other').length
  }
}
export function filterItems(items, view, s = DEFAULT_SETTINGS) {
  let xs = items.filter(it => (view.drafts || !it.draft) && (s.showColleagues || it.owner !== 'other'))
  if (view.filter === 'mine') xs = xs.filter(it => it.owner === 'self')
  if (view.filter === 'renovate') xs = xs.filter(isRenovate)
  if (view.filter === 'colleagues') xs = xs.filter(it => it.owner === 'other')
  return xs
}
export const paneItems = (items, view, s) => sortItems(filterItems(items, view, s), view.sort)
export const tableItems = items => items.slice().sort((a, b) => urgency(a) - urgency(b) || num(b.age_days) - num(a.age_days))

export function normalizeView(raw, s = DEFAULT_SETTINGS) {
  const filter = raw && FILTERS.some(f => f.id === raw.filter) ? raw.filter : 'all'
  const sort = raw && SORTS.some(x => x.id === raw.sort) ? raw.sort : s.sort
  return { filter, sort, drafts: raw && typeof raw.drafts === 'boolean' ? raw.drafts : s.showDrafts }
}

// Summary line of the page (the prototype's TL;DR counts).
export function summarize(items) {
  const c = { self: 0, renovate: 0, other: 0 }
  for (const it of items) c[it.owner] = (c[it.owner] || 0) + 1
  return {
    count: items.length,
    projects: new Set(items.map(it => it.project)).size,
    mine: c.self,
    renovate: c.renovate,
    colleagues: c.other,
    drafts: items.filter(it => it.draft).length,
    mergeable: items.filter(it => !it.draft && it.merge_status === 'mergeable').length,
    rebase: items.filter(it => !it.draft && it.merge_status === 'need_rebase').length
  }
}

// --- chips (the prototype's chips(): tone, label, icon, tooltip; D78: the pane draws the icon only) ---
// `label` is the prototype's chip text (parity test), `name` the plain name the page falls back to when the label is
// empty, `tip` the pane tooltip ("name: reason"), `group` the page column the chip belongs to.

const chip = (key, group, tone, label, name, why, { iconKey, ...extra } = {}) => ({
  key, group, tone, label, name, icon: CHIP_ICON[iconKey || key], tip: why ? `${name}: ${why}` : name, ...extra
})

export function chipsOf(it, s = DEFAULT_SETTINGS) {
  const out = []
  const a = auditOf(it)
  if (it.draft) out.push(chip('draft', 'state', 'muted', 'draft', 'Draft', 'Draft MR, not mergeable until marked ready'))
  if (s.chipOwner && it.owner === 'renovate') out.push(chip('owner', 'owner', 'default', '', 'Renovate', 'Renovate bot', { iconKey: 'renovate' }))
  if (s.chipOwner && it.owner === 'other') out.push(chip('owner', 'owner', 'outline', it.author, it.author, "Colleague's MR, read-only", { iconKey: 'colleague' }))
  if (a && s.chipRatings) {
    out.push(chip('importance', 'audit', IMPORTANCE_TONE[a.importance] || 'muted', a.importance, `Importance ${a.importance}`, a.importance_reason))
    out.push(chip('ease', 'audit', EASE_TONE[a.ease] || 'muted', a.ease, `Ease ${a.ease}`, a.ease_reason))
    if (a.escalated) out.push(chip('escalated', 'audit', 'warn', modelFamily(a.model), `Escalated to ${modelFamily(a.model)}`, 'The first model was not sure, a stronger one decided'))
    if (a.confidence !== 'sure') out.push(chip('unsure', 'audit', 'outline', '?', 'Not sure', a.not_sure_reason))
  }
  if (isRenovate(it) && s.chipRatings) {
    const st = it.audit_state
    if (st === 'queued' || st === 'running') {
      out.push(chip('audit-state', 'audit', 'muted', st === 'queued' ? 'audit queued' : 'auditing', st === 'queued' ? 'Audit queued' : 'Auditing', st === 'queued' ? 'Waiting for its turn' : 'The audit is running now', { iconKey: 'running', spinning: true }))
    } else if (st === 'stale') {
      out.push(chip('audit-state', 'audit', 'warn', 'audit stale', 'Audit stale', 'The MR head moved since this audit', { iconKey: 'stale' }))
    } else if (st === 'error') {
      out.push(chip('audit-state', 'audit', 'destructive', 'audit error', 'Audit error', 'The last audit run failed', { iconKey: 'error' }))
    }
  }
  if (!it.draft && s.chipState) {
    if (inBatch(it)) out.push(chip('state', 'state', 'success', 'batch', 'In the trivial batch', 'Merged together by the header Trivial button', { iconKey: 'batch' }))
    else if (it.merge_status === 'mergeable') out.push(chip('state', 'state', 'success', 'mergeable', 'Mergeable', 'Ready to merge', { iconKey: 'mergeable' }))
    if (it.merge_status === 'need_rebase') out.push(chip('rebase', 'state', 'warn', 'rebase', 'Needs rebase', 'Behind the target branch, needs one rebase'))
    else if (it.has_conflicts) out.push(chip('conflict', 'state', 'destructive', 'conflict', 'Conflict', 'Merge conflict, fix by hand'))
  }
  if (!hasCi(it)) out.push(chip('noci', 'state', 'outline', 'no CI', 'No CI', 'Project has no pipeline for this MR'))
  return out
}

// --- action state (the backend's `can`, read as it comes; an older or partial backend disables) ---

export function reasonFor(it, action) {
  const r = it.can && it.can.reason
  const text = typeof r === 'string' ? r : r && typeof r === 'object' ? r[action] || r.default || '' : ''
  return text || 'Not available for this MR'
}
const COLLEAGUE = "Colleague's MR"
export function rebaseAbility(it) {
  if (it.owner === 'other') return { ok: false, why: COLLEAGUE }
  const can = it.can || {}
  const ok = isRenovate(it) ? can.renovate_rebase === true : can.rebase === true
  if (!ok) return { ok, why: it.can ? reasonFor(it, 'rebase') : 'The backend sent no action state' }
  return { ok, why: isRenovate(it) ? 'Ask Renovate to rebase (ticks its rebase box)' : 'Rebase once on the server (starts one pipeline)' }
}
export function mergeAbility(it) {
  if (it.owner === 'other') return { ok: false, why: COLLEAGUE }
  const ok = !!(it.can && it.can.merge === true)
  if (!ok) return { ok, why: it.can ? reasonFor(it, 'merge') : 'The backend sent no action state' }
  return { ok, why: `Merge into ${it.target_branch}` }
}

export function sessionTip(it) {
  const s = it.session
  const kind = sessionKind(s)
  if (!kind) return 'No session found for this branch'
  return `${kind === 'created' ? 'Created in' : 'Mentioned in'}: ${s.title || s.id} (${s.profile})`
}

export const glabCommand = (it, host) => `glab mr view ${it.iid} -R ${host}/${it.project}`
export const holdDefaultUntil = (now = new Date(), days = 30) => {
  const d = new Date(now.getTime() + days * 86_400_000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}
export const isIsoDay = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v)) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))

// The D63 menu and nothing else: no Close, no Approve. `null` is a separator.
export function menuItems(it) {
  const other = it.owner === 'other'
  const mine = isMine(it)
  const failed = !!(it.pipeline && it.pipeline.status === 'failed')
  const renov = isRenovate(it)
  return [
    { id: 'open', icon: 'link-external', label: 'Open in GitLab', enabled: !!it.web_url, why: 'No web address' },
    { id: 'pipeline', icon: 'run-all', label: 'Open pipeline', enabled: !!(it.pipeline && it.pipeline.url), why: 'No pipeline' },
    { id: 'retry', icon: 'debug-rerun', label: 'Retry failed pipeline', enabled: failed && mine, why: other ? COLLEAGUE : 'Only for a failed pipeline on your MR' },
    null,
    { id: 'copy-branch', icon: 'copy', label: 'Copy branch name', enabled: !!it.source_branch, why: 'No branch' },
    { id: 'copy-glab', icon: 'copy', label: 'Copy glab view command', enabled: true, why: '' },
    null,
    { id: 'ready', icon: 'check', label: 'Mark ready', enabled: !!(it.draft && it.owner === 'self'), why: other ? COLLEAGUE : 'Only for your own draft' },
    { id: 'audit', icon: 'debug-rerun', label: 'Re-run audit', enabled: renov, why: 'Only for a Renovate MR' },
    { id: 'hold', icon: 'shield', label: 'Add Renovate hold rule', enabled: renov && !other && !!(it.renovate && it.renovate.package), why: other ? COLLEAGUE : 'Only for a Renovate MR' }
  ]
}

// --- trivial batch (the prototype's trivialPlan; the backend owns the set, this orders and counts it) ---

export function trivialPlan(items) {
  const set = items.filter(inBatch)
  const byProject = new Map()
  for (const it of set) byProject.set(it.project, [...(byProject.get(it.project) || []), it])
  const steps = []
  for (const project of [...byProject.keys()].sort()) {
    const xs = byProject.get(project).sort((a, b) => (a.merge_status === 'mergeable' ? 0 : 1) - (b.merge_status === 'mergeable' ? 0 : 1) || a.iid - b.iid)
    xs.forEach((it, i) => {
      const rebase = it.merge_status === 'need_rebase' || (i > 0 && it.merge_method === 'ff')
      steps.push({ item: it, rebase, pipelines: rebase && hasCi(it) ? 1 : 0 })
    })
  }
  const missed = items.filter(it => !it.draft && isMine(it) && !inBatch(it)).map(it => ({ item: it, why: (it.trivial && it.trivial.miss) || '' }))
  return {
    steps, missed,
    rebases: steps.filter(s => s.rebase).length,
    pipelines: steps.reduce((n, s) => n + s.pipelines, 0),
    projects: new Set(steps.map(s => s.item.project)).size
  }
}
export const trivialCount = items => items.filter(inBatch).length

// --- jobs ---

export const isDone = job => !!job && DONE_STATES.includes(job.state)
export function stepFor(job, ref) {
  const steps = (job && job.steps) || []
  for (let i = steps.length - 1; i >= 0; i--) if (steps[i].ref === ref) return steps[i]
  return null
}
export function jobLine(job) {
  const steps = (job && job.steps) || []
  const last = steps[steps.length - 1]
  const where = last ? `${last.ref ? `${last.ref}: ` : ''}${last.step}${last.detail ? `, ${last.detail}` : ''}` : 'starting'
  return `${job.kind} ${job.state}: ${where}`
}

// --- notifications (D80): events from two consecutive /mrs polls and from /jobs ---

// A bot is never "someone else": GitLab group bots (group_<id>_bot_<hash>), Renovate and any name ending in bot.
export const isBot = name => /(^|[_.-])bot($|[_.-])|^renovate/i.test(String(name || ''))
const clip = (text, n = 160) => (String(text || '').length > n ? `${String(text).slice(0, n - 3)}...` : String(text || ''))
const isLoud = a => !!a && ['high', 'critical'].includes(a.importance)
export const jobRefs = job => [...new Set([...((job && job.refs) || []), ...(((job && job.steps) || []).map(s => s.ref).filter(Boolean))])]

// Refs this window rebased: a finished rebase step in a rebase, merge or batch job of the /jobs list.
export function rebasedRefs(jobs) {
  const out = new Set()
  for (const j of jobs || []) for (const s of j.steps || []) if (s.step === 'rebase' && s.state === 'done' && s.ref) out.add(s.ref)
  return out
}

// Events between two polls. `prev` is the previous item list (null on the first poll of a scope: nothing happened yet).
// `reviewers` and `last_note` come from a newer backend; an item that lacks them, now or before, stays silent for those two.
export function mrEvents(prev, items, { user = '', rebased = new Set() } = {}) {
  if (!prev) return []
  const before = new Map(prev.map(it => [it.ref, it]))
  const out = []
  const add = (type, it, key, title, body, silent) => out.push({ type, ref: it.ref, key: `${it.ref}:${key}`, title, body: clip(body), silent })
  for (const it of items) {
    const old = before.get(it.ref)
    const a = auditOf(it)
    const was = old ? auditOf(old) : null
    const name = `${refLabel(it)} ${it.title}`
    if (isRenovate(it) && a) {
      const sha = a.sha || it.sha
      const sameSha = !!was && (was.sha || old.sha) === sha
      if (isLoud(a) && !(isLoud(was) && sameSha)) add('bump', it, `bump:${sha}`, `${refLabel(it)} rated ${a.importance}`, `${it.title}: ${a.summary}`, false)
      if (['hold', 'needs_change'].includes(a.verdict) && !(was && was.verdict === a.verdict && sameSha)) {
        add('audit', it, `audit:${sha}`, `Audit says ${a.verdict.replace('_', ' ')}: ${refLabel(it)}`, `${it.title}: ${a.summary}`, !isLoud(a))
      }
    }
    const st = it.pipeline && it.pipeline.status
    const wasSt = old && old.pipeline && old.pipeline.status
    const moved = !old || old.sha !== it.sha
    if (it.owner === 'self' && st === 'failed' && (wasSt !== 'failed' || moved)) add('pipeline-failed', it, `pipeline-failed:${it.sha}`, `Pipeline failed: ${refLabel(it)}`, it.title, false)
    if (isMine(it) && st === 'success' && (wasSt !== 'success' || moved) && rebased.has(it.ref)) add('pipeline-green', it, `pipeline-green:${it.sha}`, `Pipeline green after your rebase: ${refLabel(it)}`, it.title, true)
    const note = it.last_note
    if (it.owner === 'self' && old && note && old.last_note !== undefined && it.last_note !== undefined && note.author !== user && !isBot(note.author) && !(old.last_note && old.last_note.at === note.at)) {
      add('comment', it, `comment:${note.at}`, `New comment from ${note.author}`, name, true)
    }
    if (it.owner === 'other' && user && Array.isArray(it.reviewers) && it.reviewers.includes(user) && (!old || (Array.isArray(old.reviewers) && !old.reviewers.includes(user)))) {
      add('review', it, `review:${it.sha}`, `${it.author} asks for your review`, name, true)
    }
  }
  return out
}

export const jobKey = job => `job:${job.id}:${job.state}`
const watched = job => job && ['merge', 'batch'].includes(job.kind) && DONE_STATES.includes(job.state)
// Merge or batch jobs that ended. The first /jobs list of a scope is a baseline: its ended jobs are known, not news.
export const endedJobKeys = jobs => (jobs || []).filter(watched).map(jobKey)
export function jobEvents(jobs) {
  return (jobs || []).filter(watched).map(job => {
    const refs = jobRefs(job)
    const last = (job.steps || []).filter(s => s.detail).pop()
    const what = job.kind === 'batch' ? 'Trivial batch' : 'Merge'
    const where = refs.length > 3 ? `${refs.slice(0, 3).join(', ')} and ${refs.length - 3} more` : refs.join(', ')
    return { type: 'job', ref: refs[0] || '', jobId: job.id, key: jobKey(job), title: `${what} ${job.state}${job.state === 'done' ? '' : ', check the MRs'}`, body: clip(`${where}${last ? `: ${last.detail}` : ''}`), silent: job.state === 'done' }
  })
}

// Keep only what was not announced before, and remember it. A muted event is still remembered, so turning its toggle on
// later does not replay old news.
export function takeFresh(events, notified, now = Date.now()) {
  const seen = { ...(notified && typeof notified === 'object' ? notified : {}) }
  const fresh = []
  for (const e of events) {
    if (e.key in seen) continue
    seen[e.key] = now
    fresh.push(e)
  }
  const keys = Object.keys(seen)
  if (keys.length > KEEP_KEYS) for (const k of keys.sort((x, y) => seen[y] - seen[x]).slice(KEEP_KEYS)) delete seen[k]
  return { fresh, notified: seen }
}

// One poll's deliverable events: above SUMMARY_ABOVE they become one summary.
export function messagesFor(events) {
  if (events.length <= SUMMARY_ABOVE) return events.map(e => ({ ...e, kind: EVENTS.find(x => x.id === e.type).kind }))
  const lines = EVENTS.map(x => [x, events.filter(e => e.type === x.id).length]).filter(([, n]) => n).map(([x, n]) => `${n} ${x.summary}`)
  const worst = ['error', 'warning', 'info', 'success'].find(k => events.some(e => EVENTS.find(x => x.id === e.type).kind === k))
  return [{ type: 'summary', ref: '', key: '', title: `${events.length} new events`, body: lines.join('\n'), silent: events.every(e => e.silent), kind: worst }]
}

// --- settings ---

const bool = (v, d) => (typeof v === 'boolean' ? v : d)
const days = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 1 ? Math.floor(Number(v)) : d)
export function normalizeSettings(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const d = DEFAULT_SETTINGS
  // 30 and 90 were the calendar-day defaults before D79: as working days they would never colour anything.
  const old = Number(r.ageWarn) === 30 && Number(r.ageStale) === 90
  const warn = old ? d.ageWarn : days(r.ageWarn, d.ageWarn)
  return {
    showColleagues: bool(r.showColleagues, d.showColleagues),
    showDrafts: bool(r.showDrafts, d.showDrafts),
    chipRatings: bool(r.chipRatings, d.chipRatings),
    chipState: bool(r.chipState, d.chipState),
    chipOwner: bool(r.chipOwner, d.chipOwner),
    sessionBtn: bool(r.sessionBtn, d.sessionBtn),
    ageWarn: warn,
    ageStale: Math.max(warn, old ? d.ageStale : days(r.ageStale, d.ageStale)),
    sort: SORTS.some(x => x.id === r.sort) ? r.sort : d.sort,
    poll: POLLS.some(x => x.id === String(r.poll)) ? String(r.poll) : d.poll,
    ...Object.fromEntries(EVENTS.map(e => [e.setting, bool(r[e.setting], d[e.setting])]))
  }
}
export const pollMs = s => (Number(s.poll) > 0 ? Number(s.poll) * 1000 : false)

// --- status text (Copy status falls back to this when the backend answer is unreadable, D68) ---

export function statusMarkdown(data) {
  const items = (data && data.items) || []
  const s = summarize(items)
  const lines = [`# Open merge requests (${s.count})`, '']
  lines.push(`${plural(s.count, 'MR', 'MRs')} in ${plural(s.projects, 'project', 'projects')}: ${s.mine} mine, ${s.renovate} Renovate, ${s.colleagues} colleagues. ${s.mergeable} mergeable now, ${s.rebase} need a rebase, ${s.drafts} drafts. Trivial batch: ${trivialCount(items)}.`, '')
  const byProject = new Map()
  for (const it of sortItems(items, 'project')) byProject.set(it.project, [...(byProject.get(it.project) || []), it])
  for (const [project, xs] of byProject) {
    lines.push(`## ${project}`)
    for (const it of xs) {
      const a = auditOf(it)
      const who = it.owner === 'self' ? 'mine' : it.owner === 'renovate' ? 'Renovate' : it.author
      const state = it.draft ? 'draft' : it.merge_status
      lines.push(`- !${it.iid} ${it.title} (${who}, ${ageLabel(it.age_days)}, ${state}${a ? `, audit ${a.verdict}` : ''}${inBatch(it) ? ', trivial' : ''})`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

export const fmtUtc = iso => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? String(iso || '') : `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}
export const fmtClock = iso => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
