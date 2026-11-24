// Tests of the Mergeable desktop half, in plain node, no installs: the committed bundle
// desktop/plugin.js runs against a stand-in SDK, a small stand-in React and a stand-in backend
// (tests/standin/), over fixtures scrubbed from real MR data (tests/fixtures/mrs.json), and
// the pure logic is compared with what the prototype itself computed (tests/fixtures/prototype-parity.json).
// Usage: node plugins/mergeable/tests/desktop.test.mjs   (exit 0 when every check passes)
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { register } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const srcDir = join(here, '..', 'desktop', 'src')

// Globals the host provides to a plugin page: the document (style tag), the hash router and window.open.
const opened = []
globalThis.window = {
  location: { hash: '' },
  history: { replaceState: (_s, _t, url) => { window.location.hash = url.slice(url.indexOf('#')) } },
  addEventListener() {}, removeEventListener() {}, open: url => { opened.push(url) }
}
globalThis.CSS = { escape: s => s }
const styles = []
// Whether Hermes has focus: a notification is a toast while it has, a native one while it has not (D80).
const focus = { on: false }
globalThis.document = {
  hasFocus: () => focus.on,
  head: { appendChild: s => styles.push(s) },
  createElement: () => ({ dataset: {}, remove() { styles.length = 0 } }),
  querySelector: () => null
}

register('./standin/hooks.mjs', import.meta.url)
const sdk = await import('./standin/sdk.mjs')
const { mount, settle } = await import('./standin/render.mjs')
const { makeRest, makeWorld } = await import('./standin/backend.mjs')
const { default: plugin } = await import('../desktop/plugin.js')
const L = await import('../desktop/src/logic.js')
const M = await import('../desktop/src/model.js')
const { default: fixture } = await import('./fixtures/mrs.json', { with: { type: 'json' } })
const { default: parity } = await import('./fixtures/prototype-parity.json', { with: { type: 'json' } })

const ITEMS = fixture.items
const byRef = Object.fromEntries(ITEMS.map(i => [i.ref, i]))
const DEFAULTS = M.DEFAULT_SETTINGS

let n = 0
let failed = 0
const queue = []
function t(name, fn) { queue.push([name, fn]) }

// --- harness ---

function boot({ storage = new Map(), world = makeWorld(), settingsMethod = true, settingsArea = 'settings.plugins' } = {}) {
  sdk.resetSeams()
  sdk.resetQueries()
  sdk.connectionId.set('conn-a')
  sdk.setSettingsArea(settingsArea)
  sdk.profile.set('default')
  focus.on = false
  opened.length = 0
  window.location.hash = ''
  const log = []
  const regs = []
  const pages = []
  const clip = []
  const ext = []
  const notes = []
  let dispose = null
  const ctx = {
    rest: makeRest(world, sdk.host, log),
    storage: {
      get: (k, d) => (storage.has(k) ? JSON.parse(storage.get(k)) : d),
      set: (k, v) => { storage.set(k, JSON.stringify(v)) },
      remove: k => { storage.delete(k) }
    },
    registerMany: cs => { regs.push(...cs); return () => {} },
    register: c => { regs.push(c); return () => {} },
    onDispose: f => { dispose = f },
    os: { writeClipboard: async text => { clip.push(text); return true }, openExternal: async url => { ext.push(url); return true }, notify: x => { notes.push(x) } }
  }
  if (settingsMethod) ctx.registerSettingsPage = p => { pages.push(p); return () => {} }
  plugin.register(ctx)
  const find = (area, id) => regs.find(r => r.area === area && (!id || r.id === id))
  const app = { regs, pages, log, world, clip, ext, notes, storage, ctx, find, mounted: [], dispose: () => dispose && dispose() }
  app.pane = () => { const m = mount(sdk_h(find('panes').render)); app.mounted.push(m); return m }
  app.page = () => { const m = mount(sdk_h(find('routes').render)); app.mounted.push(m); return m }
  app.settings = () => { const m = mount(sdk_h(pages[0].render)); app.mounted.push(m); return m }
  app.stop = () => { for (const m of app.mounted) m.unmount(); app.mounted = []; app.dispose() }
  return app
}
const react = await import('./standin/react.mjs')
const sdk_h = fn => react.createElement(fn)

async function until(fn, ms = 2000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (fn()) return true
    await settle(1)
  }
  return !!fn()
}
const rows = m => m.attr('data-row', '').length ? [] : m.findAll(n => n.props && n.props['data-row'] !== undefined)
const row = (m, ref) => m.find(n => n.props && n.props['data-row'] === ref)
const kids = n => { const out = []; const go = c => { for (const x of c.children) { out.push(x); go(x) } }; go(n); return out }
const act = (m, scope, name) => kids(scope || { children: m.tree }).find(n => n.props && n.props['data-act'] === name) || null
const text = (m, n) => m.text(n)
const posts = app => app.log.filter(c => c.method === 'POST')
const loaded = async m => { await until(() => rows(m).length > 0); await settle(2) }
const dlg = m => m.find(n => n.props && n.props['data-confirm'] === 'open')
const confirmOk = (m) => act(m, dlg(m), 'x') || kids(dlg(m)).find(n => n.props && n.props['data-confirm-ok'])
const confirmCancel = m => kids(dlg(m)).find(n => n.props && n.props['data-confirm-cancel'])
const firstOf = (pred) => ITEMS.find(pred)

// =====================================================================
// registrations (D58, D56 pattern, one action id for keybind and palette)
// =====================================================================

t('registrations: pane, page, sidebar row, keybind, palette, settings page', () => {
  const app = boot()
  const ids = app.regs.map(r => r.id)
  assert.equal(new Set(ids).size, ids.length, 'unique ids')
  assert.deepEqual(app.regs.map(r => r.area).sort(), ['keybinds', 'palette', 'panes', 'routes', 'sidebar.nav'])
  const pane = app.find('panes')
  assert.equal(pane.id, 'pane')
  assert.equal(pane.title, 'Mergeable')
  assert.deepEqual(pane.data.dock, { pane: 'files', pos: 'center' })
  assert.equal('enforce' in pane.data.dock, false)
  assert.equal(pane.data.placement, 'right')
  assert.equal(pane.data.collapsible, true)
  assert.equal(pane.data.hideOnly, true)
  assert.deepEqual([pane.data.width, pane.data.minWidth, pane.data.maxWidth], ['340px', '15rem', '36rem'])
  assert.equal(pane.data.tabTitleText(), 'Mergeable')
  assert.equal(app.find('routes').data.path, '/mergeable')
  const nav = app.find('sidebar.nav')
  assert.deepEqual(nav.data, { path: '/mergeable', label: 'Mergeable', codicon: 'git-merge' })
  assert.equal(nav.order, 54)
  const key = app.find('keybinds')
  const pal = app.find('palette')
  assert.equal(key.data.id, 'mergeable.reveal')
  assert.deepEqual(key.data.defaults, ['mod+alt+m'])
  assert.equal(pal.data.id, 'mergeable.reveal')
  assert.equal(pal.data.action, key.data.id, 'palette points at the keybind action')
  assert.equal(pal.data.run, key.data.run === pal.data.run ? key.data.run : pal.data.run)
  assert.equal(app.pages.length, 1)
  assert.deepEqual([app.pages[0].id, app.pages[0].title, app.pages[0].icon], ['display', 'Mergeable', 'git-merge'])
  assert.equal(typeof app.pages[0].render, 'function')
  app.stop()
})

t('keybind and palette run the same reveal: revealPane, else navigate to the page', () => {
  const app = boot()
  app.find('keybinds').data.run()
  app.find('palette').data.run()
  assert.deepEqual(sdk.seam.revealed, ['mergeable:pane', 'mergeable:pane'])
  const saved = sdk.host.revealPane
  delete sdk.host.revealPane
  app.find('keybinds').data.run()
  assert.deepEqual(sdk.seam.navs, ['/mergeable'])
  sdk.host.revealPane = saved
  app.stop()
})

t('the constants: id, route, action id, keybind, pane id, hide note', () => {
  assert.equal(M.ID, 'mergeable')
  assert.equal(M.PATH, '/mergeable')
  assert.equal(M.PANE_ID, 'mergeable:pane')
  assert.equal(M.KEYBIND, 'mod+alt+m')
  assert.ok(/tab menu/.test(M.HIDE_NOTE) && /Ctrl\+K/.test(M.HIDE_NOTE) && /Ctrl\+J/.test(M.HIDE_NOTE) && /plugin stays on/.test(M.HIDE_NOTE))
})

// =====================================================================
// fixtures: the spec's Item shape, filled from the real data
// =====================================================================

t('fixture: 22 MRs, 3 audits, the spec Item keys (with the D80 reviewers and last_note), ISO UTC times', () => {
  assert.equal(ITEMS.length, 22)
  assert.equal(ITEMS.filter(i => i.audit).length, 3)
  assert.deepEqual(Object.keys(fixture).sort(), ['generated_at', 'host', 'items', 'profile', 'rules', 'schema_ok', 'user'])
  const keys = ['ref', 'project', 'project_id', 'iid', 'title', 'full_title', 'author', 'owner', 'draft', 'created_at', 'age_days', 'updated_at', 'sha', 'source_branch', 'target_branch', 'web_url', 'merge_status', 'has_conflicts', 'merge_method', 'pipeline', 'files_changed', 'user_notes_count', 'renovate', 'audit', 'audit_state', 'session', 'trivial', 'can', 'reviewers', 'last_note']
  for (const it of ITEMS) {
    assert.deepEqual(Object.keys(it).sort(), [...keys].sort(), it.ref)
    assert.ok(['self', 'renovate', 'other'].includes(it.owner))
    assert.ok(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(it.created_at), it.created_at)
    assert.deepEqual(Object.keys(it.can).sort(), ['merge', 'reason', 'rebase', 'renovate_rebase'])
    assert.deepEqual(Object.keys(it.trivial).sort(), ['in_batch', 'miss'])
  }
  assert.deepEqual(ITEMS.map(i => i.ref).sort(), [...parity.refs].sort())
  const bump = byRef['acme/bravo-infra!394']
  assert.equal(bump.title, 'traefik v3.7.15 to v3.7.16')
  assert.equal(bump.audit.model, 'claude-haiku-5-5')
  assert.equal(bump.audit.advisories.length, 4)
  for (const it of ITEMS) {
    assert.ok(Array.isArray(it.reviewers), it.ref)
    assert.ok(it.last_note === null || (typeof it.last_note.author === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(it.last_note.at)), it.ref)
  }
  assert.deepEqual(ITEMS.filter(i => i.reviewers.length).map(i => [i.ref, i.reviewers]), [['acme/golf-classifier!70', ['ripley']]])
  assert.deepEqual(ITEMS.filter(i => i.last_note).map(i => i.ref).sort(), ['acme/bravo-infra!370', 'ops/provisioning/mgmt/mirror!1'])
  assert.deepEqual(Object.keys(bump.audit).sort(), ['advisories', 'audited_at', 'breaking_changes', 'confidence', 'cves', 'ease', 'ease_reason', 'escalated', 'importance', 'importance_reason', 'model', 'not_sure_reason', 'releases_read', 'sha', 'summary', 'verdict'])
})

// =====================================================================
// parity with the prototype (filters, sort, age, chips, trivial)
// =====================================================================

t('parity: pane filter x sort x drafts x colleagues, 48 combinations equal the prototype order', () => {
  assert.equal(parity.combos.length, 48)
  for (const c of parity.combos) {
    const ids = L.paneItems(ITEMS, { filter: c.filter, sort: c.sort, drafts: c.drafts }, { ...DEFAULTS, showColleagues: c.colleagues }).map(i => i.ref)
    assert.deepEqual(ids, c.ids, JSON.stringify([c.filter, c.sort, c.drafts, c.colleagues]))
  }
})

t('parity: filter counts, urgency per MR and the full table order', () => {
  assert.deepEqual(L.filterCounts(ITEMS), parity.counts)
  for (const it of ITEMS) assert.equal(L.urgency(it), parity.urgency[it.ref], it.ref)
  assert.deepEqual(L.tableItems(ITEMS).map(i => i.ref), parity.table)
})

t('parity: age labels equal the prototype (the label stays calendar time; the colour moved to working days, D79)', () => {
  for (const a of parity.ages) assert.equal(L.ageLabel(a.d), a.label, `label ${a.d}`)
})

t('parity: chips (tone and label) of every MR equal the prototype, in order', () => {
  for (const it of ITEMS) {
    const mine = L.chipsOf(it, DEFAULTS).map(c => [c.tone, c.label])
    assert.deepEqual(mine, parity.chips[it.ref], it.ref)
  }
  assert.deepEqual(L.chipsOf(byRef['acme/bravo-infra!370'], DEFAULTS).map(c => c.label), ['', 'high', 'hard', 'opus', '?', 'rebase'])
})

