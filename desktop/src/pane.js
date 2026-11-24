// The 340px pane: header with the global actions, filter chips, sort, the two-line rows.
import {
  Checkbox, Codicon, EmptyState, ErrorState, host, Loader, SegmentedControl, useValue
} from '@hermes/plugin-sdk'
import { createElement as h, Fragment, useEffect, useMemo } from 'react'

import { useMrs } from './data.js'
import { filterCounts, fmtClock, paneItems, refLabel } from './logic.js'
import { FILTERS, HIDE_NOTE, PATH, SORTS } from './model.js'
import { useNotifier } from './notify.js'
import { $open, $settings, $view, setView } from './state.js'
import { Actions, Age, Chips, Detail, Dot, HeaderTools, JobStrip, RowJob, Surface, Tool, unreachable, where } from './view.js'

function PaneRow({ it, open, now, onToggle }) {
  return h('div', {
    className: `mg-row${open ? ' open' : ''}`, role: 'button', tabIndex: 0, 'data-row': it.ref, onClick: onToggle,
    onKeyDown: e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onToggle() } }
  },
  h('div', { className: 'mg-l1' },
    h(Dot, { status: it.pipeline && it.pipeline.status }),
    h('span', { className: 'mg-ttl', title: it.full_title || it.title }, it.title),
    h(Age, { it, now })),
  h('div', { className: 'mg-l2' },
    h('span', { className: 'mg-ref' }, refLabel(it)),
    h('span', { className: 'mg-tags' }, h(Chips, { it })),
    h(Actions, { it })),
  h(RowJob, { it }),
  open ? h(Detail, { it, now }) : null)
}

function Controls({ items, view, settings }) {
  const counts = filterCounts(items)
  return h(Fragment, null,
    h('div', { className: 'mg-chips', 'data-bar': 'filters' },
      FILTERS.map(f =>
        h('button', {
          key: f.id, type: 'button', className: 'mg-chip', 'data-filter': f.id, 'aria-pressed': view.filter === f.id,
          onClick: () => setView(cur => ({ ...cur, filter: f.id }))
        }, f.label, h('span', { className: 'mg-n' }, counts[f.id])))),
    h('div', { className: 'mg-bar', 'data-bar': 'sort' },
      h(SegmentedControl, { options: SORTS.map(s => ({ id: s.id, label: s.label })), value: view.sort, onChange: id => setView(cur => ({ ...cur, sort: id })) }),
      h('label', { className: 'mg-drafts' },
        h(Checkbox, { checked: view.drafts, 'data-drafts': '1', onCheckedChange: c => setView(cur => ({ ...cur, drafts: c === true })) }),
        'drafts')))
}

function Body({ q }) {
  const { data, error, isLoading, conn, profile } = q
  const view = useValue($view)
  const settings = useValue($settings)
  const open = useValue($open)
  const setOpen = next => $open.set(next($open.get()))
  const xs = useMemo(() => (data ? paneItems(data.items, view, settings) : []), [data, view, settings])

  // A notification click opens a row from outside: bring it into view.
  useEffect(() => {
    const el = open && document.querySelector(`[data-mg="pane"] [data-row="${CSS.escape ? CSS.escape(open) : open}"]`)
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' })
  }, [open, xs.length])

  if (error && !data) {
    const u = unreachable(error, conn, profile)
    return h('div', { className: 'mg-scroll' }, h(ErrorState, u))
  }
  if (isLoading || !data) return h('div', { className: 'mg-empty' }, h(Loader, null))

  const empty = !data.items.length
  let last = null
  return h(Fragment, null,
    h('div', { className: 'mg-sub', 'data-sub': '1' }, `${where(conn, data.profile || profile)}${data.user ? `, GitLab user ${data.user}` : ''}, updated ${fmtClock(data.generated_at)}`),
    data.schema_ok === false
      ? h('div', { className: 'mg-banner', 'data-banner': 'schema' }, 'The backend reports schema_ok false: session buttons may be missing. MR data is not affected.')
      : null,
    error ? h('div', { className: 'mg-banner bad', 'data-banner': 'stale' }, `${where(conn, profile)} is unreachable, showing the last answer.`) : null,
    empty ? null : h(Controls, { items: data.items, view, settings }),
    h(JobStrip, null),
    h('div', { className: 'mg-scroll', 'data-list': '1' },
      empty
        ? h('div', { className: 'mg-empty', 'data-empty': 'none' },
          h('div', null,
            h(EmptyState, { title: 'No open merge requests', description: `Nothing is open in the projects of ${where(conn, data.profile || profile)}.` }),
            h('div', { className: 'mg-note' }, HIDE_NOTE)))
        : !xs.length
          ? h('div', { className: 'mg-empty', 'data-empty': 'filtered' }, h(EmptyState, { title: 'No MR matches this filter' }))
          : xs.map(it => {
            const head = view.sort === 'project' && it.project !== last ? h('div', { key: `g-${it.project}`, className: 'mg-group', 'data-group': it.project }, it.project) : null
            last = it.project
            return h(Fragment, { key: it.ref }, head, h(PaneRow, { it, open: open === it.ref, now: data.generated_at, onToggle: () => setOpen(cur => (cur === it.ref ? null : it.ref)) }))
          })))
}

export function MergeablePane() {
  const q = useMrs()
  useNotifier(q)
  const view = useValue($view)
  const settings = useValue($settings)
  const data = q.data
  const shown = data ? paneItems(data.items, view, settings).length : null
  const meta = { host: (data && data.host) || 'gitlab.com', rules: data && data.rules }
  return h(Surface, { meta },
    h('div', { className: 'mg pane', 'data-mg': 'pane' },
      h('div', { className: 'mg-head' },
        h(Codicon, { name: 'git-pull-request', style: { color: 'var(--ui-text-tertiary)' } }),
        h('span', { className: 'mg-count mg-grow', 'data-count': '1' }, shown === null ? '' : `${shown} open`),
        h(HeaderTools, { q }, h(Tool, { icon: 'link-external', label: 'Open the full page', act: 'open-page', onClick: () => host.navigate(PATH) }))),
      h(Body, { q })))
}
