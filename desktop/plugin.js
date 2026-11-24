// desktop/src/index.js
import { KEYBINDS_AREA, PALETTE_AREA, PANES_AREA, ROUTES_AREA, SIDEBAR_NAV_AREA } from "@hermes/plugin-sdk";
import * as sdk2 from "@hermes/plugin-sdk";
import { createElement as h6 } from "react";

// .build/node_modules/hermes-plugin-ui-kit/src/theme.js
var ui = (name) => `var(--ui-${name})`;
var TONE = {
  text: ui("text-primary"),
  muted: ui("text-tertiary"),
  secondary: ui("text-secondary"),
  faint: ui("text-quaternary"),
  accent: ui("accent"),
  green: ui("green"),
  red: ui("red"),
  yellow: ui("yellow"),
  blue: ui("blue"),
  purple: ui("purple")
};
var muted = { color: TONE.muted };
function mountStyle(id, css) {
  const style = document.createElement("style");
  style.dataset.plugin = id;
  style.textContent = css;
  document.head.appendChild(style);
  return () => style.remove();
}

// desktop/src/css.js
var CSS2 = `
.mg{--mg-old:color-mix(in srgb,var(--ui-yellow) 80%,var(--ui-text-primary));--mg-stale:color-mix(in srgb,var(--ui-orange,#db704b) 80%,var(--ui-text-primary));
 display:flex;flex-direction:column;height:100%;min-height:0;font-size:12px;line-height:1.45;color:var(--ui-text-primary)}
.mg *{box-sizing:border-box}
.mg button{font:inherit}
.mg-head{display:flex;align-items:center;gap:4px;padding:8px 8px 4px 12px;flex-wrap:wrap}
.mg-head .mg-grow{flex:1 1 auto;min-width:0}
.mg-title{font-size:13px;font-weight:600}
.mg.wide .mg-title{font-size:17px}
.mg.wide .mg-head{padding:14px 20px 4px}
.mg-count{color:var(--ui-text-tertiary);font-size:12px}
.mg-sub{color:var(--ui-text-tertiary);font-size:11.5px;padding:0 12px 6px}
.mg.wide .mg-sub{padding:0 20px 8px}
.mg-bar{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:2px 8px 6px 12px;flex-wrap:wrap}
.mg-chips{display:flex;flex-wrap:wrap;gap:4px;padding:2px 12px 6px}
.mg-chip{border:0;border-radius:2.5px;background:var(--ui-bg-quaternary);color:var(--ui-text-secondary);padding:2px 8px;font-size:11px;cursor:pointer;white-space:nowrap}
.mg-chip:hover{background:var(--chrome-action-hover)}
.mg-chip[aria-pressed=true]{color:var(--ui-text-primary);box-shadow:inset 0 0 0 1px var(--ui-stroke-secondary);background:color-mix(in srgb,var(--ui-accent) 12%,transparent)}
.mg-chip .mg-n{color:var(--ui-text-tertiary);margin-left:3px}
.mg-drafts{display:inline-flex;align-items:center;gap:4px;color:var(--ui-text-tertiary);font-size:11.5px;cursor:pointer}
.mg-banner{margin:4px 12px;padding:6px 8px;border-radius:6px;font-size:11.5px;
 border:1px solid color-mix(in srgb,var(--ui-yellow) 55%,transparent);background:color-mix(in srgb,var(--ui-yellow) 12%,transparent)}
.mg-banner.bad{border-color:color-mix(in srgb,var(--ui-red) 55%,transparent);background:color-mix(in srgb,var(--ui-red) 12%,transparent)}
.mg.wide .mg-banner{margin-left:20px;margin-right:20px}
.mg-scroll{flex:1 1 auto;min-height:0;overflow:auto;border-top:1px solid var(--ui-stroke-tertiary)}
.mg.wide .mg-scroll{padding:0 20px 28px;border-top:0;overflow:auto}
.mg-group{position:sticky;top:0;z-index:1;background:var(--ui-bg-elevated,var(--ui-bg-chrome));padding:6px 12px 3px;font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;
 color:var(--ui-text-tertiary);border-bottom:1px solid var(--ui-stroke-tertiary)}
.mg-row{padding:6px 6px 6px 12px;border-bottom:1px solid var(--ui-stroke-tertiary);cursor:pointer;outline:none}
.mg-row:hover,.mg-row:focus-visible{background:var(--ui-row-hover-background)}
.mg-row.open{background:color-mix(in srgb,var(--ui-accent) 6%,transparent)}
.mg-l1{display:flex;align-items:center;gap:6px;min-width:0}
.mg-ttl{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mg-age{font-size:10.5px;color:var(--ui-text-tertiary);font-variant-numeric:tabular-nums;white-space:nowrap}
.mg-age.old{color:var(--mg-old)}.mg-age.stale{color:var(--mg-stale)}
.mg-l2{display:flex;align-items:center;gap:4px;margin-top:3px;min-width:0}
.mg-ref{font:10.5px var(--font-mono,ui-monospace,monospace);color:var(--ui-text-tertiary);white-space:nowrap}
.mg-tags{display:flex;flex-wrap:wrap;gap:3px;flex:1 1 auto;min-width:0}
.mg-acts{display:flex;flex:none;gap:0}
.mg-cluster{display:flex;flex-wrap:wrap;align-items:center;gap:4px}
.mg-tags [data-chip]{flex:none}
.mg-tw{display:inline-flex}
.mg-dim{opacity:.55}
.mg-dot{display:inline-block;width:8px;height:8px;border-radius:50%;flex:none;background:var(--ui-text-quaternary)}
.mg-dot.success{background:var(--ui-green)}.mg-dot.failed{background:var(--ui-red)}.mg-dot.running{background:var(--ui-blue)}
.mg-l3{display:flex;align-items:center;gap:4px;margin-top:3px;font-size:11px;color:var(--ui-text-secondary)}
.mg-l3.failed{color:var(--ui-red)}
.mg-detail{margin:6px 0 2px;padding:8px 10px;border:1px solid var(--ui-stroke-tertiary);border-radius:4px;font-size:12px;cursor:default;background:var(--ui-bg-quaternary)}
.mg-detail dl,.mg-kv{display:grid;grid-template-columns:86px minmax(0,1fr);gap:2px 8px;margin:0}
.mg-detail dt,.mg-kv .k{color:var(--ui-text-tertiary)}
.mg-detail dd,.mg-kv .v{margin:0;min-width:0;overflow-wrap:anywhere;color:var(--ui-text-secondary)}
.mg-kv{grid-template-columns:96px minmax(0,1fr);margin:6px 0}
.mg-mono{font:11.5px var(--font-mono,ui-monospace,monospace)}
.mg-job{display:flex;align-items:center;gap:6px;margin:4px 12px;padding:4px 6px 4px 8px;border-radius:6px;font-size:11.5px;
 border:1px solid var(--ui-stroke-secondary);background:var(--ui-bg-quaternary)}
.mg-job.failed,.mg-job.stopped{border-color:color-mix(in srgb,var(--ui-red) 55%,transparent)}
.mg-job.done{border-color:color-mix(in srgb,var(--ui-green) 55%,transparent)}
.mg-job .mg-grow{flex:1 1 auto;min-width:0;overflow-wrap:anywhere}
.mg.wide .mg-job{margin-left:20px;margin-right:20px}
.mg-empty{display:grid;place-items:center;text-align:center;padding:28px 12px}
.mg-note{color:var(--ui-text-tertiary);font-size:11.5px;margin-top:8px;max-width:40ch}
.mg-tablewrap{overflow-x:auto}
.mg-tbl{width:100%;min-width:980px;border-collapse:collapse;font-size:12px}
.mg-tbl th{color:var(--ui-text-tertiary);font-weight:500;font-size:11px;text-align:left;padding:5px 8px;border-bottom:1px solid var(--ui-stroke-tertiary)}
.mg-tbl td{text-align:left;vertical-align:top;padding:5px 8px;border-bottom:1px solid var(--ui-stroke-tertiary);overflow-wrap:anywhere}
.mg-tbl td.nw{white-space:nowrap;overflow-wrap:normal}
.mg-tbl tr.hit{background:color-mix(in srgb,var(--ui-accent) 8%,transparent)}
.mg-link{color:var(--ui-accent);text-decoration:none;cursor:pointer;background:none;border:0;padding:0}
.mg-link:hover{text-decoration:underline}
.mg-h2{font-size:14px;font-weight:600;margin:28px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--ui-stroke-tertiary)}
.mg-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:12px}
.mg-card{border:1px solid var(--ui-stroke-secondary);border-radius:6px;padding:12px 14px;min-width:0}
.mg-card.hit{border-color:var(--ui-accent)}
.mg-card h3{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12.5px;font-weight:600;margin:0 0 6px}
.mg-runs{font-size:11px;color:var(--ui-text-tertiary);margin-top:6px}
.mg-cardacts{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.mg-warnbox{margin:8px 0;padding:6px 10px;border-radius:6px;font-size:12px;
 border:1px solid color-mix(in srgb,var(--ui-red) 30%,transparent);background:color-mix(in srgb,var(--ui-red) 10%,transparent);color:var(--ui-red)}
.mg-set{display:grid;gap:12px;max-width:720px}
.mg-setrow{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid var(--ui-stroke-tertiary);font-size:12.5px}
.mg-setrow .mg-num{width:84px}
.mg-hold{display:grid;gap:6px;margin-top:8px}
.mg-hold input{width:160px}
.mg-plan{width:100%;border-collapse:collapse;font-size:12px;margin-top:6px}
.mg-plan th,.mg-plan td{text-align:left;padding:3px 6px;border-bottom:1px solid var(--ui-stroke-tertiary);vertical-align:top}
.mg-plan td:last-child,.mg-plan th:last-child{white-space:nowrap;text-align:right}
.mg-plan th{color:var(--ui-text-tertiary);font-weight:500;font-size:11px}
`;

// desktop/src/data.js
import { host as host2, queryClient as queryClient2, useValue as useValue2 } from "@hermes/plugin-sdk";
import { useRef } from "react";

// .build/node_modules/hermes-plugin-ui-kit/src/live.js
import { atom, host, queryClient, useQuery, useValue } from "@hermes/plugin-sdk";
var POLL_FLOOR_MS = 15e3;
var LIVE_SAFETY_MS = 6e4;
function useBackend() {
  return { conn: useValue(host.state.connectionId) ?? "", profile: useValue(host.state.profile) ?? "" };
}
function useLiveQuery({ live = false, pollMs: pollMs2 = POLL_FLOOR_MS, liveMs = LIVE_SAFETY_MS, ...query }) {
  return useQuery({ ...query, refetchInterval: live ? liveMs : pollMs2 });
}

