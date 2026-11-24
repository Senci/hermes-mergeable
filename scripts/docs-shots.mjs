// Renders the screenshots of the Mergeable docs from the BUILT desktop/plugin.js.
//
// The bundle runs in plain node against the stand-in SDK, the stand-in React and the stand-in backend of
// tests/standin/, over docs/fixtures/example.json (fictional MRs, no network). The resulting tree of host
// nodes is written as static HTML, styled with host-like tokens, and captured by headless Chrome over CDP.
// The shots therefore show the plugin's own markup in a host-like frame, not the running desktop app.
//
// Usage: node scripts/docs-shots.mjs [--out DIR] [--check] [--chrome PATH]
//   (no flag)  render every shot into DIR (default docs/assets) and write DIR/shots.json (needs Chrome and the
//              host's codicon font: CODICONS_DIR, or ~/.hermes/hermes-agent/node_modules/@vscode/codicons/dist)
//   --check    render every shot to HTML and test its content; test the committed shots against shots.json
//              (missing, empty, wrong size, or taken from another plugin.js, fixture or script is exit 1); with
//              Chrome present also render the PNGs into DIR and test those. Without Chrome the PNG render
//              is skipped and said so.
// Clock: Friday 2026-10-23 10:00Z, UTC. Exit 0 ok, 1 findings, 2 cannot run.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { register } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

process.env.TZ = 'UTC'
const FIXED = Date.parse('2026-10-23T10:00:00Z')
const RealDate = Date
globalThis.Date = class extends RealDate {
  constructor(...args) { if (args.length === 0) super(FIXED); else super(...args) }
  static now() { return FIXED }
}

const here = dirname(fileURLToPath(import.meta.url))
const plugin = resolve(here, '..')
const SELF = join(here, 'docs-shots.mjs')
const FIXTURE = join(plugin, 'docs/fixtures/example.json')
const BUNDLE = join(plugin, 'desktop/plugin.js')
const COMMITTED = join(plugin, 'docs/assets')

const args = process.argv.slice(2)
const flag = name => args.includes(name)
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const check = flag('--check')
const outDir = resolve(option('--out') || COMMITTED)
if (flag('--help') || flag('-h')) { console.log(readFileSync(SELF, 'utf8').split('\n').slice(0, 17).join('\n')); process.exit(0) }
const fail = msg => { console.error(`FAIL: ${msg}`); process.exit(2) }

// --- the node side: host globals, stand-ins, the bundle ---

globalThis.window = {
  location: { hash: '' }, history: { replaceState() {} }, addEventListener() {}, removeEventListener() {}, open() {}
}
globalThis.CSS = { escape: s => s }
const styles = []
globalThis.document = {
  hasFocus: () => false,
  head: { appendChild: s => styles.push(s) },
  createElement: () => ({ dataset: {}, remove() {} }),
  querySelector: () => null
}
register(pathToFileURL(join(plugin, 'tests/standin/hooks.mjs')).href)
const sdk = await import(pathToFileURL(join(plugin, 'tests/standin/sdk.mjs')).href)
const { mount, settle } = await import(pathToFileURL(join(plugin, 'tests/standin/render.mjs')).href)
const { makeRest, makeWorld } = await import(pathToFileURL(join(plugin, 'tests/standin/backend.mjs')).href)
const react = await import(pathToFileURL(join(plugin, 'tests/standin/react.mjs')).href)
const { default: mergeable } = await import(pathToFileURL(BUNDLE).href)
const L = await import(pathToFileURL(join(plugin, 'desktop/src/logic.js')).href)
const M = await import(pathToFileURL(join(plugin, 'desktop/src/model.js')).href)
const example = JSON.parse(readFileSync(FIXTURE, 'utf8'))
const clone = v => JSON.parse(JSON.stringify(v))