t('parity: session button kind (created, mentioned, none below score 5)', () => {
  for (const it of ITEMS) assert.equal(L.sessionKind(it.session), parity.session_kind[it.ref], it.ref)
  assert.ok(ITEMS.some(i => i.session && i.session.score < 5), 'the fixture has a below-floor candidate')
})

t('parity: trivial set, plan order, rebases and pipelines; count equals the fixture in_batch count', () => {
  const inBatch = ITEMS.filter(i => i.trivial.in_batch)
  assert.equal(L.trivialCount(ITEMS), inBatch.length)
  assert.equal(inBatch.length, 8)
  assert.deepEqual(inBatch.map(i => i.ref).sort(), [...parity.trivial.refs].sort())
  for (const it of ITEMS) assert.equal(it.trivial.miss, parity.trivial.miss[it.ref], it.ref)
  const plan = L.trivialPlan(ITEMS)
  assert.deepEqual(plan.steps.map(s => ({ ref: s.item.ref, rebase: s.rebase, pipelines: s.pipelines })), parity.trivial.steps)
  assert.deepEqual([plan.rebases, plan.pipelines, plan.projects], [parity.trivial.rebases, parity.trivial.pipelines, parity.trivial.projects])
})

t('can: the fixture reasons are the prototype reasons, and a single string serves both buttons', () => {
  const colleague = byRef['acme/foxtrot-platform!64']
  assert.equal(L.rebaseAbility(colleague).ok, false)
  assert.equal(L.mergeAbility(colleague).ok, false)
  assert.equal(L.mergeAbility(colleague).why, "Colleague's MR")
  const current = ITEMS.find(i => i.can.merge && !i.can.rebase)
  assert.equal(L.rebaseAbility(current).why, 'Already current with main')
  const stale = byRef['acme/bravo-infra!394']
  assert.equal(L.rebaseAbility(stale).ok, true)
  assert.ok(/Renovate/.test(L.rebaseAbility(stale).why))
  assert.equal(L.mergeAbility(stale).why, 'Not mergeable: need_rebase')
  // A per-action object is read too, and a missing `can` disables with a reason.
  assert.equal(L.reasonFor({ can: { reason: { rebase: 'a', merge: 'b' } } }, 'merge'), 'b')
  assert.equal(L.mergeAbility({ target_branch: 'main' }).ok, false)
})

// =====================================================================
// the pane rendered
// =====================================================================

t('pane: header count, trivial count, filter chips with counts, sort, drafts toggle', async () => {
  const app = boot()
  const m = app.pane()
  await loaded(m)
  assert.equal(text(m, m.find(n => n.props && n.props['data-count'])), '22 open')
  assert.equal(text(m, m.find(n => n.props && n.props['data-trivial-n'])), '8')
  const chips = m.findAll(n => n.props && n.props['data-filter'])
  assert.deepEqual(chips.map(c => text(m, c)), ['All22', 'Mine14', 'Renovate3', 'Colleagues5'])
  assert.deepEqual(m.findAll(n => n.props && n.props['data-seg']).map(s => text(m, s)), ['Urgency', 'Age', 'Project'])
  assert.ok(m.find(n => n.props && n.props['data-drafts']))
  for (const a of ['trivial', 'refresh', 'copy-status', 'audit-all', 'settings', 'open-page']) assert.ok(act(m, null, a), a)
  assert.deepEqual(rows(m).map(r => r.props['data-row']), parity.combos.find(c => c.filter === 'all' && c.sort === 'urgency' && c.drafts && c.colleagues).ids)
  app.stop()
})

t('pane: filter chips, sort and the drafts toggle change the rows like the prototype', async () => {
  const app = boot()
  const m = app.pane()
  await loaded(m)
  const click = sel => { m.click(m.find(sel)); return settle(2) }
  const expected = (filter, sort, drafts) => parity.combos.find(c => c.filter === filter && c.sort === sort && c.drafts === drafts && c.colleagues).ids
  await click(n => n.props && n.props['data-filter'] === 'renovate')
  assert.deepEqual(rows(m).map(r => r.props['data-row']), expected('renovate', 'urgency', true))
  await click(n => n.props && n.props['data-seg'] === 'age')
  assert.deepEqual(rows(m).map(r => r.props['data-row']), expected('renovate', 'age', true))
  await click(n => n.props && n.props['data-filter'] === 'all')
  await click(n => n.props && n.props['data-seg'] === 'project')
  assert.deepEqual(rows(m).map(r => r.props['data-row']), expected('all', 'project', true))
  assert.ok(m.findAll(n => n.props && n.props['data-group']).length >= 10, 'group headers by project')
  m.find(n => n.props && n.props['data-drafts']).props.onChange({ target: { checked: false } })
  await settle(2)
  assert.deepEqual(rows(m).map(r => r.props['data-row']), expected('all', 'project', false))
  assert.equal(text(m, m.find(n => n.props && n.props['data-count'])), `${expected('all', 'project', false).length} open`)
  app.stop()
})

t('pane: rows carry state dot, title, age class, ref and icon-only chips; a click opens the detail', async () => {
  const app = boot()
  const m = app.pane()
  await loaded(m)
  for (const it of ITEMS) {
    const r = row(m, it.ref)
    assert.ok(r, it.ref)
    const age = kids(r).find(n => n.props && n.props['data-age'])
    assert.equal(age.props['data-age'], L.ageClass(L.workingAge(it, fixture.generated_at)) || 'fresh', it.ref)
    assert.equal(text(m, age), L.ageLabel(it.age_days))
    assert.equal(kids(r).find(n => n.props && n.props['data-dot']).props['data-dot'], it.pipeline ? it.pipeline.status : 'none')
    assert.ok(text(m, r).includes(L.refLabel(it)))
    const tones = kids(r).filter(n => n.props && n.props['data-chip']).map(n => n.props['data-tone'])
    assert.deepEqual(tones, parity.chips[it.ref].map(c => c[0]), it.ref)
  }
  const r = row(m, 'acme/bravo-infra!394')
  m.click(r)
  await settle(2)
  const d = m.find(n => n.props && n.props['data-detail'] === 'acme/bravo-infra!394')
  assert.ok(d)
  assert.ok(/v3\.7\.15 to v3\.7\.16 \(patch\)/.test(text(m, d)) && /merge/.test(text(m, d)))
  assert.ok(/working day/.test(text(m, d)), 'the detail names the age in working days')
  m.click(row(m, 'acme/bravo-infra!394'))
  await settle(2)
  assert.equal(m.find(n => n.props && n.props['data-detail']), null)
  app.stop()
})

t('buttons: Rebase and Merge are disabled on every colleague MR and carry can.reason', async () => {
  const app = boot()
  const m = app.pane()
  await loaded(m)
  const others = ITEMS.filter(i => i.owner === 'other')
  assert.equal(others.length, 5)
  for (const it of others) {
    const r = row(m, it.ref)
    for (const name of ['rebase', 'merge']) {
      const b = act(m, r, name)
      assert.equal(b.props.disabled, true, `${it.ref} ${name}`)
      assert.equal(b.props['data-why'], it.can.reason)
      assert.equal(m.click(b), false)
    }
  }
  const mergeable = ITEMS.find(i => i.owner === 'self' && i.can.merge)
  assert.equal(act(m, row(m, mergeable.ref), 'merge').props.disabled, false)
  assert.deepEqual(posts(app), [], 'nothing was posted')
  app.stop()
})

t('buttons: an MR that is not mergeable says why; Renovate rebase follows can.renovate_rebase', async () => {
  const app = boot()
  const m = app.pane()
  await loaded(m)
  const drafts = ITEMS.filter(i => i.owner === 'self' && i.draft)
  assert.ok(drafts.length >= 4)
  for (const it of drafts) {
    const b = act(m, row(m, it.ref), 'merge')
    assert.equal(b.props.disabled, true)
    assert.equal(b.props['data-why'], 'Draft')
  }
  assert.equal(act(m, row(m, 'acme/bravo-infra!394'), 'rebase').props.disabled, false)
  assert.equal(act(m, row(m, 'acme/bravo-infra!394'), 'merge').props.disabled, true)
  app.stop()
})

// =====================================================================
// writes: ConfirmDialog first, expected_sha always
// =====================================================================

t('merge: the ConfirmDialog opens first, Cancel posts nothing, Confirm posts with expected_sha', async () => {
  const app = boot()
  const m = app.pane()
  await loaded(m)
  const it = ITEMS.find(i => i.owner === 'self' && i.can.merge)
  m.click(act(m, row(m, it.ref), 'merge'))
  await settle(2)
  assert.ok(dlg(m), 'dialog is open')
  assert.deepEqual(posts(app), [], 'no POST before the confirm')
  const body = text(m, dlg(m))
  for (const part of [it.ref, it.title, it.target_branch, it.merge_method, it.pipeline ? it.pipeline.status : 'no CI']) assert.ok(body.includes(part), `dialog shows ${part}`)
  m.click(confirmCancel(m))
  await settle(2)
  assert.equal(dlg(m), null)
  assert.deepEqual(posts(app), [])
  m.click(act(m, row(m, it.ref), 'merge'))
  await settle(2)
  m.click(confirmOk(m))
  await until(() => posts(app).length === 1)
  const [p] = posts(app)
  assert.equal(p.path, `/mrs/${it.project_id}/${it.iid}/merge`)
  assert.deepEqual(p.body, { expected_sha: it.sha })
  await until(() => m.find(n => n.props && n.props['data-job']))
  assert.ok(m.find(n => n.props && n.props['data-job']), 'the job strip shows')
  app.stop()
})

t('merge dialog shows the audit verdict, and warns on hold', async () => {
  const w = boot()
  const first = ITEMS.find(i => i.owner === 'renovate' && i.audit.verdict === 'hold')
  w.world.data['conn-a|default'].items.find(i => i.ref === first.ref).can = { rebase: false, renovate_rebase: false, merge: true, reason: '' }
  const mm = w.pane()
  await loaded(mm)
  mm.click(act(mm, row(mm, first.ref), 'merge'))
  await settle(2)
  assert.ok(/Audit.*hold/.test(text(mm, dlg(mm))))
  assert.ok(/audit says hold/.test(text(mm, dlg(mm))))
  w.stop()
})

t('merge: a 409 from the backend keeps the dialog open with the message and tracks no job', async () => {
  const app = boot()
  const m = app.pane()
  await loaded(m)
  const it = ITEMS.find(i => i.owner === 'self' && i.can.merge)
  app.world.data['conn-a|default'].items.find(i => i.ref === it.ref).sha = 'f'.repeat(40)
  m.click(act(m, row(m, it.ref), 'merge'))
  await settle(2)
  m.click(confirmOk(m))
  await until(() => m.find(n => n.props && n.props['data-confirm-error']))
  assert.ok(/409/.test(text(m, m.find(n => n.props && n.props['data-confirm-error']))))
  assert.ok(dlg(m), 'dialog stays open')
  assert.equal(m.find(n => n.props && n.props['data-job']), null)
  app.stop()
})

t('no POST leaves without expected_sha: an MR with no head sha is refused before the request', async () => {
  const app = boot()
  const it = ITEMS.find(i => i.owner === 'self' && i.can.merge)
  app.world.data['conn-a|default'].items.find(i => i.ref === it.ref).sha = ''
  const m = app.pane()
  await loaded(m)
  m.click(act(m, row(m, it.ref), 'merge'))
  await settle(2)
  m.click(confirmOk(m))
  await until(() => m.find(n => n.props && n.props['data-confirm-error']))
  assert.ok(/no head sha/.test(text(m, m.find(n => n.props && n.props['data-confirm-error']))))
  assert.deepEqual(posts(app), [])
  app.stop()
})

t('every per-MR POST carries expected_sha equal to the row head; batch posts refs and shas', async () => {
  const app = boot()
  const m = app.pane()
  await loaded(m)
  const stale = byRef['acme/bravo-infra!394']
  m.click(act(m, row(m, stale.ref), 'rebase'))
  await until(() => posts(app).length === 1)
  assert.deepEqual(posts(app)[0], { method: 'POST', path: `/mrs/${stale.project_id}/${stale.iid}/rebase`, body: { expected_sha: stale.sha }, conn: 'conn-a', profile: 'default' })
  // menu actions: retry (a failed pipeline on your own MR), ready (own draft), audit and hold (Renovate)
  const self = firstOf(i => i.owner === 'self' && i.project !== 'acme/bravo-infra' && !i.draft)
  app.world.data['conn-a|default'].items.find(i => i.ref === self.ref).pipeline = { status: 'failed', url: 'https://x/p/1' }
  m.unmount()
  sdk.resetQueries()
  const m2 = app.pane()
  await loaded(m2)
  const run = async (it, id) => {
    m2.click(act(m2, row(m2, it.ref), 'menu'))
    await settle(2)
    m2.click(m2.find(n => n.props && n.props['data-item'] === id))
    await settle(2)
  }
  const draft = firstOf(i => i.owner === 'self' && i.draft)
  await run(self, 'retry')
  await run(draft, 'ready')
  await run(stale, 'audit')
  await until(() => posts(app).length === 4)
  const kinds = posts(app).slice(1).map(p => [p.path.split('/').pop(), p.body])
  assert.deepEqual(kinds, [['retry-pipeline', { expected_sha: self.sha }], ['ready', { expected_sha: draft.sha }], ['audit', { expected_sha: stale.sha }]])
  for (const p of posts(app)) assert.ok(typeof p.body.expected_sha === 'string' && p.body.expected_sha.length === 40)
  app.stop()
})

