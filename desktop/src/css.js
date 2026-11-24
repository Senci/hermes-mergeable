// Mergeable stylesheet. Colours are the host's --ui-* properties only, so light, dark and user themes
// follow without a rebuild. Badges, buttons, dialogs and menus come from the SDK; this sheet only lays
// them out. Age: amber from the warn limit, orange from the stale limit, in working days (D79).
export const CSS = `
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
`