// desktop/src/model.js
var ID = "mergeable";
var PATH = "/mergeable";
var PANE_ID = `${ID}:pane`;
var ACTION_ID = "mergeable.reveal";
var KEYBIND = "mod+alt+m";
var NAV_ORDER = 54;
var STALE_MS = 15e3;
var JOB_POLL_MS = 3e3;
var SETTINGS_HOST_FALLBACK = "/settings";
var PANE_DATA = {
  placement: "right",
  dock: { pane: "files", pos: "center" },
  collapsible: true,
  hideOnly: true,
  width: "340px",
  minWidth: "15rem",
  maxWidth: "36rem",
  tabTitleText: () => "Mergeable"
};
var NAV_DATA = { path: PATH, label: "Mergeable", codicon: "git-merge" };
var HIDE_NOTE = "The Mergeable tab only hides: use its tab menu or Ctrl+K (Mergeable) to hide or show it, and Ctrl+J to fold the whole Files zone with it. The plugin stays on.";
var FILTERS = [
  { id: "all", label: "All" },
  { id: "mine", label: "Mine" },
  { id: "renovate", label: "Renovate" },
  { id: "colleagues", label: "Colleagues" }
];
var SORTS = [
  { id: "urgency", label: "Urgency" },
  { id: "age", label: "Age" },
  { id: "project", label: "Project" }
];
var POLLS = [
  { id: "60", label: "60 s" },
  { id: "300", label: "5 min" },
  { id: "0", label: "Manual" }
];
var CONFLICT_ICON = "git-pull-request-new-changes";
var CHIP_ICON = {
  draft: "git-pull-request-draft",
  renovate: "robot",
  colleague: "person",
  importance: "flame",
  ease: "tools",
  escalated: "sparkle",
  unsure: "question",
  running: "loading",
  stale: "history",
  error: "error",
  batch: "smiley",
  mergeable: "git-pull-request-done",
  rebase: "git-pull-request-create",
  conflict: CONFLICT_ICON,
  noci: "workspace-untrusted"
};
var EVENTS = [
  { id: "bump", setting: "notifyBump", kind: "warning", label: "Renovate bump rated high or critical", hint: "A new audit rates a bump high or critical.", summary: "bumps rated high or critical" },
  { id: "audit", setting: "notifyAudit", kind: "warning", label: "Audit says hold or needs change", hint: "The verdict of a Renovate audit is hold or needs_change.", summary: "audits that say hold or needs change" },
  { id: "pipeline-failed", setting: "notifyPipelineFailed", kind: "error", label: "Pipeline failed on my MR", hint: "The head pipeline of one of your own MRs turns failed.", summary: "failed pipelines" },
  { id: "pipeline-green", setting: "notifyPipelineGreen", kind: "success", label: "Pipeline green after my rebase", hint: "An MR you rebased here has a green pipeline on its new head.", summary: "green pipelines after a rebase" },
  { id: "job", setting: "notifyJob", kind: "success", label: "Merge or batch job finished or stopped", hint: "A merge or trivial batch job ends, also when it fails or stops.", summary: "merge or batch jobs ended" },
  { id: "comment", setting: "notifyComment", kind: "info", label: "New comment on my MR from someone else", hint: "Needs the backend that reports last_note; bots and system notes do not count.", summary: "new comments" },
  { id: "review", setting: "notifyReview", kind: "info", label: "A colleague asks me to review", hint: "Needs the backend that reports reviewers.", summary: "review requests" }
];
var SUMMARY_ABOVE = 3;
var KEEP_KEYS = 400;
var STORE = { settings: "display", notified: "notified" };
var DEFAULT_SETTINGS = {
  showColleagues: true,
  showDrafts: true,
  chipRatings: true,
  chipState: true,
  chipOwner: true,
  sessionBtn: true,
  ageWarn: 1,
  ageStale: 3,
  sort: "urgency",
  poll: "60",
  ...Object.fromEntries(EVENTS.map((e) => [e.setting, true]))
};
var SESSION_MIN_SCORE = 5;
var SESSION_CREATED_SCORE = 10;
var IMPORTANCE_ORDER = { critical: 0, high: 1, medium: 2, low: 3, none: 4 };
var IMPORTANCE_TONE = { critical: "destructive", high: "destructive", medium: "warn", low: "muted", none: "muted" };
var EASE_TONE = { trivial: "success", easy: "success", medium: "warn", hard: "destructive" };
var VERDICT_TONE = { merge: "success", merge_with_followup: "success", needs_change: "warn", hold: "destructive" };
var WRITE_PATH = {
  rebase: "rebase",
  merge: "merge",
  retry: "retry-pipeline",
  ready: "ready",
  audit: "audit",
  hold: "renovate-hold"
};
var DONE_STATES = ["done", "failed", "stopped"];