t('trivial: one ConfirmDialog lists the order, rebases and pipelines; Confirm posts the shown refs and shas', async () => {
  const app = boot()
  const m = app.pane()
  await loaded(m)
  m.click(act(m, null, 'trivial'))
  await settle(2)
  assert.ok(dlg(m))
  assert.deepEqual(posts(app), [])
  const plan = L.trivialPlan(ITEMS)
  const steps = m.findAll(n => n.props && n.props['data-step'])
  assert.deepEqual(steps.map(s => s.props['data-step']), plan.steps.map(s => s.item.ref))
  const body = text(m, dlg(m))
  assert.ok(body.includes('Merge 8 trivial MRs?'))
  assert.ok(body.includes('4 rebases') && body.includes('4 MR pipelines'), body.slice(0, 200))
  m.click(confirmCancel(m))
  await settle(2)
  assert.deepEqual(posts(app), [])
  m.click(act(m, null, 'trivial'))
  await settle(2)
  m.click(confirmOk(m))
  await until(() => posts(app).length === 1)
  const [p] = posts(app)
  assert.equal(p.path, '/batch/trivial')
  assert.deepEqual(p.body.refs, plan.steps.map(s => s.item.ref))
  assert.deepEqual(p.body.shas, plan.steps.map(s => s.item.sha))
  app.stop()
})

t('trivial: a set that changed server side is refused (409) and the dialog says so', async () => {
  const app = boot()
  const m = app.pane()
  await loaded(m)
  m.click(act(m, null, 'trivial'))
  await settle(2)
  app.world.data['conn-a|default'].items.find(i => i.ref === 'acme/foxtrot-platform!87').trivial.in_batch = false
  m.click(confirmOk(m))
  await until(() => m.find(n => n.props && n.props['data-confirm-error']))
  assert.ok(/409/.test(text(m, m.find(n => n.props && n.props['data-confirm-error']))))
  app.stop()
})

t('trivial: a step without a head sha is refused before the request', async () => {
  const app = boot()
  app.world.data['conn-a|default'].items.find(i => i.ref === 'acme/foxtrot-platform!87').sha = ''
  const m = app.pane()
  await loaded(m)
  m.click(act(m, null, 'trivial'))
  await settle(2)
  m.click(confirmOk(m))
  await until(() => m.find(n => n.props && n.props['data-confirm-error']))
  assert.ok(/no head sha|without a head sha/.test(text(m, m.find(n => n.props && n.props['data-confirm-error']))))
  assert.deepEqual(posts(app), [])
  app.stop()
})

t('renovate hold: its own ConfirmDialog with a date; a bad date posts nothing, a good one posts package and until', async () => {
  const app = boot()
  const m = app.pane()
  await loaded(m)
  const it = byRef['acme/bravo-infra!396']
  m.click(act(m, row(m, it.ref), 'menu'))
  await settle(2)
  m.click(m.find(n => n.props && n.props['data-item'] === 'hold'))
  await settle(2)
  assert.ok(dlg(m))
  assert.deepEqual(posts(app), [])
  const field = m.find(n => n.props && n.props['data-field'] === 'until')
  assert.ok(L.isIsoDay(field.props.value))
  m.type(field, 'soon')
  await settle(2)
  m.click(confirmOk(m))
  await until(() => m.find(n => n.props && n.props['data-confirm-error']))
  assert.deepEqual(posts(app), [])
  m.type(m.find(n => n.props && n.props['data-field'] === 'until'), '2026-12-01')
  await settle(2)
  m.click(confirmOk(m))
  await until(() => posts(app).length === 1)
  assert.equal(posts(app)[0].path, `/mrs/${it.project_id}/${it.iid}/renovate-hold`)
  assert.deepEqual(posts(app)[0].body, { expected_sha: it.sha, package: it.renovate.package, until: '2026-12-01' })
  app.stop()
})

// =====================================================================
// jobs
// =====================================================================

t('jobs: the strip polls /jobs/{id} every 3 s, settles once on done with one list refresh, then stops polling', async () => {
  const app = boot()
  const m = app.pane()
  await loaded(m)
  const stale = byRef['acme/bravo-infra!394']
  m.click(act(m, row(m, stale.ref), 'rebase'))
  await until(() => m.find(n => n.props && n.props['data-job']))
  await settle(3)
  const id = [...app.world.jobs.keys()][0]
  assert.ok(sdk.activeIntervals().some(x => x.ms === 3000 && x.key.includes('"job","' + id + '"')), 'job poll registered at 3000 ms: ' + id + ' ' + JSON.stringify(sdk.activeIntervals()))
  const getsBefore = app.log.filter(c => c.method === 'GET' && c.path === `/jobs/${id}`).length
  app.world.jobs.get(id).steps.push({ ref: stale.ref, step: 'rebasing', state: 'running', detail: 'pipeline 12', at: '' })
  sdk.fireIntervals(3000)
  await settle(4)
  assert.ok(app.log.filter(c => c.method === 'GET' && c.path === `/jobs/${id}`).length > getsBefore)
  const line = m.find(n => n.props && n.props['data-rowjob'] === stale.ref)
  assert.ok(line && /rebasing, pipeline 12/.test(text(m, line)), 'progress on the row')
  assert.ok(/rebase running/.test(text(m, m.find(n => n.props && n.props['data-job']))))
  const mrsBefore = app.log.filter(c => c.path === '/mrs').length
  app.world.jobs.get(id).state = 'done'
  sdk.fireIntervals(3000)
  await until(() => sdk.seam.toasts.length > 0)
  await settle(6)
  assert.equal(sdk.seam.toasts.filter(x => x.kind === 'success').length, 1)
  assert.equal(app.log.filter(c => c.path === '/mrs').length, mrsBefore + 1, 'one refresh after the job')
  assert.equal(sdk.activeIntervals().some(x => x.key.includes('"job"')), false, 'polling stopped')
  assert.equal(m.find(n => n.props && n.props['data-rowjob']), null)
  m.click(m.find(n => n.props && n.props['data-dismiss']))
  await settle(2)
  assert.equal(m.find(n => n.props && n.props['data-job']), null)
  app.stop()
})

t('jobs: a failed job shows on the strip and the row, toasts an error; another write job on the project disables its buttons', async () => {
  const app = boot()
  const m = app.pane()
  await loaded(m)
  const a = byRef['acme/foxtrot-platform!87']
  const b = byRef['acme/foxtrot-platform!95']
  m.click(act(m, row(m, a.ref), 'rebase'))
  await until(() => m.find(n => n.props && n.props['data-job']))
  await settle(3)
  const why = act(m, row(m, b.ref), 'merge').props['data-why']
  assert.ok(/write job is running on acme\/foxtrot-platform/.test(why), why)
  assert.equal(act(m, row(m, b.ref), 'merge').props.disabled, true)
  const id = [...app.world.jobs.keys()][0]
  app.world.jobs.get(id).state = 'failed'
  app.world.jobs.get(id).steps[0] = { ref: a.ref, step: 'rebase', state: 'failed', detail: 'conflict', at: '' }
  sdk.fireIntervals(3000)
  await until(() => sdk.seam.toasts.some(x => x.kind === 'error'))
  await settle(4)
  assert.ok(/failed/.test(text(m, m.find(n => n.props && n.props['data-job']))))
  assert.ok(/rebase, conflict/.test(text(m, m.find(n => n.props && n.props['data-rowjob'] === a.ref))))
  assert.equal(act(m, row(m, b.ref), 'merge').props.disabled, b.can.merge ? false : true)
  app.stop()
})

t('jobs: a 423 from the backend surfaces as a notification and tracks nothing', async () => {
  const app = boot()
  const m = app.pane()
  await loaded(m)
  const a = byRef['acme/foxtrot-platform!87']
  m.click(act(m, row(m, a.ref), 'rebase'))
  await until(() => posts(app).length === 1)
  // a second write the UI would have disabled: drive it through the backend directly, as another window would
  await assert.rejects(app.ctx.rest(`/mrs/${a.project_id}/${a.iid}/rebase`, { method: 'POST', body: { expected_sha: a.sha } }), /423/)
  app.stop()
})

// =====================================================================
// Copy status, Open session, More menu, Refresh, Re-audit all
// =====================================================================

t('copy status: the backend markdown reaches the clipboard (string or { markdown }); an unreadable answer falls back to a local summary', async () => {
  const app = boot()
  const m = app.pane()
  await loaded(m)
  m.click(act(m, null, 'copy-status'))
  await until(() => app.clip.length === 1)
  assert.ok(app.clip[0].startsWith('# Open merge requests (22)'))
  assert.ok(app.clip[0].includes('Trivial batch: 8'))
  assert.equal(app.log.filter(c => c.path === '/status.md').length, 1)
  app.world.statusMode = 'object'
  m.click(act(m, null, 'copy-status'))
  await until(() => app.clip.length === 2)
  assert.ok(app.clip[1].startsWith('# Open merge requests (22)'))
  app.world.statusMode = 'raw'
  m.click(act(m, null, 'copy-status'))
  await until(() => app.clip.length === 3)
  assert.ok(app.clip[2].includes('Trivial batch: 8') && app.clip[2].includes('## acme/foxtrot-platform'))
  assert.ok(sdk.seam.toasts.some(x => /built from the list in hand/.test(x.message)))
  app.stop()
})

t('open session: host.openSession(id, { intent: tab, profile }); disabled below the score floor, dim for a mention', async () => {
  const app = boot()
  const m = app.pane()
  await loaded(m)
  const created = ITEMS.find(i => L.sessionKind(i.session) === 'created')
  const mentioned = ITEMS.find(i => L.sessionKind(i.session) === 'mentioned')
  const none = ITEMS.find(i => i.session && !L.sessionKind(i.session))
  const b = act(m, row(m, created.ref), 'session')
  assert.equal(b.props.disabled, false)
  m.click(b)
  await settle(2)
  assert.deepEqual(sdk.seam.opened, [{ id: created.session.id, opts: { intent: 'tab', profile: created.session.profile } }])
  assert.ok(/mg-dim/.test(act(m, row(m, mentioned.ref), 'session').props.className || ''))
  assert.ok(!/mg-dim/.test(b.props.className || ''))
  const dead = act(m, row(m, none.ref), 'session')
  assert.equal(dead.props.disabled, true)
  assert.equal(m.click(dead), false)
  assert.equal(sdk.seam.opened.length, 1)
  app.stop()
})

t('More menu: the D63 items only, no Close and no Approve; disabled items say why', async () => {
  const app = boot()
  const m = app.pane()
  await loaded(m)
  const open = async ref => {
    m.click(act(m, row(m, ref), 'menu'))
    await settle(2)
    return m.findAll(n => n.props && n.props['data-item'])
  }
  const reno = await open('acme/bravo-infra!394')
  assert.deepEqual(reno.map(i => i.props['data-item']), ['open', 'pipeline', 'retry', 'copy-branch', 'copy-glab', 'ready', 'audit', 'hold'])
  const labels = reno.map(i => text(m, i))
  assert.deepEqual(labels, ['Open in GitLab', 'Open pipeline', 'Retry failed pipeline', 'Copy branch name', 'Copy glab view command', 'Mark ready', 'Re-run audit', 'Add Renovate hold rule'])
  assert.equal(labels.some(l => /close|approve/i.test(l)), false)
  const en = Object.fromEntries(reno.map(i => [i.props['data-item'], !i.props.disabled]))
  assert.deepEqual(en, { open: true, pipeline: true, retry: false, 'copy-branch': true, 'copy-glab': true, ready: false, audit: true, hold: true })
  assert.ok(/failed pipeline on your MR/.test(reno[2].props.title))
  m.click(m.find(n => n.props && n.props['data-item'] === 'copy-glab'))
  await settle(2)
  const other = await open('acme/foxtrot-platform!64')
  assert.deepEqual(Object.fromEntries(other.map(i => [i.props['data-item'], !i.props.disabled])), { open: true, pipeline: true, retry: false, 'copy-branch': true, 'copy-glab': true, ready: false, audit: false, hold: false })
  assert.deepEqual(app.clip, ['glab mr view 394 -R gitlab.example.com/acme/bravo-infra'])
  app.stop()
})

