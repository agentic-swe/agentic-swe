#!/usr/bin/env node
/**
 * Local read-only dashboard for .worklogs work items (metrics + cost + tokens).
 *
 *   node scripts/swe-dashboard-server.cjs [--cwd <projectRoot>] [--port N] [--no-open]
 *
 * Env: SWE_DASHBOARD_PORT (default 47822), AGENTIC_SWE_DASHBOARD_CWD (default process.cwd()).
 */
'use strict';

const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { collectWorkDashboard, buildRollup } = require('./lib/work-engine/collect-work-dashboard.cjs');

function readJsonBody(req, limit = 2_000_000) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > limit) {
        reject(new Error('request body too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function parseArgs(argv) {
  let cwd = process.env.AGENTIC_SWE_DASHBOARD_CWD || process.cwd();
  let port = parseInt(String(process.env.SWE_DASHBOARD_PORT || '47822'), 10);
  let shouldOpen = true;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cwd' && argv[i + 1]) cwd = path.resolve(argv[++i]);
    else if (a === '--port' && argv[i + 1]) port = parseInt(argv[++i], 10);
    else if (a === '--no-open') shouldOpen = false;
    else if (a === '--help' || a === '-h') {
      console.log(`Usage: node scripts/swe-dashboard-server.cjs [--cwd <dir>] [--port N] [--no-open]`);
      process.exit(0);
    }
  }
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    console.error('Invalid --port');
    process.exit(2);
  }
  return { cwd, port, shouldOpen };
}

function openUrl(target) {
  const plat = process.platform;
  if (plat === 'darwin') {
    spawn('open', [target], { detached: true, stdio: 'ignore' }).unref();
  } else if (plat === 'win32') {
    spawn('cmd', ['/c', 'start', '', target], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [target], { detached: true, stdio: 'ignore' }).unref();
  }
}

function htmlPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>agentic SWE — work dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=IBM+Plex+Sans:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg-deep: #06080d;
      --bg-surface: #0c0f16;
      --bg-card: #111520;
      --border: #1a1f2e;
      --cyan: #00e5ff;
      --cyan-dim: #00e5ff33;
      --cyan-glow: #00e5ff18;
      --violet: #7c3aed;
      --violet-dim: #7c3aed33;
      --accent-human: #f59e0b;
      --accent-human-dim: #f59e0b55;
      --text: #b0b8c8;
      --text-bright: #e8ecf2;
      --text-heading: #f0f4fa;
      --font-display: 'Syne', sans-serif;
      --font-body: 'IBM Plex Sans', sans-serif;
      --font-mono: 'JetBrains Mono', monospace;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html { scrollbar-width: thin; scrollbar-color: var(--border) var(--bg-deep); }
    body {
      font-family: var(--font-body);
      background: var(--bg-deep);
      color: var(--text);
      line-height: 1.65;
      overflow-x: hidden;
      min-height: 100vh;
    }
    .grid-bg {
      position: fixed;
      inset: 0;
      z-index: 0;
      background-image:
        linear-gradient(var(--cyan-glow) 1px, transparent 1px),
        linear-gradient(90deg, var(--cyan-glow) 1px, transparent 1px);
      background-size: 60px 60px;
      mask-image: radial-gradient(ellipse 70% 50% at 50% 28%, black 22%, transparent 72%);
      -webkit-mask-image: radial-gradient(ellipse 70% 50% at 50% 28%, black 22%, transparent 72%);
      pointer-events: none;
    }
    .noise-layer {
      position: fixed;
      inset: 0;
      z-index: 0;
      opacity: 0.045;
      pointer-events: none;
      background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    }
    .scan-line {
      position: fixed;
      inset: 0;
      z-index: 0;
      pointer-events: none;
      background: repeating-linear-gradient(
        0deg,
        transparent,
        transparent 2px,
        rgba(0, 229, 255, 0.02) 2px,
        rgba(0, 229, 255, 0.02) 3px
      );
      mask-image: linear-gradient(to bottom, transparent, black 8%, black 92%, transparent);
      -webkit-mask-image: linear-gradient(to bottom, transparent, black 8%, black 92%, transparent);
      animation: scan-drift 14s linear infinite;
    }
    @keyframes scan-drift {
      0% { opacity: 0.35; }
      50% { opacity: 0.55; }
      100% { opacity: 0.35; }
    }
    .dash-aurora {
      position: fixed;
      border-radius: 50%;
      filter: blur(88px);
      pointer-events: none;
      z-index: 0;
    }
    .dash-aurora--a {
      width: min(42vw, 520px);
      height: min(42vw, 520px);
      top: -6%;
      left: 12%;
      background: radial-gradient(circle, rgba(0, 229, 255, 0.22), transparent 68%);
    }
    .dash-aurora--b {
      width: min(36vw, 460px);
      height: min(36vw, 460px);
      top: 18%;
      right: 6%;
      background: radial-gradient(circle, rgba(124, 58, 237, 0.2), transparent 68%);
    }
    .content-wrap { position: relative; z-index: 1; }
    .dash-main {
      padding: 5.5rem 2rem 4rem;
      max-width: 1100px;
      margin: 0 auto;
    }
    .section-label {
      font-family: var(--font-mono);
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--cyan);
      text-transform: uppercase;
      letter-spacing: 0.15em;
      margin-bottom: 1rem;
    }
    .dash-main h1 {
      font-family: var(--font-display);
      font-size: clamp(1.85rem, 4vw, 2.5rem);
      font-weight: 800;
      color: var(--text-heading);
      letter-spacing: -0.03em;
      line-height: 1.15;
      margin-bottom: 1rem;
    }
    .gradient-text {
      background: linear-gradient(135deg, var(--cyan), var(--violet));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .dash-lead {
      font-size: 0.98rem;
      color: var(--text);
      max-width: 42rem;
      margin-bottom: 2rem;
      line-height: 1.65;
    }
    .dash-lead code,
    .mono {
      font-family: var(--font-mono);
      font-size: 0.84em;
      background: var(--bg-surface);
      padding: 0.12em 0.45em;
      border-radius: 4px;
      border: 1px solid var(--border);
      color: var(--text-bright);
    }
    .dash-cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(10.5rem, 1fr));
      gap: 1rem;
      margin-bottom: 2.25rem;
    }
    .dash-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1rem 1.15rem;
      transition: border-color 0.25s, box-shadow 0.25s;
    }
    .dash-card:hover {
      border-color: var(--cyan-dim);
      box-shadow: 0 0 20px var(--cyan-glow);
    }
    .dash-card__label {
      display: block;
      font-family: var(--font-mono);
      font-size: 0.68rem;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--cyan);
      opacity: 0.92;
      margin-bottom: 0.45rem;
    }
    .dash-card__val {
      font-family: var(--font-display);
      font-size: 1.2rem;
      font-weight: 700;
      color: var(--text-heading);
      letter-spacing: -0.02em;
    }
    .table-wrap {
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
      background: var(--bg-surface);
      margin-bottom: 1.5rem;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.88rem;
    }
    th, td {
      border: 1px solid var(--border);
      padding: 0.65rem 0.85rem;
      text-align: left;
      vertical-align: top;
    }
    th {
      background: var(--bg-card);
      color: var(--text-heading);
      font-family: var(--font-mono);
      font-size: 0.68rem;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    tbody tr { transition: background 0.15s; }
    tbody tr:hover td { background: rgba(0, 229, 255, 0.04); }
    .err { color: #f87171; font-family: var(--font-mono); font-size: 0.82rem; }
    .pill {
      display: inline-flex;
      align-items: center;
      font-family: var(--font-mono);
      font-size: 0.72rem;
      padding: 0.3rem 0.65rem;
      border-radius: 6px;
      background: var(--bg-deep);
      border: 1px solid var(--border);
      color: var(--text);
      white-space: nowrap;
    }
    .pill:hover { border-color: var(--cyan-dim); color: var(--text-bright); box-shadow: 0 0 12px var(--cyan-dim); }
    .pill.done {
      border-color: var(--cyan-dim);
      color: var(--cyan);
      background: var(--cyan-glow);
    }
    .task {
      max-width: 16rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--text-bright);
    }
    .dash-status {
      font-family: var(--font-mono);
      font-size: 0.8rem;
      color: var(--text);
      opacity: 0.88;
    }
    .dash-toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.75rem 1rem;
      margin-bottom: 1.5rem;
      padding: 1rem 1.15rem;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
    }
    .dash-seg {
      display: inline-flex;
      border-radius: 8px;
      border: 1px solid var(--border);
      overflow: hidden;
      background: var(--bg-surface);
    }
    .dash-seg button {
      font-family: var(--font-body);
      font-size: 0.78rem;
      font-weight: 600;
      padding: 0.45rem 0.85rem;
      border: none;
      background: transparent;
      color: var(--text);
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .dash-seg button:hover { color: var(--text-bright); background: #ffffff08; }
    .dash-seg button.active {
      background: var(--cyan);
      color: var(--bg-deep);
    }
    .dash-search {
      flex: 1 1 12rem;
      min-width: 10rem;
      font-family: var(--font-body);
      font-size: 0.85rem;
      padding: 0.45rem 0.75rem;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--bg-deep);
      color: var(--text-bright);
    }
    .dash-search:focus {
      outline: 2px solid var(--cyan);
      outline-offset: 2px;
    }
    .dash-btn {
      font-family: var(--font-body);
      font-size: 0.78rem;
      font-weight: 600;
      padding: 0.45rem 0.9rem;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--bg-surface);
      color: var(--text-bright);
      cursor: pointer;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .dash-btn:hover { border-color: var(--cyan-dim); box-shadow: 0 0 14px var(--cyan-glow); }
    .dash-btn--primary {
      background: var(--cyan);
      color: var(--bg-deep);
      border-color: var(--cyan);
    }
    .dash-check {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.78rem;
      color: var(--text);
      cursor: pointer;
      user-select: none;
    }
    .dash-check input { accent-color: var(--cyan); }
    .dash-chart-panel {
      margin-bottom: 2rem;
      padding: 1.15rem 1.25rem;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
    }
    .dash-chart-panel h2 {
      font-family: var(--font-display);
      font-size: 1rem;
      font-weight: 700;
      color: var(--text-heading);
      margin-bottom: 1rem;
      letter-spacing: -0.02em;
    }
    .bar-row {
      display: flex;
      align-items: center;
      gap: 0.65rem;
      margin-bottom: 0.45rem;
      font-size: 0.78rem;
    }
    .bar-row:last-child { margin-bottom: 0; }
    .bar-name {
      flex: 0 0 9rem;
      font-family: var(--font-mono);
      color: var(--cyan);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .bar-track {
      flex: 1;
      height: 8px;
      background: var(--bg-surface);
      border-radius: 4px;
      overflow: hidden;
      border: 1px solid var(--border);
    }
    .bar-fill {
      height: 100%;
      border-radius: 3px;
      background: linear-gradient(90deg, var(--cyan), var(--violet));
      min-width: 2px;
    }
    .bar-count {
      flex: 0 0 2.5rem;
      text-align: right;
      font-family: var(--font-mono);
      color: var(--text-bright);
    }
    .dash-empty {
      display: none;
      margin-bottom: 2rem;
      padding: 1.5rem 1.75rem;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--bg-card);
      max-width: 42rem;
    }
    .dash-empty.visible { display: block; }
    .dash-empty h2 {
      font-family: var(--font-display);
      font-size: 1.1rem;
      color: var(--text-heading);
      margin-bottom: 0.75rem;
    }
    .dash-empty p { font-size: 0.9rem; margin-bottom: 0.65rem; color: var(--text); }
    .dash-empty a { color: var(--cyan); text-decoration: none; }
    .dash-empty a:hover { text-decoration: underline; }
    .row-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
    }
    .row-actions a, .row-actions button {
      font-family: var(--font-mono);
      font-size: 0.65rem;
      padding: 0.25rem 0.45rem;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--bg-deep);
      color: var(--cyan);
      cursor: pointer;
      text-decoration: none;
    }
    .row-actions a:hover, .row-actions button:hover { border-color: var(--cyan-dim); }
    .timeline {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.2rem;
      max-width: 14rem;
    }
    .timeline-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--violet);
      border: 1px solid var(--border);
      flex-shrink: 0;
    }
    .timeline-dot:last-child { background: var(--cyan); }
    .timeline-ellipsis { font-size: 0.65rem; color: var(--text); opacity: 0.7; }
    .cost-delta { font-size: 0.72rem; color: var(--accent-human); font-weight: 600; white-space: nowrap; }
    @media (prefers-reduced-motion: reduce) {
      .scan-line { animation: none; opacity: 0.25; }
    }
    @media (max-width: 768px) {
      .dash-main { padding: 4.5rem 1.25rem 3rem; }
      .dash-cards { grid-template-columns: repeat(2, 1fr); }
    }
  </style>