// desktop/src/logic.js
var num = (n) => Number.isFinite(n) ? n : 0;
var plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
var shortOf = (project) => String(project || "").split("/").pop();
var refLabel = (it) => `${shortOf(it.project)}!${it.iid}`;
var isMine = (it) => it.owner !== "other";
var isRenovate = (it) => it.owner === "renovate";
var hasCi = (it) => !!it.pipeline;
var auditOf = (it) => it.audit && typeof it.audit === "object" ? it.audit : null;
var inBatch = (it) => !!(it.trivial && it.trivial.in_batch);
var modelFamily = (model) => {
  const m = /^(?:claude-)?([a-z]+)/.exec(String(model || ""));
  return m ? m[1] : "opus";
};
function ageLabel(d) {
  if (d === null || d === void 0) return "";
  if (d < 1) return "today";
  if (d < 14) return `${d}d`;
  if (d < 60) return `${Math.round(d / 7)}w`;
  return `${Math.round(d / 30)}mo`;
}
var ageClass = (wd, s = DEFAULT_SETTINGS) => wd >= s.ageStale ? "stale" : wd >= s.ageWarn ? "old" : "";
var DAY_MS = 864e5;
var pad = (n) => String(n).padStart(2, "0");
var isoOf = (ms) => new Date(ms).toISOString().slice(0, 10);
var msOf = (iso) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
var addDays = (iso, n) => isoOf(msOf(iso) + n * DAY_MS);
function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h7 = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h7 - k) % 7;
  const m = Math.floor((a + 11 * h7 + 22 * l) / 451);
  const month = Math.floor((h7 + l - 7 * m + 114) / 31);
  const day = (h7 + l - 7 * m + 114) % 31 + 1;
  return `${year}-${pad(month)}-${pad(day)}`;
}
var holidayCache = /* @__PURE__ */ new Map();
function hamburgHolidays(year) {
  if (holidayCache.has(year)) return holidayCache.get(year);
  const easter = easterSunday(year);
  const list = [
    { date: `${year}-01-01`, name: "New Year" },
    { date: addDays(easter, -2), name: "Good Friday" },
    { date: addDays(easter, 1), name: "Easter Monday" },
    { date: `${year}-05-01`, name: "Labour Day" },
    { date: addDays(easter, 39), name: "Ascension" },
    { date: addDays(easter, 50), name: "Whit Monday" },
    { date: `${year}-10-03`, name: "German Unity Day" },
    { date: `${year}-10-31`, name: "Reformation Day" },
    { date: `${year}-12-25`, name: "Christmas Day" },
    { date: `${year}-12-26`, name: "Boxing Day" }
  ].sort((x, y) => x.date < y.date ? -1 : 1);
  holidayCache.set(year, list);
  return list;
}
var holidayOn = (iso) => hamburgHolidays(Number(iso.slice(0, 4))).find((h7) => h7.date === iso) || null;
function isWorkingDay(iso) {
  const dow = new Date(msOf(iso)).getUTCDay();
  return dow !== 0 && dow !== 6 && !holidayOn(iso);
}
var berlin = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" });
function berlinDay(when) {
  const d = when instanceof Date ? when : new Date(when);
  return Number.isNaN(d.getTime()) ? null : berlin.format(d);
}
function workingDaysBetween(from, to) {
  const a = berlinDay(from);
  const b = berlinDay(to);
  if (!a || !b || b <= a) return 0;
  let n = 0;
  for (let day = addDays(a, 1); day <= b; day = addDays(day, 1)) if (isWorkingDay(day)) n++;
  return n;
}
var workingAge = (it, now) => workingDaysBetween(it.created_at, Number.isNaN(new Date(now).getTime()) ? /* @__PURE__ */ new Date() : now);
function ageTip(it, wd) {
  return `Opened ${berlinDay(it.created_at) || it.created_at}, ${plural(num(it.age_days), "day", "days")} ago, ${plural(wd, "working day", "working days")}`;
}
function sessionKind(session) {
  if (!session || !session.id || !(num(session.score) >= SESSION_MIN_SCORE)) return null;
  return session.score >= SESSION_CREATED_SCORE ? "created" : "mentioned";
}
function urgency(it) {
  let s = 50;
  if (it.draft) s += 40;
  if (!isMine(it)) s += 30;
  if (it.merge_status === "mergeable") s -= 20;
  const a = auditOf(it);
  if (a) s -= (4 - (IMPORTANCE_ORDER[a.importance] ?? 4)) * 6;
  if (it.merge_status === "need_rebase") s -= 5;
  return s;
}
var SORT_KEYS = {
  urgency: (it) => [urgency(it), -num(it.age_days)],
  age: (it) => [-num(it.age_days), 0],
  project: (it) => [it.project, num(it.iid)]
};
function sortItems(items, sort) {
  const key = SORT_KEYS[sort] || SORT_KEYS.urgency;
  return items.slice().sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    return ka[0] < kb[0] ? -1 : ka[0] > kb[0] ? 1 : ka[1] - kb[1];
  });
}
function filterCounts(items) {
  return {
    all: items.length,
    mine: items.filter((it) => it.owner === "self").length,
    renovate: items.filter(isRenovate).length,
    colleagues: items.filter((it) => it.owner === "other").length
  };
}
function filterItems(items, view, s = DEFAULT_SETTINGS) {
  let xs = items.filter((it) => (view.drafts || !it.draft) && (s.showColleagues || it.owner !== "other"));
  if (view.filter === "mine") xs = xs.filter((it) => it.owner === "self");
  if (view.filter === "renovate") xs = xs.filter(isRenovate);
  if (view.filter === "colleagues") xs = xs.filter((it) => it.owner === "other");
  return xs;
}
var paneItems = (items, view, s) => sortItems(filterItems(items, view, s), view.sort);
var tableItems = (items) => items.slice().sort((a, b) => urgency(a) - urgency(b) || num(b.age_days) - num(a.age_days));
function normalizeView(raw, s = DEFAULT_SETTINGS) {
  const filter = raw && FILTERS.some((f) => f.id === raw.filter) ? raw.filter : "all";
  const sort = raw && SORTS.some((x) => x.id === raw.sort) ? raw.sort : s.sort;
  return { filter, sort, drafts: raw && typeof raw.drafts === "boolean" ? raw.drafts : s.showDrafts };
}
function summarize(items) {
  const c = { self: 0, renovate: 0, other: 0 };
  for (const it of items) c[it.owner] = (c[it.owner] || 0) + 1;
  return {
    count: items.length,
    projects: new Set(items.map((it) => it.project)).size,
    mine: c.self,
    renovate: c.renovate,
    colleagues: c.other,
    drafts: items.filter((it) => it.draft).length,
    mergeable: items.filter((it) => !it.draft && it.merge_status === "mergeable").length,
    rebase: items.filter((it) => !it.draft && it.merge_status === "need_rebase").length
  };
}
var chip = (key, group, tone, label, name, why, { iconKey, ...extra } = {}) => ({
  key,
  group,
  tone,
  label,
  name,
  icon: CHIP_ICON[iconKey || key],
  tip: why ? `${name}: ${why}` : name,
  ...extra
});
function chipsOf(it, s = DEFAULT_SETTINGS) {
  const out = [];
  const a = auditOf(it);
  if (it.draft) out.push(chip("draft", "state", "muted", "draft", "Draft", "Draft MR, not mergeable until marked ready"));
  if (s.chipOwner && it.owner === "renovate") out.push(chip("owner", "owner", "default", "", "Renovate", "Renovate bot", { iconKey: "renovate" }));
  if (s.chipOwner && it.owner === "other") out.push(chip("owner", "owner", "outline", it.author, it.author, "Colleague's MR, read-only", { iconKey: "colleague" }));
  if (a && s.chipRatings) {
    out.push(chip("importance", "audit", IMPORTANCE_TONE[a.importance] || "muted", a.importance, `Importance ${a.importance}`, a.importance_reason));
    out.push(chip("ease", "audit", EASE_TONE[a.ease] || "muted", a.ease, `Ease ${a.ease}`, a.ease_reason));
    if (a.escalated) out.push(chip("escalated", "audit", "warn", modelFamily(a.model), `Escalated to ${modelFamily(a.model)}`, "The first model was not sure, a stronger one decided"));
    if (a.confidence !== "sure") out.push(chip("unsure", "audit", "outline", "?", "Not sure", a.not_sure_reason));
  }
  if (isRenovate(it) && s.chipRatings) {
    const st = it.audit_state;
    if (st === "queued" || st === "running") {
      out.push(chip("audit-state", "audit", "muted", st === "queued" ? "audit queued" : "auditing", st === "queued" ? "Audit queued" : "Auditing", st === "queued" ? "Waiting for its turn" : "The audit is running now", { iconKey: "running", spinning: true }));
    } else if (st === "stale") {
      out.push(chip("audit-state", "audit", "warn", "audit stale", "Audit stale", "The MR head moved since this audit", { iconKey: "stale" }));
    } else if (st === "error") {
      out.push(chip("audit-state", "audit", "destructive", "audit error", "Audit error", "The last audit run failed", { iconKey: "error" }));
    }
  }
  if (!it.draft && s.chipState) {
    if (inBatch(it)) out.push(chip("state", "state", "success", "batch", "In the trivial batch", "Merged together by the header Trivial button", { iconKey: "batch" }));
    else if (it.merge_status === "mergeable") out.push(chip("state", "state", "success", "mergeable", "Mergeable", "Ready to merge", { iconKey: "mergeable" }));
    if (it.merge_status === "need_rebase") out.push(chip("rebase", "state", "warn", "rebase", "Needs rebase", "Behind the target branch, needs one rebase"));
    else if (it.has_conflicts) out.push(chip("conflict", "state", "destructive", "conflict", "Conflict", "Merge conflict, fix by hand"));
  }
  if (!hasCi(it)) out.push(chip("noci", "state", "outline", "no CI", "No CI", "Project has no pipeline for this MR"));
  return out;
}
function reasonFor(it, action) {
  const r = it.can && it.can.reason;
  const text = typeof r === "string" ? r : r && typeof r === "object" ? r[action] || r.default || "" : "";
  return text || "Not available for this MR";
}
var COLLEAGUE = "Colleague's MR";
function rebaseAbility(it) {
  if (it.owner === "other") return { ok: false, why: COLLEAGUE };
  const can = it.can || {};
  const ok = isRenovate(it) ? can.renovate_rebase === true : can.rebase === true;
  if (!ok) return { ok, why: it.can ? reasonFor(it, "rebase") : "The backend sent no action state" };
  return { ok, why: isRenovate(it) ? "Ask Renovate to rebase (ticks its rebase box)" : "Rebase once on the server (starts one pipeline)" };
}
function mergeAbility(it) {
  if (it.owner === "other") return { ok: false, why: COLLEAGUE };
  const ok = !!(it.can && it.can.merge === true);
  if (!ok) return { ok, why: it.can ? reasonFor(it, "merge") : "The backend sent no action state" };
  return { ok, why: `Merge into ${it.target_branch}` };
}
function sessionTip(it) {
  const s = it.session;
  const kind = sessionKind(s);
  if (!kind) return "No session found for this branch";
  return `${kind === "created" ? "Created in" : "Mentioned in"}: ${s.title || s.id} (${s.profile})`;
}
var glabCommand = (it, host6) => `glab mr view ${it.iid} -R ${host6}/${it.project}`;
var holdDefaultUntil = (now = /* @__PURE__ */ new Date(), days2 = 30) => {
  const d = new Date(now.getTime() + days2 * 864e5);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
};
var isIsoDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v)) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
function menuItems(it) {
  const other = it.owner === "other";
  const mine = isMine(it);
  const failed = !!(it.pipeline && it.pipeline.status === "failed");
  const renov = isRenovate(it);
  return [
    { id: "open", icon: "link-external", label: "Open in GitLab", enabled: !!it.web_url, why: "No web address" },
    { id: "pipeline", icon: "run-all", label: "Open pipeline", enabled: !!(it.pipeline && it.pipeline.url), why: "No pipeline" },
    { id: "retry", icon: "debug-rerun", label: "Retry failed pipeline", enabled: failed && mine, why: other ? COLLEAGUE : "Only for a failed pipeline on your MR" },
    null,
    { id: "copy-branch", icon: "copy", label: "Copy branch name", enabled: !!it.source_branch, why: "No branch" },
    { id: "copy-glab", icon: "copy", label: "Copy glab view command", enabled: true, why: "" },
    null,
    { id: "ready", icon: "check", label: "Mark ready", enabled: !!(it.draft && it.owner === "self"), why: other ? COLLEAGUE : "Only for your own draft" },
    { id: "audit", icon: "debug-rerun", label: "Re-run audit", enabled: renov, why: "Only for a Renovate MR" },
    { id: "hold", icon: "shield", label: "Add Renovate hold rule", enabled: renov && !other && !!(it.renovate && it.renovate.package), why: other ? COLLEAGUE : "Only for a Renovate MR" }
  ];
}
function trivialPlan(items) {
  const set = items.filter(inBatch);
  const byProject = /* @__PURE__ */ new Map();
  for (const it of set) byProject.set(it.project, [...byProject.get(it.project) || [], it]);
  const steps = [];
  for (const project of [...byProject.keys()].sort()) {
    const xs = byProject.get(project).sort((a, b) => (a.merge_status === "mergeable" ? 0 : 1) - (b.merge_status === "mergeable" ? 0 : 1) || a.iid - b.iid);
    xs.forEach((it, i) => {
      const rebase = it.merge_status === "need_rebase" || i > 0 && it.merge_method === "ff";
      steps.push({ item: it, rebase, pipelines: rebase && hasCi(it) ? 1 : 0 });
    });
  }
  const missed = items.filter((it) => !it.draft && isMine(it) && !inBatch(it)).map((it) => ({ item: it, why: it.trivial && it.trivial.miss || "" }));
  return {
    steps,
    missed,
    rebases: steps.filter((s) => s.rebase).length,
    pipelines: steps.reduce((n, s) => n + s.pipelines, 0),
    projects: new Set(steps.map((s) => s.item.project)).size
  };
}
var trivialCount = (items) => items.filter(inBatch).length;
var isDone = (job) => !!job && DONE_STATES.includes(job.state);
function stepFor(job, ref) {
  const steps = job && job.steps || [];
  for (let i = steps.length - 1; i >= 0; i--) if (steps[i].ref === ref) return steps[i];
  return null;
}
function jobLine(job) {
  const steps = job && job.steps || [];
  const last = steps[steps.length - 1];
  const where2 = last ? `${last.ref ? `${last.ref}: ` : ""}${last.step}${last.detail ? `, ${last.detail}` : ""}` : "starting";
  return `${job.kind} ${job.state}: ${where2}`;
}
var isBot = (name) => /(^|[_.-])bot($|[_.-])|^renovate/i.test(String(name || ""));
var clip = (text, n = 160) => String(text || "").length > n ? `${String(text).slice(0, n - 3)}...` : String(text || "");
var isLoud = (a) => !!a && ["high", "critical"].includes(a.importance);
var jobRefs = (job) => [.../* @__PURE__ */ new Set([...job && job.refs || [], ...(job && job.steps || []).map((s) => s.ref).filter(Boolean)])];
function rebasedRefs(jobs) {
  const out = /* @__PURE__ */ new Set();
  for (const j of jobs || []) for (const s of j.steps || []) if (s.step === "rebase" && s.state === "done" && s.ref) out.add(s.ref);
  return out;
}
function mrEvents(prev, items, { user = "", rebased = /* @__PURE__ */ new Set() } = {}) {
  if (!prev) return [];
  const before = new Map(prev.map((it) => [it.ref, it]));
  const out = [];
  const add = (type, it, key, title, body, silent) => out.push({ type, ref: it.ref, key: `${it.ref}:${key}`, title, body: clip(body), silent });
  for (const it of items) {
    const old = before.get(it.ref);
    const a = auditOf(it);
    const was = old ? auditOf(old) : null;
    const name = `${refLabel(it)} ${it.title}`;
    if (isRenovate(it) && a) {
      const sha = a.sha || it.sha;
      const sameSha = !!was && (was.sha || old.sha) === sha;
      if (isLoud(a) && !(isLoud(was) && sameSha)) add("bump", it, `bump:${sha}`, `${refLabel(it)} rated ${a.importance}`, `${it.title}: ${a.summary}`, false);
      if (["hold", "needs_change"].includes(a.verdict) && !(was && was.verdict === a.verdict && sameSha)) {
        add("audit", it, `audit:${sha}`, `Audit says ${a.verdict.replace("_", " ")}: ${refLabel(it)}`, `${it.title}: ${a.summary}`, !isLoud(a));
      }
    }
    const st = it.pipeline && it.pipeline.status;
    const wasSt = old && old.pipeline && old.pipeline.status;
    const moved = !old || old.sha !== it.sha;
    if (it.owner === "self" && st === "failed" && (wasSt !== "failed" || moved)) add("pipeline-failed", it, `pipeline-failed:${it.sha}`, `Pipeline failed: ${refLabel(it)}`, it.title, false);
    if (isMine(it) && st === "success" && (wasSt !== "success" || moved) && rebased.has(it.ref)) add("pipeline-green", it, `pipeline-green:${it.sha}`, `Pipeline green after your rebase: ${refLabel(it)}`, it.title, true);
    const note = it.last_note;
    if (it.owner === "self" && old && note && old.last_note !== void 0 && it.last_note !== void 0 && note.author !== user && !isBot(note.author) && !(old.last_note && old.last_note.at === note.at)) {
      add("comment", it, `comment:${note.at}`, `New comment from ${note.author}`, name, true);
    }
    if (it.owner === "other" && user && Array.isArray(it.reviewers) && it.reviewers.includes(user) && (!old || Array.isArray(old.reviewers) && !old.reviewers.includes(user))) {
      add("review", it, `review:${it.sha}`, `${it.author} asks for your review`, name, true);
    }
  }
  return out;
}
var jobKey = (job) => `job:${job.id}:${job.state}`;
var watched = (job) => job && ["merge", "batch"].includes(job.kind) && DONE_STATES.includes(job.state);
var endedJobKeys = (jobs) => (jobs || []).filter(watched).map(jobKey);
function jobEvents(jobs) {
  return (jobs || []).filter(watched).map((job) => {
    const refs = jobRefs(job);
    const last = (job.steps || []).filter((s) => s.detail).pop();
    const what = job.kind === "batch" ? "Trivial batch" : "Merge";
    const where2 = refs.length > 3 ? `${refs.slice(0, 3).join(", ")} and ${refs.length - 3} more` : refs.join(", ");
    return { type: "job", ref: refs[0] || "", jobId: job.id, key: jobKey(job), title: `${what} ${job.state}${job.state === "done" ? "" : ", check the MRs"}`, body: clip(`${where2}${last ? `: ${last.detail}` : ""}`), silent: job.state === "done" };
  });
}
function takeFresh(events, notified, now = Date.now()) {
  const seen = { ...notified && typeof notified === "object" ? notified : {} };
  const fresh = [];
  for (const e of events) {
    if (e.key in seen) continue;
    seen[e.key] = now;
    fresh.push(e);
  }
  const keys = Object.keys(seen);
  if (keys.length > KEEP_KEYS) for (const k of keys.sort((x, y) => seen[y] - seen[x]).slice(KEEP_KEYS)) delete seen[k];
  return { fresh, notified: seen };
}
function messagesFor(events) {
  if (events.length <= SUMMARY_ABOVE) return events.map((e) => ({ ...e, kind: EVENTS.find((x) => x.id === e.type).kind }));
  const lines = EVENTS.map((x) => [x, events.filter((e) => e.type === x.id).length]).filter(([, n]) => n).map(([x, n]) => `${n} ${x.summary}`);
  const worst = ["error", "warning", "info", "success"].find((k) => events.some((e) => EVENTS.find((x) => x.id === e.type).kind === k));
  return [{ type: "summary", ref: "", key: "", title: `${events.length} new events`, body: lines.join("\n"), silent: events.every((e) => e.silent), kind: worst }];
}
var bool = (v, d) => typeof v === "boolean" ? v : d;
var days = (v, d) => Number.isFinite(Number(v)) && Number(v) >= 1 ? Math.floor(Number(v)) : d;
function normalizeSettings(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const d = DEFAULT_SETTINGS;
  const old = Number(r.ageWarn) === 30 && Number(r.ageStale) === 90;
  const warn = old ? d.ageWarn : days(r.ageWarn, d.ageWarn);
  return {
    showColleagues: bool(r.showColleagues, d.showColleagues),
    showDrafts: bool(r.showDrafts, d.showDrafts),
    chipRatings: bool(r.chipRatings, d.chipRatings),
    chipState: bool(r.chipState, d.chipState),
    chipOwner: bool(r.chipOwner, d.chipOwner),
    sessionBtn: bool(r.sessionBtn, d.sessionBtn),
    ageWarn: warn,
    ageStale: Math.max(warn, old ? d.ageStale : days(r.ageStale, d.ageStale)),
    sort: SORTS.some((x) => x.id === r.sort) ? r.sort : d.sort,
    poll: POLLS.some((x) => x.id === String(r.poll)) ? String(r.poll) : d.poll,
    ...Object.fromEntries(EVENTS.map((e) => [e.setting, bool(r[e.setting], d[e.setting])]))
  };
}
var pollMs = (s) => Number(s.poll) > 0 ? Number(s.poll) * 1e3 : false;
function statusMarkdown(data) {
  const items = data && data.items || [];
  const s = summarize(items);
  const lines = [`# Open merge requests (${s.count})`, ""];
  lines.push(`${plural(s.count, "MR", "MRs")} in ${plural(s.projects, "project", "projects")}: ${s.mine} mine, ${s.renovate} Renovate, ${s.colleagues} colleagues. ${s.mergeable} mergeable now, ${s.rebase} need a rebase, ${s.drafts} drafts. Trivial batch: ${trivialCount(items)}.`, "");
  const byProject = /* @__PURE__ */ new Map();
  for (const it of sortItems(items, "project")) byProject.set(it.project, [...byProject.get(it.project) || [], it]);
  for (const [project, xs] of byProject) {
    lines.push(`## ${project}`);
    for (const it of xs) {
      const a = auditOf(it);
      const who = it.owner === "self" ? "mine" : it.owner === "renovate" ? "Renovate" : it.author;
      const state = it.draft ? "draft" : it.merge_status;
      lines.push(`- !${it.iid} ${it.title} (${who}, ${ageLabel(it.age_days)}, ${state}${a ? `, audit ${a.verdict}` : ""}${inBatch(it) ? ", trivial" : ""})`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
var fmtUtc = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso || "") : `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
};
var fmtClock = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

// desktop/src/state.js
import { atom as atom2 } from "@hermes/plugin-sdk";
var api = null;
var $settings = null;
var $view = null;
var $jobs = null;
var $jobData = null;
var $open = null;
function bind(ctx) {
  api = ctx;
  $settings = atom2(normalizeSettings(ctx.storage.get(STORE.settings, null)));
  $view = atom2(normalizeView(null, $settings.get()));
  $jobs = atom2([]);
  $jobData = atom2({});
  $open = atom2(null);
}
function unbind() {
  api = null;
  $settings = $view = $jobs = $jobData = $open = null;
}
var setView = (next) => $view.set(normalizeView(typeof next === "function" ? next($view.get()) : next, $settings.get()));
function setSettings(next) {
  const cur = $settings.get();
  const v = normalizeSettings(typeof next === "function" ? next(cur) : next);
  $settings.set(v);
  api.storage.set(STORE.settings, v);
  if (v.showDrafts !== cur.showDrafts) setView((view) => ({ ...view, drafts: v.showDrafts }));
  if (v.sort !== cur.sort) setView((view) => ({ ...view, sort: v.sort }));
}
function trackJob(job) {
  if (!$jobs) return;
  if (!$jobs.get().some((j) => j.id === job.id)) $jobs.set([...$jobs.get(), job]);
}
function dismissJob(id) {
  $jobs.set($jobs.get().filter((j) => j.id !== id));
  const { [id]: _gone, ...rest } = $jobData.get();
  $jobData.set(rest);
}
var finished = /* @__PURE__ */ new Set();
var markFinished = (id) => finished.has(id) ? false : (finished.add(id), true);
function putJobData(job) {
  const cur = $jobData.get();
  if (cur[job.id] !== job) $jobData.set({ ...cur, [job.id]: job });
}

// desktop/src/data.js
var scopeKey = (conn, profile) => [ID, conn, profile];
var mrsKey = (conn, profile) => [...scopeKey(conn, profile), "mrs"];
var jobKey2 = (conn, profile, id) => [...scopeKey(conn, profile), "job", id];
var jobsKey = (conn, profile) => [...scopeKey(conn, profile), "jobs"];
var here = () => scopeKey(host2.state.connectionId.get() ?? "", host2.state.profile.get() ?? "");
var offline = () => Promise.reject(new Error("mergeable not loaded"));
var fetchMrs = () => api ? api.rest("/mrs") : offline();
function useMrs() {
  const { conn, profile } = useBackend();
  const settings = useValue2($settings);
  const q = useLiveQuery({
    queryKey: mrsKey(conn, profile),
    queryFn: fetchMrs,
    placeholderData: (prev, prevQuery) => prevQuery && prevQuery.queryKey[1] === conn && prevQuery.queryKey[2] === profile ? prev : void 0,
    pollMs: pollMs(settings),
    staleTime: STALE_MS
  });
  return { ...q, conn, profile };
}
async function refresh() {
  const key = [...here(), "mrs"];
  const data = await api.rest("/mrs?refresh=1");
  queryClient2.setQueryData(key, data);
  return data;
}
function useJobsList(enabled) {
  const { conn, profile } = useBackend();
  const settings = useValue2($settings);
  return useLiveQuery({
    queryKey: jobsKey(conn, profile),
    queryFn: () => api ? api.rest("/jobs") : offline(),
    pollMs: pollMs(settings),
    staleTime: STALE_MS,
    enabled
  });
}
function useJob(id) {
  const { conn, profile } = useBackend();
  const final = useRef(false);
  const q = useLiveQuery({
    queryKey: jobKey2(conn, profile, id),
    queryFn: () => api ? api.rest(`/jobs/${encodeURIComponent(id)}`) : offline(),
    pollMs: final.current ? false : JOB_POLL_MS,
    staleTime: 0
  });
  final.current = isDone(q.data);
  return q;
}
function settleJob(job, meta) {
  if (!isDone(job) || !markFinished(job.id)) return;
  const ok = job.state === "done";
  host2.notify({ kind: ok ? "success" : "error", message: `Mergeable: ${meta ? meta.label : job.kind} ${job.state}` });
  void queryClient2.invalidateQueries({ queryKey: [...here(), "mrs"] });
}
function started(out, kind, label, refs) {
  const id = out && (typeof out.job_id === "string" || typeof out.job_id === "number") ? String(out.job_id) : null;
  if (!id) throw new Error("the backend accepted the request without a job_id");
  const scope = here();
  trackJob({ id, kind, label, refs, conn: scope[1], profile: scope[2] });
  return id;
}
async function postMr(it, kind, extra = {}) {
  if (!it || !it.sha) throw new Error(`${it ? it.ref : "MR"} has no head sha, refusing to write`);
  if (!WRITE_PATH[kind]) throw new Error(`unknown action ${kind}`);
  const out = await api.rest(`/mrs/${it.project_id}/${it.iid}/${WRITE_PATH[kind]}`, {
    method: "POST",
    body: { expected_sha: it.sha, ...extra }
  });
  return started(out, kind, `${kind} ${it.ref}`, [it.ref]);
}
async function postBatch(plan) {
  const steps = plan.steps;
  if (!steps.length || steps.some((s) => !s.item.sha)) throw new Error("the batch has a step without a head sha, refusing to write");
  const refs = steps.map((s) => s.item.ref);
  const out = await api.rest("/batch/trivial", { method: "POST", body: { refs, shas: steps.map((s) => s.item.sha) } });
  return started(out, "batch", `trivial batch of ${refs.length}`, refs);
}
async function auditAll() {
  const out = await api.rest("/audit/all", { method: "POST", body: {} });
  return started(out, "audit-all", "re-audit all", []);
}
async function fetchStatus(data) {
  try {
    const out = await api.rest("/status.md");
    if (typeof out === "string" && out.trim()) return { text: out, local: false };
    if (out && typeof out.markdown === "string" && out.markdown.trim()) return { text: out.markdown, local: false };
  } catch {
  }
  return { text: statusMarkdown(data), local: true };
}
async function copyText(text) {
  if (api && api.os && typeof api.os.writeClipboard === "function") return api.os.writeClipboard(text);
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  return false;
}
function openExternal(url) {
  if (api && api.os && typeof api.os.openExternal === "function") void api.os.openExternal(url);
  else window.open(url, "_blank", "noopener");
}
function openSession(it) {
  if (!sessionKind(it.session)) return;
  void host2.openSession(it.session.id, { intent: "tab", profile: it.session.profile });
}
function reveal(paneId) {
  if (typeof host2.revealPane === "function") host2.revealPane(paneId);
  else host2.navigate(PATH);
}

// desktop/src/notify.js
import { host as host3, useValue as useValue3 } from "@hermes/plugin-sdk";
import { useEffect } from "react";
var scopes = /* @__PURE__ */ new Map();
var resetNotifier = () => scopes.clear();
var focused = () => typeof document !== "undefined" && typeof document.hasFocus === "function" && document.hasFocus();
function showRow(ref, items) {
  reveal(PANE_ID);
  if (!ref) return;
  if (items && !filterItems(items, $view.get(), $settings.get()).some((it) => it.ref === ref)) setView((cur) => ({ ...cur, filter: "all", drafts: true }));
  $open.set(ref);
}
function deliver(m, items) {
  const show = () => showRow(m.ref, items);
  const title = `Mergeable: ${m.title}`;
  if (focused()) {
    host3.notify({ kind: m.kind, title, message: m.body || m.title, action: { label: "Show", onClick: show } });
  } else if (api.os && typeof api.os.notify === "function") {
    api.os.notify({ title, body: m.body, silent: m.silent, onActivate: show });
  } else {
    host3.notify({ kind: m.kind, title, message: m.body || m.title });
  }
}
function observe(scope, data, jobs) {
  if (!api) return;
  const st = scopes.get(scope) || { items: null, data: null, jobs: null };
  scopes.set(scope, st);
  const events = [];
  let known = api.storage.get(STORE.notified, {});
  let baseline = false;
  if (data && data !== st.data) {
    const items = data.items || [];
    events.push(...mrEvents(st.items, items, { user: data.user || "", rebased: rebasedRefs(jobs || st.jobs) }));
    st.items = items;
    st.data = data;
  }
  if (jobs && jobs !== st.jobs) {
    if (st.jobs === null) {
      known = takeFresh(endedJobKeys(jobs).map((key) => ({ key })), known).notified;
      baseline = true;
    } else {
      events.push(...jobEvents(jobs));
    }
    st.jobs = jobs;
  }
  const { fresh, notified } = takeFresh(events, known);
  if (fresh.length || baseline) api.storage.set(STORE.notified, notified);
  const settings = $settings.get();
  const mine = new Set($jobs.get().map((j) => j.id));
  const due = fresh.filter((e) => settings[EVENTS.find((x) => x.id === e.type).setting]).filter((e) => !(e.type === "job" && focused() && mine.has(e.jobId)));
  for (const m of messagesFor(due)) deliver(m, st.items);
}
function useNotifier(q) {
  const s = useValue3($settings);
  const jobs = useJobsList(!!(s.notifyJob || s.notifyPipelineGreen));
  useEffect(() => {
    if (q.data) observe(`${q.conn}|${q.profile}`, q.data, jobs.data);
  }, [q.data, jobs.data, q.conn, q.profile]);
}

// desktop/src/page.js
import { Badge as Badge2, Button as Button2, Codicon as Codicon2, EmptyState as EmptyState2, ErrorState, Loader } from "@hermes/plugin-sdk";
import { createElement as h3, Fragment as Fragment2, useEffect as useEffect3, useMemo, useState as useState2 } from "react";

// .build/node_modules/hermes-plugin-ui-kit/src/table.js
import { EmptyState } from "@hermes/plugin-sdk";
import { createElement as h } from "react";
var cell = { padding: "6px 8px", verticalAlign: "top", borderTop: `1px solid var(--ui-stroke-tertiary, var(--border))` };
function Table({ columns, rows, renderRow, empty, fontSize = 13 }) {
  if (!rows.length) return h(EmptyState, empty);
  return h(
    "table",
    { style: { width: "100%", borderCollapse: "collapse", fontSize } },
    h("thead", null, h(
      "tr",
      { style: { ...muted, fontSize: 11, textAlign: "left" } },
      columns.map((c, i) => h("th", { key: i, style: { padding: "4px 8px", fontWeight: 500, textAlign: c.align === "right" ? "right" : "left" } }, c.label))
    )),
    h("tbody", null, rows.flatMap(renderRow))
  );
}

// .build/node_modules/hermes-plugin-ui-kit/src/route.js
function createRoute(path, { select, params }) {
  const split = () => window.location.hash.replace(/^#/, "").split("?");
  const on = () => (window.location.hash || "").replace(/^#/, "").split("?")[0] === path;
  const read = () => {
    const [here2, qs = ""] = split();
    if (here2 !== path) return null;
    const q = new URLSearchParams(qs);
    const view = { [select]: q.get(select) || null };
    for (const k of params) view[k] = q.get(k);
    return view;
  };
  const href = (view) => {
    const q = new URLSearchParams();
    for (const k of [select, ...params]) if (view[k]) q.set(k, view[k]);
    const qs = q.toString();
    return qs ? `${path}?${qs}` : path;
  };
  const write = (view) => {
    if (!on()) return;
    const next = href(view);
    if (window.location.hash.replace(/^#/, "") === next) return;
    window.history.replaceState(null, "", `#${next}`);
  };
  return { path, on, read, href, write };
}

// desktop/src/view.js
import {
  Badge,
  Button,
  Codicon,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  host as host4,
  Input,
  Tip,
  useValue as useValue4
} from "@hermes/plugin-sdk";
import * as sdk from "@hermes/plugin-sdk";
import { createContext, createElement as h2, Fragment, useContext, useEffect as useEffect2, useState } from "react";
var stop = (e) => e.stopPropagation();
var say = (kind, message) => host4.notify({ kind, message });
var fail = (what, e) => say("error", `Mergeable: ${what} failed: ${e && e.message || e}`);
var Ask = createContext(null);
var useAsk = () => useContext(Ask);
function Surface({ meta, children }) {
  const [ask, setAsk] = useState(null);
  const close = () => setAsk(null);
  return h2(
    Ask.Provider,
    { value: { ask: setAsk, meta } },
    children,
    ask && ask.kind === "merge" ? h2(MergeDialog, { key: ask.item.ref, it: ask.item, rules: meta.rules, close }) : null,
    ask && ask.kind === "trivial" ? h2(TrivialDialog, { key: "trivial", plan: ask.plan, close }) : null,
    ask && ask.kind === "hold" ? h2(HoldDialog, { key: ask.item.ref, it: ask.item, close }) : null
  );
}
var KV = ({ k, children, mono }) => [
  h2("span", { key: `${k}-k`, className: "k" }, k),
  h2("span", { key: `${k}-v`, className: `v${mono ? " mg-mono" : ""}` }, children)
];
function MergeDialog({ it, rules, close }) {
  const a = auditOf(it);
  const keeps = rules && rules.delete_source_branch === false;
  return h2(
    ConfirmDialog,
    {
      open: true,
      onClose: close,
      title: `Merge ${it.ref}?`,
      confirmLabel: "Merge",
      busyLabel: "Merging",
      doneLabel: "Started",
      description: "Confirming is the go for this one MR. The backend re-reads it first and refuses if the head moved.",
      onConfirm: async () => {
        await postMr(it, "merge");
      }
    },
    h2(
      "div",
      { className: "mg-kv", "data-dialog": "merge" },
      h2(KV, { k: "Title" }, it.title),
      h2(KV, { k: "Into", mono: true }, `${it.target_branch} (merge method ${it.merge_method})`),
      h2(KV, { k: "Pipeline" }, it.pipeline ? it.pipeline.status : "no CI for this MR"),
      h2(KV, { k: "Branch", mono: true }, `${it.source_branch} is ${keeps ? "kept" : "deleted"} after the merge`),
      a ? h2(KV, { k: "Audit" }, `${a.verdict}: ${a.summary}`) : null
    ),
    a && a.verdict === "hold" ? h2("div", { className: "mg-warnbox" }, "The audit says hold. Merging moves this pin on the next deploy.") : null
  );
}
function PlanTable({ plan }) {
  return h2(
    "table",
    { className: "mg-plan", "data-plan": "1" },
    h2("thead", null, h2("tr", null, ["#", "MR", "Step", "CI runs"].map((c) => h2("th", { key: c, title: c === "CI runs" ? "Extra MR pipelines this step starts" : void 0 }, c)))),
    h2("tbody", null, plan.steps.map((s, i) => h2(
      "tr",
      { key: s.item.ref, "data-step": s.item.ref },
      h2("td", null, i + 1),
      h2("td", { className: "mg-mono" }, refLabel(s.item)),
      h2("td", null, s.rebase ? s.item.owner === "renovate" ? "Renovate rebase box, wait green, merge" : "rebase once, wait green, merge" : "merge", " ", h2("span", { className: "mg-count" }, s.item.title)),
      h2("td", null, s.pipelines)
    )))
  );
}
function TrivialDialog({ plan, close }) {
  return h2(
    ConfirmDialog,
    {
      open: true,
      onClose: close,
      title: `Merge ${plural(plan.steps.length, "trivial MR", "trivial MRs")}?`,
      confirmLabel: `Merge ${plan.steps.length}`,
      busyLabel: "Starting",
      doneLabel: "Started",
      description: `Landed one at a time in this order; the run stops at the first failure. ${plural(plan.rebases, "rebase", "rebases")}, ${plural(plan.pipelines, "MR pipeline", "MR pipelines")}.`,
      onConfirm: async () => {
        await postBatch(plan);
      }
    },
    h2("div", { "data-dialog": "trivial" }, h2(PlanTable, { plan }))
  );
}
function HoldDialog({ it, close }) {
  const [until, setUntil] = useState(() => holdDefaultUntil());
  const pkg = it.renovate.package;
  return h2(
    ConfirmDialog,
    {
      open: true,
      onClose: close,
      title: `Hold ${pkg}?`,
      confirmLabel: "Draft hold MR",
      busyLabel: "Starting",
      doneLabel: "Started",
      description: "The backend commits a packageRules entry to renovate.json on a new branch and opens a Draft MR. Nothing merges.",
      onConfirm: async () => {
        if (!isIsoDay(until)) throw new Error("Pick a date as YYYY-MM-DD");
        await postMr(it, "hold", { package: pkg, until });
      }
    },
    h2(
      "div",
      { className: "mg-hold", "data-dialog": "hold" },
      h2("label", null, "Hold until"),
      h2(Input, { type: "date", value: until, "aria-label": "Hold until", "data-field": "until", onChange: (e) => setUntil(e.target.value) })
    )
  );
}
function JobWatch({ job }) {
  const q = useJob(job.id);
  useEffect2(() => {
    if (!q.data) return;
    putJobData(q.data);
    settleJob(q.data, job);
  }, [q.data]);
  return null;
}
function useJobsHere() {
  const { conn, profile } = useBackend();
  const jobs = useValue4($jobs);
  const data = useValue4($jobData);
  return jobs.filter((j) => j.conn === conn && j.profile === profile).map((j) => ({ meta: j, job: data[j.id] || null }));
}
function useBusyProjects() {
  const here2 = useJobsHere();
  const busy = /* @__PURE__ */ new Set();
  for (const { meta, job } of here2) {
    if (job && isDone(job)) continue;
    for (const ref of meta.refs) busy.add(ref.split("!")[0]);
  }
  return busy;
}
function JobStrip() {
  const here2 = useJobsHere();
  if (!here2.length) return null;
  return h2(Fragment, null, here2.map(({ meta, job }) => h2(
    "div",
    { key: meta.id, className: `mg-job ${job ? job.state : "running"}`, "data-job": meta.id, "data-state": job ? job.state : "running" },
    h2(JobWatch, { job: meta }),
    h2(Codicon, { name: !job || !isDone(job) ? "loading" : job.state === "done" ? "pass" : "error", spinning: !job || !isDone(job) }),
    h2("span", { className: "mg-grow" }, job ? jobLine(job) : `${meta.label}: starting`),
    h2(Button, { size: "icon-xs", variant: "ghost", "aria-label": "Dismiss", "data-dismiss": meta.id, onClick: () => dismissJob(meta.id) }, h2(Codicon, { name: "close" }))
  )));
}
function RowJob({ it }) {
  const here2 = useJobsHere();
  const hit = here2.filter((x) => x.meta.refs.includes(it.ref)).pop();
  if (!hit) return null;
  const step = hit.job ? stepFor(hit.job, it.ref) : null;
  const done = hit.job && isDone(hit.job);
  const bad = done && hit.job.state !== "done";
  if (done && !bad) return null;
  return h2(
    "div",
    { className: `mg-l3${bad ? " failed" : ""}`, "data-rowjob": it.ref },
    h2(Codicon, { name: bad ? "error" : "loading", spinning: !bad }),
    `${hit.meta.kind}: ${step ? `${step.step}${step.detail ? `, ${step.detail}` : ""}` : hit.job ? hit.job.state : "starting"}`
  );
}
var Dot = ({ status }) => h2("span", { className: `mg-dot ${status === "success" ? "success" : status === "failed" ? "failed" : status === "running" || status === "pending" ? "running" : ""}`, "data-dot": status || "none", title: `Pipeline: ${status || "none"}` });
var Age = ({ it, now }) => {
  const s = useValue4($settings);
  const wd = workingAge(it, now);
  const cls = ageClass(wd, s);
  return h2(
    Tip,
    { label: ageTip(it, wd) },
    h2("span", { className: `mg-age ${cls}`, "data-age": cls || "fresh", "data-wd": wd }, ageLabel(it.age_days))
  );
};
function Chips({ it, iconOnly = true, group, skip = [], fallback = null }) {
  const s = useValue4($settings);
  const shown = iconOnly ? s : { ...s, chipRatings: true, chipState: true, chipOwner: true };
  const list = chipsOf(it, shown).filter((c) => (!group || c.group === group) && !skip.includes(c.key));
  if (!list.length) return fallback;
  return h2(Fragment, null, list.map((c) => {
    const icon = h2(Codicon, { name: c.icon, spinning: !!c.spinning, size: 12 });
    const props = { variant: c.tone, "data-chip": c.key, "data-tone": c.tone, "data-icon": c.icon };
    return iconOnly ? h2(Tip, { key: `${c.key}-${c.icon}`, label: c.tip }, h2(Badge, { ...props, size: "xs", "aria-label": c.tip }, icon)) : h2(Badge, { key: `${c.key}-${c.icon}`, ...props, title: c.tip }, icon, c.label || c.name);
  }));
}
function Icon({ it, act, icon, label, why, disabled, dim, onClick }) {
  const text = why || label;
  const btn = h2(Button, {
    size: "icon-xs",
    variant: "ghost",
    disabled,
    "aria-label": label,
    "data-act": act,
    "data-ref": it.ref,
    "data-why": disabled ? why : void 0,
    className: dim ? "mg-dim" : void 0,
    onClick: (e) => {
      stop(e);
      onClick();
    }
  }, h2(Codicon, { name: icon }));
  return h2(Tip, { label: text }, h2("span", { className: "mg-tw", title: text }, btn));
}
async function run(it, kind) {
  try {
    await postMr(it, kind);
  } catch (e) {
    fail(`${kind} ${it.ref}`, e);
  }
}
async function copy(text, what) {
  try {
    const ok = await copyText(text);
    say(ok ? "success" : "warning", ok ? `Copied ${what}` : `Could not copy ${what}`);
  } catch (e) {
    fail(`copy ${what}`, e);
  }
}
function MoreMenu({ it }) {
  const { ask, meta } = useAsk();
  const pick = {
    open: () => openExternal(it.web_url),
    pipeline: () => openExternal(it.pipeline.url),
    retry: () => run(it, "retry"),
    "copy-branch": () => copy(it.source_branch, it.source_branch),
    "copy-glab": () => copy(glabCommand(it, meta.host), "the glab command"),
    ready: () => run(it, "ready"),
    audit: () => run(it, "audit"),
    hold: () => ask({ kind: "hold", item: it })
  };
  return h2(
    DropdownMenu,
    null,
    h2(
      DropdownMenuTrigger,
      { asChild: true },
      h2(Button, { size: "icon-xs", variant: "ghost", "aria-label": "More actions", "data-act": "menu", "data-ref": it.ref, onClick: stop }, h2(Codicon, { name: "ellipsis" }))
    ),
    h2(
      DropdownMenuContent,
      { align: "end", onClick: stop },
      menuItems(it).map((m, i) => m === null ? h2(DropdownMenuSeparator, { key: `sep${i}` }) : h2(
        DropdownMenuItem,
        { key: m.id, "data-item": m.id, disabled: !m.enabled, title: m.enabled ? void 0 : m.why, onSelect: () => pick[m.id]() },
        h2(Codicon, { name: m.icon }),
        m.label
      ))
    )
  );
}
function Actions({ it }) {
  const { ask, meta } = useAsk();
  const s = useValue4($settings);
  const busy = useBusyProjects().has(it.project);
  const lock = busy ? `A write job is running on ${it.project}` : null;
  const rb = rebaseAbility(it);
  const mg = mergeAbility(it);
  const kind = sessionKind(it.session);
  return h2(
    "span",
    { className: "mg-acts" },
    h2(Icon, { it, act: "rebase", icon: "sync", label: "Rebase", why: lock || rb.why, disabled: !rb.ok || busy, onClick: () => run(it, "rebase") }),
    h2(Icon, { it, act: "merge", icon: "git-merge", label: "Merge", why: lock || mg.why, disabled: !mg.ok || busy, onClick: () => ask({ kind: "merge", item: it }) }),
    s.sessionBtn ? h2(Icon, { it, act: "session", icon: "comment-discussion", label: "Open session", why: sessionTip(it), disabled: !kind, dim: kind === "mentioned", onClick: () => openSession(it) }) : null,
    h2(MoreMenu, { it })
  );
}
var settingsHref = () => typeof sdk.pluginSettingsHref === "function" ? sdk.pluginSettingsHref(ID) : SETTINGS_HOST_FALLBACK;
function Tool({ icon, label, act, onClick, disabled, spinning }) {
  return h2(
    Tip,
    { label },
    h2(Button, { size: "icon-xs", variant: "ghost", "aria-label": label, "data-act": act, disabled, onClick }, h2(Codicon, { name: icon, spinning }))
  );
}
function HeaderTools({ q, children }) {
  const { ask } = useAsk();
  const [busy, setBusy] = useState("");
  const items = q.data && q.data.items || [];
  const n = trivialCount(items);
  const wrap = (name, fn) => async () => {
    setBusy(name);
    try {
      await fn();
    } catch (e) {
      fail(name, e);
    } finally {
      setBusy("");
    }
  };
  const copyStatus = wrap("copy status", async () => {
    const { text, local } = await fetchStatus(q.data);
    const ok = await copyText(text);
    say(ok ? "success" : "warning", ok ? `Copied the status${local ? " (built from the list in hand)" : ""}` : "Could not copy the status");
  });
  return h2(
    Fragment,
    null,
    h2(
      Tip,
      { label: n ? "Merge every MR that matches the trivial rules (Settings, Plugins, Mergeable)" : "No MR matches the trivial rules" },
      h2(
        "span",
        { className: "mg-tw" },
        h2(
          Button,
          { size: "xs", variant: "secondary", "data-act": "trivial", disabled: !n, onClick: () => ask({ kind: "trivial", plan: trivialPlan(items) }) },
          h2(Codicon, { name: "git-merge" }),
          "Trivial ",
          h2("span", { "data-trivial-n": "1" }, n)
        )
      )
    ),
    h2(Tool, { icon: "refresh", label: "Refresh (collector plus audits for changed heads)", act: "refresh", disabled: !!busy || q.isFetching, spinning: busy === "refresh" || q.isFetching, onClick: wrap("refresh", refresh) }),
    h2(Tool, { icon: "copy", label: "Copy status as Markdown", act: "copy-status", disabled: !q.data || busy === "copy status", onClick: copyStatus }),
    h2(Tool, { icon: "debug-rerun", label: "Re-audit all (ignores the head-sha cache)", act: "audit-all", disabled: !!busy, onClick: wrap("re-audit all", auditAll) }),
    h2(Tool, { icon: "settings-gear", label: "Settings (Settings, Plugins, Mergeable)", act: "settings", onClick: () => host4.navigate(settingsHref()) }),
    children
  );
}
var where = (conn, profile) => `backend ${conn || "this device"}, profile ${profile || "default"}`;
function unreachable(error, conn, profile) {
  const hint = /404|not found/i.test(String(error && error.message || error)) ? " A 404 means that backend does not have the mergeable plugin." : " The Python half loads only when mergeable is in plugins.enabled of that profile and the backend was restarted.";
  return { title: `Mergeable backend unreachable (${where(conn, profile)})`, description: `${error && error.message || error}.${hint}` };
}
function Detail({ it, now }) {
  const a = auditOf(it);
  const dl = [];
  const add = (k, v, mono) => dl.push(h2("dt", { key: `${k}-t` }, k), h2("dd", { key: `${k}-d`, className: mono ? "mg-mono" : void 0 }, v));
  add("Branch", `${it.source_branch} into ${it.target_branch}`, true);
  add("Opened", `${fmtUtc(it.created_at)}, ${it.age_days} days ago, ${plural(workingAge(it, now), "working day", "working days")}`);
  add("Project", `merge method ${it.merge_method}, ${it.pipeline ? "CI yes" : "CI no"}, ${it.files_changed} files, ${plural(it.user_notes_count || 0, "note", "notes")}`);
  if (sessionKind(it.session)) add("Session", `${it.session.title || it.session.id} (${it.session.profile}, ${sessionKind(it.session)}, score ${it.session.score})`);
  if (a && it.renovate) {
    add("Bump", `${it.renovate.from} to ${it.renovate.to} (${it.renovate.update_type})`, true);
    add("Verdict", h2(Fragment, null, h2(Badge, { variant: VERDICT_TONE[a.verdict] || "muted" }, a.verdict), ` ${a.summary}`));
    add("Importance", a.importance_reason);
    add("Ease", a.ease_reason);
    if (a.confidence !== "sure") add("Not sure", a.not_sure_reason);
  }
  return h2("div", { className: "mg-detail", "data-detail": it.ref, onClick: stop }, h2("dl", null, dl));
}

// desktop/src/page.js
var route = createRoute("/mergeable", { select: "open", params: [] });
function useOpenRef() {
  const [open, setOpen] = useState2(() => (route.read() || {}).open || null);
  useEffect3(() => {
    const on = () => setOpen((route.read() || {}).open || null);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return [open, (ref) => {
    setOpen(ref);
    route.write({ open: ref });
  }];
}
var nw = { ...cell, whiteSpace: "nowrap" };
var Link = ({ url, title, children }) => h3("a", { className: "mg-link", href: url, title, rel: "noopener", onClick: (e) => {
  e.preventDefault();
  openExternal(url);
} }, children);
function AuditBadges({ a }) {
  return h3(
    Fragment2,
    null,
    h3(Badge2, { variant: IMPORTANCE_TONE[a.importance] || "muted" }, h3(Codicon2, { name: CHIP_ICON.importance }), a.importance),
    " ",
    h3(Badge2, { variant: EASE_TONE[a.ease] || "muted" }, h3(Codicon2, { name: CHIP_ICON.ease }), a.ease),
    " ",
    h3(Badge2, { variant: VERDICT_TONE[a.verdict] || "muted" }, a.verdict)
  );
}
function MrTable({ items, open, now, onOpen }) {
  const rows = useMemo(() => tableItems(items), [items]);
  return h3(
    "div",
    { className: "mg-tablewrap" },
    h3(
      "div",
      { style: { minWidth: 980 } },
      h3(Table, {
        fontSize: 12,
        columns: ["MR", "Title", "Owner", "Age", "State", "CI", "Audit", "Session", "Actions"].map((label) => ({ label })),
        rows,
        empty: { title: "No open merge requests" },
        renderRow: (it) => {
          const a = auditOf(it);
          return h3(
            "tr",
            { key: it.ref, "data-row": it.ref, className: open === it.ref ? "hit" : void 0, onClick: () => onOpen(it.ref) },
            h3("td", { style: nw, className: "mg-mono" }, h3(Link, { url: it.web_url, title: it.ref }, refLabel(it))),
            h3("td", { style: { ...cell, minWidth: 240 } }, it.title, h3(RowJob, { it })),
            h3("td", { style: nw }, it.owner === "self" ? "me" : h3(Chips, { it, iconOnly: false, group: "owner" })),
            h3("td", { style: nw }, h3(Age, { it, now })),
            h3("td", { style: nw }, h3("div", { className: "mg-cluster" }, h3(Chips, { it, iconOnly: false, group: "state", skip: ["noci"], fallback: it.merge_status }))),
            h3("td", { style: nw }, h3(Dot, { status: it.pipeline && it.pipeline.status }), " ", it.pipeline ? it.pipeline.status : "no CI"),
            h3("td", { style: { ...cell, minWidth: 150 } }, h3("div", { className: "mg-cluster", style: { maxWidth: 240 } }, h3(Chips, { it, iconOnly: false, group: "audit" }), a ? h3(Badge2, { variant: VERDICT_TONE[a.verdict] || "muted" }, a.verdict) : null)),
            h3("td", { style: nw }, sessionKind(it.session) || ""),
            h3("td", { style: nw, onClick: (e) => e.stopPropagation() }, h3(Actions, { it }))
          );
        }
      })
    )
  );
}
function AuditCard({ it, hit }) {
  const a = auditOf(it);
  const r = it.renovate || {};
  const adv = a.advisories || [];
  const kv = [];
  const add = (k, v, mono) => kv.push(h3("span", { key: `${k}-k`, className: "k" }, k), h3("span", { key: `${k}-v`, className: `v${mono ? " mg-mono" : ""}` }, v));
  add("Package", r.package, true);
  add("Range", `${r.from} to ${r.to} (${r.update_type})`, true);
  add("Read", (a.releases_read || []).join(", ") || "no releases in the range (digest bump)");
  if (adv.length) add("Advisories", adv.map((x) => `${x.ghsa} ${x.severity}${x.cvss ? ` CVSS ${x.cvss}` : ""}${x.cve ? ` (${x.cve})` : ""}`).join("; "));
  if ((a.cves || []).length) add("CVEs named", a.cves.map((c) => `${c.id} ${c.severity}${c.cvss ? ` ${c.cvss}` : ""}`).join(", "));
  add("Summary", a.summary);
  add("Importance", a.importance_reason);
  add("Ease", a.ease_reason);
  if (a.confidence !== "sure") add("Not sure", a.not_sure_reason);
  const bcs = a.breaking_changes || [];
  return h3(
    "div",
    { className: `mg-card${hit ? " hit" : ""}`, "data-audit": it.ref },
    h3("h3", null, h3(Link, { url: it.web_url, title: it.ref }, it.ref), h3(AuditBadges, { a })),
    h3("div", { className: "mg-kv" }, kv),
    bcs.length ? h3(
      "table",
      { className: "mg-plan" },
      h3("thead", null, h3("tr", null, ["Version", "Breaking or changed default", "Us?"].map((c) => h3("th", { key: c }, c)))),
      h3("tbody", null, bcs.map((b, i) => h3("tr", { key: i }, h3("td", null, b.version), h3("td", null, b.change), h3("td", null, b.affects_us))))
    ) : null,
    h3("div", { className: "mg-runs" }, `Decided by ${String(a.model || "none").replace("claude-", "")}${a.escalated ? " after escalation" : ""}, audited ${fmtUtc(a.audited_at)}.`),
    h3(
      "div",
      { className: "mg-cardacts" },
      h3(Actions, { it }),
      h3(
        Button2,
        { size: "xs", variant: "secondary", "data-act": "reaudit", "data-ref": it.ref, onClick: async () => {
          try {
            await postMr(it, "audit");
          } catch (e) {
            say("error", `Mergeable: audit ${it.ref} failed: ${e.message}`);
          }
        } },
        h3(Codicon2, { name: "debug-rerun" }),
        "Re-run audit"
      )
    )
  );
}
function Body({ q }) {
  const { data, error, isLoading, conn, profile } = q;
  const [open, onOpen] = useOpenRef();
  useEffect3(() => {
    if (!open || !data) return;
    const el = document.querySelector(`[data-row="${CSS.escape ? CSS.escape(open) : open}"]`);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "center" });
  }, [open, data && data.generated_at]);
  if (error && !data) return h3("div", { className: "mg-scroll" }, h3(ErrorState, unreachable(error, conn, profile)));
  if (isLoading || !data) return h3("div", { className: "mg-empty" }, h3(Loader, null));
  const audited = data.items.filter(auditOf);
  return h3(
    Fragment2,
    null,
    data.schema_ok === false ? h3("div", { className: "mg-banner", "data-banner": "schema" }, "The backend reports schema_ok false: session buttons may be missing. MR data is not affected.") : null,
    error ? h3("div", { className: "mg-banner bad", "data-banner": "stale" }, `${where(conn, profile)} is unreachable, showing the last answer.`) : null,
    h3(JobStrip, null),
    h3(
      "div",
      { className: "mg-scroll", "data-list": "1" },
      data.items.length ? h3(MrTable, { items: data.items, open, now: data.generated_at, onOpen }) : h3("div", { className: "mg-empty", "data-empty": "none" }, h3(EmptyState2, { title: "No open merge requests", description: `Nothing is open in the projects of ${where(conn, data.profile || profile)}.` })),
      h3("h2", { className: "mg-h2" }, "Renovate audits"),
      audited.length ? h3("div", { className: "mg-cards", "data-audits": "1" }, audited.map((it) => h3(AuditCard, { key: it.ref, it, hit: open === it.ref }))) : h3("p", { className: "mg-count", "data-empty": "audits" }, "No audit has run yet. A Renovate MR gets one when its head commit changes, or from its More menu.")
    )
  );
}
function MergeablePage() {
  const q = useMrs();
  useNotifier(q);
  const data = q.data;
  const s = data ? summarize(data.items) : null;
  const meta = { host: data && data.host || "gitlab.com", rules: data && data.rules };
  return h3(
    Surface,
    { meta },
    h3(
      "div",
      { className: "mg wide", "data-mg": "page" },
      h3(
        "div",
        { className: "mg-head" },
        h3("span", { className: "mg-title mg-grow" }, "Open merge requests"),
        h3(HeaderTools, { q }, h3(Tool, { icon: "layout-sidebar-right", label: "Show the Mergeable tab in the Files zone", act: "show-pane", onClick: () => reveal(PANE_ID) }))
      ),
      s ? h3(
        "div",
        { className: "mg-sub", "data-sub": "1" },
        `${plural(s.count, "open MR", "open MRs")} in ${plural(s.projects, "project", "projects")}: ${s.mine} mine, ${s.renovate} Renovate, ${s.colleagues} colleagues. ${plural(s.drafts, "draft", "drafts")}, ${s.mergeable} mergeable now, ${s.rebase} need a rebase. ${where(q.conn, data.profile || q.profile)}, GitLab host ${data.host || "unknown"}, updated ${fmtClock(data.generated_at)}.`
      ) : null,
      h3(Body, { q })
    )
  );
}

// desktop/src/pane.js
import {
  Checkbox,
  Codicon as Codicon3,
  EmptyState as EmptyState3,
  ErrorState as ErrorState2,
  host as host5,
  Loader as Loader2,
  SegmentedControl,
  useValue as useValue5
} from "@hermes/plugin-sdk";
import { createElement as h4, Fragment as Fragment3, useEffect as useEffect4, useMemo as useMemo2 } from "react";
function PaneRow({ it, open, now, onToggle }) {
  return h4(
    "div",
    {
      className: `mg-row${open ? " open" : ""}`,
      role: "button",
      tabIndex: 0,
      "data-row": it.ref,
      onClick: onToggle,
      onKeyDown: (e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onToggle();
        }
      }
    },
    h4(
      "div",
      { className: "mg-l1" },
      h4(Dot, { status: it.pipeline && it.pipeline.status }),
      h4("span", { className: "mg-ttl", title: it.full_title || it.title }, it.title),
      h4(Age, { it, now })
    ),
    h4(
      "div",
      { className: "mg-l2" },
      h4("span", { className: "mg-ref" }, refLabel(it)),
      h4("span", { className: "mg-tags" }, h4(Chips, { it })),
      h4(Actions, { it })
    ),
    h4(RowJob, { it }),
    open ? h4(Detail, { it, now }) : null
  );
}
function Controls({ items, view, settings }) {
  const counts = filterCounts(items);
  return h4(
    Fragment3,
    null,
    h4(
      "div",
      { className: "mg-chips", "data-bar": "filters" },
      FILTERS.map((f) => h4("button", {
        key: f.id,
        type: "button",
        className: "mg-chip",
        "data-filter": f.id,
        "aria-pressed": view.filter === f.id,
        onClick: () => setView((cur) => ({ ...cur, filter: f.id }))
      }, f.label, h4("span", { className: "mg-n" }, counts[f.id])))
    ),
    h4(
      "div",
      { className: "mg-bar", "data-bar": "sort" },
      h4(SegmentedControl, { options: SORTS.map((s) => ({ id: s.id, label: s.label })), value: view.sort, onChange: (id) => setView((cur) => ({ ...cur, sort: id })) }),
      h4(
        "label",
        { className: "mg-drafts" },
        h4(Checkbox, { checked: view.drafts, "data-drafts": "1", onCheckedChange: (c) => setView((cur) => ({ ...cur, drafts: c === true })) }),
        "drafts"
      )
    )
  );
}
function Body2({ q }) {
  const { data, error, isLoading, conn, profile } = q;
  const view = useValue5($view);
  const settings = useValue5($settings);
  const open = useValue5($open);
  const setOpen = (next) => $open.set(next($open.get()));
  const xs = useMemo2(() => data ? paneItems(data.items, view, settings) : [], [data, view, settings]);
  useEffect4(() => {
    const el = open && document.querySelector(`[data-mg="pane"] [data-row="${CSS.escape ? CSS.escape(open) : open}"]`);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
  }, [open, xs.length]);
  if (error && !data) {
    const u = unreachable(error, conn, profile);
    return h4("div", { className: "mg-scroll" }, h4(ErrorState2, u));
  }
  if (isLoading || !data) return h4("div", { className: "mg-empty" }, h4(Loader2, null));
  const empty = !data.items.length;
  let last = null;
  return h4(
    Fragment3,
    null,
    h4("div", { className: "mg-sub", "data-sub": "1" }, `${where(conn, data.profile || profile)}${data.user ? `, GitLab user ${data.user}` : ""}, updated ${fmtClock(data.generated_at)}`),
    data.schema_ok === false ? h4("div", { className: "mg-banner", "data-banner": "schema" }, "The backend reports schema_ok false: session buttons may be missing. MR data is not affected.") : null,
    error ? h4("div", { className: "mg-banner bad", "data-banner": "stale" }, `${where(conn, profile)} is unreachable, showing the last answer.`) : null,
    empty ? null : h4(Controls, { items: data.items, view, settings }),
    h4(JobStrip, null),
    h4(
      "div",
      { className: "mg-scroll", "data-list": "1" },
      empty ? h4(
        "div",
        { className: "mg-empty", "data-empty": "none" },
        h4(
          "div",
          null,
          h4(EmptyState3, { title: "No open merge requests", description: `Nothing is open in the projects of ${where(conn, data.profile || profile)}.` }),
          h4("div", { className: "mg-note" }, HIDE_NOTE)
        )
      ) : !xs.length ? h4("div", { className: "mg-empty", "data-empty": "filtered" }, h4(EmptyState3, { title: "No MR matches this filter" })) : xs.map((it) => {
        const head = view.sort === "project" && it.project !== last ? h4("div", { key: `g-${it.project}`, className: "mg-group", "data-group": it.project }, it.project) : null;
        last = it.project;
        return h4(Fragment3, { key: it.ref }, head, h4(PaneRow, { it, open: open === it.ref, now: data.generated_at, onToggle: () => setOpen((cur) => cur === it.ref ? null : it.ref) }));
      })
    )
  );
}
function MergeablePane() {
  const q = useMrs();
  useNotifier(q);
  const view = useValue5($view);
  const settings = useValue5($settings);
  const data = q.data;
  const shown = data ? paneItems(data.items, view, settings).length : null;
  const meta = { host: data && data.host || "gitlab.com", rules: data && data.rules };
  return h4(
    Surface,
    { meta },
    h4(
      "div",
      { className: "mg pane", "data-mg": "pane" },
      h4(
        "div",
        { className: "mg-head" },
        h4(Codicon3, { name: "git-pull-request", style: { color: "var(--ui-text-tertiary)" } }),
        h4("span", { className: "mg-count mg-grow", "data-count": "1" }, shown === null ? "" : `${shown} open`),
        h4(HeaderTools, { q }, h4(Tool, { icon: "link-external", label: "Open the full page", act: "open-page", onClick: () => host5.navigate(PATH) }))
      ),
      h4(Body2, { q })
    )
  );
}