function boot(data = example) {
  sdk.resetSeams(); sdk.resetQueries()
  sdk.connectionId.set('local'); sdk.profile.set('default')
  styles.length = 0
  const world = makeWorld()
  world.data = { 'local|default': clone(data) }
  const storage = new Map()
  const regs = []
  const pages = []
  let dispose = null
  mergeable.register({
    rest: makeRest(world, sdk.host, []),
    storage: { get: (k, d) => (storage.has(k) ? JSON.parse(storage.get(k)) : d), set: (k, v) => { storage.set(k, JSON.stringify(v)) }, remove: k => { storage.delete(k) } },
    registerMany: cs => { regs.push(...cs); return () => {} },
    register: c => { regs.push(c); return () => {} },
    registerSettingsPage: p => { pages.push(p); return () => {} },
    onDispose: f => { dispose = f },
    os: { writeClipboard: async () => true, openExternal: async () => true, notify() {} }
  })
  const mounted = []
  const into = fn => { const m = mount(react.createElement(fn)); mounted.push(m); return m }
  return {
    pane: () => into(regs.find(r => r.area === 'panes').render),
    page: () => into(regs.find(r => r.area === 'routes').render),
    settings: () => into(pages[0].render),
    css: () => styles.map(s => s.textContent || '').join('\n'),
    stop: () => { for (const m of mounted) m.unmount(); if (dispose) dispose() }
  }
}

const kids = n => { const out = []; const go = c => { for (const x of c.children) { out.push(x); go(x) } }; go(n); return out }
const byProp = (m, key, value) => m.find(n => n.props && n.props[key] === value)
const within = (n, key, value) => kids(n).find(x => x.props && x.props[key] === value)
async function until(fn, ms = 3000) {
  const t0 = RealDate.now()
  while (RealDate.now() - t0 < ms) { if (fn()) return true; await settle(1) }
  return !!fn()
}
const loaded = async m => {
  if (!(await until(() => m.findAll(n => n.props && n.props['data-row'] !== undefined).length > 0))) throw new Error('no rows rendered')
  await settle(3)
}

// --- tree to HTML ---

const VOID = new Set(['input', 'hr', 'br', 'img'])
const UNITLESS = new Set(['opacity', 'flex', 'flexGrow', 'flexShrink', 'zIndex', 'lineHeight', 'fontWeight', 'order'])
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escAttr = s => esc(s).replace(/"/g, '&quot;')
const kebab = k => k.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)
const styleOf = o => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== false)
  .map(([k, v]) => `${k.startsWith('--') ? k : kebab(k)}:${typeof v === 'number' && !UNITLESS.has(k) ? `${v}px` : v}`).join(';')
const BOOL = new Set(['checked', 'disabled', 'readOnly', 'selected'])
function attrs(props) {
  const out = []
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'children' || k === 'key' || k === 'ref' || /^on[A-Z]/.test(k) || v === undefined || v === null) continue
    if (k === 'className') out.push(`class="${escAttr(v)}"`)
    else if (k === 'htmlFor') out.push(`for="${escAttr(v)}"`)
    else if (k === 'style') { const s = styleOf(v); if (s) out.push(`style="${escAttr(s)}"`) }
    else if (BOOL.has(k)) { if (v) out.push(k.toLowerCase()) }
    else if (typeof v === 'function' || typeof v === 'object') continue
    else out.push(`${k === 'tabIndex' ? 'tabindex' : k}="${escAttr(v)}"`)
  }
  return out.length ? ` ${out.join(' ')}` : ''
}
function html(nodes) {
  return nodes.map(n => {
    if (n.tag === '#text') return esc(n.text)
    const open = `<${n.tag}${attrs(n.props)}>`
    return VOID.has(n.tag) ? open : `${open}${html(n.children)}</${n.tag}>`
  }).join('')
}

// --- scenarios: each returns { body, css, markers } for its frame ---