</head>
<body>
  <div class="grid-bg" aria-hidden="true"></div>
  <div class="noise-layer" aria-hidden="true"></div>
  <div class="scan-line" aria-hidden="true"></div>
  <div class="dash-aurora dash-aurora--a" aria-hidden="true"></div>
  <div class="dash-aurora dash-aurora--b" aria-hidden="true"></div>
  <div class="content-wrap">
    <main class="dash-main">
      <div class="section-label">// observability</div>
      <h1>Work <span class="gradient-text">dashboard</span></h1>
      <p class="dash-lead">Read-only view of each work item under <code>.worklogs</code> (from <code>state.json</code>) for the project passed as <code>--cwd</code>. Use filters and export for the current view.</p>
      <p class="dash-lead mono" id="meta-line" style="font-size:0.8rem;opacity:0.85;margin-top:-1.25rem;margin-bottom:1.5rem"></p>
      <div class="dash-empty" id="empty-panel" role="region" aria-label="No work items">
        <h2>No work items yet</h2>
        <p>Create one from your project root, for example:</p>
        <p><code>npm run work-engine -- init --id my-task --task "Describe the task"</code></p>
        <p>Or try demo data: <code>npm run seed-dashboard-demo</code> (writes sample <code>.worklogs</code> folders).</p>
        <p>Docs: <a href="https://agentic-swe.github.io/agentic-swe-site/docs/usage" target="_blank" rel="noopener noreferrer">Usage</a> · <a href="https://agentic-swe.github.io/agentic-swe-site/docs/check-commands" target="_blank" rel="noopener noreferrer">Check commands</a></p>
      </div>
      <div class="dash-toolbar">
        <div class="dash-seg" id="filter-seg" role="group" aria-label="Filter by completion">
          <button type="button" data-filter="all" class="active">All</button>
          <button type="button" data-filter="active">Active</button>
          <button type="button" data-filter="completed">Completed</button>
        </div>
        <input type="search" class="dash-search" id="dash-search" placeholder="Search work id, task, state, track…" autocomplete="off" />
        <button type="button" class="dash-btn dash-btn--primary" id="btn-refresh">Refresh</button>
        <button type="button" class="dash-btn" id="btn-load-more" style="display:none">Load more</button>
        <label class="dash-check"><input type="checkbox" id="auto-refresh" /> Auto (30s)</label>
        <button type="button" class="dash-btn" id="btn-export-json">Export JSON</button>
        <button type="button" class="dash-btn" id="btn-export-csv">Export CSV</button>
      </div>
      <div class="dash-chart-panel" id="state-chart-wrap" style="display:none">
        <h2>Current view — by state</h2>
        <div id="state-chart"></div>
      </div>
      <div class="dash-cards" id="rollup"></div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Work ID</th>
              <th>State</th>
              <th>Track</th>
              <th>Task</th>
              <th>Duration</th>
              <th>Iterations</th>
              <th>Cost (used / cap)</th>
              <th title="Increase since previous refresh">Δ cost</th>
              <th>Tokens</th>
              <th>Spawns / panels</th>
              <th>History</th>
              <th>Actions</th>
              <th>Transitions</th>
            </tr>
          </thead>
          <tbody id="rows"></tbody>
        </table>
      </div>
      <p class="dash-status" id="status">Loading…</p>
    </main>
  </div>
  <script>
    var ALL_ITEMS = [];
    var ROLLUP_FULL = {};
    var TOTAL_COUNT = 0;
    var PROJECT_ROOT = '';
    var LAST_COST_SNAPSHOT = {};
    var PAGE_LIMIT = 100;
    var FILTER = 'all';
    var SEARCH = '';
    var AUTO_TIMER = null;

    function fmtDur(ms) {
      if (ms == null || !Number.isFinite(ms)) return '—';
      const s = Math.floor(ms / 1000);
      if (s < 60) return s + 's';
      const m = Math.floor(s / 60);
      if (m < 120) return m + 'm';
      const h = Math.floor(m / 60);
      return h + 'h ' + (m % 60) + 'm';
    }
    function fmtUsd(n) {
      if (n == null || !Number.isFinite(n)) return '—';
      return '$' + n.toFixed(4);
    }
    function esc(s) {
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }
    function vscodeHref(abs) {
      if (!abs) return '#';
      var u = abs.replace(/\\\\/g, '/');
      if (u.indexOf('..') !== -1) return '#';
      return 'vscode://file/' + u;
    }
    function filteredItems() {
      return ALL_ITEMS.filter(function(it) {
        if (FILTER === 'active' && it.is_completed) return false;
        if (FILTER === 'completed' && !it.is_completed) return false;
        if (!SEARCH.trim()) return true;
        var q = SEARCH.trim().toLowerCase();
        var blob = [it.work_id, it.task, it.current_state, it.track || '', it.dir_id || '']
          .join(' ').toLowerCase();
        return blob.indexOf(q) !== -1;
      });
    }
    function renderStateChart(roll) {
      var wrap = document.getElementById('state-chart-wrap');
      var el = document.getElementById('state-chart');
      var by = (roll && roll.by_state) || {};
      var keys = Object.keys(by).filter(function(k) { return by[k] > 0; });
      if (!keys.length) {
        wrap.style.display = 'none';
        el.innerHTML = '';
        return;
      }
      var max = Math.max.apply(null, keys.map(function(k) { return by[k]; }), 1);
      wrap.style.display = 'block';
      el.innerHTML = keys.sort(function(a, b) { return by[b] - by[a]; }).map(function(k) {
        var pct = Math.round((by[k] / max) * 100);
        return '<div class="bar-row"><span class="bar-name" title="' + esc(k) + '">' + esc(k) + '</span>' +
          '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%"></div></div>' +
          '<span class="bar-count">' + by[k] + '</span></div>';
      }).join('');
    }
    function renderRollupCards(roll) {
      var cards = [
        ['Work items', roll.work_item_count],
        ['Completed', roll.completed_count],
        ['In progress', roll.in_progress_count],
        ['Total cost (used)', fmtUsd(roll.total_cost_used_usd)],
        ['Total cost (budget sum)', fmtUsd(roll.total_cost_budget_usd)],
        ['Tokens (in)', (roll.total_input_tokens || 0).toLocaleString()],
        ['Tokens (out)', (roll.total_output_tokens || 0).toLocaleString()],
        ['Cache read', (roll.total_cache_read_input_tokens || 0).toLocaleString()],
      ];
      document.getElementById('rollup').innerHTML = cards.map(function(c) {
        return '<div class="dash-card"><span class="dash-card__label">' + esc(c[0]) + '</span><span class="dash-card__val">' + esc(String(c[1])) + '</span></div>';
      }).join('');
    }
    function timelineHtml(it) {
      var rt = it.recent_transitions || [];
      if (!rt.length) return '<span class="timeline-ellipsis">—</span>';
      var dots = rt.map(function(t, i) {
        var title = esc(t.to) + (t.at ? ' @ ' + esc(t.at) : '');
        return '<span class="timeline-dot" title="' + title + '"></span>';
      }).join('');
      return '<div class="timeline" title="Recent states (hover dots)">' + dots + '</div>';
    }
    function actionsHtml(it) {
      if (it.error) return '';
      var rel = it.work_dir_relative || ('.worklogs/' + it.dir_id);
      var abs = it.state_json_abs_path || '';
      var vs = vscodeHref(abs);
      return '<div class="row-actions">' +
        '<button type="button" data-copy="' + esc(rel) + '">Copy path</button>' +
        (abs ? '<a href="' + esc(vs) + '">VS Code</a>' : '') +
        '</div>';
    }
    function costDeltaCell(it) {
      if (it.error || it.cost_used_usd == null || !Number.isFinite(it.cost_used_usd)) return '—';
      var k = it.dir_id || it.work_id;
      var prev = LAST_COST_SNAPSHOT[k];
      if (prev == null || !Number.isFinite(prev)) return '—';
      var d = it.cost_used_usd - prev;
      if (d <= 1e-9) return '—';
      return '<span class="cost-delta" title="since last refresh">+' + esc(d.toFixed(4)) + '</span>';
    }
    function snapshotCostsFromItems(arr) {
      arr.forEach(function(it) {
        var k = it.dir_id || it.work_id;
        if (it.cost_used_usd != null && Number.isFinite(it.cost_used_usd)) {
          LAST_COST_SNAPSHOT[k] = it.cost_used_usd;
        }
      });
    }
    function syncLoadMoreButton() {
      var btn = document.getElementById('btn-load-more');
      if (!btn) return;
      var left = TOTAL_COUNT - ALL_ITEMS.length;
      if (left > 0) {
        btn.style.display = 'inline-flex';
        btn.textContent = 'Load more (' + left + ')';
      } else {
        btn.style.display = 'none';
      }
    }
    function renderTable(items, roll) {
      var tb = document.getElementById('rows');
      tb.innerHTML = items.map(function(it) {
        if (it.error) {
          return '<tr><td class="mono">' + esc(it.work_id) + '</td><td colspan="12" class="err">' + esc(it.error) + '</td></tr>';
        }
        var statePill = it.is_completed
          ? '<span class="pill done">completed</span>'
          : '<span class="pill">' + esc(it.current_state || '') + '</span>';
        var iter = it.iterations_used != null && it.iteration_budget != null
          ? it.iterations_used + ' / ' + it.iteration_budget
          : '—';
        var cost = (it.cost_used_usd != null ? fmtUsd(it.cost_used_usd) : '—') + ' / ' + (it.cost_budget_usd != null ? fmtUsd(it.cost_budget_usd) : '—');
        var delta = costDeltaCell(it);
        var tok = it.tokens_total != null && it.tokens_total > 0 ? it.tokens_total.toLocaleString() : '—';
        var sp = (it.counters && it.counters.subagent_spawns != null ? it.counters.subagent_spawns : '—')
          + ' / ' + (it.counters && it.counters.panel_runs != null ? it.counters.panel_runs : '—');
        return '<tr><td class="mono">' + esc(it.work_id) + '</td><td>' + statePill + '</td><td>' + esc(it.track || '—') + '</td><td class="task" title="' + esc(it.task) + '">' + esc(it.task) + '</td><td>' + esc(fmtDur(it.duration_ms)) + '</td><td class="mono">' + esc(iter) + '</td><td class="mono">' + cost + '</td><td class="mono">' + delta + '</td><td class="mono">' + esc(tok) + '</td><td class="mono">' + esc(sp) + '</td><td class="mono">' + String(it.history_length || 0) + '</td><td>' + actionsHtml(it) + '</td><td>' + timelineHtml(it) + '</td></tr>';
      }).join('');
      document.getElementById('rows').onclick = function(ev) {
        var t = ev.target;
        if (t && t.getAttribute && t.getAttribute('data-copy')) {
          navigator.clipboard.writeText(t.getAttribute('data-copy')).then(function() {
            t.textContent = 'Copied!';
            setTimeout(function() { t.textContent = 'Copy path'; }, 1500);
          }).catch(function() {});
        }
      };
    }
    function applyView() {
      var items = filteredItems();
      var roll = ROLLUP_FULL && ROLLUP_FULL.work_item_count != null ? ROLLUP_FULL : {};
      renderRollupCards(roll);
      renderStateChart(roll);
      renderTable(items, roll);
      snapshotCostsFromItems(ALL_ITEMS);
      var shown = items.length;
      var loaded = ALL_ITEMS.length;
      var tc = TOTAL_COUNT || loaded;
      var statusEl = document.getElementById('status');
      if (tc === 0) {
        statusEl.textContent = 'No work items under .worklogs/';
      } else {
        statusEl.textContent = 'Showing ' + shown + ' in view · ' + loaded + ' loaded / ' + tc + ' total in repo';
      }
      document.getElementById('empty-panel').classList.toggle('visible', tc === 0);
    }
    function loadData(opts) {
      opts = opts || {};
      var append = !!opts.append;
      var offset = append ? ALL_ITEMS.length : 0;
      var url = '/api/work-items?limit=' + PAGE_LIMIT + '&offset=' + offset;
      return fetch(url).then(function(r) { return r.json(); }).then(function(data) {
        var incoming = data.items || [];
        if (data.rollup) ROLLUP_FULL = data.rollup;
        TOTAL_COUNT = typeof data.total_count === 'number' ? data.total_count : incoming.length;
        if (!append) {
          ALL_ITEMS = [];
        }
        incoming.forEach(function(it) {
          var k = it.dir_id || it.work_id;
          var dup = ALL_ITEMS.some(function(x) { return (x.dir_id || x.work_id) === k; });
          if (!dup) ALL_ITEMS.push(it);
        });
        syncLoadMoreButton();
        applyView();
      });
    }
    function exportJson() {
      var items = filteredItems();
      var blob = new Blob([JSON.stringify({
        api: 'work-items-v1',
        projectRoot: PROJECT_ROOT,
        exported_at: new Date().toISOString(),
        rollup: ROLLUP_FULL,
        items: items,
      }, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'work-dashboard-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      URL.revokeObjectURL(a.href);
    }
    function exportCsv() {
      var items = filteredItems().filter(function(it) { return !it.error; });
      var cols = ['work_id','current_state','track','task','duration_ms','iterations_used','iteration_budget','cost_used_usd','cost_budget_usd','tokens_total','subagent_spawns','panel_runs','history_length','work_dir_relative'];
      var lines = [cols.join(',')];
      items.forEach(function(it) {
        var row = cols.map(function(c) {
          var v = it[c];
          if (c === 'subagent_spawns') v = it.counters && it.counters.subagent_spawns;
          if (c === 'panel_runs') v = it.counters && it.counters.panel_runs;
          if (v == null) v = '';
          v = String(v).replace(/"/g, '""');
          if (/[",\\n]/.test(v)) v = '"' + v + '"';
          return v;
        });
        lines.push(row.join(','));
      });
      var blob = new Blob([lines.join('\\n')], { type: 'text/csv;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'work-dashboard-' + new Date().toISOString().slice(0, 10) + '.csv';
      a.click();
      URL.revokeObjectURL(a.href);
    }
    function wireUi() {
      document.getElementById('filter-seg').onclick = function(ev) {
        var b = ev.target.closest('button');
        if (!b || !b.getAttribute('data-filter')) return;
        FILTER = b.getAttribute('data-filter');
        [].forEach.call(document.querySelectorAll('#filter-seg button'), function(x) {
          x.classList.toggle('active', x.getAttribute('data-filter') === FILTER);
        });
        applyView();
      };
      document.getElementById('dash-search').oninput = function() {
        SEARCH = this.value;
        applyView();
      };
      document.getElementById('btn-refresh').onclick = function() {
        LAST_COST_SNAPSHOT = {};
        loadData({ append: false }).catch(function(e) { document.getElementById('status').textContent = 'Error: ' + e.message; });
      };
      document.getElementById('btn-load-more').onclick = function() {
        loadData({ append: true }).catch(function(e) { document.getElementById('status').textContent = 'Error: ' + e.message; });
      };
      document.getElementById('btn-export-json').onclick = exportJson;
      document.getElementById('btn-export-csv').onclick = exportCsv;
      document.getElementById('auto-refresh').onchange = function() {
        if (AUTO_TIMER) { clearInterval(AUTO_TIMER); AUTO_TIMER = null; }
        if (this.checked) {
          AUTO_TIMER = setInterval(function() { loadData({ append: false }).catch(function() {}); }, 30000);
        }
      };
    }
    Promise.all([
      fetch('/api/meta').then(function(r) { return r.json(); }),
      fetch('/api/work-items?limit=' + PAGE_LIMIT + '&offset=0').then(function(r) { return r.json(); }),
    ]).then(function(pair) {
      var ml = document.getElementById('meta-line');
      if (pair[0].projectRoot) PROJECT_ROOT = pair[0].projectRoot;
      if (ml && pair[0].projectRoot) ml.textContent = 'Project root: ' + pair[0].projectRoot;
      var data = pair[1];
      ALL_ITEMS = data.items || [];
      if (data.rollup) ROLLUP_FULL = data.rollup;
      TOTAL_COUNT = typeof data.total_count === 'number' ? data.total_count : ALL_ITEMS.length;
      syncLoadMoreButton();
      wireUi();
      applyView();
    }).catch(function(e) {
      document.getElementById('status').textContent = 'Error: ' + e.message;
    });
  </script>
</body>
</html>`;
}

function main() {
  const { cwd, port, shouldOpen } = parseArgs(process.argv);
  const host = '127.0.0.1';

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${host}:${port}`);

    if (req.method === 'GET' && url.pathname === '/api/meta') {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify({ projectRoot: path.resolve(cwd) }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/rollup') {
      readJsonBody(req)
        .then((body) => {
          const items = Array.isArray(body.items) ? body.items : [];
          const rollup = buildRollup(items);
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
          });
          res.end(JSON.stringify({ rollup }));
        })
        .catch((e) => {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: String(e.message || e) }));
        });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/work-items') {
      try {
        const lim = url.searchParams.get('limit');
        const off = url.searchParams.get('offset');
        const opts = {};
        if (lim != null && lim !== '') {
          const n = parseInt(lim, 10);
          if (Number.isFinite(n)) opts.limit = n;
        }
        if (off != null && off !== '') {
          const n = parseInt(off, 10);
          if (Number.isFinite(n)) opts.offset = n;
        }
        const payload = collectWorkDashboard(cwd, opts);
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify(payload, null, 0));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(e.message || e) }));
      }
      return;
    }

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(htmlPage());
      return;
    }

    if (req.method !== 'GET' && req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      res.end('Method Not Allowed');
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  server.listen(port, host, () => {
    const base = `http://${host}:${port}/`;
    console.log(`agentic-swe dashboard listening at ${base}`);
    console.log(`Project root (cwd): ${cwd}`);
    if (shouldOpen) openUrl(base);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is in use. Set SWE_DASHBOARD_PORT or use --port.`);
    } else {
      console.error(err);
    }
    process.exit(1);
  });
}

main();