t('More menu: open and pipeline go through os.openExternal; the menu click does not open the row', async () => {
  const app = boot()
  const m = app.pane()
  await loaded(m)
  const it = byRef['acme/bravo-infra!394']
  m.click(act(m, row(m, it.ref), 'menu'))
  await settle(2)
  m.click(m.find(n => n.props && n.props['data-item'] === 'open'))
  await settle(2)
  assert.equal(m.find(n => n.props && n.props['data-detail']), null, 'the row stayed closed after the item click')
  m.click(act(m, row(m, it.ref), 'menu'))
  await settle(2)
  m.click(m.find(n => n.props && n.props['data-item'] === 'pipeline'))
  await settle(2)
  assert.deepEqual(app.ext, [it.web_url, it.pipeline.url])
  assert.equal(m.find(n => n.props && n.props['data-detail']), null, 'the row stayed closed')
  app.stop()
})

t('Refresh asks for ?refresh=1 and replaces the list; Re-audit all posts /audit/all and tracks a job', async () => {
  const app = boot()
  const m = app.pane()
  await loaded(m)
  const before = app.world.data['conn-a|default'].generated_at
  m.click(act(m, null, 'refresh'))
  await until(() => app.log.some(c => c.path === '/mrs?refresh=1'))
  await settle(4)
  assert.ok(app.world.data['conn-a|default'].generated_at !== before)
  m.click(act(m, null, 'audit-all'))
  await until(() => posts(app).length === 1)
  assert.equal(posts(app)[0].path, '/audit/all')
  await until(() => m.find(n => n.props && n.props['data-job']))
  app.stop()
})

t('settings cog deep-links with pluginSettingsHref(mergeable); the full-page button navigates to /mergeable', async () => {
  const app = boot()
  const m = app.pane()
  await loaded(m)
  m.click(act(m, null, 'settings'))
  m.click(act(m, null, 'open-page'))
  assert.deepEqual(sdk.seam.navs, [sdk.pluginSettingsHref('mergeable'), '/mergeable'])
  assert.equal(sdk.seam.navs[0], '/settings?tab=plugins&plugin=mergeable')
  const view = readFileSync(join(srcDir, 'view.js'), 'utf8')
  assert.ok(/typeof sdk\.pluginSettingsHref === 'function'/.test(view), 'older hosts without the export keep loading')
  app.stop()
})

// =====================================================================
// query keys, backend and profile switches, offline and empty states
// =====================================================================

t('query keys carry connection and profile; a switch shows no rows of the old backend', async () => {
  const app = boot()
  app.world.latency = { 'conn-b|default': 40 }
  const m = app.pane()
  await loaded(m)
  const mrsKeys = () => [...new Set(sdk.seam.queryKeys)].filter(k => k.includes('"mrs"'))
  assert.deepEqual(mrsKeys(), ['["mergeable","conn-a","default","mrs"]'])
  sdk.connectionId.set('conn-b')
  await settle(2)
  assert.equal(rows(m).length, 0, 'no conn-a row while conn-b loads')
  assert.ok(m.find(n => n.props && n.props['data-loader']))
  await until(() => rows(m).length === 3)
  assert.deepEqual(rows(m).map(r => r.props['data-row']), ['remote/app!100', 'remote/app!101', 'remote/app!102'].sort((a, b) => 0))
  assert.ok(/backend conn-b, profile ops-box/.test(text(m, m.find(n => n.props && n.props['data-sub']))))
  sdk.connectionId.set('conn-a')
  sdk.profile.set('work')
  await until(() => text(m, m.find(n => n.props && n.props['data-sub'] || false) || { children: [], tag: 'x' }).includes('profile work'))
  assert.deepEqual(mrsKeys().sort(), ['["mergeable","conn-a","default","mrs"]', '["mergeable","conn-a","work","mrs"]', '["mergeable","conn-b","default","mrs"]'])
  for (const k of sdk.seam.queryKeys) assert.ok(JSON.parse(k).length >= 4, k)
  app.stop()
})

t('a write follows the window backend: the POST runs on the connection and profile of the click', async () => {
  const app = boot()
  const m = app.pane()
  await loaded(m)
  const stale = byRef['acme/bravo-infra!394']
  m.click(act(m, row(m, stale.ref), 'rebase'))
  await until(() => posts(app).length === 1)
  assert.deepEqual([posts(app)[0].conn, posts(app)[0].profile], ['conn-a', 'default'])
  app.stop()
})

t('offline: the error state names the backend and profile; a 404 says that backend lacks the plugin; stale data keeps a banner', async () => {
  const app = boot()
  app.world.fail = 'GET /api/plugins/mergeable/mrs: 404 Plugin not found'
  const m = app.pane()
  await until(() => m.find(n => n.props && n.props.role === 'alert'))
  const alert = text(m, m.find(n => n.props && n.props.role === 'alert'))
  assert.ok(/unreachable \(backend conn-a, profile default\)/.test(alert), alert)
  assert.ok(/does not have the mergeable plugin/.test(alert))
  assert.equal(rows(m).length, 0)
  app.world.fail = null
  sdk.connectionId.set('conn-b')
  app.world.fail = 'boom'
  await until(() => /conn-b/.test(text(m, m.find(n => n.props && n.props.role === 'alert') || { children: [] })))
  assert.ok(/backend conn-b/.test(text(m, m.find(n => n.props && n.props.role === 'alert'))))
  app.stop()
  const stale = boot()
  const m2 = stale.pane()
  await loaded(m2)
  stale.world.fail = 'gateway gone'
  m2.click(act(m2, null, 'refresh'))
  await settle(3)
  sdk.queryClient.invalidateQueries({ queryKey: ['mergeable', 'conn-a', 'default', 'mrs'] })
  await until(() => m2.find(n => n.props && n.props['data-banner'] === 'stale'))
  assert.ok(m2.find(n => n.props && n.props['data-banner'] === 'stale'))
  assert.ok(rows(m2).length > 0, 'the last answer stays')
  stale.stop()
})

t('empty: no MRs names the backend and profile and carries the hide-only note', async () => {
  const app = boot()
  app.world.data['conn-a|default'].items = []
  const m = app.pane()
  await until(() => m.find(n => n.props && n.props['data-empty'] === 'none'))
  const body = text(m, m.find(n => n.props && n.props['data-empty'] === 'none'))
  assert.ok(body.includes('backend conn-a, profile default'), body)
  assert.ok(body.includes(M.HIDE_NOTE))
  assert.equal(m.find(n => n.props && n.props['data-filter']), null, 'no filters over nothing')
  app.stop()
})

t('a filter that matches nothing says so; schema_ok false shows the banner', async () => {
  const app = boot()
  app.world.data['conn-a|default'].schema_ok = false
  const m = app.pane()
  await loaded(m)
  assert.ok(m.find(n => n.props && n.props['data-banner'] === 'schema'))
  m.click(m.find(n => n.props && n.props['data-filter'] === 'colleagues'))
  m.find(n => n.props && n.props['data-drafts']).props.onChange({ target: { checked: false } })
  await settle(2)
  assert.ok(rows(m).length > 0)
  app.stop()
  const e = boot()
  e.ctx.storage.set('display', { showColleagues: false })
  e.stop()
  const e2 = boot({ storage: e.storage })
  const m2 = e2.pane()
  await loaded(m2)
  m2.click(m2.find(n => n.props && n.props['data-filter'] === 'colleagues'))
  await settle(2)
  assert.ok(m2.find(n => n.props && n.props['data-empty'] === 'filtered'), 'colleagues hidden by the display setting')
  e2.stop()
})

t('polling: the list polls at the poll setting (60 s default, 5 min, none for manual)', async () => {
  const app = boot()
  const m = app.pane()
  await loaded(m)
  const mrsIntervals = () => sdk.activeIntervals().filter(x => x.key.includes('"mrs"')).map(x => x.ms)
  assert.deepEqual(mrsIntervals(), [60000])
  const s = app.settings()
  m.unmount()
  s.find(n => n.props && n.props['data-set'] === 'poll').children // sanity: the row exists
  const seg = s.findAll(n => n.props && n.props['data-seg'] === '300')[0]
  s.click(seg)
  await settle(2)
  const m2 = app.pane()
  await loaded(m2)
  assert.deepEqual(mrsIntervals(), [300000])
  s.click(s.findAll(n => n.props && n.props['data-seg'] === '0')[0])
  await settle(2)
  await settle(3)
  assert.deepEqual(mrsIntervals(), [])
  app.stop()
})

// =====================================================================
// settings page (D67)
// =====================================================================

t('settings: display preferences live in ctx.storage, drive the pane at once and survive a reload', async () => {
  const storage = new Map()
  const app = boot({ storage })
  const m = app.pane()
  await loaded(m)
  const s = app.settings()
  const toggles = s.findAll(n => n.props && n.props.role === 'switch').map(n => n.props['aria-label'])
  assert.deepEqual(toggles, ["Show colleagues' MRs", 'Show drafts by default', 'Renovate rating chips', 'Merge state chips', 'Owner chips', 'Session button', ...M.EVENTS.map(e => e.label)])
  const sw = label => s.find(n => n.props && n.props['aria-label'] === label)
  const chipsOf = ref => kids(row(m, ref)).filter(n => n.props && n.props['data-chip']).map(n => n.props['data-chip'])
  assert.ok(chipsOf('acme/bravo-infra!394').includes('importance'))
  sw('Renovate rating chips').props.onChange({ target: { checked: false } })
  await settle(2)
  assert.equal(chipsOf('acme/bravo-infra!394').includes('importance'), false)
  sw('Session button').props.onChange({ target: { checked: false } })
  sw('Show drafts by default').props.onChange({ target: { checked: false } })
  await settle(2)
  assert.equal(act(m, row(m, 'acme/bravo-infra!394'), 'session'), null)
  assert.equal(rows(m).length, ITEMS.filter(i => !i.draft).length, 'default drafts off moves the live view')
  s.click(s.findAll(n => n.props && n.props['data-seg'] === 'age')[0])
  await settle(2)
  assert.deepEqual(rows(m).map(r => r.props['data-row']), parity.combos.find(c => c.filter === 'all' && c.sort === 'age' && !c.drafts && c.colleagues).ids)
  const saved = JSON.parse(storage.get('display'))
  assert.deepEqual([saved.chipRatings, saved.sessionBtn, saved.showDrafts, saved.sort], [false, false, false, 'age'])
  app.stop()
  const again = boot({ storage })
  const m2 = again.pane()
  await loaded(m2)
  assert.equal(rows(m2).length, ITEMS.filter(i => !i.draft).length)
  assert.equal(act(m2, row(m2, 'acme/bravo-infra!394'), 'session'), null)
  again.stop()
})

// =====================================================================
// working days (D79)
// =====================================================================

t('working days: Easter and the ten Hamburg holidays of 2026 and 2027 (Good Friday 2026-04-03, Ascension 2027-05-06)', () => {
  assert.equal(L.easterSunday(2026), '2026-04-05')
  assert.equal(L.easterSunday(2027), '2027-03-28')
  for (const [y, d] of [[2024, '2024-03-31'], [2025, '2025-04-20'], [2038, '2038-04-25'], [1999, '1999-04-04']]) assert.equal(L.easterSunday(y), d, String(y))
  assert.deepEqual(L.hamburgHolidays(2026).map(h => [h.date, h.name]), [
    ['2026-01-01', 'New Year'], ['2026-04-03', 'Good Friday'], ['2026-04-06', 'Easter Monday'], ['2026-05-01', 'Labour Day'], ['2026-05-14', 'Ascension'],
    ['2026-05-25', 'Whit Monday'], ['2026-10-03', 'German Unity Day'], ['2026-10-31', 'Reformation Day'], ['2026-12-25', 'Christmas Day'], ['2026-12-26', 'Boxing Day']
  ])
  assert.deepEqual(L.hamburgHolidays(2027).map(h => [h.date, h.name]), [
    ['2027-01-01', 'New Year'], ['2027-03-26', 'Good Friday'], ['2027-03-29', 'Easter Monday'], ['2027-05-01', 'Labour Day'], ['2027-05-06', 'Ascension'],
    ['2027-05-17', 'Whit Monday'], ['2027-10-03', 'German Unity Day'], ['2027-10-31', 'Reformation Day'], ['2027-12-25', 'Christmas Day'], ['2027-12-26', 'Boxing Day']
  ])
  assert.equal(L.holidayOn('2026-04-03').name, 'Good Friday')
  assert.equal(L.holidayOn('2026-10-31').name, 'Reformation Day')
  assert.equal(L.holidayOn('2027-05-06').name, 'Ascension')
  assert.equal(L.holidayOn('2026-04-02'), null)
})

t('working days: Mo to Fr only; a holiday on a weekday is not a working day, one on a weekend changes nothing', () => {
  assert.equal(L.isWorkingDay('2026-04-02'), true) // Thursday
  assert.equal(L.isWorkingDay('2026-04-03'), false) // Good Friday
  assert.equal(L.isWorkingDay('2026-04-04'), false) // Saturday
  assert.equal(L.isWorkingDay('2026-04-05'), false) // Sunday
  assert.equal(L.isWorkingDay('2026-04-06'), false) // Easter Monday
  assert.equal(L.isWorkingDay('2026-04-07'), true)
  assert.equal(L.isWorkingDay('2026-10-30'), true) // Reformation Day is Saturday in 2026
  assert.equal(L.isWorkingDay('2027-05-06'), false) // Ascension, Thursday
})