const PANE_REF = 'aperture/portal-gun!41'
const scenarios = {
  async pane() {
    const app = boot(); const m = app.pane(); await loaded(m)
    return { body: `<div id="pane">${html(m.tree)}</div>`, plugin: app.css(), want: { rows: example.items.length, icons: Object.values(M.CHIP_ICON) }, stop: app.stop }
  },
  async page() {
    const app = boot(); const m = app.page(); await loaded(m)
    return { body: `<div id="page">${html(m.tree)}</div>`, plugin: app.css(), want: { rows: example.items.length }, stop: app.stop }
  },
  async 'merge-confirm'() {
    const app = boot(); const m = app.pane(); await loaded(m)
    const row = byProp(m, 'data-row', PANE_REF)
    m.click(within(row, 'data-act', 'merge'))
    if (!(await until(() => byProp(m, 'data-confirm', 'open')))) throw new Error('merge dialog did not open')
    return { body: `<div id="pane">${html(m.tree)}</div>`, plugin: app.css(), want: { rows: example.items.length, dialog: true }, stop: app.stop }
  },
  async 'trivial-confirm'() {
    const app = boot(); const m = app.pane(); await loaded(m)
    m.click(byProp(m, 'data-act', 'trivial'))
    if (!(await until(() => byProp(m, 'data-confirm', 'open')))) throw new Error('trivial dialog did not open')
    return { body: `<div id="pane">${html(m.tree)}</div>`, plugin: app.css(), want: { rows: example.items.length, dialog: true }, stop: app.stop }
  },
  async settings() {
    const app = boot(); const m = app.settings()
    if (!(await until(() => byProp(m, 'data-mg', 'settings')))) throw new Error('settings page did not render')
    return { body: `<div id="page" class="settings">${html(m.tree)}</div>`, plugin: app.css(), want: { switches: 13, plain: true }, stop: app.stop }
  },
  async notification() {
    // The D80 summary as the plugin builds it from two polls: the same functions the pane runs, over the example data.
    const before = clone(example.items)
    const get = ref => before.find(i => i.ref === ref)
    get('aperture/portal-gun!41').audit = null
    get('weyland/nostromo-autopilot!17').audit = null
    get('cyberdyne/skynet-lite!14').pipeline.status = 'running'
    get('aperture/portal-gun!44').last_note = null
    get('aperture/portal-gun!43').reviewers = []
    const events = L.mrEvents(before, clone(example.items), { user: example.user, rebased: new Set() })
    const [note] = L.messagesFor(events)
    if (note.type !== 'summary') throw new Error(`expected one summary, got ${events.length} events`)
    const lines = note.body.split('\n').map(x => `<div>${esc(x)}</div>`).join('')
    const body = `<div id="desk"><div class="note" data-note="summary"><div class="note-i"><i class="codicon codicon-git-merge"></i></div>` +
      `<div class="note-t"><div class="note-h"><span>Hermes</span><span>now</span></div><div class="note-title">${esc(`Mergeable: ${note.title}`)}</div>` +
      `<div class="note-b">${lines}</div><div class="note-f">${note.silent ? 'silent' : 'with sound: a high rating or a failure is in it'}</div></div></div></div>`
    return { body, plugin: '', want: { note: true }, stop() {} }
  }
}

// name: frame width x height, device scale factor, the file name written
const SHOTS = [
  { name: 'pane', w: 340, h: 840, dsf: 2 },
  { name: 'page', w: 1280, h: 1080, dsf: 1 },
  { name: 'merge-confirm', w: 620, h: 440, dsf: 2 },
  { name: 'trivial-confirm', w: 620, h: 470, dsf: 2 },
  { name: 'settings', w: 900, h: 1400, dsf: 1 },
  { name: 'notification', w: 460, h: 230, dsf: 2 }
]

