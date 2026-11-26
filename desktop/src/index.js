// Mergeable: open GitLab merge requests as a tab stacked with Files, a full page at /mergeable, a
// sidebar row and a settings page. Data comes from this package's backend (dashboard/plugin_api.py)
// through ctx.rest. Writes go through the backend behind an SDK ConfirmDialog (merge, trivial batch);
// nothing here writes chat text, and MR titles are third-party data that never reach the chat input.
//
// Source of desktop/plugin.js. Build: `sh scripts/rebuild.sh` (esbuild, one file, SDK and react external). Every
// named import from '@hermes/plugin-sdk' must exist in the SDK of the oldest supported Hermes (v2026.9.24).

import { KEYBINDS_AREA, PALETTE_AREA, PANES_AREA, ROUTES_AREA, SIDEBAR_NAV_AREA } from '@hermes/plugin-sdk'
import * as sdk from '@hermes/plugin-sdk'
import { createElement as h } from 'react'

import { mountStyle } from 'hermes-plugin-ui-kit/theme.js'

import { CSS } from './css.js'
import { reveal } from './data.js'
import { ACTION_ID, ID, KEYBIND, NAV_DATA, NAV_ORDER, PANE_DATA, PANE_ID, PATH } from './model.js'
import { resetNotifier } from './notify.js'
import { MergeablePage } from './page.js'
import { MergeablePane } from './pane.js'
import { SettingsPage } from './settings.js'
import { bind, unbind } from './state.js'

export default {
  id: ID,
  name: 'Mergeable',
  description: 'Open GitLab merge requests with Renovate audits: a tab stacked with Files, a full page, rebase, merge and a trivial batch behind a confirm dialog.',
  register(ctx) {
    bind(ctx)
    resetNotifier()
    const unmountStyle = mountStyle(ID, CSS)
    ctx.onDispose(() => {
      unmountStyle()
      resetNotifier()
      unbind()
    })
    // One action, two surfaces: the keybind and the palette row can never drift apart.
    const show = () => reveal(PANE_ID)
    ctx.registerMany([
      { id: 'pane', area: PANES_AREA, title: 'Mergeable', data: PANE_DATA, render: () => h(MergeablePane) },
      { id: 'page', area: ROUTES_AREA, data: { path: PATH }, render: () => h(MergeablePage) },
      { id: 'nav', area: SIDEBAR_NAV_AREA, order: NAV_ORDER, data: NAV_DATA },
      { id: 'keybind', area: KEYBINDS_AREA, data: { id: ACTION_ID, label: 'Show Mergeable', defaults: [KEYBIND], run: show } },
      {
        id: 'palette',
        area: PALETTE_AREA,
        data: { id: ACTION_ID, action: ACTION_ID, label: 'Show Mergeable', keywords: ['mergeable', 'merge requests', 'gitlab', 'renovate', 'rebase'], run: show }
      }
    ])
    // Settings page: the method where the host has it, else the SDK's plugins area (read off the namespace, it is not
    // in the SDK floor), else nothing on a host that has neither.
    const render = () => h(SettingsPage)
    if (typeof ctx.registerSettingsPage === 'function') {
      ctx.registerSettingsPage({ id: 'display', title: 'Mergeable', icon: 'git-merge', render })
    } else if (typeof sdk.SETTINGS_PLUGINS_AREA === 'string') {
      ctx.register({ area: sdk.SETTINGS_PLUGINS_AREA, id: 'display', title: 'Mergeable', render, data: { icon: 'git-merge' } })
    }
  }
}