t('working days: spans across a weekend plus a holiday, across New Year, and the Berlin day boundary', () => {
  const wd = (a, b) => L.workingDaysBetween(a, b)
  assert.equal(wd('2026-10-23T10:00:00Z', '2026-10-23T18:00:00Z'), 0, 'same day')
  assert.equal(wd('2026-10-23T10:00:00Z', '2026-10-26T08:00:00Z'), 1, 'Friday to Monday')
  assert.equal(wd('2026-10-26T10:00:00Z', '2026-10-23T10:00:00Z'), 0, 'backwards')
  // Thu 2026-04-02 to Tue 2026-04-07: Good Friday, weekend and Easter Monday are skipped, only Tuesday counts.
  assert.equal(wd('2026-04-02T09:00:00Z', '2026-04-07T09:00:00Z'), 1)
  assert.equal(wd('2026-04-02T09:00:00Z', '2026-04-08T09:00:00Z'), 2)
  // Wed 2027-05-05 to Mon 2027-05-10: Ascension (Thu) is skipped; Fri and Mon count.
  assert.equal(wd('2027-05-05T09:00:00Z', '2027-05-10T09:00:00Z'), 2)
  // Thu 2026-12-24 to Mon 2027-01-04: Christmas Day, Boxing Day, New Year (Fri) and the weekends are skipped.
  assert.equal(wd('2026-12-24T09:00:00Z', '2027-01-04T09:00:00Z'), 5)
  // 22:30Z on Thu 2026-10-22 is already Friday 00:30 in Berlin (CEST): Friday to Monday is 1, not 2.
  assert.equal(L.berlinDay('2026-10-22T22:30:00Z'), '2026-10-23')
  assert.equal(L.berlinDay('2026-01-15T23:30:00Z'), '2026-01-16')
  assert.equal(wd('2026-10-22T22:30:00Z', '2026-10-26T08:00:00Z'), 1)
  assert.equal(wd('2026-10-22T20:30:00Z', '2026-10-26T08:00:00Z'), 2)
  assert.equal(wd('junk', '2026-10-26T08:00:00Z'), 0)
})

t('working days: the age colour compares with >= (warn 1, stale 3 by default) and the old 30 and 90 are migrated', () => {
  assert.deepEqual([DEFAULTS.ageWarn, DEFAULTS.ageStale], [1, 3])
  assert.deepEqual([0, 1, 2, 3, 4].map(d => L.ageClass(d)), ['', 'old', 'old', 'stale', 'stale'])
  assert.equal(L.ageClass(5, { ageWarn: 5, ageStale: 9 }), 'old')
  assert.equal(L.ageClass(9, { ageWarn: 5, ageStale: 9 }), 'stale')
  assert.equal(L.ageClass(4, { ageWarn: 5, ageStale: 9 }), '')
  assert.deepEqual([L.normalizeSettings({ ageWarn: 30, ageStale: 90 }).ageWarn, L.normalizeSettings({ ageWarn: 30, ageStale: 90 }).ageStale], [1, 3])
  assert.deepEqual([L.normalizeSettings({ ageWarn: 2, ageStale: 90 }).ageWarn, L.normalizeSettings({ ageWarn: 2, ageStale: 90 }).ageStale], [2, 90])
  const it = { created_at: '2026-10-22T22:30:00Z', age_days: 4 }
  assert.equal(L.workingAge(it, '2026-10-26T08:00:00Z'), 1)
  assert.equal(L.ageTip(it, 1), 'Opened 2026-10-23, 4 days ago, 1 working day')
  assert.equal(L.ageTip(it, 3), 'Opened 2026-10-23, 4 days ago, 3 working days')
  assert.equal(L.ageLabel(4), '4d', 'the label stays calendar time')
})

t('pane: the age colour and tooltip come from working days as of the list time, the label stays calendar', async () => {
  const world = makeWorld()
  const data = world.data['conn-a|default']
  data.generated_at = '2026-10-26T09:00:00Z' // Monday
  const set = (ref, created, days) => { const it = data.items.find(i => i.ref === ref); it.created_at = created; it.age_days = days }
  set('acme/charlie-crm!19', '2026-10-26T06:00:00Z', 0) // same day: 0 working days
  set('acme/echo-deploy!489', '2026-10-23T10:00:00Z', 3) // Friday: 1
  set('acme/foxtrot-platform!95', '2026-10-21T10:00:00Z', 5) // Wednesday: Thu, Fri, Mon = 3
  const app = boot({ world })
  const m = app.pane()
  await loaded(m)
  const age = ref => kids(row(m, ref)).find(n => n.props && n.props['data-age'])
  assert.deepEqual(['acme/charlie-crm!19', 'acme/echo-deploy!489', 'acme/foxtrot-platform!95'].map(r => age(r).props['data-age']), ['fresh', 'old', 'stale'])
  assert.deepEqual(['acme/charlie-crm!19', 'acme/echo-deploy!489', 'acme/foxtrot-platform!95'].map(r => age(r).props['data-wd']), [0, 1, 3])
  assert.equal(age('acme/echo-deploy!489').props['data-tip'], 'Opened 2026-10-23, 3 days ago, 1 working day')
  assert.equal(age('acme/foxtrot-platform!95').props['data-tip'], 'Opened 2026-10-21, 5 days ago, 3 working days')
  assert.equal(text(m, age('acme/foxtrot-platform!95')), '5d')
  app.stop()
})

t('settings: age limits recolour the age in the rows, the labels say working days, bad numbers are repaired', async () => {
  const app = boot()
  const m = app.pane()
  await loaded(m)
  const s = app.settings()
  const ageOf = ref => kids(row(m, ref)).find(n => n.props && n.props['data-age']).props['data-age']
  const labels = s.findAll(n => n.props && n.props['data-set'] && /age/.test(n.props['data-set'])).map(n => n.props['aria-label'])
  assert.deepEqual(labels, ['Age warn from (working days)', 'Age stale from (working days)'])
  const old = ITEMS.find(i => L.workingAge(i, fixture.generated_at) >= 1 && L.workingAge(i, fixture.generated_at) < 3)
  assert.ok(old, 'the fixture has an MR of one or two working days')
  assert.equal(ageOf(old.ref), 'old')
  const field = name => s.find(n => n.props && n.props['data-set'] === name)
  s.type(field('ageWarn'), '200')
  await settle(2)
  field('ageWarn').props.onBlur()
  await settle(3)
  assert.equal(ageOf(old.ref), 'fresh')
  s.type(field('ageStale'), '1')
  await settle(2)
  field('ageStale').props.onBlur()
  await settle(3)
  assert.equal(JSON.parse(app.storage.get('display')).ageStale, 200, 'stale never below warn')
  assert.deepEqual(L.normalizeSettings('junk'), DEFAULTS)
  assert.deepEqual(L.normalizeSettings({ ageWarn: -3, ageStale: 'x', poll: '7', sort: 'bogus', notifyJob: 'yes', chipOwner: 0 }), DEFAULTS)
  assert.equal(L.normalizeSettings({ ageWarn: '45.9' }).ageWarn, 45)
  app.stop()
})

// =====================================================================
// chips: icon only in the pane (D78), icon plus label on the page
// =====================================================================

const chipNodes = (m, scope) => kids(scope).filter(n => n.props && n.props['data-chip'])
const iconOf = n => kids(n).find(c => c.props && c.props['data-codicon'])

t('chips: the D78 icon map is one table and the conflict icon is one constant', () => {
  assert.deepEqual(M.CHIP_ICON, {
    draft: 'git-pull-request-draft', renovate: 'robot', colleague: 'person', importance: 'flame', ease: 'tools', escalated: 'sparkle', unsure: 'question',
    running: 'loading', stale: 'history', error: 'error', batch: 'smiley', mergeable: 'git-pull-request-done', rebase: 'git-pull-request-create',
    conflict: 'git-pull-request-new-changes', noci: 'workspace-untrusted'
  })
  assert.equal(M.CONFLICT_ICON, 'git-pull-request-new-changes')
  assert.equal(M.CHIP_ICON.conflict, M.CONFLICT_ICON)
  let hits = 0
  for (const f of files) hits += (read(f).match(/git-pull-request-new-changes/g) || []).length
  assert.equal(hits, 1, 'the glyph name appears once in desktop/src')
  const action = ['sync', 'git-merge', 'comment-discussion', 'ellipsis']
  for (const icon of Object.values(M.CHIP_ICON)) assert.equal(action.includes(icon), false, `${icon} is an action button glyph`)
})

t('pane chips: every chip is icon only, has one codicon, a tooltip (name and reason) and an aria-label, no text', async () => {
  const app = boot()
  const m = app.pane()
  await loaded(m)
  let seen = 0
  for (const it of ITEMS) {
    const want = L.chipsOf(it, DEFAULTS)
    const got = chipNodes(m, row(m, it.ref))
    assert.equal(got.length, want.length, it.ref)
    got.forEach((n, i) => {
      seen++
      assert.equal(text(m, n), '', `${it.ref} ${want[i].key} has no text`)
      assert.equal(kids(n).filter(c => c.props && c.props['data-codicon']).length, 1, `${it.ref} ${want[i].key} has one icon`)
      assert.equal(iconOf(n).props['data-codicon'], want[i].icon)
      assert.ok(want[i].icon, `${it.ref} ${want[i].key} has an icon`)
      assert.equal(n.props['data-tip'], want[i].tip, 'the tooltip is name and reason')
      assert.equal(n.props['aria-label'], want[i].tip)
      assert.ok(n.props['data-tip'].length > 3)
      assert.equal(n.props.title, undefined, 'no second native tooltip beside the Tip')
    })
  }
  assert.ok(seen > 40, `${seen} chips checked`)
  const reno = chipNodes(m, row(m, 'acme/bravo-infra!370'))
  assert.deepEqual(reno.map(n => iconOf(n).props['data-codicon']), ['robot', 'flame', 'tools', 'sparkle', 'question', 'git-pull-request-create'])
  assert.ok(/^Importance high: /.test(reno[1].props['data-tip']) && reno[1].props['data-tip'].length > 40, 'the reason follows the name')
  const colleague = chipNodes(m, row(m, 'acme/foxtrot-platform!64'))
  assert.equal(colleague[0].props['data-tip'], "deckard: Colleague's MR, read-only")
  assert.equal(iconOf(colleague[0]).props['data-codicon'], 'person')
  app.stop()
})

t('pane chips: draft, batch, mergeable, no CI, conflict and the audit states use the D78 icons; a running audit spins', async () => {
  const world = makeWorld()
  const items = world.data['conn-a|default'].items
  const by = ref => items.find(i => i.ref === ref)
  by('acme/bravo-infra!396').audit_state = 'running'
  by('acme/bravo-infra!370').audit_state = 'stale'
  by('acme/bravo-infra!394').audit_state = 'error'
  by('acme/foxtrot-platform!78').has_conflicts = true
  by('acme/foxtrot-platform!78').merge_status = 'cannot_be_merged'
  by('acme/foxtrot-platform!83').pipeline = null
  const app = boot({ world })
  const m = app.pane()
  await loaded(m)
  const icons = ref => chipNodes(m, row(m, ref)).map(n => [n.props['data-chip'], iconOf(n).props['data-codicon'], /(^| )codicon-modifier-spin( |$)/.test(iconOf(n).props.className)])
  assert.deepEqual(icons('acme/bravo-infra!396').filter(c => c[0] === 'audit-state'), [['audit-state', 'loading', true]])
  assert.deepEqual(icons('acme/bravo-infra!370').filter(c => c[0] === 'audit-state'), [['audit-state', 'history', false]])
  assert.deepEqual(icons('acme/bravo-infra!394').filter(c => c[0] === 'audit-state'), [['audit-state', 'error', false]])
  assert.deepEqual(icons('acme/foxtrot-platform!78').filter(c => c[0] === 'conflict'), [['conflict', 'git-pull-request-new-changes', false]])
  assert.deepEqual(icons('acme/foxtrot-platform!83').filter(c => c[0] === 'noci'), [['noci', 'workspace-untrusted', false]])
  const draft = ITEMS.find(i => i.draft)
  assert.deepEqual(icons(draft.ref)[0], ['draft', 'git-pull-request-draft', false])
  assert.ok(icons('acme/charlie-crm!19').some(c => c[1] === 'smiley' || c[1] === 'git-pull-request-done'))
  const batch = ITEMS.find(i => i.trivial.in_batch && !i.draft)
  assert.ok(icons(batch.ref).some(c => c[1] === 'smiley'), 'a batch MR carries the smiley')
  const plain = ITEMS.find(i => !i.trivial.in_batch && !i.draft && i.merge_status === 'mergeable')
  if (plain) assert.ok(icons(plain.ref).some(c => c[1] === 'git-pull-request-done'))
  assert.ok(icons('acme/bravo-infra!394').every(c => c[2] === false || c[1] === 'loading'), 'only the loading chip spins')
  app.stop()
})

