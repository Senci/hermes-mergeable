// Backend access. Everything goes through ctx.rest, which follows the window's active gateway on
// every call, so connection and profile are part of every query key: a switch must neither reuse nor
// show another backend's data. Every per-MR write carries expected_sha (D59): the backend re-reads
// the MR and answers 409 when the head moved since the row was drawn.
import { host, queryClient, useValue } from '@hermes/plugin-sdk'
import { useRef } from 'react'

import { useBackend, useLiveQuery } from 'hermes-plugin-ui-kit/live.js'

import { isDone, pollMs, sessionKind, statusMarkdown } from './logic.js'
import { ID, JOB_POLL_MS, PATH, STALE_MS, WRITE_PATH } from './model.js'
import { $settings, api, markFinished, trackJob } from './state.js'

export { useBackend }

export const scopeKey = (conn, profile) => [ID, conn, profile]
export const mrsKey = (conn, profile) => [...scopeKey(conn, profile), 'mrs']
export const jobKey = (conn, profile, id) => [...scopeKey(conn, profile), 'job', id]
export const jobsKey = (conn, profile) => [...scopeKey(conn, profile), 'jobs']
const here = () => scopeKey(host.state.connectionId.get() ?? '', host.state.profile.get() ?? '')

const offline = () => Promise.reject(new Error('mergeable not loaded'))
const fetchMrs = () => (api ? api.rest('/mrs') : offline())

// The one polling query. A previous payload carries over only from the same connection and profile.
export function useMrs() {
  const { conn, profile } = useBackend()
  const settings = useValue($settings)
  const q = useLiveQuery({
    queryKey: mrsKey(conn, profile),
    queryFn: fetchMrs,
    placeholderData: (prev, prevQuery) =>
      prevQuery && prevQuery.queryKey[1] === conn && prevQuery.queryKey[2] === profile ? prev : undefined,
    pollMs: pollMs(settings),
    staleTime: STALE_MS
  })
  return { ...q, conn, profile }
}

// Refresh button: the backend re-collects (and audits changed heads), the answer replaces the cache entry
// of the scope the click came from, even if the window switched backends meanwhile.
export async function refresh() {
  const key = [...here(), 'mrs']
  const data = await api.rest('/mrs?refresh=1')
  queryClient.setQueryData(key, data)
  return data
}

// The backend's last 20 jobs (D80 notifications: ended merge and batch jobs, rebases). Polled like the list, and only
// while an event that needs it is switched on.
export function useJobsList(enabled) {
  const { conn, profile } = useBackend()
  const settings = useValue($settings)
  return useLiveQuery({
    queryKey: jobsKey(conn, profile),
    queryFn: () => (api ? api.rest('/jobs') : offline()),
    pollMs: pollMs(settings),
    staleTime: STALE_MS,
    enabled
  })
}

// One query per tracked job, polled every 3 s until it reports a final state.
export function useJob(id) {
  const { conn, profile } = useBackend()
  const final = useRef(false)
  const q = useLiveQuery({
    queryKey: jobKey(conn, profile, id),
    queryFn: () => (api ? api.rest(`/jobs/${encodeURIComponent(id)}`) : offline()),
    pollMs: final.current ? false : JOB_POLL_MS,
    staleTime: 0
  })
  final.current = isDone(q.data)
  return q
}

// Runs once per finished job however many surfaces watch it: the toast and one list refresh.
export function settleJob(job, meta) {
  if (!isDone(job) || !markFinished(job.id)) return
  const ok = job.state === 'done'
  host.notify({ kind: ok ? 'success' : 'error', message: `Mergeable: ${meta ? meta.label : job.kind} ${job.state}` })
  void queryClient.invalidateQueries({ queryKey: [...here(), 'mrs'] })
}

function started(out, kind, label, refs) {
  const id = out && (typeof out.job_id === 'string' || typeof out.job_id === 'number') ? String(out.job_id) : null
  if (!id) throw new Error('the backend accepted the request without a job_id')
  const scope = here()
  trackJob({ id, kind, label, refs, conn: scope[1], profile: scope[2] })
  return id
}

// Per-MR write. Refuses to send without the head sha the row showed.
export async function postMr(it, kind, extra = {}) {
  if (!it || !it.sha) throw new Error(`${it ? it.ref : 'MR'} has no head sha, refusing to write`)
  if (!WRITE_PATH[kind]) throw new Error(`unknown action ${kind}`)
  const out = await api.rest(`/mrs/${it.project_id}/${it.iid}/${WRITE_PATH[kind]}`, {
    method: 'POST',
    body: { expected_sha: it.sha, ...extra }
  })
  return started(out, kind, `${kind} ${it.ref}`, [it.ref])
}

// Trivial batch (D65): the refs and shas the dialog listed, nothing else.
export async function postBatch(plan) {
  const steps = plan.steps
  if (!steps.length || steps.some(s => !s.item.sha)) throw new Error('the batch has a step without a head sha, refusing to write')
  const refs = steps.map(s => s.item.ref)
  const out = await api.rest('/batch/trivial', { method: 'POST', body: { refs, shas: steps.map(s => s.item.sha) } })
  return started(out, 'batch', `trivial batch of ${refs.length}`, refs)
}

export async function auditAll() {
  const out = await api.rest('/audit/all', { method: 'POST', body: {} })
  return started(out, 'audit-all', 're-audit all', [])
}

// ctx.rest answers JSON only (the desktop transport JSON-parses every body), so a raw text/markdown
// answer from /status.md surfaces as an error. Take a JSON string or { markdown } from the backend;
// anything else falls back to the same summary built from the list in hand.
export async function fetchStatus(data) {
  try {
    const out = await api.rest('/status.md')
    if (typeof out === 'string' && out.trim()) return { text: out, local: false }
    if (out && typeof out.markdown === 'string' && out.markdown.trim()) return { text: out.markdown, local: false }
  } catch {
    // fall through to the local summary
  }
  return { text: statusMarkdown(data), local: true }
}

export async function copyText(text) {
  if (api && api.os && typeof api.os.writeClipboard === 'function') return api.os.writeClipboard(text)
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    await navigator.clipboard.writeText(text)
    return true
  }
  return false
}

export function openExternal(url) {
  if (api && api.os && typeof api.os.openExternal === 'function') void api.os.openExternal(url)
  else window.open(url, '_blank', 'noopener')
}

// The session that made the MR, in a new tab, on the profile that owns it (state.db is per profile).
export function openSession(it) {
  if (!sessionKind(it.session)) return
  void host.openSession(it.session.id, { intent: 'tab', profile: it.session.profile })
}

// Idempotent: reveals the pane (fronts its tab), never toggles. Older desktops have no revealPane,
// then the full page is the way in.
export function reveal(paneId) {
  if (typeof host.revealPane === 'function') host.revealPane(paneId)
  else host.navigate(PATH)
}
