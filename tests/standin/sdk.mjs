// Stand-in for @hermes/plugin-sdk, shared by the node test (with the stand-in React) and the headless
// Chrome harness (with real React): it only imports from 'react', so each side supplies its own.
// Prop shapes mirror apps/desktop/src/components/ui at the floor release (SegmentedControl options
// are { id, label }, DropdownMenuItem is onSelect, Checkbox is checked/onCheckedChange, ConfirmDialog
// is open/onClose/onConfirm and keeps the dialog open with an inline error when onConfirm throws).
//
// The query layer models what the plugin relies on from TanStack Query: one entry per key, a shared
// in-flight fetch, staleTime, `enabled: false` observers that never fetch, refetchInterval timers,
// placeholderData(prev, prevQuery), prefix invalidation. Intervals never run on their own: the
// probe calls fireIntervals(ms), so a 3 s job poll costs no wall time.
import { cloneElement, createContext, createElement as h, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react'

export const atom = v => {
  const subs = new Set()
  return {
    get: () => v,
    set: n => { if (Object.is(n, v)) return; v = n; subs.forEach(f => f(v)) },
    listen: f => { subs.add(f); return () => subs.delete(f) }
  }
}
export const useValue = a => useSyncExternalStore(f => a.listen(f), () => a.get())

// Area ids as the host defines them (apps/desktop/src/sdk/areas.ts, app/routes.ts, lib/keybinds/actions.ts).
export const PANES_AREA = 'panes'
export const ROUTES_AREA = 'routes'
export const SIDEBAR_NAV_AREA = 'sidebar.nav'
export const KEYBINDS_AREA = 'keybinds'
export const PALETTE_AREA = 'palette'
// `let` so a test can make the namespace property a non-string (a host that lacks the area).
export let SETTINGS_PLUGINS_AREA = 'settings.plugins'
export const setSettingsArea = v => { SETTINGS_PLUGINS_AREA = v }
export const pluginSettingsHref = (plugin, page) => `/settings?tab=plugins&plugin=${plugin}${page ? `&ppage=${page}` : ''}`

// Probe seams, all on one object so a test can reset them.
export const seam = {
  queryKeys: [], intervals: {}, navs: [], toasts: [], opened: [], revealed: [], submits: 0, fetches: 0
}
export const resetSeams = () => {
  SETTINGS_PLUGINS_AREA = 'settings.plugins'
  seam.queryKeys.length = 0
  seam.navs.length = 0
  seam.toasts.length = 0
  seam.opened.length = 0
  seam.revealed.length = 0
  seam.intervals = {}
  seam.submits = 0
  seam.fetches = 0
}

const store = new Map()
const observers = new Set()
const norm = k => JSON.stringify(k)
const entry = k => {
  const s = norm(k)
  if (!store.has(s)) store.set(s, { key: k, s, data: undefined, error: null, fetching: false, at: 0, promise: null })
  return store.get(s)
}
const timers = new Set()
export const resetQueries = () => { store.clear(); observers.clear(); timers.clear() }
const notify = e => observers.forEach(o => o.s === e.s && o.bump())

function fetchEntry(e, fn) {
  if (e.promise) return e.promise
  e.fetching = true
  seam.fetches++
  notify(e)
  e.promise = Promise.resolve().then(fn).then(
    d => { e.data = d; e.error = null; e.at = Date.now() },
    err => { e.error = err }
  ).then(() => { e.fetching = false; e.promise = null; notify(e) })
  return e.promise
}

export const queryClient = {
  getQueryData: key => entry(key).data,
  setQueryData: (key, upd) => {
    const e = entry(key)
    e.data = typeof upd === 'function' ? upd(e.data) : upd
    e.error = null
    e.at = Date.now()
    notify(e)
  },
  invalidateQueries: ({ queryKey }) => {
    const pre = queryKey.map(String).join('\u0000')
    const hits = [...observers].filter(o => o.enabled && o.key.map(String).join('\u0000').startsWith(pre))
    return Promise.all([...new Set(hits.map(o => o.refetch()))])
  }
}

export function useQuery({ queryKey, queryFn, refetchInterval, placeholderData, staleTime = 0, enabled = true }) {
  const s = norm(queryKey)
  const [, setTick] = useState(0)
  const prevRef = useRef(null)
  const fn = useRef(queryFn)
  fn.current = queryFn
  const e = entry(queryKey)
  seam.queryKeys.push(s)
  const interval = typeof refetchInterval === 'number' ? refetchInterval : 0
  useEffect(() => {
    const me = {
      s, key: queryKey, enabled, bump: () => setTick(t => t + 1),
      refetch: () => fetchEntry(entry(queryKey), () => fn.current())
    }
    observers.add(me)
    let tick = null
    if (enabled) {
      const ent = entry(queryKey)
      if (ent.data === undefined || Date.now() - ent.at >= staleTime) me.refetch()
      if (interval) {
        seam.intervals[s] = interval
        tick = { ms: interval, run: () => me.refetch(), s }
        timers.add(tick)
      }
    }
    return () => { observers.delete(me); if (tick) timers.delete(tick) }
  }, [s, enabled, interval])
  let data = e.data
  let isPlaceholderData = false
  if (data === undefined && placeholderData) {
    const prev = prevRef.current
    const p = typeof placeholderData === 'function' ? placeholderData(prev && prev.data, prev ? { queryKey: prev.key } : undefined) : placeholderData
    if (p !== undefined) { data = p; isPlaceholderData = true }
  }
  if (e.data !== undefined) prevRef.current = e
  return {
    data, error: e.error, isFetching: e.fetching, isPlaceholderData,
    isLoading: data === undefined && !e.error,
    refetch: () => fetchEntry(entry(queryKey), () => fn.current())
  }
}
// Fire every interval timer of this period (a poll tick); returns how many fired.
export const fireIntervals = ms => { let n = 0; for (const t of [...timers]) if (t.ms === ms) { t.run(); n++ } return n }
export const activeIntervals = () => [...timers].map(t => ({ ms: t.ms, key: t.s }))

export const connectionId = atom('conn-a')
export const profile = atom('default')
export const host = {
  state: { connectionId, profile },
  navigate: p => { seam.navs.push(p) },
  notify: t => { seam.toasts.push(t) },
  openSession: async (id, opts) => { seam.opened.push({ id, opts }) },
  revealPane: id => { seam.revealed.push(id) },
  composer: { submit: () => { seam.submits++ } }
}

export const Button = ({ children, onClick, disabled, variant, size, className, ...rest }) =>
  h('button', { onClick, disabled, type: 'button', className: `btn ${variant || ''} ${size || ''} ${className || ''}`, ...rest }, children)
export const Codicon = ({ name, style, size, spinning, className }) =>
  h('i', { className: `codicon codicon-${name}${spinning ? ' codicon-modifier-spin' : ''} ${className || ''}`, 'data-codicon': name, style: { ...(size ? { fontSize: size } : {}), ...style } })
export const Badge = ({ children, variant = 'default', size, className, ...rest }) =>
  h('span', { className: `badge b-${variant}${size ? ` sz-${size}` : ''} ${className || ''}`, 'data-variant': variant, ...rest }, children)
export const EmptyState = ({ title, description }) => h('div', { className: 'empty' }, h('div', { className: 'et' }, title), description ? h('div', { className: 'ed' }, description) : null)
export const ErrorState = ({ title, description, children }) => h('div', { className: 'error', role: 'alert' }, h('div', { className: 'et' }, title), h('div', { className: 'ed' }, description), children)
export const Loader = () => h('div', { className: 'loader', 'data-loader': '1' }, 'loading')
export const Input = ({ className, ...rest }) => h('input', { className: `input ${className || ''}`, ...rest })
export const Checkbox = ({ checked, onCheckedChange, ...rest }) =>
  h('input', { type: 'checkbox', checked: !!checked, onChange: e => onCheckedChange(e.target.checked), ...rest })
export const SegmentedControl = ({ options, value, onChange }) =>
  h('span', { className: 'seg' }, options.map(o => h('button', { key: o.id, type: 'button', 'data-seg': o.id, 'aria-pressed': o.id === value, onClick: () => onChange(o.id) }, o.label)))
// The real Tip wraps its child in a tooltip trigger; here the label rides on the child so a test can read it.
export const Tip = ({ label, children }) => cloneElement(children, { 'data-tip': label })
export const ToggleRow = ({ label, description, checked, onChange, id }) =>
  h('label', { className: 'trow', id }, h('span', null, label, description ? h('span', { className: 'ed' }, description) : null),
    h('input', { type: 'checkbox', role: 'switch', 'aria-label': label, checked: !!checked, onChange: e => onChange(e.target.checked) }))

const MenuCtx = createContext(null)
export const DropdownMenu = ({ children }) => {
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState(null)
  return h(MenuCtx.Provider, { value: { open, setOpen, rect, setRect } }, h('span', { className: 'dd' }, children))
}
export const DropdownMenuTrigger = ({ children }) => {
  const c = useContext(MenuCtx)
  // Behaves like Radix: the trigger click opens the menu and does not reach the row.
  return cloneElement(children, { onClick: e => { e.stopPropagation(); if (e.currentTarget && e.currentTarget.getBoundingClientRect) c.setRect(e.currentTarget.getBoundingClientRect()); else c.setRect({ bottom: 0, right: 0 }); c.setOpen(!c.open) } })
}
export const DropdownMenuContent = ({ children, onClick }) => {
  const c = useContext(MenuCtx)
  if (!c.open) return null
  const r = c.rect || { bottom: 0, right: 0 }
  const style = typeof window === 'undefined' ? {} : { position: 'fixed', top: r.bottom + 4, right: window.innerWidth - r.right }
  return h('div', { className: 'menu', role: 'menu', style, onClick }, children)
}
export const DropdownMenuItem = ({ children, onSelect, disabled, ...rest }) => {
  const c = useContext(MenuCtx)
  return h('button', { type: 'button', role: 'menuitem', disabled, className: 'mi', onClick: () => { onSelect && onSelect(); c.setOpen(false) }, ...rest }, children)
}
export const DropdownMenuSeparator = () => h('hr', null)

// ConfirmDialog as confirm-dialog.tsx: Confirm runs onConfirm; a throw keeps it open with the message inline.
export function ConfirmDialog({ open, onClose, onConfirm, title, description, children, confirmLabel = 'Confirm', cancelLabel = 'Cancel' }) {
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState(null)
  if (!open) return null
  const run = async () => {
    if (status === 'saving' || status === 'done') return
    setError(null)
    setStatus('saving')
    try {
      await onConfirm()
      setStatus('done')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
      setStatus('idle')
    }
  }
  return h('div', { className: 'dlg-wrap' },
    h('div', { className: 'dlg-back', onClick: onClose }),
    h('div', { role: 'dialog', className: 'dlg', 'data-confirm': 'open' },
      h('h2', null, title),
      description ? h('p', { className: 'ed' }, description) : null,
      children,
      error ? h('div', { className: 'error', 'data-confirm-error': '1' }, error) : null,
      h('div', { className: 'dlg-f' },
        h(Button, { variant: 'ghost', size: 'sm', 'data-confirm-cancel': '1', onClick: onClose }, cancelLabel),
        h(Button, { size: 'sm', 'data-confirm-ok': '1', disabled: status === 'saving', onClick: run }, confirmLabel))))
}