// desktop/src/settings.js
import { Input as Input2, SegmentedControl as SegmentedControl2, ToggleRow, useValue as useValue6 } from "@hermes/plugin-sdk";
import { createElement as h5, useEffect as useEffect5, useState as useState3 } from "react";
function NumberRow({ label, value, onCommit, name }) {
  const [draft, setDraft] = useState3(String(value));
  useEffect5(() => setDraft(String(value)), [value]);
  const commit = () => onCommit(draft);
  return h5(
    "div",
    { className: "mg-setrow" },
    h5("span", null, label),
    h5(Input2, {
      type: "number",
      min: 1,
      className: "mg-num",
      value: draft,
      "aria-label": label,
      "data-set": name,
      onChange: (e) => setDraft(e.target.value),
      onBlur: commit,
      onKeyDown: (e) => {
        if (e.key === "Enter") commit();
      }
    })
  );
}
var ChoiceRow = ({ label, options, value, onChange, name }) => h5(
  "div",
  { className: "mg-setrow", "data-set": name },
  h5("span", null, label),
  h5(SegmentedControl2, { options, value, onChange })
);
function SettingsPage() {
  const s = useValue6($settings);
  const set = (patch) => setSettings((cur) => ({ ...cur, ...patch }));
  const toggle = (name, label, description) => h5(ToggleRow, { key: name, id: `mg-set-${name}`, label, description, checked: s[name], onChange: (on) => set({ [name]: on }) });
  return h5(
    "div",
    { className: "mg-set", "data-mg": "settings" },
    h5(
      "div",
      null,
      h5("h3", null, "Display"),
      h5("p", { className: "mg-count" }, "Kept on this machine. Merge rules and backend settings are per profile: see Agent settings.")
    ),
    toggle("showColleagues", "Show colleagues' MRs", "Their rows stay read-only whatever this says."),
    toggle("showDrafts", "Show drafts by default", "The pane header can still switch them per session."),
    toggle("chipRatings", "Renovate rating chips", "Importance, ease, escalation and audit state on the row."),
    toggle("chipState", "Merge state chips", "mergeable, rebase, conflict and batch."),
    toggle("chipOwner", "Owner chips", "The Renovate bot icon and a colleague name."),
    toggle("sessionBtn", "Session button", "Opens the Hermes session that made the MR, in a new tab."),
    h5(NumberRow, { name: "ageWarn", label: "Age warn from (working days)", value: s.ageWarn, onCommit: (v) => set({ ageWarn: v }) }),
    h5(NumberRow, { name: "ageStale", label: "Age stale from (working days)", value: s.ageStale, onCommit: (v) => set({ ageStale: v }) }),
    h5(ChoiceRow, { name: "sort", label: "Default sort", options: SORTS.map((x) => ({ id: x.id, label: x.label })), value: s.sort, onChange: (id) => set({ sort: id }) }),
    h5(ChoiceRow, { name: "poll", label: "Poll interval", options: POLLS.map((x) => ({ id: x.id, label: x.label })), value: s.poll, onChange: (id) => set({ poll: id }) }),
    h5(
      "div",
      null,
      h5("h3", null, "Notifications"),
      h5("p", { className: "mg-count" }, "Native while Hermes is in the background, an in-app toast while it is focused; the OS do-not-disturb decides quiet hours. More than 3 in one poll become one summary. Only while Hermes runs; the first poll after a start never notifies.")
    ),
    EVENTS.map((e) => toggle(e.setting, e.label, e.hint))
  );
}