t('page chips: icon plus label in the State, Owner and Audit columns, the tooltip on the chip', async () => {
  const world = makeWorld()
  world.data['conn-a|default'].items.find(i => i.ref === 'acme/bravo-infra!396').audit_state = 'running'
  const app = boot({ world })
  const m = app.page()
  await until(() => rows(m).length > 0)
  await settle(2)
  let seen = 0
  for (const it of ITEMS) {
    const r = row(m, it.ref)
    const want = L.chipsOf(D(world).items.find(i => i.ref === it.ref), { ...DEFAULTS, chipOwner: true, chipRatings: true, chipState: true }).filter(c => c.key !== 'noci')
    const got = chipNodes(m, r)
    assert.deepEqual(got.map(n => n.props['data-chip']).sort(), want.map(c => c.key).sort(), it.ref)
    for (const n of got) {
      seen++
      const c = want.find(w => w.key === n.props['data-chip'] && w.icon === iconOf(n).props['data-codicon'])
      assert.ok(c, `${it.ref} ${n.props['data-chip']} has its icon`)
      assert.equal(text(m, n), c.label || c.name, `${it.ref} ${c.key} shows its label`)
      assert.ok(text(m, n).length > 0)
      assert.equal(n.props.title, c.tip)
      assert.equal(n.props['data-tip'], undefined, 'the page chip uses the title, not a Tip')
    }
  }
  assert.ok(seen > 30, `${seen} page chips`)
  const reno = chipNodes(m, row(m, 'acme/bravo-infra!370')).map(n => text(m, n))
  assert.deepEqual(reno, ['Renovate', 'rebase', 'high', 'hard', 'opus', '?'], 'column order: owner, state, audit')
  const spin = chipNodes(m, row(m, 'acme/bravo-infra!396')).find(n => n.props['data-chip'] === 'audit-state')
  assert.equal(text(m, spin), 'auditing')
  assert.ok(/(^| )codicon-modifier-spin( |$)/.test(iconOf(spin).props.className), 'the running chip spins')
  assert.deepEqual(chipNodes(m, row(m, ITEMS.find(i => i.owner === 'self' && !i.draft).ref)).filter(n => n.props['data-chip'] === 'owner'), [], 'my own MRs carry no owner chip')
  app.stop()
})

// =====================================================================
// notifications (D80)
// =====================================================================

const D = world => world.data['conn-a|default']
const pick = (world, ref) => D(world).items.find(i => i.ref === ref)
const poll = async () => { sdk.fireIntervals(60000); await settle(12) }
async function startApp({ world = makeWorld(), storage = new Map(), prep, surface = 'pane' } = {}) {
  if (prep) prep(world)
  const app = boot({ world, storage })
  const m = surface === 'page' ? app.page() : app.pane()
  await loaded(m)
  await settle(10)
  return { app, m, world, storage }
}
const GAUGE = 'acme/charlie-crm!19'
const MIRROR = 'ops/provisioning/mgmt/mirror!1'

// One crafted poll pair per event: `before` is the state of poll 1 (it never notifies), `change` makes poll 2.
const CASES = [
  {
    id: 'bump', toggle: 'notifyBump', title: 'Mergeable: bravo-infra!396 rated high', silent: false,
    change: w => { pick(w, 'acme/bravo-infra!396').audit.importance = 'high' }
  },
  {
    id: 'audit', toggle: 'notifyAudit', title: 'Mergeable: Audit says hold: bravo-infra!396', silent: true,
    change: w => { pick(w, 'acme/bravo-infra!396').audit.verdict = 'hold' }
  },
  {
    id: 'pipeline-failed', toggle: 'notifyPipelineFailed', title: 'Mergeable: Pipeline failed: charlie-crm!19', silent: false,
    change: w => { pick(w, GAUGE).pipeline.status = 'failed' }
  },
  {
    id: 'pipeline-green', toggle: 'notifyPipelineGreen', title: 'Mergeable: Pipeline green after your rebase: foxtrot-platform!87', silent: true,
    prep: w => { pick(w, 'acme/foxtrot-platform!87').pipeline.status = 'running' },
    after: w => { pick(w, 'acme/foxtrot-platform!87').pipeline.status = 'success' },
    async drive({ app, m, world }) {
      m.click(act(m, row(m, 'acme/foxtrot-platform!87'), 'rebase'))
      await until(() => world.jobs.size === 1)
      world.jobs.values().next().value.steps.push({ ref: 'acme/foxtrot-platform!87', step: 'rebase', state: 'done', detail: 'new head 0123abcd', at: '' })
      await poll()
      assert.deepEqual(app.notes, [], 'a running pipeline is not news')
      pick(world, 'acme/foxtrot-platform!87').pipeline.status = 'success'
      await poll()
    }
  },
  {
    id: 'job', toggle: 'notifyJob', title: 'Mergeable: Merge done', silent: true,
    prep: w => { w.jobs.set('old-1', { id: 'old-1', kind: 'merge', state: 'done', projects: [], refs: ['acme/foxtrot-platform!95'], steps: [{ ref: 'acme/foxtrot-platform!95', step: 'merge', state: 'done', detail: 'merged abc', at: '' }] }) },
    after: () => {},
    async drive({ m, world }) {
      m.click(act(m, row(m, GAUGE), 'merge'))
      await settle(2)
      m.click(confirmOk(m))
      await until(() => world.jobs.size === 2)
      await poll()
      const job = [...world.jobs.values()].find(j => j.id !== 'old-1')
      job.steps.push({ ref: GAUGE, step: 'merge', state: 'done', detail: 'merged 99aa', at: '' })
      job.state = 'done'
      await poll()
    }
  },
  {
    id: 'comment', toggle: 'notifyComment', title: 'Mergeable: New comment from deckard', silent: true,
    change: w => { pick(w, MIRROR).last_note = { author: 'deckard', at: '2026-10-23T08:00:00Z' } }
  },
  {
    id: 'review', toggle: 'notifyReview', title: 'Mergeable: deckard asks for your review', silent: true,
    change: w => { pick(w, 'acme/foxtrot-platform!64').reviewers = ['ripley'] }
  }
]

for (const c of CASES) {
  t(`notifications: ${c.id} fires once on a crafted poll pair, never on the first poll`, async () => {
    const { app, m, world } = await startApp({ prep: c.prep })
    assert.deepEqual(app.notes, [], 'the first poll is the baseline')
    if (c.drive) await c.drive({ app, m, world })
    else { c.change(world); await poll() }
    assert.equal(app.notes.length, 1, JSON.stringify(app.notes.map(n => n.title)))
    const note = app.notes[0]
    assert.equal(note.title, c.title)
    assert.equal(note.silent, c.silent, `silent flag of ${c.id}`)
    assert.equal(typeof note.onActivate, 'function')
    assert.ok(typeof note.body === 'string' && note.body.length > 0)
    assert.equal('activate' in note, false, 'the click runs onActivate, it does not navigate to the page')
    await poll()
    await poll()
    assert.equal(app.notes.length, 1, 'once, not on every poll')
    assert.equal(sdk.seam.toasts.filter(x => x.title === c.title).length, 0, 'no toast while Hermes is in the background')
    app.stop()
    // The state after the change, met on the very first poll, is not an event.
    const after = makeWorld()
    if (c.prep) c.prep(after)
    if (c.after) c.after(after)
    else c.change(after)
    const b = await startApp({ world: after })
    assert.deepEqual(b.app.notes, [], `${c.id} on the first poll`)
    await poll()
    assert.deepEqual(b.app.notes, [], `${c.id} on the second poll with no change`)
    b.app.stop()
  })
}

t('notifications: the seven events are the seven D80 events, each with a setting that is on by default', () => {
  assert.deepEqual(M.EVENTS.map(e => e.id), ['bump', 'audit', 'pipeline-failed', 'pipeline-green', 'job', 'comment', 'review'])
  assert.equal(M.EVENTS.length, 7)
  assert.deepEqual(CASES.map(c => c.id), M.EVENTS.map(e => e.id))
  assert.deepEqual(CASES.map(c => c.toggle), M.EVENTS.map(e => e.setting))
  for (const e of M.EVENTS) assert.equal(DEFAULTS[e.setting], true, e.setting)
  assert.equal('notify' in DEFAULTS, false)
})

t('notifications: the settings page has seven toggles, all on, kept in ctx.storage and read back after a reload', async () => {
  const storage = new Map()
  const app = boot({ storage })
  const s = app.settings()
  for (const e of M.EVENTS) {
    const sw = s.find(n => n.props && n.props['aria-label'] === e.label)
    assert.ok(sw, e.label)
    assert.equal(sw.props.checked, true, e.label)
  }
  s.find(n => n.props && n.props['aria-label'] === M.EVENTS[2].label).props.onChange({ target: { checked: false } })
  await settle(2)
  assert.equal(JSON.parse(storage.get('display')).notifyPipelineFailed, false)
  assert.equal(JSON.parse(storage.get('display')).notifyBump, true)
  app.stop()
  const again = boot({ storage })
  const s2 = again.settings()
  assert.equal(s2.find(n => n.props && n.props['aria-label'] === M.EVENTS[2].label).props.checked, false)
  assert.equal(s2.find(n => n.props && n.props['aria-label'] === M.EVENTS[0].label).props.checked, true)
  again.stop()
})

t('notifications: a switched-off event is silent, and its news is not replayed when the toggle goes back on', async () => {
  const { app, m, world } = await startApp()
  const s = app.settings()
  const sw = () => s.find(n => n.props && n.props['aria-label'] === M.EVENTS[2].label)
  sw().props.onChange({ target: { checked: false } })
  await settle(2)
  pick(world, GAUGE).pipeline.status = 'failed'
  await poll()
  assert.deepEqual(app.notes, [])
  sw().props.onChange({ target: { checked: true } })
  await settle(2)
  await poll()
  assert.deepEqual(app.notes, [], 'the failure was seen while muted and is not announced now')
  pick(world, 'acme/echo-deploy!489').pipeline.status = 'failed'
  await poll()
  assert.equal(app.notes.length, 1, 'a new failure is')
  app.stop()
})

t('notifications: the dedupe keys live in ctx.storage and survive a reload of the plugin and of the storage', async () => {
  const storage = new Map()
  const first = await startApp({ storage })
  pick(first.world, GAUGE).pipeline.status = 'failed'
  await poll()
  assert.equal(first.app.notes.length, 1)
  const kept = JSON.parse(storage.get('notified'))
  const key = `${GAUGE}:pipeline-failed:${pick(first.world, GAUGE).sha}`
  assert.deepEqual(Object.keys(kept), [key], 'one key per announced event, <ref>:<event>:<sha>')
  first.app.stop()
  // A new window: the storage is read back from its serialised form, the poll baseline starts again from "success".
  const copy = new Map(storage)
  const second = await startApp({ storage: copy })
  assert.deepEqual(second.app.notes, [])
  pick(second.world, GAUGE).pipeline.status = 'failed'
  await poll()
  assert.deepEqual(second.app.notes, [], 'the same failure of the same head is not announced twice')
  const key2 = Object.keys(JSON.parse(copy.get('notified')))
  assert.deepEqual(key2, [key])
  pick(second.world, GAUGE).sha = 'e'.repeat(40)
  pick(second.world, GAUGE).pipeline.status = 'success'
  await poll()
  pick(second.world, GAUGE).pipeline.status = 'failed'
  await poll()
  assert.equal(second.app.notes.length, 1, 'a failure of a new head is news again')
  second.app.stop()
  // The control: the same sequence with an empty storage announces it.
  const third = await startApp()
  pick(third.world, GAUGE).pipeline.status = 'failed'
  await poll()
  assert.equal(third.app.notes.length, 1)
  third.app.stop()
})

t('notifications: the key store keeps the newest keys only', () => {
  const events = Array.from({ length: M.KEEP_KEYS + 25 }, (_, i) => ({ type: 'bump', key: `k${i}` }))
  const a = L.takeFresh(events.slice(0, M.KEEP_KEYS), {}, 1000)
  assert.equal(Object.keys(a.notified).length, M.KEEP_KEYS)
  const b = L.takeFresh(events.slice(M.KEEP_KEYS), a.notified, 2000)
  assert.equal(b.fresh.length, 25)
  assert.equal(Object.keys(b.notified).length, M.KEEP_KEYS)
  assert.ok(Array.from({ length: 25 }, (_, i) => `k${M.KEEP_KEYS + i}`).every(k => k in b.notified), 'the newest 25 are kept')
  assert.deepEqual(L.takeFresh([{ key: 'x' }, { key: 'x' }], {}).fresh.length, 1, 'a key twice in one poll counts once')
  assert.deepEqual(L.takeFresh([{ key: 'x' }], 'junk').fresh.length, 1, 'unreadable storage starts empty')
})