const TOKENS = `
:root{color-scheme:dark;--ui-base:#e6edf3;--ui-text-primary:#e8edf2;--ui-text-secondary:#bfc7cf;--ui-text-tertiary:#8b949e;--ui-text-quaternary:#5b636b;
--ui-stroke-secondary:#2a313a;--ui-stroke-tertiary:#1f252c;--ui-bg-quaternary:#161b22;--ui-bg-elevated:#0d1117;--ui-bg-chrome:#010409;--ui-row-hover-background:#131820;--chrome-action-hover:#1c232c;
--ui-accent:#4a84fe;--ui-green:#3fb950;--ui-red:#f85149;--ui-yellow:#d29922;--ui-blue:#58a6ff;--ui-orange:#db704b;--ui-purple:#9e94d5;--pop:#161b22;--primary:#4a84fe}`
const BASE = `
html,body{margin:0;background:var(--ui-bg-elevated);color:var(--ui-text-primary);font:13px system-ui,sans-serif}
#pane{width:340px;height:100vh;background:var(--ui-bg-elevated)}#page{width:100vw;height:100vh;background:var(--ui-bg-elevated)}
#page.settings{padding:18px 28px;box-sizing:border-box}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:4px;border:0;border-radius:2.5px;background:transparent;color:var(--ui-text-secondary);padding:0 6px;font:500 11px/16px system-ui;flex:none}
.btn.secondary{background:var(--ui-bg-quaternary);color:var(--ui-text-primary);padding:2px 8px}
.btn.xs{padding:2px 8px}.btn.sm{padding:4px 10px;font-size:12px}.btn.default{background:var(--primary);color:#fff}.btn[disabled]{opacity:.4}
.btn.icon-xs{width:24px;height:24px;padding:0;border-radius:4px}.btn.icon-xs .codicon{font-size:14px}
.codicon{font-size:13px;line-height:1}.codicon-modifier-spin{animation:none!important}
.badge{display:inline-flex;align-items:center;gap:4px;border-radius:3px;padding:2px 6px;font-size:10.4px;font-weight:500;line-height:1;white-space:nowrap}
.badge.sz-xs{padding:1px 4px;font-size:9.6px}
.b-default{background:color-mix(in srgb,var(--primary) 10%,transparent);color:var(--primary)}.b-muted{background:var(--ui-bg-quaternary);color:var(--ui-text-tertiary)}
.b-success{background:rgba(16,185,129,.10);color:#6ee7b7}.b-warn{background:rgba(245,158,11,.10);color:#fcd34d}
.b-destructive{background:color-mix(in srgb,var(--ui-red) 10%,transparent);color:var(--ui-red)}.b-outline{border:1px solid var(--ui-stroke-secondary);color:var(--ui-text-tertiary)}
.input{font:12px system-ui;color:var(--ui-text-primary);background:var(--ui-bg-quaternary);border:1px solid var(--ui-stroke-secondary);border-radius:4px;padding:3px 8px}
.seg{display:inline-flex;gap:2px;background:var(--ui-bg-quaternary);border-radius:4px;padding:2px}.seg button{border:0;background:transparent;color:var(--ui-text-tertiary);padding:1px 8px;border-radius:3px;font:500 11px/16px system-ui}
.seg button[aria-pressed=true]{background:var(--pop);color:var(--ui-text-primary);box-shadow:0 0 0 1px var(--ui-stroke-tertiary)}
.dlg-wrap{position:fixed;inset:0;display:grid;place-items:center;z-index:50}.dlg-back{position:absolute;inset:0;background:rgba(1,4,9,.6)}
.dlg{box-sizing:border-box;position:relative;width:min(520px,92vw);background:var(--pop);border:1px solid var(--ui-stroke-secondary);border-radius:8px;padding:16px;box-shadow:0 16px 40px rgba(0,0,0,.5);max-height:90vh;overflow:auto}
.dlg h2{margin:0 0 4px;font-size:14px}.ed{color:var(--ui-text-tertiary);font-size:12px;margin-top:2px}.dlg-f{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}
.trow{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid var(--ui-stroke-tertiary)}.trow .ed{display:block}
input[role=switch]{appearance:none;width:30px;height:17px;border-radius:9px;background:var(--ui-bg-quaternary);box-shadow:inset 0 0 0 1px var(--ui-stroke-secondary);position:relative;flex:none;margin:0}
input[role=switch]::after{content:"";position:absolute;top:3px;left:3px;width:11px;height:11px;border-radius:50%;background:var(--ui-text-tertiary)}
input[role=switch]:checked{background:var(--primary);box-shadow:none}input[role=switch]:checked::after{left:16px;background:#fff}
input[type=checkbox]:not([role=switch]){accent-color:var(--primary)}
#desk{width:100vw;height:100vh;display:grid;place-items:center;background:#1a1d24}
.note{display:flex;gap:12px;width:400px;box-sizing:border-box;padding:12px 14px;border-radius:12px;background:#262a33;box-shadow:0 8px 24px rgba(0,0,0,.45);color:#e6e8ee;font:13px/1.4 system-ui}
.note-i{width:36px;height:36px;border-radius:8px;background:var(--primary);display:grid;place-items:center;flex:none}.note-i .codicon{font-size:20px;color:#fff}
.note-t{min-width:0;flex:1}.note-h{display:flex;justify-content:space-between;color:#9aa1ad;font-size:11px}.note-title{font-weight:600;margin-top:2px}
.note-b{margin-top:4px;color:#cdd2db}.note-f{margin-top:8px;color:#8e95a2;font-size:11px}`

