// Renderer for the stand-in React: mount an element, get a plain tree of host nodes ({ tag, props,
// children, parent }), find nodes, click them (bubbling, stopPropagation, disabled buttons ignored),
// type into inputs, and let async work settle. Effects run after each render, cleanups on unmount.
import { Fragment, setCurrent } from './react.mjs'

export function mount(element) {
  const instances = new Map()
  let seen = new Set()
  let tree = []
  let scheduled = false
  let rendering = false
  let unmounted = false
  const stacks = new Map()

  const root = {
    schedule() {
      if (scheduled || unmounted) return
      scheduled = true
      queueMicrotask(() => { scheduled = false; if (!unmounted) render() })
    }
  }

  function readContext(ctx) {
    const s = stacks.get(ctx)
    return s && s.length ? s[s.length - 1] : ctx.def
  }

  function node(tag, props, children, parent) {
    const n = { tag, props, children: [], parent }
    n.children = children(n)
    return n
  }

  function expand(el, path, parent) {
    if (el === null || el === undefined || el === false || el === true) return []
    if (typeof el === 'string' || typeof el === 'number') return [{ tag: '#text', text: String(el), props: {}, children: [], parent }]
    if (Array.isArray(el)) return el.flatMap((c, i) => expand(c, `${path}/${c && c.key != null ? 'k' + c.key : i}`, parent))
    const { type, props } = el
    if (typeof type === 'string') {
      return [node(type, props, n => expand(props.children, path, n), parent)]
    }
    if (type === Fragment) return expand(props.children, path, parent)
    if (type && type.$$ === 'provider') {
      const s = stacks.get(type.ctx) || []
      stacks.set(type.ctx, [...s, props.value])
      try {
        return expand(props.children, path, parent)
      } finally {
        stacks.set(type.ctx, s)
      }
    }
    if (typeof type !== 'function') throw new Error(`stand-in React cannot render a ${typeof type}`)
    const key = `${path}:${type.name}`
    let inst = instances.get(key)
    if (!inst) {
      inst = { hooks: [], effects: [], pending: [], i: 0, root, readContext }
      instances.set(key, inst)
    }
    seen.add(key)
    inst.i = 0
    inst.pending = []
    setCurrent(inst)
    let out
    try {
      out = type(props)
    } finally {
      setCurrent(null)
    }
    return expand(out, key, parent)
  }

  const flushEffects = () => {
    for (const inst of instances.values()) {
      for (const i of inst.pending) {
        const hook = inst.hooks[i]
        if (typeof hook.cleanup === 'function') hook.cleanup()
        const res = inst.effects[i]()
        hook.cleanup = typeof res === 'function' ? res : undefined
      }
      inst.pending = []
    }
  }

  function render() {
    if (rendering) throw new Error('re-entrant render')
    rendering = true
    try {
      seen = new Set()
      stacks.clear()
      tree = expand(element, 'root', null)
    } finally {
      rendering = false
    }
    for (const [key, inst] of instances) {
      if (!seen.has(key)) {
        for (const hook of inst.hooks) if (hook && typeof hook.cleanup === 'function') hook.cleanup()
        instances.delete(key)
      }
    }
    flushEffects()
  }

  render()

  const walk = (nodes, out = []) => {
    for (const n of nodes) {
      out.push(n)
      walk(n.children, out)
    }
    return out
  }
  const textOf = n => (n.tag === '#text' ? n.text : n.children.map(textOf).join(''))

  const api = {
    get tree() { return tree },
    all: () => walk(tree),
    find: pred => walk(tree).find(pred) || null,
    findAll: pred => walk(tree).filter(pred),
    attr: (name, value) => walk(tree).filter(n => n.props && String(n.props[name]) === String(value)),
    text: n => textOf(n || { tag: 'root', children: tree }),
    // Click with bubbling; a disabled button gets no event, as in a browser.
    click(n) {
      if (!n) throw new Error('click on null')
      if (n.props.disabled) return false
      let stopped = false
      const ev = { target: n, preventDefault() {}, stopPropagation() { stopped = true } }
      for (let cur = n; cur && !stopped; cur = cur.parent) {
        if (typeof cur.props.onClick === 'function') cur.props.onClick({ ...ev, currentTarget: cur })
      }
      return true
    },
    type(n, value) {
      n.props.onChange({ target: { value, checked: value }, currentTarget: { value } })
    },
    unmount() {
      unmounted = true
      for (const inst of instances.values()) for (const hook of inst.hooks) if (hook && typeof hook.cleanup === 'function') hook.cleanup()
      instances.clear()
      tree = []
    },
    render
  }
  return api
}

// Let promises, microtasks and zero timers drain (the stand-in backend answers after a macrotask).
export async function settle(rounds = 6) {
  for (let i = 0; i < rounds; i++) await new Promise(r => setTimeout(r, 0))
}
