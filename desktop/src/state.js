// The host context and the view state, bound in register() and cleared on dispose. Display settings
// (D67, per machine) are written through to ctx.storage; the view (filter, sort, drafts) is shared as
// atoms so the pane and the page, mounted at once, follow each other. Tracked jobs live here too.
import { atom } from '@hermes/plugin-sdk'

import { normalizeSettings, normalizeView } from './logic.js'
import { STORE } from './model.js'

export let api = null
export let $settings = null
export let $view = null
// Jobs the user started in this session: [{ id, kind, label, scope }]. Their payloads (polled by
// JobWatch) are kept in $jobData by id, so a row can show the step of the job that touches it.
export let $jobs = null
export let $jobData = null
// The pane row that is open (expanded). Shared so a notification click can open one from outside the pane.
export let $open = null

export function bind(ctx) {
  api = ctx
  $settings = atom(normalizeSettings(ctx.storage.get(STORE.settings, null)))
  $view = atom(normalizeView(null, $settings.get()))
  $jobs = atom([])
  $jobData = atom({})
  $open = atom(null)
}

export function unbind() {
  api = null
  $settings = $view = $jobs = $jobData = $open = null
}

export const setView = next => $view.set(normalizeView(typeof next === 'function' ? next($view.get()) : next, $settings.get()))

// A changed default (drafts, sort) also moves the live view, as the prototype's settings did.
export function setSettings(next) {
  const cur = $settings.get()
  const v = normalizeSettings(typeof next === 'function' ? next(cur) : next)
  $settings.set(v)
  api.storage.set(STORE.settings, v)
  if (v.showDrafts !== cur.showDrafts) setView(view => ({ ...view, drafts: v.showDrafts }))
  if (v.sort !== cur.sort) setView(view => ({ ...view, sort: v.sort }))
}

export function trackJob(job) {
  if (!$jobs) return // a write answered after the plugin was disposed
  if (!$jobs.get().some(j => j.id === job.id)) $jobs.set([...$jobs.get(), job])
}
export function dismissJob(id) {
  $jobs.set($jobs.get().filter(j => j.id !== id))
  const { [id]: _gone, ...rest } = $jobData.get()
  $jobData.set(rest)
}
// True the first time a job id is reported finished: the toast and list refresh run once per job.
const finished = new Set()
export const markFinished = id => (finished.has(id) ? false : (finished.add(id), true))
export function putJobData(job) {
  const cur = $jobData.get()
  if (cur[job.id] !== job) $jobData.set({ ...cur, [job.id]: job })
}