function codicons() {
  const dir = process.env.CODICONS_DIR || join(homedir(), '.hermes/hermes-agent/node_modules/@vscode/codicons/dist')
  if (!existsSync(join(dir, 'codicon.css')) || !existsSync(join(dir, 'codicon.ttf'))) return null
  const version = (() => { try { return JSON.parse(readFileSync(join(dir, '../package.json'), 'utf8')).version } catch { return 'unknown' } })()
  const font = readFileSync(join(dir, 'codicon.ttf')).toString('base64')
  const css = readFileSync(join(dir, 'codicon.css'), 'utf8').replace(/url\("\.\/codicon\.ttf[^"]*"\)/, `url("data:font/ttf;base64,${font}")`)
  return { css, version }
}

const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex')
const sources = () => ({ 'desktop/plugin.js': sha(BUNDLE), 'docs/fixtures/example.json': sha(FIXTURE), 'scripts/docs-shots.mjs': sha(SELF) })
const pngSize = file => {
  const b = readFileSync(file)
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), bytes: b.length }
}
const MIN_BYTES = 4000

function findChrome() {
  const named = option('--chrome') || process.env.CHROME
  if (named) return existsSync(named) ? named : null
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    for (const bin of ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser']) {
      if (existsSync(join(dir, bin))) return join(dir, bin)
    }
  }
  return existsSync('/usr/sbin/google-chrome-stable') ? '/usr/sbin/google-chrome-stable' : null
}

async function capture(chromeBin, files) {
  const profile = join(work, 'chrome-profile')
  mkdirSync(profile, { recursive: true })
  const chrome = spawn(chromeBin, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
  try {
    const wsUrl = await new Promise((res, rej) => {
      let buf = ''
      chrome.stderr.on('data', d => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (m) res(m[1]) })
      chrome.on('exit', code => rej(new Error(`chrome exited with ${code}: ${buf.slice(-300)}`)))
      setTimeout(() => rej(new Error('chrome did not start in 15 s')), 15000)
    })
    const port = new URL(wsUrl).port
    const tab = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page')
    const ws = new WebSocket(tab.webSocketDebuggerUrl)
    await new Promise(r => ws.addEventListener('open', r))
    let id = 0
    const waiting = new Map()
    ws.addEventListener('message', m => { const msg = JSON.parse(m.data); if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id) } })
    const send = (method, params = {}) => new Promise(r => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
    await send('Page.enable')
    const sizes = {}
    for (const { shot, file } of files) {
      await send('Emulation.setDeviceMetricsOverride', { width: shot.w, height: shot.h, deviceScaleFactor: shot.dsf, mobile: false })
      await send('Page.navigate', { url: pathToFileURL(file).href })
      await new Promise(r => setTimeout(r, 400))
      await send('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => true)', awaitPromise: true })
      const res = await send('Page.captureScreenshot', { format: 'png' })
      if (!res.result || !res.result.data) throw new Error(`no screenshot for ${shot.name}: ${JSON.stringify(res.error || res)}`)
      const png = join(outDir, `${shot.name}.png`)
      writeFileSync(png, Buffer.from(res.result.data, 'base64'))
      sizes[shot.name] = pngSize(png)
    }
    ws.close()
    return sizes
  } finally {
    chrome.kill('SIGTERM')
  }
}

// --- run ---

