// Module hooks for the node test: the desktop bundle imports '@hermes/plugin-sdk' and 'react', which
// the host injects at runtime. Here they resolve to the stand-ins beside this file.
import { fileURLToPath } from 'node:url'

const here = new URL('.', import.meta.url)
const MAP = {
  '@hermes/plugin-sdk': new URL('sdk.mjs', here).href,
  react: new URL('react.mjs', here).href
}

export async function resolve(specifier, context, next) {
  if (MAP[specifier]) return { url: MAP[specifier], shortCircuit: true }
  return next(specifier, context)
}
export const root = fileURLToPath(here)