// desktop/src/index.js
var index_default = {
  id: ID,
  name: "Mergeable",
  description: "Open GitLab merge requests with Renovate audits: a tab stacked with Files, a full page, rebase, merge and a trivial batch behind a confirm dialog.",
  register(ctx) {
    bind(ctx);
    resetNotifier();
    const unmountStyle = mountStyle(ID, CSS2);
    ctx.onDispose(() => {
      unmountStyle();
      resetNotifier();
      unbind();
    });
    const show = () => reveal(PANE_ID);
    ctx.registerMany([
      { id: "pane", area: PANES_AREA, title: "Mergeable", data: PANE_DATA, render: () => h6(MergeablePane) },
      { id: "page", area: ROUTES_AREA, data: { path: PATH }, render: () => h6(MergeablePage) },
      { id: "nav", area: SIDEBAR_NAV_AREA, order: NAV_ORDER, data: NAV_DATA },
      { id: "keybind", area: KEYBINDS_AREA, data: { id: ACTION_ID, label: "Show Mergeable", defaults: [KEYBIND], run: show } },
      {
        id: "palette",
        area: PALETTE_AREA,
        data: { id: ACTION_ID, action: ACTION_ID, label: "Show Mergeable", keywords: ["mergeable", "merge requests", "gitlab", "renovate", "rebase"], run: show }
      }
    ]);
    const render = () => h6(SettingsPage);
    if (typeof ctx.registerSettingsPage === "function") {
      ctx.registerSettingsPage({ id: "display", title: "Mergeable", icon: "git-merge", render });
    } else if (typeof sdk2.SETTINGS_PLUGINS_AREA === "string") {
      ctx.register({ area: sdk2.SETTINGS_PLUGINS_AREA, id: "display", title: "Mergeable", render, data: { icon: "git-merge" } });
    }
  }
};
export {
  index_default as default
};