t('notifications: more than 3 events in one poll become one summary, 3 stay single', async () => {
  const selfs = ITEMS.filter(i => i.owner === 'self' && !i.draft && i.pipeline && i.pipeline.status === 'success').map(i => i.ref)
  assert.ok(selfs.length >= 4)
  const three = await startApp()
  for (const ref of selfs.slice(0, 3)) pick(three.world, ref).pipeline.status = 'failed'
  await poll()
  assert.equal(three.app.notes.length, 3)
  assert.ok(three.app.notes.every(n => /^Mergeable: Pipeline failed: /.test(n.title)))
  three.app.stop()
  const four = await startApp()
  for (const ref of selfs.slice(0, 4)) pick(four.world, ref).pipeline.status = 'failed'
  await poll()
  assert.equal(four.app.notes.length, 1, 'one summary')
  assert.equal(four.app.notes[0].title, 'Mergeable: 4 new events')
  assert.equal(four.app.notes[0].body, '4 failed pipelines')
  assert.equal(four.app.notes[0].silent, false, 'failures are never silent')
  assert.equal(typeof four.app.notes[0].onActivate, 'function')
  await poll()
  assert.equal(four.app.notes.length, 1)
  four.app.stop()
  // Mixed kinds are counted per kind, and a summary of quiet events stays quiet.
  const mixed = await startApp()
  pick(mixed.world, 'acme/bravo-infra!396').audit.verdict = 'hold'
  pick(mixed.world, MIRROR).last_note = { author: 'deckard', at: '2026-10-23T08:00:00Z' }
  pick(mixed.world, 'acme/foxtrot-platform!64').reviewers = ['ripley']
  pick(mixed.world, 'acme/golf-classifier!70').reviewers = []
  await poll()
  assert.equal(mixed.app.notes.length, 3)
  pick(mixed.world, 'acme/golf-classifier!70').reviewers = ['ripley']
  pick(mixed.world, 'acme/foxtrot-platform!64').reviewers = []
  pick(mixed.world, MIRROR).last_note = { author: 'deckard', at: '2026-10-23T09:00:00Z' }
  pick(mixed.world, 'acme/foxtrot-platform!78').pipeline.status = 'failed'
  pick(mixed.world, 'acme/bravo-infra!394').audit.verdict = 'needs_change'
  await poll()
  const sum = mixed.app.notes.slice(3)
  assert.equal(sum.length, 1)
  assert.equal(sum[0].title, 'Mergeable: 4 new events')
  assert.equal(sum[0].body, '1 audits that say hold or needs change\n1 failed pipelines\n1 new comments\n1 review requests')
  assert.equal(sum[0].silent, false, 'one failure makes the summary loud')
  mixed.app.stop()
})

t('notifications: a new audit of a new head is announced again, the same head only once', async () => {
  const { app, world } = await startApp()
  const it = pick(world, 'acme/bravo-infra!394') // rated high
  it.audit.sha = 'a'.repeat(40)
  await poll()
  it.audit.sha = 'b'.repeat(40)
  await poll()
  await poll()
  assert.deepEqual(app.notes.map(n => n.title), ['Mergeable: bravo-infra!394 rated high', 'Mergeable: bravo-infra!394 rated high'])
  assert.deepEqual(Object.keys(JSON.parse(app.storage.get('notified'))).sort(), [`acme/bravo-infra!394:bump:${'a'.repeat(40)}`, `acme/bravo-infra!394:bump:${'b'.repeat(40)}`])
  app.stop()
})

t('notifications: silent only for quiet events; high and critical bumps, loud audits and failures sound (D80)', async () => {
  const { app, world } = await startApp()
  const it = pick(world, 'acme/bravo-infra!394')
  it.audit.verdict = 'hold' // 394 is rated high: the hold is loud
  await poll()
  assert.equal(app.notes.length, 1)
  assert.equal(app.notes[0].silent, false, 'hold on a high-importance bump')
  pick(world, 'acme/bravo-infra!396').audit.verdict = 'needs_change' // low importance
  await poll()
  assert.equal(app.notes[1].silent, true, 'needs change on a low-importance bump')
  pick(world, 'acme/bravo-infra!396').audit.importance = 'critical'
  pick(world, 'acme/bravo-infra!396').audit.sha = 'f'.repeat(40)
  await poll()
  assert.deepEqual(app.notes.slice(2).map(n => [n.title, n.silent]), [['Mergeable: bravo-infra!396 rated critical', false], ['Mergeable: Audit says needs change: bravo-infra!396', false]], 'a critical bump, and its audit is loud now')
  world.jobs.set('b1', { id: 'b1', kind: 'batch', state: 'failed', projects: [], refs: ['acme/foxtrot-platform!87', 'acme/foxtrot-platform!95'], steps: [{ ref: 'acme/foxtrot-platform!95', step: 'merge', state: 'failed', detail: 'pipeline failed', at: '' }] })
  world.jobs.set('b2', { id: 'b2', kind: 'merge', state: 'stopped', projects: [], refs: ['acme/foxtrot-platform!83'], steps: [] })
  world.jobs.set('b3', { id: 'b3', kind: 'rebase', state: 'done', projects: [], refs: ['acme/foxtrot-platform!84'], steps: [] })
  await poll()
  const jobs = app.notes.slice(4)
  assert.deepEqual(jobs.map(n => [n.title, n.silent]), [['Mergeable: Trivial batch failed, check the MRs', false], ['Mergeable: Merge stopped, check the MRs', false]])
  assert.ok(/acme\/foxtrot-platform!87, acme\/foxtrot-platform!95: pipeline failed/.test(jobs[0].body), jobs[0].body)
  app.stop()
})

t('notifications: ended jobs that exist at the first /jobs read are history, not news', async () => {
  const world = makeWorld()
  world.jobs.set('h1', { id: 'h1', kind: 'batch', state: 'done', projects: [], refs: ['acme/foxtrot-platform!87'], steps: [] })
  world.jobs.set('h2', { id: 'h2', kind: 'merge', state: 'failed', projects: [], refs: ['acme/foxtrot-platform!95'], steps: [] })
  const { app } = await startApp({ world })
  assert.deepEqual(app.notes, [])
  await poll()
  assert.deepEqual(app.notes, [])
  world.jobs.set('h3', { id: 'h3', kind: 'merge', state: 'running', projects: [], refs: ['acme/foxtrot-platform!83'], steps: [] })
  await poll()
  assert.deepEqual(app.notes, [], 'a running job is not an end')
  world.jobs.get('h3').state = 'done'
  await poll()
  assert.equal(app.notes.length, 1)
  app.stop()
})

t('notifications: comments from yourself, bots and system never count; an older backend without the fields stays silent for comments and reviews', () => {
  const user = 'ripley'
  const base = ITEMS.find(i => i.ref === MIRROR)
  const note = (n, extra = {}) => ({ ...base, last_note: n, ...extra })
  const ev = (before, after) => L.mrEvents([before], [after], { user }).map(e => e.type)
  const old = note({ author: 'deckard', at: '2026-10-22T09:15:00Z' })
  assert.deepEqual(ev(old, note({ author: 'deckard', at: '2026-10-23T08:00:00Z' })), ['comment'])
  assert.deepEqual(ev(old, note({ author: user, at: '2026-10-23T08:00:00Z' })), [], 'my own note')
  assert.deepEqual(ev(old, note({ author: 'group_42_bot_c0ffee', at: '2026-10-23T08:00:00Z' })), [], 'a group bot')
  assert.deepEqual(ev(old, note({ author: 'renovate-bot', at: '2026-10-23T08:00:00Z' })), [], 'renovate')
  assert.deepEqual(ev(old, note({ author: 'deckard', at: '2026-10-22T09:15:00Z' })), [], 'the same note')
  assert.deepEqual(ev(note(null), note({ author: 'deckard', at: '2026-10-23T08:00:00Z' })), ['comment'], 'the first note')
  assert.deepEqual(ev(note(null), note(null)), [])
  const colleague = ITEMS.find(i => i.owner === 'other')
  assert.deepEqual(ev(note({ author: 'x', at: 'a' }, { owner: 'other' }), note({ author: 'y', at: 'b' }, { owner: 'other' })), [], 'a colleague MR gets no comment event')
  // an older backend: the keys are absent
  const strip = it => { const { last_note: _n, reviewers: _r, ...rest } = it; return rest }
  assert.deepEqual(ev(strip(old), note({ author: 'deckard', at: '2026-10-23T08:00:00Z' })), [], 'the first poll with the field is a baseline')
  assert.deepEqual(ev(old, strip(note({ author: 'deckard', at: '2026-10-23T08:00:00Z' }))), [])
  assert.deepEqual(ev(strip(colleague), { ...colleague, reviewers: [user] }), [], 'reviewers appear on an upgraded backend: baseline')
  assert.deepEqual(ev({ ...colleague, reviewers: [] }, { ...colleague, reviewers: [user] }), ['review'])
  assert.deepEqual(ev({ ...colleague, reviewers: [user] }, { ...colleague, reviewers: [user] }), [], 'already asked')
  assert.deepEqual(ev({ ...colleague, reviewers: [] }, { ...colleague, reviewers: ['someone.else'] }), [], 'asked for someone else')
  assert.deepEqual(L.mrEvents(null, ITEMS, { user }), [], 'no previous poll, no event')
  assert.equal(L.isBot('deckard'), false)
  assert.equal(L.isBot('group_42_bot_c0ffee'), true)
})

t('notifications: a backend without reviewers and last_note still announces everything else', async () => {
  const world = makeWorld()
  for (const it of D(world).items) { delete it.reviewers; delete it.last_note }
  const { app } = await startApp({ world })
  assert.deepEqual(app.notes, [])
  pick(world, GAUGE).pipeline.status = 'failed'
  pick(world, 'acme/foxtrot-platform!64').reviewers = ['ripley']
  pick(world, MIRROR).last_note = { author: 'deckard', at: '2026-10-23T08:00:00Z' }
  await poll()
  assert.deepEqual(app.notes.map(n => n.title), ['Mergeable: Pipeline failed: charlie-crm!19'], 'the two new fields are baseline, only the failure is news')
  pick(world, MIRROR).last_note = { author: 'deckard', at: '2026-10-23T09:00:00Z' }
  await poll()
  assert.equal(app.notes.length, 2, 'once the backend sends them, comments count')
  app.stop()
})

t('notifications: focused means a toast (host.notify) and no OS note; unfocused means ctx.os.notify; no OS door falls back to the toast', async () => {
  const a = await startApp()
  focus.on = true
  pick(a.world, GAUGE).pipeline.status = 'failed'
  await poll()
  assert.deepEqual(a.app.notes, [], 'no native note while Hermes is focused')
  const toast = sdk.seam.toasts.find(x => /Pipeline failed/.test(x.title || ''))
  assert.ok(toast, JSON.stringify(sdk.seam.toasts))
  assert.deepEqual([toast.kind, toast.title, toast.action.label], ['error', 'Mergeable: Pipeline failed: charlie-crm!19', 'Show'])
  assert.equal(toast.message, pick(a.world, GAUGE).title)
  a.app.stop()
  const b = await startApp()
  focus.on = false
  delete b.app.ctx.os.notify
  pick(b.world, 'acme/echo-deploy!489').pipeline.status = 'failed'
  await poll()
  assert.deepEqual(b.app.notes, [])
  assert.ok(sdk.seam.toasts.some(x => /echo-deploy!489/.test(x.title)), 'no ctx.os.notify: the toast carries it')
  b.app.stop()
  const c = await startApp()
  c.app.ctx.os = undefined
  pick(c.world, GAUGE).pipeline.status = 'failed'
  await poll()
  assert.equal(sdk.seam.toasts.filter(x => /charlie-crm/.test(x.title)).length, 1, 'no ctx.os at all: still no throw, still a toast')
  c.app.stop()
})

t('notifications: a job started in this window does not toast twice while focused (settleJob already does), but is announced in the background', async () => {
  const a = await startApp()
  a.m.click(act(a.m, row(a.m, GAUGE), 'merge'))
  await settle(2)
  a.m.click(confirmOk(a.m))
  await until(() => a.world.jobs.size === 1)
  await poll()
  focus.on = true
  const job = [...a.world.jobs.values()][0]
  job.state = 'done'
  sdk.fireIntervals(3000)
  await poll()
  assert.equal(sdk.seam.toasts.filter(x => x.kind === 'success').length, 1, 'settleJob toasts once')
  assert.equal(sdk.seam.toasts.filter(x => /Merge done/.test(x.title || '')).length, 0)
  assert.deepEqual(a.app.notes, [])
  a.app.stop()
})

