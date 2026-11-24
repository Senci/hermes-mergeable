// Stand-in Mergeable backend for the node test and the screenshot harness: the spec's API contract
// (GET /mrs, per-MR writes, /batch/trivial, /audit/all, /jobs/{id}, /status.md) over the fixture.
// It applies the validation the real routes will: 403 on an `other` MR, 404 unknown MR, 409 when
// expected_sha is not the head or the batch set differs, 422 on a bad body, 423 while another write
// job runs on the project. Which dataset answers follows the window's active connection and profile at
// call time, the way ctx.rest follows the active gateway.
import fixture from '../fixtures/mrs.json' with { type: 'json' }

const clone = v => JSON.parse(JSON.stringify(v))
const sleep = ms => new Promise(r => setTimeout(r, ms))
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

let jobSeq = 0
export const newJobId = () => `job-${++jobSeq}`

// Datasets by `${connection}|${profile}`: the fixture itself, a small other profile, another gateway.
export function makeDatasets() {
  const other = clone(fixture)
  other.profile = 'ops-box'
  other.items = other.items.slice(0, 3).map((it, i) => ({ ...it, ref: `remote/app!${100 + i}`, project: 'remote/app', project_id: 900, iid: 100 + i, title: `Remote MR ${i + 1}`, sha: `${i}`.repeat(40) }))
  const work = clone(fixture)
  work.profile = 'work'
  work.items = work.items.filter(it => it.owner === 'self').slice(0, 2)
  return { 'conn-a|default': clone(fixture), 'conn-a|work': work, 'conn-b|default': other }
}

export function makeWorld() {
  return { data: makeDatasets(), jobs: new Map(), fail: null, latency: 0, statusMode: 'string', status404: false }
}

const err = (code, message) => Object.assign(new Error(`${code}: ${message}`), { status: code })

// Markdown the real /status.md returns (grouped by project, owner, age, state, verdict, batch size).
export function statusFor(data) {
  const lines = [`# Open merge requests (${data.items.length})`, '']
  const batch = data.items.filter(i => i.trivial.in_batch).length
  lines.push(`Trivial batch: ${batch}`, '')
  const by = new Map()
  for (const it of data.items) by.set(it.project, [...(by.get(it.project) || []), it])
  for (const [project, xs] of [...by].sort()) {
    lines.push(`## ${project}`)
    for (const it of xs) lines.push(`- !${it.iid} ${it.title} (${it.owner}, ${it.age_days}d, ${it.draft ? 'draft' : it.merge_status}${it.audit ? `, audit ${it.audit.verdict}` : ''})`)
    lines.push('')
  }
  return lines.join('\n')
}

// ctx.rest of the stand-in. `log` receives every call: { method, path, body, conn, profile }.
export function makeRest(world, host, log) {
  const writeKinds = { rebase: 1, merge: 1, 'retry-pipeline': 1, ready: 1, audit: 1, 'renovate-hold': 1 }
  const startJob = (kind, refs, projects) => {
    const busy = [...world.jobs.values()].find(j => j.state === 'running' && j.projects.some(p => projects.includes(p)))
    if (busy) throw err(423, `another write job runs on ${busy.projects.join(', ')}`)
    const id = newJobId()
    world.jobs.set(id, { id, kind, state: 'running', projects, refs, steps: refs.map(ref => ({ ref, step: 'queued', state: 'running', detail: '', at: new Date().toISOString() })) })
    return { job_id: id }
  }
  return async function rest(path, opts = {}) {
    const method = opts.method || 'GET'
    const conn = host.state.connectionId.get() ?? ''
    const profile = host.state.profile.get() ?? ''
    const ds = `${conn}|${profile}`
    const body = opts.body === undefined ? undefined : clone(opts.body)
    log.push({ method, path, body, conn, profile })
    const lat = typeof world.latency === 'object' ? world.latency[ds] ?? 0 : world.latency || 0
    await sleep(lat || 1)
    if (world.fail) throw new Error(world.fail)
    const data = world.data[ds]
    if (!data) throw new Error(`404 Plugin not found on ${ds}`)
    const [route, qs = ''] = path.split('?')

    if (method === 'GET' && route === '/mrs') {
      if (new URLSearchParams(qs).get('refresh') === '1') data.generated_at = new Date().toISOString()
      return clone(data)
    }
    if (method === 'GET' && route === '/status.md') {
      if (world.statusMode === 'raw') throw new Error('Invalid JSON from /api/plugins/mergeable/status.md (status 200): # Open merge requests')
      const md = statusFor(data)
      return world.statusMode === 'object' ? { markdown: md } : md
    }
    const job = /^\/jobs\/([^/]+)$/.exec(route)
    if (method === 'GET' && job) {
      const j = world.jobs.get(decodeURIComponent(job[1]))
      if (!j) throw err(404, 'unknown job')
      return clone({ id: j.id, kind: j.kind, state: j.state, refs: j.refs, steps: j.steps })
    }
    if (method === 'GET' && route === '/jobs') return clone([...world.jobs.values()].slice(-20).map(j => ({ id: j.id, kind: j.kind, state: j.state, refs: j.refs, steps: j.steps })))

    const write = /^\/mrs\/(\d+)\/(\d+)\/([a-z-]+)$/.exec(route)
    if (method === 'POST' && write && writeKinds[write[3]]) {
      if (!body || typeof body !== 'object' || typeof body.expected_sha !== 'string' || !body.expected_sha) throw err(422, 'expected_sha is required')
      const it = data.items.find(i => i.project_id === Number(write[1]) && i.iid === Number(write[2]))
      if (!it) throw err(404, 'unknown MR')
      if (it.owner === 'other') throw err(403, 'colleague MR is read-only')
      if (body.expected_sha !== it.sha) throw err(409, 'the head moved since the row was drawn')
      const kind = write[3]
      if (kind === 'merge' && !it.can.merge) throw err(422, `not mergeable: ${it.can.reason}`)
      if (kind === 'rebase' && !(it.can.rebase || it.can.renovate_rebase)) throw err(422, `cannot rebase: ${it.can.reason}`)
      if (kind === 'renovate-hold') {
        if (!it.renovate || body.package !== it.renovate.package || !DAY_RE.test(String(body.until))) throw err(422, 'hold needs the MR package and an until date')
      }
      return startJob(kind, [it.ref], [it.project])
    }
    if (method === 'POST' && route === '/batch/trivial') {
      if (!body || !Array.isArray(body.refs) || !Array.isArray(body.shas) || body.refs.length !== body.shas.length) throw err(422, 'refs and shas are required')
      const set = data.items.filter(i => i.trivial.in_batch)
      const want = new Set(set.map(i => `${i.ref}@${i.sha}`))
      const got = new Set(body.refs.map((r, i) => `${r}@${body.shas[i]}`))
      if (want.size !== got.size || [...want].some(k => !got.has(k))) throw err(409, 'the trivial set differs from the one the dialog showed')
      return startJob('batch', body.refs, [...new Set(set.map(i => i.project))])
    }
    if (method === 'POST' && route === '/audit/all') return startJob('audit-all', data.items.filter(i => i.owner === 'renovate').map(i => i.ref), [])
    throw err(404, `${method} ${path}`)
  }
}
