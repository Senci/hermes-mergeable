// Notifications (D80): what changed between two /mrs polls and in /jobs, announced once. The pane and the page both
// call useNotifier(q); one answer is looked at once however many surfaces are mounted. The first poll of a backend and
// profile is the baseline and never notifies, and announced keys live in ctx.storage so a restart does not repeat them.
import { host, useValue } from '@hermes/plugin-sdk'
import { useEffect } from 'react'

import { reveal, useJobsList } from './data.js'
import { endedJobKeys, filterItems, jobEvents, messagesFor, mrEvents, rebasedRefs, takeFresh } from './logic.js'
import { EVENTS, PANE_ID, STORE } from './model.js'
import { $jobs, $open, $settings, $view, api, setView } from './state.js'

// scope -> { items: last item list, data: last payload seen, jobs: last /jobs list seen }
const scopes = new Map()
export const resetNotifier = () => scopes.clear()

const focused = () => typeof document !== 'undefined' && typeof document.hasFocus === 'function' && document.hasFocus()

// Click target: the pane with the row expanded; a filter that hides the row is widened first.
function showRow(ref, items) {
  reveal(PANE_ID)
  if (!ref) return
  if (items && !filterItems(items, $view.get(), $settings.get()).some(it => it.ref === ref)) setView(cur => ({ ...cur, filter: 'all', drafts: true }))
  $open.set(ref)
}

function deliver(m, items) {
  const show = () => showRow(m.ref, items)
  const title = `Mergeable: ${m.title}`
  if (focused()) {
    host.notify({ kind: m.kind, title, message: m.body || m.title, action: { label: 'Show', onClick: show } })
  } else if (api.os && typeof api.os.notify === 'function') {
    // The host posts it only while Hermes is in the background; a click focuses Hermes and runs onActivate.
    api.os.notify({ title, body: m.body, silent: m.silent, onActivate: show })
  } else {
    host.notify({ kind: m.kind, title, message: m.body || m.title })
  }
}

export function observe(scope, data, jobs) {
  if (!api) return
  const st = scopes.get(scope) || { items: null, data: null, jobs: null }
  scopes.set(scope, st)
  const events = []
  let known = api.storage.get(STORE.notified, {})
  let baseline = false
  if (data && data !== st.data) {
    const items = data.items || []
    events.push(...mrEvents(st.items, items, { user: data.user || '', rebased: rebasedRefs(jobs || st.jobs) }))
    st.items = items
    st.data = data
  }
  if (jobs && jobs !== st.jobs) {
    if (st.jobs === null) {
      known = takeFresh(endedJobKeys(jobs).map(key => ({ key })), known).notified
      baseline = true
    } else {
      events.push(...jobEvents(jobs))
    }
    st.jobs = jobs
  }
  const { fresh, notified } = takeFresh(events, known)
  if (fresh.length || baseline) api.storage.set(STORE.notified, notified)
  const settings = $settings.get()
  const mine = new Set($jobs.get().map(j => j.id))
  // A job started here already toasts when it ends (settleJob); only the unfocused case is news.
  const due = fresh
    .filter(e => settings[EVENTS.find(x => x.id === e.type).setting])
    .filter(e => !(e.type === 'job' && focused() && mine.has(e.jobId)))
  for (const m of messagesFor(due)) deliver(m, st.items)
}

export function useNotifier(q) {
  const s = useValue($settings)
  const jobs = useJobsList(!!(s.notifyJob || s.notifyPipelineGreen))
  useEffect(() => {
    if (q.data) observe(`${q.conn}|${q.profile}`, q.data, jobs.data)
  }, [q.data, jobs.data, q.conn, q.profile])
}
