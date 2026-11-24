// A small synchronous React stand-in for the node test: createElement, the hooks the Mergeable
// desktop half uses, context. It is not React: no scheduler, no batching beyond one microtask, no
// reconciliation (the whole tree renders again and hook state is matched by tree path). That is
// enough to run the real bundle's components, press its buttons and read what it drew.
let cur = null
export const setCurrent = c => { cur = c }

export const Fragment = Symbol('Fragment')

export function createElement(type, props, ...children) {
  const p = props ? { ...props } : {}
  if (children.length) p.children = children.length === 1 ? children[0] : children
  const key = p.key ?? null
  delete p.key
  return { $$: 'el', type, props: p, key }
}
export const cloneElement = (el, extra) => ({ ...el, props: { ...el.props, ...extra } })

export function createContext(def) {
  const ctx = { $$: 'ctx', def }
  ctx.Provider = { $$: 'provider', ctx }
  return ctx
}
export const useContext = ctx => cur.readContext(ctx)

const slot = () => {
  const c = cur
  const i = c.i++
  return [c, i]
}
export function useState(init) {
  const [c, i] = slot()
  if (!(i in c.hooks)) c.hooks[i] = { v: typeof init === 'function' ? init() : init }
  const hook = c.hooks[i]
  return [hook.v, next => {
    const v = typeof next === 'function' ? next(hook.v) : next
    if (Object.is(v, hook.v)) return
    hook.v = v
    c.root.schedule()
  }]
}
export function useRef(init) {
  const [c, i] = slot()
  if (!(i in c.hooks)) c.hooks[i] = { current: init }
  return c.hooks[i]
}
const same = (a, b) => a && b && a.length === b.length && a.every((x, k) => Object.is(x, b[k]))
export function useMemo(fn, deps) {
  const [c, i] = slot()
  const h = c.hooks[i]
  if (h && same(h.deps, deps)) return h.v
  c.hooks[i] = { deps, v: fn() }
  return c.hooks[i].v
}
export const useCallback = (fn, deps) => useMemo(() => fn, deps)
export function useEffect(fn, deps) {
  const [c, i] = slot()
  const h = c.hooks[i]
  if (h && deps && same(h.deps, deps)) return
  c.hooks[i] = { deps, cleanup: h && h.cleanup }
  c.pending.push(i)
  c.effects[i] = fn
}
export function useSyncExternalStore(subscribe, getSnapshot) {
  const [, force] = useState(0)
  const snap = getSnapshot()
  const ref = useRef(snap)
  ref.current = snap
  useEffect(() => subscribe(() => { if (!Object.is(getSnapshot(), ref.current)) force(n => n + 1) }), [subscribe])
  return snap
}
