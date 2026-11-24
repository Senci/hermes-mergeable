// The full page at /mergeable: the prototype's table (section 2) and the Renovate audit cards (section 3).
// #/mergeable?open=<project!iid> highlights and scrolls to one MR (replaceState writes, hashchange reads).
import { Badge, Button, Codicon, EmptyState, ErrorState, Loader } from '@hermes/plugin-sdk'
import { createElement as h, Fragment, useEffect, useMemo, useState } from 'react'

import { Table, cell } from 'hermes-plugin-ui-kit/table.js'
import { createRoute } from 'hermes-plugin-ui-kit/route.js'

import { openExternal, reveal, useMrs, postMr } from './data.js'
import { auditOf, fmtClock, fmtUtc, plural, refLabel, sessionKind, summarize, tableItems } from './logic.js'
import { CHIP_ICON, EASE_TONE, IMPORTANCE_TONE, PANE_ID, VERDICT_TONE } from './model.js'
import { useNotifier } from './notify.js'
import { Actions, Age, Chips, Dot, HeaderTools, JobStrip, RowJob, Surface, Tool, say, unreachable, where } from './view.js'

const route = createRoute('/mergeable', { select: 'open', params: [] })

function useOpenRef() {
  const [open, setOpen] = useState(() => (route.read() || {}).open || null)
  useEffect(() => {
    const on = () => setOpen((route.read() || {}).open || null)
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return [open, ref => { setOpen(ref); route.write({ open: ref }) }]
}

const nw = { ...cell, whiteSpace: 'nowrap' }
const Link = ({ url, title, children }) =>
  h('a', { className: 'mg-link', href: url, title, rel: 'noopener', onClick: e => { e.preventDefault(); openExternal(url) } }, children)

function AuditBadges({ a }) {
  return h(Fragment, null,
    h(Badge, { variant: IMPORTANCE_TONE[a.importance] || 'muted' }, h(Codicon, { name: CHIP_ICON.importance }), a.importance), ' ',
    h(Badge, { variant: EASE_TONE[a.ease] || 'muted' }, h(Codicon, { name: CHIP_ICON.ease }), a.ease), ' ',
    h(Badge, { variant: VERDICT_TONE[a.verdict] || 'muted' }, a.verdict))
}

function MrTable({ items, open, now, onOpen }) {
  const rows = useMemo(() => tableItems(items), [items])
  return h('div', { className: 'mg-tablewrap' },
    h('div', { style: { minWidth: 980 } },
      h(Table, {
        fontSize: 12,
        columns: ['MR', 'Title', 'Owner', 'Age', 'State', 'CI', 'Audit', 'Session', 'Actions'].map(label => ({ label })),
        rows,
        empty: { title: 'No open merge requests' },
        renderRow: it => {
          const a = auditOf(it)
          return h('tr', { key: it.ref, 'data-row': it.ref, className: open === it.ref ? 'hit' : undefined, onClick: () => onOpen(it.ref) },
            h('td', { style: nw, className: 'mg-mono' }, h(Link, { url: it.web_url, title: it.ref }, refLabel(it))),
            h('td', { style: { ...cell, minWidth: 240 } }, it.title, h(RowJob, { it })),
            h('td', { style: nw }, it.owner === 'self' ? 'me' : h(Chips, { it, iconOnly: false, group: 'owner' })),
            h('td', { style: nw }, h(Age, { it, now })),
            h('td', { style: nw }, h('div', { className: 'mg-cluster' }, h(Chips, { it, iconOnly: false, group: 'state', skip: ['noci'], fallback: it.merge_status }))),
            h('td', { style: nw }, h(Dot, { status: it.pipeline && it.pipeline.status }), ' ', it.pipeline ? it.pipeline.status : 'no CI'),
            h('td', { style: { ...cell, minWidth: 150 } }, h('div', { className: 'mg-cluster', style: { maxWidth: 240 } }, h(Chips, { it, iconOnly: false, group: 'audit' }), a ? h(Badge, { variant: VERDICT_TONE[a.verdict] || 'muted' }, a.verdict) : null)),
            h('td', { style: nw }, sessionKind(it.session) || ''),
            h('td', { style: nw, onClick: e => e.stopPropagation() }, h(Actions, { it })))
        }
      })))
}

function AuditCard({ it, hit }) {
  const a = auditOf(it)
  const r = it.renovate || {}
  const adv = a.advisories || []
  const kv = []
  const add = (k, v, mono) => kv.push(h('span', { key: `${k}-k`, className: 'k' }, k), h('span', { key: `${k}-v`, className: `v${mono ? ' mg-mono' : ''}` }, v))
  add('Package', r.package, true)
  add('Range', `${r.from} to ${r.to} (${r.update_type})`, true)
  add('Read', (a.releases_read || []).join(', ') || 'no releases in the range (digest bump)')
  if (adv.length) add('Advisories', adv.map(x => `${x.ghsa} ${x.severity}${x.cvss ? ` CVSS ${x.cvss}` : ''}${x.cve ? ` (${x.cve})` : ''}`).join('; '))
  if ((a.cves || []).length) add('CVEs named', a.cves.map(c => `${c.id} ${c.severity}${c.cvss ? ` ${c.cvss}` : ''}`).join(', '))
  add('Summary', a.summary)
  add('Importance', a.importance_reason)
  add('Ease', a.ease_reason)
  if (a.confidence !== 'sure') add('Not sure', a.not_sure_reason)
  const bcs = a.breaking_changes || []
  return h('div', { className: `mg-card${hit ? ' hit' : ''}`, 'data-audit': it.ref },
    h('h3', null, h(Link, { url: it.web_url, title: it.ref }, it.ref), h(AuditBadges, { a })),
    h('div', { className: 'mg-kv' }, kv),
    bcs.length
      ? h('table', { className: 'mg-plan' },
        h('thead', null, h('tr', null, ['Version', 'Breaking or changed default', 'Us?'].map(c => h('th', { key: c }, c)))),
        h('tbody', null, bcs.map((b, i) => h('tr', { key: i }, h('td', null, b.version), h('td', null, b.change), h('td', null, b.affects_us)))))
      : null,
    h('div', { className: 'mg-runs' }, `Decided by ${String(a.model || 'none').replace('claude-', '')}${a.escalated ? ' after escalation' : ''}, audited ${fmtUtc(a.audited_at)}.`),
    h('div', { className: 'mg-cardacts' },
      h(Actions, { it }),
      h(Button, { size: 'xs', variant: 'secondary', 'data-act': 'reaudit', 'data-ref': it.ref, onClick: async () => { try { await postMr(it, 'audit') } catch (e) { say('error', `Mergeable: audit ${it.ref} failed: ${e.message}`) } } },
        h(Codicon, { name: 'debug-rerun' }), 'Re-run audit')))
}

function Body({ q }) {
  const { data, error, isLoading, conn, profile } = q
  const [open, onOpen] = useOpenRef()
  useEffect(() => {
    if (!open || !data) return
    const el = document.querySelector(`[data-row="${CSS.escape ? CSS.escape(open) : open}"]`)
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' })
  }, [open, data && data.generated_at])
  if (error && !data) return h('div', { className: 'mg-scroll' }, h(ErrorState, unreachable(error, conn, profile)))
  if (isLoading || !data) return h('div', { className: 'mg-empty' }, h(Loader, null))
  const audited = data.items.filter(auditOf)
  return h(Fragment, null,
    data.schema_ok === false
      ? h('div', { className: 'mg-banner', 'data-banner': 'schema' }, 'The backend reports schema_ok false: session buttons may be missing. MR data is not affected.')
      : null,
    error ? h('div', { className: 'mg-banner bad', 'data-banner': 'stale' }, `${where(conn, profile)} is unreachable, showing the last answer.`) : null,
    h(JobStrip, null),
    h('div', { className: 'mg-scroll', 'data-list': '1' },
      data.items.length
        ? h(MrTable, { items: data.items, open, now: data.generated_at, onOpen })
        : h('div', { className: 'mg-empty', 'data-empty': 'none' }, h(EmptyState, { title: 'No open merge requests', description: `Nothing is open in the projects of ${where(conn, data.profile || profile)}.` })),
      h('h2', { className: 'mg-h2' }, 'Renovate audits'),
      audited.length
        ? h('div', { className: 'mg-cards', 'data-audits': '1' }, audited.map(it => h(AuditCard, { key: it.ref, it, hit: open === it.ref })))
        : h('p', { className: 'mg-count', 'data-empty': 'audits' }, 'No audit has run yet. A Renovate MR gets one when its head commit changes, or from its More menu.')))
}

export function MergeablePage() {
  const q = useMrs()
  useNotifier(q)
  const data = q.data
  const s = data ? summarize(data.items) : null
  const meta = { host: (data && data.host) || 'gitlab.com', rules: data && data.rules }
  return h(Surface, { meta },
    h('div', { className: 'mg wide', 'data-mg': 'page' },
      h('div', { className: 'mg-head' },
        h('span', { className: 'mg-title mg-grow' }, 'Open merge requests'),
        h(HeaderTools, { q }, h(Tool, { icon: 'layout-sidebar-right', label: 'Show the Mergeable tab in the Files zone', act: 'show-pane', onClick: () => reveal(PANE_ID) }))),
      s
        ? h('div', { className: 'mg-sub', 'data-sub': '1' },
          `${plural(s.count, 'open MR', 'open MRs')} in ${plural(s.projects, 'project', 'projects')}: ${s.mine} mine, ${s.renovate} Renovate, ${s.colleagues} colleagues. ` +
          `${plural(s.drafts, 'draft', 'drafts')}, ${s.mergeable} mergeable now, ${s.rebase} need a rebase. ${where(q.conn, data.profile || q.profile)}, GitLab host ${data.host || 'unknown'}, updated ${fmtClock(data.generated_at)}.`)
        : null,
      h(Body, { q })))
}