mkdirSync(outDir, { recursive: true })
const work = mkdtempSync(join(tmpdir(), 'mg-docs-shots-'))
process.on('exit', () => rmSync(work, { recursive: true, force: true }))
const htmlDir = work
const font = codicons()
const problems = []
const files = []
for (const shot of SHOTS) {
  let result
  try {
    result = await scenarios[shot.name]()
  } catch (err) {
    problems.push(`${shot.name}: scenario failed: ${err.message}`)
    continue
  }
  const rows = (result.body.match(/data-row="/g) || []).length
  if (result.want.rows && rows !== result.want.rows) problems.push(`${shot.name}: ${rows} rows, expected ${result.want.rows}`)
  for (const icon of result.want.icons || []) {
    if (!result.body.includes(`codicon-${icon} `) && !result.body.includes(`codicon-${icon}"`)) problems.push(`${shot.name}: the example data draws no ${icon} chip (CHIP_ICON)`)
  }
  if (result.want.dialog && !result.body.includes('data-confirm="open"')) problems.push(`${shot.name}: no confirm dialog in the frame`)
  if (result.want.switches && (result.body.match(/role="switch"/g) || []).length !== result.want.switches) problems.push(`${shot.name}: switch count differs from ${result.want.switches}`)
  if (result.want.note && !result.body.includes('data-note="summary"')) problems.push(`${shot.name}: no notification summary`)
  if (!result.want.plain && !/codicon-[a-z-]+/.test(result.body)) problems.push(`${shot.name}: no codicon in the frame`)
  result.stop()
  const file = join(htmlDir, `${shot.name}.html`)
  writeFileSync(file, `<!doctype html><html><head><meta charset="utf-8"><style>${font ? font.css : ''}</style><style>${TOKENS}${BASE}</style><style>${result.plugin}</style></head><body>${result.body}</body></html>\n`)
  files.push({ shot, file })
}

const chromeBin = findChrome()
let sizes = null
if (!problems.length && chromeBin && font) {
  if (font.version !== '0.0.45') console.log(`note: codicons ${font.version}, the decisions name icons of 0.0.45`)
  try { sizes = await capture(chromeBin, files) } catch (err) { problems.push(`chrome render failed: ${err.message}`) }
} else if (!check && !problems.length) {
  fail(chromeBin ? `the codicon font is missing (set CODICONS_DIR)` : 'Chrome not found (set CHROME or pass --chrome)')
} else if (check) {
  console.log(`PNG render skipped: ${chromeBin ? 'no codicon font' : 'no Chrome'} here; the committed shots are checked instead`)
}

if (sizes) {
  for (const shot of SHOTS) {
    const s = sizes[shot.name]
    if (!s) problems.push(`${shot.name}.png: not rendered`)
    else if (s.bytes < MIN_BYTES) problems.push(`${shot.name}.png: only ${s.bytes} bytes`)
    else if (s.w !== shot.w * shot.dsf || s.h !== shot.h * shot.dsf) problems.push(`${shot.name}.png: ${s.w}x${s.h}, expected ${shot.w * shot.dsf}x${shot.h * shot.dsf}`)
  }
}

if (!check && !problems.length) {
  const manifest = { sources: sources(), shots: Object.fromEntries(SHOTS.map(s => [s.name, { w: sizes[s.name].w, h: sizes[s.name].h }])) }
  writeFileSync(join(outDir, 'shots.json'), `${JSON.stringify(manifest, null, 2)}\n`)
}

if (check) {
  const manifestFile = join(COMMITTED, 'shots.json')
  if (!existsSync(manifestFile)) problems.push('docs/assets/shots.json is missing: run node scripts/docs-shots.mjs')
  else {
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
    const now = sources()
    for (const [file, hash] of Object.entries(now)) {
      if (manifest.sources[file] !== hash) problems.push(`the committed shots were taken from another ${file}: rerun node scripts/docs-shots.mjs and commit docs/assets`)
    }
    for (const shot of SHOTS) {
      const png = join(COMMITTED, `${shot.name}.png`)
      if (!existsSync(png)) { problems.push(`docs/assets/${shot.name}.png is missing`); continue }
      const s = pngSize(png)
      if (!s) problems.push(`docs/assets/${shot.name}.png is not a PNG`)
      else if (statSync(png).size < MIN_BYTES) problems.push(`docs/assets/${shot.name}.png is empty (${s.bytes} bytes)`)
      else if (s.w !== shot.w * shot.dsf || s.h !== shot.h * shot.dsf) problems.push(`docs/assets/${shot.name}.png is ${s.w}x${s.h}, expected ${shot.w * shot.dsf}x${shot.h * shot.dsf}`)
    }
  }
}

for (const p of problems) console.error(`FINDING: ${p}`)
if (sizes) for (const s of SHOTS) console.log(`${s.name}.png ${sizes[s.name].w}x${sizes[s.name].h} ${sizes[s.name].bytes} bytes`)
console.log(`${check ? 'check' : 'render'} ${problems.length ? 'FAILED' : 'ok'}: ${SHOTS.length} shots, ${problems.length} findings, chrome ${chromeBin ? 'yes' : 'no'}`)
process.exit(problems.length ? 1 : 0)