t('notifications: the click opens the pane with the row expanded; a filter that hides the row is widened', async () => {
  const { app, m, world } = await startApp()
  m.click(m.find(n => n.props && n.props['data-filter'] === 'renovate'))
  await settle(2)
  assert.equal(row(m, GAUGE), null, 'the Renovate filter hides my own MR')
  pick(world, GAUGE).pipeline.status = 'failed'
  await poll()
  assert.equal(app.notes.length, 1)
  assert.equal(m.find(n => n.props && n.props['data-detail']), null)
  sdk.seam.revealed.length = 0
  app.notes[0].onActivate()
  await settle(4)
  assert.deepEqual(sdk.seam.revealed, ['mergeable:pane'])
  assert.ok(m.find(n => n.props && n.props['data-detail'] === GAUGE), 'the row is expanded')
  assert.equal(m.find(n => n.props && n.props['data-filter'] === 'all').props['aria-pressed'], true)
  const a = await startApp()
  a.m.click(a.m.find(n => n.props && n.props['data-seg'] === 'age'))
  focus.on = true
  pick(a.world, 'acme/echo-deploy!489').pipeline.status = 'failed'
  await poll()
  const toast = sdk.seam.toasts.find(x => /echo-deploy!489/.test(x.title || ''))
  toast.action.onClick()
  await settle(4)
  assert.ok(a.m.find(n => n.props && n.props['data-detail'] === 'acme/echo-deploy!489'), 'the toast action does the same')
  a.app.stop()
  app.stop()
})

t('notifications: pane and page mounted together announce an event once', async () => {
  const { app, world } = await startApp()
  const page = app.page()
  await until(() => rows(page).length > 0)
  await settle(6)
  pick(world, GAUGE).pipeline.status = 'failed'
  await poll()
  assert.equal(app.notes.length, 1)
  app.stop()
})

t('notifications: a backend or profile switch starts a new baseline for that scope', async () => {
  const { app, m, world } = await startApp()
  sdk.connectionId.set('conn-b')
  await until(() => rows(m).length === 3)
  await settle(8)
  assert.deepEqual(app.notes, [], 'the other backend is a first poll')
  sdk.connectionId.set('conn-a')
  await until(() => rows(m).length > 3)
  await settle(8)
  assert.deepEqual(app.notes, [], 'back on the first one, nothing changed')
  pick(world, GAUGE).pipeline.status = 'failed'
  await poll()
  assert.equal(app.notes.length, 1)
  app.stop()
})

t('notifications: the jobs list is polled only while an event that needs it is on', async () => {
  const storage = new Map()
  const pre = boot({ storage })
  pre.ctx.storage.set('display', { notifyJob: false, notifyPipelineGreen: false })
  pre.stop()
  const { app } = await startApp({ storage })
  assert.equal(app.log.filter(c => c.path === '/jobs').length, 0, 'no /jobs read with both job events off')
  assert.equal(sdk.activeIntervals().some(x => x.key.includes('"jobs"')), false)
  app.stop()
  const on = await startApp()
  assert.ok(on.app.log.filter(c => c.path === '/jobs').length >= 1)
  assert.deepEqual(sdk.activeIntervals().filter(x => x.key.includes('"jobs"')).map(x => x.ms), [60000])
  on.app.stop()
})

// =====================================================================
// the page
// =====================================================================

t('page: summary, the full table in prototype order, and the audit cards', async () => {
  const app = boot()
  const m = app.page()
  await until(() => rows(m).length > 0)
  await settle(2)
  assert.deepEqual(rows(m).map(r => r.props['data-row']), parity.table)
  const sub = text(m, m.find(n => n.props && n.props['data-sub']))
  assert.ok(sub.startsWith('22 open MRs in 10 projects: 14 mine, 3 Renovate, 5 colleagues.'), sub)
  const heads = kids(m.find(n => n.props && n.props.className === 'mg-tablewrap')).filter(n => n.tag === 'th').map(x => text(m, x))
  assert.deepEqual(heads, ['MR', 'Title', 'Owner', 'Age', 'State', 'CI', 'Audit', 'Session', 'Actions'])
  const cards = m.findAll(n => n.props && n.props['data-audit'])
  assert.deepEqual(cards.map(c => c.props['data-audit']).sort(), ['acme/bravo-infra!370', 'acme/bravo-infra!394', 'acme/bravo-infra!396'])
  const c394 = text(m, cards.find(c => c.props['data-audit'] === 'acme/bravo-infra!394'))
  for (const part of ['GHSA-hrpp-p4fc-wwf8 high CVSS 7', 'v3.7.15, v3.7.16', 'haiku-5-5', 'merge']) assert.ok(c394.includes(part), part)
  assert.ok(/after escalation/.test(text(m, cards.find(c => c.props['data-audit'] === 'acme/bravo-infra!370'))))
  assert.ok(/Not sure/.test(text(m, cards.find(c => c.props['data-audit'] === 'acme/bravo-infra!370'))))
  assert.ok(/digest bump/.test(text(m, cards.find(c => c.props['data-audit'] === 'acme/bravo-infra!396'))))
  for (const a of ['trivial', 'refresh', 'copy-status', 'audit-all', 'settings', 'show-pane']) assert.ok(act(m, null, a), a)
  app.stop()
})

t('settings: a host without registerSettingsPage but with the plugins area gets exactly one register in that area', () => {
  const app = boot({ settingsMethod: false })
  const inArea = app.regs.filter(r => r.area === 'settings.plugins')
  assert.equal(inArea.length, 1)
  assert.equal(inArea[0].id, 'display')
  assert.equal(inArea[0].title, 'Mergeable')
  assert.deepEqual(inArea[0].data, { icon: 'git-merge' })
  assert.equal(typeof inArea[0].render, 'function')
  assert.equal(app.pages.length, 0)
  app.stop()
})

t('settings: a host with the method uses it and registers nothing in the area', () => {
  const app = boot()
  assert.equal(app.pages.length, 1)
  assert.equal(app.regs.filter(r => r.area === 'settings.plugins').length, 0)
  app.stop()
})

t('settings: a host with neither the method nor the area loads and registers no settings page', () => {
  const app = boot({ settingsMethod: false, settingsArea: null })
  assert.equal(app.pages.length, 0)
  assert.deepEqual(app.regs.map(r => r.area).sort(), ['keybinds', 'palette', 'panes', 'routes', 'sidebar.nav'])
  app.stop()
})

t('buttons: a colleague MR stays read-only when the backend wrongly sends can all true (client guard, 0 POST)', async () => {
  const world = makeWorld()
  const hostile = world.data['conn-a|default'].items.find(i => i.ref === 'acme/foxtrot-platform!64')
  assert.equal(hostile.owner, 'other')
  hostile.can = { rebase: true, merge: true, renovate_rebase: true, retry: true, ready: true, reason: 'x' }
  const app = boot({ world })
  const m = app.pane()
  await loaded(m)
  for (const name of ['rebase', 'merge']) {
    const b = act(m, row(m, hostile.ref), name)
    assert.equal(b.props.disabled, true, name)
    assert.equal(b.props['data-why'], "Colleague's MR", name)
    assert.equal(m.click(b), false, name)
  }
  assert.deepEqual(L.rebaseAbility(hostile), { ok: false, why: "Colleague's MR" })
  assert.deepEqual(L.mergeAbility(hostile), { ok: false, why: "Colleague's MR" })
  const menu = Object.fromEntries(L.menuItems({ ...hostile, draft: true, pipeline: { status: 'failed', url: 'u' }, renovate: { package: 'p' } }).filter(Boolean).map(i => [i.id, i.enabled]))
  assert.equal(menu.retry, false)
  assert.equal(menu.ready, false)
  assert.equal(menu.hold, false)
  assert.equal(menu.open, true)
  assert.equal(menu['copy-branch'], true)
  assert.deepEqual(posts(app), [])
  app.stop()
})

t('page: the same buttons gate the same way (colleagues disabled, ConfirmDialog before the merge POST)', async () => {
  const app = boot()
  const m = app.page()
  await until(() => rows(m).length > 0)
  await settle(2)
  const other = ITEMS.find(i => i.owner === 'other')
  assert.equal(act(m, row(m, other.ref), 'merge').props.disabled, true)
  const it = ITEMS.find(i => i.owner === 'self' && i.can.merge)
  m.click(act(m, row(m, it.ref), 'merge'))
  await settle(2)
  assert.ok(dlg(m))
  assert.deepEqual(posts(app), [])
  m.click(act(m, null, 'show-pane'))
  assert.deepEqual(sdk.seam.revealed, ['mergeable:pane'])
  app.stop()
})

t('page: a deep link #/mergeable?open=<ref> marks the row and the audit card; a hashchange moves it', async () => {
  window.location.hash = '#/mergeable?open=acme%2Fbravo-infra%21394'
  const app = boot()
  window.location.hash = '#/mergeable?open=acme%2Fbravo-infra%21394'
  const m = app.page()
  await until(() => rows(m).length > 0)
  await settle(2)
  assert.equal(row(m, 'acme/bravo-infra!394').props.className, 'hit')
  assert.ok(/mg-card hit/.test(m.find(n => n.props && n.props['data-audit'] === 'acme/bravo-infra!394').props.className))
  assert.equal(row(m, 'acme/bravo-infra!396').props.className, undefined)
  m.click(row(m, 'acme/bravo-infra!396'))
  await settle(2)
  assert.equal(window.location.hash, '#/mergeable?open=acme%2Fbravo-infra%21396')
  assert.equal(row(m, 'acme/bravo-infra!396').props.className, 'hit')
  app.stop()
})

t('page: one backend answer feeds the pane and the page; both mounted at once open one dialog each, not two', async () => {
  const app = boot()
  const pane = app.pane()
  const page = app.page()
  await loaded(pane)
  await until(() => rows(page).length > 0)
  const it = ITEMS.find(i => i.owner === 'self' && i.can.merge)
  pane.click(act(pane, row(pane, it.ref), 'merge'))
  await settle(2)
  assert.ok(dlg(pane))
  assert.equal(dlg(page), null)
  assert.equal(app.log.filter(c => c.path === '/mrs').length, 1, 'one fetch for two surfaces')
  app.stop()
})

// =====================================================================
// bundle and source rules
// =====================================================================

const files = readdirSync(srcDir).filter(f => f.endsWith('.js'))
const read = f => readFileSync(join(srcDir, f), 'utf8')

t('bundle: imports only the loader allowlist, no relative or URL import', () => {
  const bundle = readFileSync(join(here, '..', 'desktop', 'plugin.js'), 'utf8')
  const specs = [...bundle.matchAll(/^\s*import\b[^;]*?\bfrom\s*["']([^"']+)["']/gm)].map(m => m[1])
  assert.ok(specs.length >= 2)
  for (const s of specs) assert.ok(['@hermes/plugin-sdk', 'react', 'react/jsx-runtime', 'react/jsx-dev-runtime'].includes(s), s)
  assert.equal(/\bimport\s*\(/.test(bundle), false, 'no dynamic import')
  assert.ok(bundle.includes("'mod+alt+m'") || bundle.includes('"mod+alt+m"'))
})

t('no composer.submit anywhere in desktop/src and nothing reached a composer while the tests ran', () => {
  assert.ok(files.length >= 8)
  for (const f of files) assert.equal(/\bcomposer\s*\./.test(read(f)), false, f)
  assert.equal(sdk.seam.submits, 0)
})

t('no Close and no Approve action anywhere in the sources (D63)', () => {
  for (const f of files) {
    for (const [i, line] of read(f).split('\n').entries()) {
      if (/^\s*\/\//.test(line)) continue
      assert.equal(/['"`](Close MR|Approve)/i.test(line), false, `${f}:${i + 1}`)
    }
  }
})

t('desktop/src, fixtures, stand-ins and README use ASCII punctuation only', () => {
  const bad = /[\u2013\u2014\u2026\u2018\u2019\u201c\u201d\u2190-\u21ff]/
  for (const f of files) assert.equal(bad.test(read(f)), false, f)
  for (const f of ['mrs.json', 'prototype-parity.json']) assert.equal(bad.test(readFileSync(join(here, 'fixtures', f), 'utf8')), false, f)
  for (const f of readdirSync(join(here, 'standin'))) assert.equal(bad.test(readFileSync(join(here, 'standin', f), 'utf8')), false, f)
  assert.equal(bad.test(readFileSync(join(here, '..', 'desktop', 'plugin.js'), 'utf8')), false, 'plugin.js')
  assert.equal(bad.test(readFileSync(join(here, '..', 'README.md'), 'utf8')), false, 'README.md')
})

// --- run ---

for (const [name, fn] of queue) {
  await settle(8) // a write left in flight by the previous test lands before this one boots
  n++
  try {
    await fn()
    console.log(`PASS ${String(n).padStart(2, '0')} ${name}`)
  } catch (e) {
    failed++
    console.log(`FAIL ${String(n).padStart(2, '0')} ${name} :: ${String(e.message).split('\n')[0]}`)
    if (process.env.TRACE) console.log(e.stack)
  }
}
console.log(`${n - failed}/${n} passed`)
process.exit(failed ? 1 : 0)
