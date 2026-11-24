// Settings, Plugins, Mergeable (D67): the display preferences of this machine, kept in ctx.storage.
// Merge rules and backend settings are per profile in plugin.yaml config_schema; the host shows that
// form as this entry's Agent settings sub-page, so none of it is rebuilt here.
import { Input, SegmentedControl, ToggleRow, useValue } from '@hermes/plugin-sdk'
import { createElement as h, useEffect, useState } from 'react'

import { EVENTS, POLLS, SORTS } from './model.js'
import { $settings, setSettings } from './state.js'

function NumberRow({ label, value, onCommit, name }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = () => onCommit(draft)
  return h('div', { className: 'mg-setrow' },
    h('span', null, label),
    h(Input, {
      type: 'number', min: 1, className: 'mg-num', value: draft, 'aria-label': label, 'data-set': name,
      onChange: e => setDraft(e.target.value), onBlur: commit, onKeyDown: e => { if (e.key === 'Enter') commit() }
    }))
}

const ChoiceRow = ({ label, options, value, onChange, name }) =>
  h('div', { className: 'mg-setrow', 'data-set': name },
    h('span', null, label),
    h(SegmentedControl, { options, value, onChange }))

export function SettingsPage() {
  const s = useValue($settings)
  const set = patch => setSettings(cur => ({ ...cur, ...patch }))
  const toggle = (name, label, description) =>
    h(ToggleRow, { key: name, id: `mg-set-${name}`, label, description, checked: s[name], onChange: on => set({ [name]: on }) })
  return h('div', { className: 'mg-set', 'data-mg': 'settings' },
    h('div', null,
      h('h3', null, 'Display'),
      h('p', { className: 'mg-count' }, 'Kept on this machine. Merge rules and backend settings are per profile: see Agent settings.')),
    toggle('showColleagues', "Show colleagues' MRs", 'Their rows stay read-only whatever this says.'),
    toggle('showDrafts', 'Show drafts by default', 'The pane header can still switch them per session.'),
    toggle('chipRatings', 'Renovate rating chips', 'Importance, ease, escalation and audit state on the row.'),
    toggle('chipState', 'Merge state chips', 'mergeable, rebase, conflict and batch.'),
    toggle('chipOwner', 'Owner chips', 'The Renovate bot icon and a colleague name.'),
    toggle('sessionBtn', 'Session button', 'Opens the Hermes session that made the MR, in a new tab.'),
    h(NumberRow, { name: 'ageWarn', label: 'Age warn from (working days)', value: s.ageWarn, onCommit: v => set({ ageWarn: v }) }),
    h(NumberRow, { name: 'ageStale', label: 'Age stale from (working days)', value: s.ageStale, onCommit: v => set({ ageStale: v }) }),
    h(ChoiceRow, { name: 'sort', label: 'Default sort', options: SORTS.map(x => ({ id: x.id, label: x.label })), value: s.sort, onChange: id => set({ sort: id }) }),
    h(ChoiceRow, { name: 'poll', label: 'Poll interval', options: POLLS.map(x => ({ id: x.id, label: x.label })), value: s.poll, onChange: id => set({ poll: id }) }),
    h('div', null,
      h('h3', null, 'Notifications'),
      h('p', { className: 'mg-count' }, 'Native while Hermes is in the background, an in-app toast while it is focused; the OS do-not-disturb decides quiet hours. More than 3 in one poll become one summary. Only while Hermes runs; the first poll after a start never notifies.')),
    EVENTS.map(e => toggle(e.setting, e.label, e.hint)))
}
