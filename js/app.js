/* Greenspace Finance: UI */
(function () {
  'use strict';
  const C = window.GSCore;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n, dp = 2) => (n < 0 ? '-' : '') + '$' + Math.abs(n || 0).toLocaleString('en-NZ', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  const money0 = n => money(n, 0);
  const hrs = n => (Math.round((n || 0) * 100) / 100).toLocaleString('en-NZ', { maximumFractionDigits: 2 });
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${C.pad(d.getMonth() + 1)}-${C.pad(d.getDate())}`; };
  const CAT_COLORS = { Consulting: 'var(--accent)', Landscaping: 'var(--soil)', Admin: 'var(--muted)', Travel: 'var(--warn)' };
  const clone = o => JSON.parse(JSON.stringify(o));

  // ---------- browser storage (only used when the server database is not reachable) ----------
  const store = {
    get(k, fb) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch { } }
  };

  // ---------- database ----------
  // Server mode: Netlify function /api/db (Netlify Blobs). Local mode: this browser only (preview / offline).
  const db = {
    mode: 'server',
    async load() {
      try {
        const r = await fetch('/api/db', { headers: { accept: 'application/json' } });
        if (!r.ok) throw new Error('db ' + r.status);
        const ct = r.headers.get('content-type') || '';
        if (!ct.includes('json')) throw new Error('not json');
        this.mode = 'server';
        return await r.json();
      } catch {
        this.mode = 'local';
        const l = store.get('gs.db', null);
        return { entries: (l && l.entries) || [], config: (l && l.config) || null, empty: !l };
      }
    },
    async send(url, method, body) {
      const r = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Save failed (' + r.status + ')');
      return j;
    },
    saveLocal() { store.set('gs.db', { entries: state.data.rows, config: state.config }); },
    async saveDay(date, entries) {
      if (this.mode === 'local') return this.saveLocal();
      return this.send('/api/db?day=' + date, 'PUT', { entries });
    },
    async saveConfig(config) {
      if (this.mode === 'local') return this.saveLocal();
      return this.send('/api/db?config=1', 'PUT', { config });
    },
    async importAll(entries, config, from) {
      if (this.mode === 'local') { state.data.rows = entries; return this.saveLocal(); }
      return this.send('/api/db?import=1', 'POST', { entries, config, from });
    }
  };

  function defaultConfig() {
    const d = clone(window.GS_DEFAULT_CONFIG);
    const st = defaultSettings(); st.tiers = { A: 0.2, B: 0.15, C: 0.1, D: 0.05 };
    return { projects: d.projects, targets: d.targets, mileageRate: d.mileageRate, materials: [], settings: st };
  }
  function defaultSettings() {
    const d = clone(window.GS_BILLING_DEFAULTS);
    d.invoiced = []; d.fromDate = '2026-09-01';
    return d;
  }
  // Fill any missing pieces of a saved config from the defaults
  function normaliseConfig(c) {
    const d = defaultConfig();
    if (!c) return d;
    const s = Object.assign(defaultSettings(), c.settings || {});
    const defP = clone(window.GS_BILLING_DEFAULTS.projects), savedP = (c.settings && c.settings.projects) || {};
    s.projects = {};
    for (const k of new Set([...Object.keys(defP), ...Object.keys(savedP)])) s.projects[k] = Object.assign({}, defP[k] || {}, savedP[k] || {});
    s.contacts = Object.assign(clone(window.GS_BILLING_DEFAULTS.contacts), (c.settings && c.settings.contacts) || {});
    s.invoiced = (c.settings && c.settings.invoiced) || [];
    s.tiers = Object.assign({ A: 0.2, B: 0.15, C: 0.1, D: 0.05 }, (c.settings && c.settings.tiers) || {});
    return { projects: c.projects && c.projects.length ? c.projects : d.projects, targets: c.targets || d.targets, mileageRate: c.mileageRate || d.mileageRate, materials: c.materials || [], settings: s };
  }

  const state = {
    config: null, settings: null, data: null, view: 'dashboard',
    tsDate: null, tsMonth: null, dashMonth: null, editing: null,
    inv: null, xero: { checked: false, available: false, connected: false }, charts: {}, saving: 0
  };

  function applyConfig(cfg) {
    state.config = normaliseConfig(cfg);
    state.settings = state.config.settings;
    if (state.data) { state.data.targets = state.config.targets; state.data.projects = state.config.projects; state.data.mileageRate = state.config.mileageRate; }
  }
  function setRows(rows) {
    state.data = { rows: rows.slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)), targets: state.config.targets, projects: state.config.projects, mileageRate: state.config.mileageRate, fromDate: state.settings.fromDate };
  }

  // ---------- save status ----------
  let cfgTimer;
  function saveSettings() { clearTimeout(cfgTimer); cfgTimer = setTimeout(() => track(db.saveConfig(state.config)), 400); }
  async function track(p) {
    state.saving++; updateChip();
    try { await p; state.lastSaved = new Date(); state.saveError = null; }
    catch (e) { state.saveError = e.message; toast('Not saved: ' + e.message, 6000); }
    finally { state.saving--; updateChip(); }
  }
  function updateChip() {
    const chip = $('#dataChip');
    if (state.saveError) { chip.textContent = 'Not saved, check connection'; chip.className = 'chip bad'; return; }
    if (state.saving) { chip.textContent = 'Saving ...'; chip.className = 'chip'; return; }
    if (db.mode === 'local') { chip.textContent = 'Saved in this browser only'; chip.className = 'chip warn'; chip.title = 'The app database is available once deployed to Netlify'; return; }
    chip.textContent = state.lastSaved ? 'All changes saved' : 'Saved on your Netlify site';
    chip.className = 'chip ok'; chip.title = '';
  }

  // ---------- toast ----------
  let toastTimer;
  function toast(msg, ms = 2800) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }

  // ---------- one-off workbook import ----------
  async function importWorkbook(file, from) {
    if (!file) return;
    if (!window.XLSX) { toast('The spreadsheet reader did not load. Check your connection and reload.'); return; }
    toast('Reading ' + file.name + ' ...', 10000);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheets = {};
      for (const n of wb.SheetNames) sheets[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null });
      if (!sheets.Timesheet) throw new Error('This workbook has no Timesheet tab.');
      from = from || state.settings.fromDate || '2026-09-01';
      const parsed = C.parseWorkbook(sheets, { fromDate: from });
      const entries = C.rowsToEntries(parsed.rows);
      // rates, mileage and targets from the workbook, keeping anything added in the app
      const cfg = clone(state.config);
      for (const p of parsed.projects) {
        const rate = p.rateNew || p.rateOld || 0;
        const ex = cfg.projects.find(x => x.client === p.client && x.project === p.project);
        if (ex) ex.rate = rate; else cfg.projects.push({ client: p.client, project: p.project, rate });
      }
      if (parsed.mileageRate) cfg.mileageRate = parsed.mileageRate;
      for (const [mk, t] of Object.entries(parsed.targets)) if (t.target) cfg.targets[mk] = { target: t.target, targetDays: t.targetDays || t.netDays || 21 };
      cfg.materials = (cfg.materials || []).filter(m => m.source !== 'workbook').concat(C.parseMaterials(sheets));
      cfg.settings.fromDate = from;
      cfg.settings.importedAt = new Date().toISOString(); cfg.settings.importedFile = file.name;
      toast('Saving ' + entries.length + ' entries ...', 10000);
      await db.importAll(entries, cfg, from);
      applyConfig(cfg);
      if (db.mode === 'local') db.saveLocal();
      // reload what the server now holds (keeps any entries before `from`)
      const fresh = db.mode === 'server' ? await db.load() : { entries };
      setRows(fresh.entries || entries);
      state.firstRun = false; state.inv = null; state.tsDate = null; state.dashMonth = null; pickDates();
      toast(`Imported ${entries.length} entries from ${file.name}. Everything now lives in the app.`, 5000);
      go('dashboard');
    } catch (e) { console.error(e); toast('Could not import the workbook: ' + e.message, 7000); }
  }

  function pickDates() {
    const rows = state.data.rows; const t = todayISO();
    const last = rows.length ? rows[rows.length - 1].date : t;
    state.tsDate = state.tsDate || t;
    state.dashMonth = state.dashMonth || C.monthKey(t);
  }

  // drag & drop a workbook anywhere on the Setup page or the welcome screen
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    if (state.view === 'setup' || state.firstRun) importWorkbook(f, $('#impFrom')?.value);
    else toast('To import a workbook, go to Setup.');
  });
  $('#fileInput').addEventListener('change', e => { importWorkbook(e.target.files[0], $('#impFrom')?.value); e.target.value = ''; });

  // ---------- routing ----------
  const VIEWS = ['dashboard', 'timesheet', 'invoicing', 'landscaping', 'setup'];
  function route() {
    let h = (location.hash || '').replace('#', '');
    if (h === 'materials') h = 'landscaping';
    state.view = VIEWS.includes(h) ? h : 'dashboard';
    document.body.dataset.view = state.view;
    $$('.tabs a').forEach(a => a.setAttribute('aria-current', a.dataset.view === state.view ? 'page' : 'false'));
    $$('.view').forEach(v => { v.hidden = true; });
    if (!state.data) { $('#view-loading').hidden = false; return; }
    if (state.firstRun && state.view !== 'setup') { renderWelcome($('#view-empty')); $('#view-empty').hidden = false; return; }
    const el = $('#view-' + state.view); el.hidden = false;
    ({ dashboard: renderDashboard, timesheet: renderTimesheet, invoicing: renderInvoicing, landscaping: renderMaterials, setup: renderSetup })[state.view](el);
  }
  window.addEventListener('hashchange', route);
  const go = v => { if (location.hash === '#' + v) route(); else location.hash = v; };

  function renderWelcome(el) {
    el.innerHTML = `
      <div class="dropzone">
        <h1>Welcome to Greenspace Finance</h1>
        <p>Your timesheet, rates, targets and billing details are kept in this app from now on. Bring your existing history across once from the workbook, or start with an empty timesheet.</p>
        <div class="add-lines" style="justify-content:center">
          <label class="field"><span>Bring entries across from</span><input type="date" id="impFrom" value="${esc(state.settings.fromDate || '2026-09-01')}"></label>
        </div>
        <div class="add-lines" style="justify-content:center">
          <label class="btn" for="fileInput">Import 2026 Financials workbook (one time)</label>
          <button class="btn btn-quiet" id="startEmpty">Start with an empty timesheet</button>
        </div>
        <p class="note">Only the Timesheet, Config and Working Days tabs are read. You can drop the workbook onto this page too.</p>
      </div>`;
    $('#startEmpty').onclick = async () => {
      state.firstRun = false;
      await track(db.saveConfig(state.config));
      go('timesheet');
    };
  }

  // ---------- helpers ----------
  const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  function billingFor(client, project) {
    const p = state.settings.projects;
    return p[client + '|' + project] || p[client + '|*'] || { contact: client, reference: '', header: '', due: '20th' };
  }
  const isBillable = client => client && !state.settings.nonBillable.includes(client);
  function monthTargetPerDay(mk) {
    const t = state.data.targets[mk];
    return t && t.target ? t.target / (t.targetDays || 21) : 0;
  }
  function allMonths() {
    const ms = new Set(C.monthsInData(state.data)); ms.add(C.monthKey(todayISO()));
    return [...ms].sort();
  }

  // ======================================================================
  // DASHBOARD
  // ======================================================================
  function renderDashboard(el) {
    const d = state.data;
    const months = allMonths();
    const t = todayISO();
    if (!months.includes(state.dashMonth)) state.dashMonth = months[months.length - 1];
    const mk = state.dashMonth;
    const s = C.monthStats(d, mk, t);
    const isCurrent = mk === C.monthKey(t);
    const pct = s.target ? s.revenue / s.target : 0;
    const pctTD = s.target ? s.targetToDate / s.target : 0;
    const variance = s.revenue - (isCurrent ? s.targetToDate : s.target);
    // run rate: revenue per elapsed weekday x weekdays in month
    const elapsed = s.daily.filter(x => !x.future && C.weekday(x.date) % 6 !== 0).length;
    const weekdays = s.daily.filter(x => C.weekday(x.date) % 6 !== 0).length;
    const projected = isCurrent && elapsed ? s.revenue / elapsed * weekdays : s.revenue;
    // since start of data
    const allRev = d.rows.filter(r => r.client).reduce((a, r) => a + r.amount, 0);
    const allHrs = d.rows.filter(r => r.client).reduce((a, r) => a + r.hours, 0);
    const allTarget = months.filter(m => m <= C.monthKey(t)).reduce((a, m) => a + (d.targets[m]?.target || 0), 0);
    const billableHrs = s.projects.filter(p => isBillable(p.client)).reduce((a, p) => a + p.hours, 0);

    const mi = months.indexOf(mk);
    el.innerHTML = `
      <div class="view-head">
        <div><div class="label">Dashboard</div><h1>${C.monthLabel(mk)}</h1></div>
        <div class="controls">
          <button class="btn btn-quiet btn-small" id="dPrev" ${mi <= 0 ? 'disabled' : ''} aria-label="Previous month">&larr;</button>
          <select id="dMonth" aria-label="Month">${months.map(m => `<option value="${m}" ${m === mk ? 'selected' : ''}>${C.monthLabel(m)}</option>`).join('')}</select>
          <button class="btn btn-quiet btn-small" id="dNext" ${mi >= months.length - 1 ? 'disabled' : ''} aria-label="Next month">&rarr;</button>
        </div>
      </div>

      <div class="kpis">
        <div class="kpi lead">
          <span class="label">Revenue this month</span>
          <span class="value">${money0(s.revenue)}</span>
          <span class="sub">${s.target ? `${Math.round(pct * 100)}% of ${money0(s.target)} target` : 'No target set in Working Days'}</span>
          <div class="meter" title="Bar: revenue. Marker: where the target should be today"><i style="width:${Math.min(100, pct * 100)}%"></i>${isCurrent ? `<b style="left:${Math.min(100, pctTD * 100)}%"></b>` : ''}</div>
        </div>
        <div class="kpi">
          <span class="label">${isCurrent ? 'Against target to date' : 'Against target'}</span>
          <span class="value" style="color:${variance >= 0 ? 'var(--good)' : 'var(--bad)'}">${variance >= 0 ? '+' : ''}${money0(variance)}</span>
          <span class="sub">${isCurrent ? `Target to today ${money0(s.targetToDate)}` : `Month target ${money0(s.target)}`}</span>
        </div>
        <div class="kpi">
          <span class="label">Hours worked</span>
          <span class="value">${hrs(s.hours)}</span>
          <span class="sub">${s.daysWorked} days worked of ${s.targetDays} target · ${hrs(billableHrs)} billable</span>
        </div>
        <div class="kpi">
          <span class="label">${isCurrent ? 'Projected month end' : 'Mileage recovered'}</span>
          <span class="value">${isCurrent ? money0(projected) : money0(s.mileage)}</span>
          <span class="sub">${isCurrent ? `At the current daily rate · mileage ${money0(s.mileage)}` : `${s.kms.toLocaleString()} km`}</span>
        </div>
        <div class="kpi">
          <span class="label">Since ${C.fmtDateLong(d.fromDate).slice(4)}</span>
          <span class="value">${money0(allRev)}</span>
          <span class="sub">${hrs(allHrs)} hours · target ${money0(allTarget)}</span>
        </div>
      </div>

      <div class="grid-2">
        <div class="panel">
          <div class="panel-head"><h2>Cumulative revenue</h2>
            <div class="legend"><span><i style="background:var(--accent)"></i>Actual</span><span><i style="background:var(--soil)"></i>Target</span></div></div>
          <div class="chart-box"><canvas id="cCum" aria-label="Cumulative revenue against target"></canvas></div>
        </div>
        <div class="panel">
          <div class="panel-head"><h2>Revenue by month</h2>
            <div class="legend"><span><i style="background:var(--accent)"></i>Timesheet $</span><span><i style="background:var(--soil)"></i>Target</span></div></div>
          <div class="chart-box"><canvas id="cMonths" aria-label="Revenue by month against target"></canvas></div>
        </div>
      </div>

      <div class="grid-2">
        <div class="panel">
          <div class="panel-head"><h2>By client and project</h2><span class="note">${C.monthLabel(mk)}</span></div>
          <div class="table-wrap"><table>
            <thead><tr><th>Client</th><th>Project</th><th class="num">Hours</th><th class="num">Rate</th><th class="num">Amount</th><th>Share</th></tr></thead>
            <tbody>${s.projects.map(p => `<tr>
              <td>${esc(p.client)}</td><td>${esc(p.project)}</td><td class="num">${hrs(p.hours)}</td><td class="num">${p.rate ? '$' + p.rate : '-'}</td>
              <td class="num">${money(p.amount)}</td>
              <td><div class="bar-cell"><span class="bar" style="flex:none;width:${s.revenue ? Math.max(2, Math.round(p.amount / s.revenue * 100)) : 0}px"></span><span class="muted num">${s.revenue ? Math.round(p.amount / s.revenue * 100) : 0}%</span></div></td>
            </tr>`).join('') || '<tr><td colspan="6" class="muted">No time recorded this month.</td></tr>'}</tbody>
            <tfoot><tr><td colspan="2">Total</td><td class="num">${hrs(s.hours)}</td><td></td><td class="num">${money(s.revenue)}</td><td></td></tr></tfoot>
          </table></div>
          <div class="panel-head" style="margin-top:18px"><h3>By category</h3></div>
          <div class="table-wrap"><table>
            <tbody>${['Consulting', 'Landscaping', 'Admin', 'Travel'].filter(c => s.categories[c] || s.categoryHours[c]).map(c => `<tr>
              <td><span class="cat-dot" style="background:${CAT_COLORS[c]}"></span>${c}</td><td class="num">${hrs(s.categoryHours[c])} h</td><td class="num">${money(s.categories[c] || 0)}</td></tr>`).join('')}</tbody>
          </table></div>
        </div>
        <div class="panel">${readyToInvoiceHTML(C.addMonths(C.monthKey(t), -1), C.monthKey(t))}</div>
      </div>`;

    $('#dMonth').onchange = e => { state.dashMonth = e.target.value; renderDashboard(el); };
    $('#dPrev').onclick = () => { state.dashMonth = months[mi - 1]; renderDashboard(el); };
    $('#dNext').onclick = () => { state.dashMonth = months[mi + 1]; renderDashboard(el); };
    $$('[data-prep]', el).forEach(b => b.onclick = () => {
      const [client, projectsJSON, mkk] = JSON.parse(b.dataset.prep);
      startInvoice(client, projectsJSON, C.monthStart(mkk), C.monthEnd(mkk));
      go('invoicing');
    });
    $$('[data-mkinv]', el).forEach(b => b.onclick = () => {
      const r = JSON.parse(b.dataset.mkinv);
      state.settings.invoiced.push({ ...r, number: '', total: null, at: new Date().toISOString(), manual: true });
      saveSettings(); renderDashboard(el); toast('Marked as invoiced');
    });
    drawDashboardCharts(s, months, isCurrent);
  }

  // Groups billable time by invoice (client + billing contact + reference) for a month.
  function invoiceGroups(mk) {
    const rows = state.data.rows.filter(r => C.monthKey(r.date) === mk && isBillable(r.client) && (r.hours || r.kms));
    const g = new Map();
    for (const r of rows) {
      const b = billingFor(r.client, r.project);
      const k = r.client + '|' + (b.contact || r.client) + '|' + (b.reference || '');
      if (!g.has(k)) g.set(k, { client: r.client, contact: b.contact || r.client, reference: b.reference || '', projects: new Set(), hours: 0, amount: 0, kms: 0, kmAmt: 0 });
      const x = g.get(k); x.projects.add(r.project); x.hours += r.hours; x.amount += r.amount; x.kms += r.kms; x.kmAmt += r.kmAmt;
    }
    return [...g.values()].filter(x => x.amount > 0 || x.kmAmt > 0).map(x => ({ ...x, projects: [...x.projects] })).sort((a, b) => b.amount - a.amount);
  }
  function isInvoiced(mk, client, projects) {
    return state.settings.invoiced.find(i => i.month === mk && i.client === client && projects.every(p => i.projects.includes(p)));
  }
  function readyToInvoiceHTML(prevMk, curMk) {
    const block = mk => {
      const groups = invoiceGroups(mk);
      if (!groups.length) return `<p class="muted">No billable time in ${C.monthLabel(mk)}.</p>`;
      return `<div class="table-wrap"><table>
        <thead><tr><th>Bill to</th><th>Projects</th><th class="num">Hours</th><th class="num">Excl GST</th><th>Status</th><th></th></tr></thead>
        <tbody>${groups.map(gx => {
          const done = isInvoiced(mk, gx.client, gx.projects);
          const total = gx.amount + gx.kmAmt;
          return `<tr>
            <td>${esc(gx.contact)}${gx.reference ? `<div class="muted mono" style="font-size:.75rem">${esc(gx.reference)}</div>` : ''}</td>
            <td>${esc(gx.client)}: ${gx.projects.map(esc).join(', ')}</td>
            <td class="num">${hrs(gx.hours)}</td><td class="num">${money(total)}</td>
            <td>${done ? `<span class="chip ok">${done.number ? esc(done.number) : 'Invoiced'}</span>` : '<span class="chip warn">To do</span>'}</td>
            <td style="white-space:nowrap"><button class="btn btn-small btn-ghost" data-prep='${esc(JSON.stringify([gx.client, gx.projects, mk]))}'>Prepare</button>
            ${done ? '' : `<button class="btn btn-small btn-quiet" title="Record that this has been invoiced" data-mkinv='${esc(JSON.stringify({ month: mk, client: gx.client, projects: gx.projects }))}'>Done</button>`}</td>
          </tr>`;
        }).join('')}</tbody></table></div>`;
    };
    return `<div class="panel-head"><h2>Ready to invoice</h2><span class="note">Billable time grouped the way you bill it</span></div>
      <h3 style="margin:4px 0 8px">${C.monthLabel(prevMk)}</h3>${block(prevMk)}
      <h3 style="margin:18px 0 8px">${C.monthLabel(curMk)} so far</h3>${block(curMk)}`;
  }

  function drawDashboardCharts(s, months, isCurrent) {
    if (!window.Chart) return;
    Object.values(state.charts).forEach(c => c.destroy()); state.charts = {};
    const ink = cssVar('--muted'), line = cssVar('--line'), acc = cssVar('--accent'), soil = cssVar('--soil');
    Chart.defaults.font.family = cssVar('--f-body') || 'sans-serif';
    Chart.defaults.color = ink;
    const fmtK = v => '$' + (v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'k' : v);
    const labels = s.daily.map(x => +x.date.slice(8));
    const actual = s.daily.map(x => x.future ? null : x.cumActual);
    state.charts.cum = new Chart($('#cCum'), {
      type: 'line',
      data: { labels, datasets: [
        { label: 'Actual', data: actual, borderColor: acc, backgroundColor: acc + '22', fill: true, tension: .15, pointRadius: ctx => ctx.dataIndex === actual.filter(v => v !== null).length - 1 ? 4 : 0, pointBackgroundColor: acc, borderWidth: 2.5 },
        { label: 'Target', data: s.daily.map(x => x.cumTarget), borderColor: soil, borderDash: [5, 4], pointRadius: 0, borderWidth: 2, fill: false }
      ] },
      options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: false }, tooltip: { callbacks: { title: i => C.fmtDateLong(s.daily[i[0].dataIndex].date), label: c => `${c.dataset.label}: ${money0(c.parsed.y)}` } } },
        scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } }, y: { beginAtZero: true, grid: { color: line }, ticks: { callback: fmtK } } } }
    });
    const ms = months.map(m => C.monthStats(state.data, m));
    state.charts.months = new Chart($('#cMonths'), {
      data: { labels: months.map(m => C.monthLabel(m).replace(/ (\d{2})(\d{2})$/, ' $2')), datasets: [
        { type: 'bar', label: 'Timesheet $', data: ms.map(x => x.revenue), backgroundColor: months.map(m => m === s.mk ? acc : acc + '88'), borderRadius: 4, maxBarThickness: 46 },
        { type: 'line', label: 'Target', data: ms.map(x => x.target || null), borderColor: soil, backgroundColor: soil, borderDash: [5, 4], pointRadius: 3, borderWidth: 2 }
      ] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${money0(c.parsed.y)}` } } },
        scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: line }, ticks: { callback: fmtK } } } }
    });
  }
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (state.view === 'dashboard' && state.data) route(); });


  // ======================================================================
  // TIMESHEET (enter and edit time)
  // ======================================================================
  function clientsList() { return [...new Set(state.config.projects.map(p => p.client))].sort((a, b) => a.localeCompare(b)); }
  function projectsFor(client) { return state.config.projects.filter(p => p.client === client).map(p => p.project); }

  function entryFormHTML(e, isNew) {
    const clients = clientsList();
    const client = e.client || clients[0] || '';
    const projects = projectsFor(client);
    const hours = Math.max(0, Math.round((C.toMin(e.end) - C.toMin(e.time)) / 15) / 4);
    return `<form class="entry-form" id="entryForm" data-id="${esc(e.id || '')}" autocomplete="off">
      <div class="ef-grid">
        <label class="field"><span>Start</span><input type="time" step="900" id="fStart" value="${esc(e.time)}" required></label>
        <label class="field"><span>End</span><input type="time" step="900" id="fEnd" value="${esc(e.end)}" required></label>
        <div class="field"><span>Hours</span><output id="fHours" class="ef-hours">${hrs(hours)}</output></div>
        <label class="field"><span>Client</span><select id="fClient">${clients.map(c => `<option ${c === client ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
        <label class="field"><span>Project</span><select id="fProject">${projects.map(p => `<option ${p === e.project ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label>
        <label class="field ef-wide"><span>Activity</span><input type="text" id="fActivity" value="${esc(e.activity)}" placeholder="What you did, e.g. Site visit Puhoi; call Scott"></label>
        <label class="field"><span>Km</span><input type="number" min="0" step="1" id="fKms" value="${e.kms || ''}" placeholder="0"></label>
        <label class="field ef-wide"><span>Notes (not on invoices)</span><input type="text" id="fNotes" value="${esc(e.notes)}"></label>
      </div>
      <div class="add-lines">
        <button class="btn" type="submit">${isNew ? 'Add entry' : 'Save changes'}</button>
        <button class="btn btn-quiet" type="button" id="fCancel">Cancel</button>
        <span class="note" id="fRate"></span>
      </div>
    </form>`;
  }

  function renderTimesheet(el) {
    const d = state.data;
    const date = state.tsDate || todayISO();
    const mk = C.monthKey(date);
    const entries = d.rows.filter(r => r.date === date).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    const work = entries.filter(r => r.client);
    const dayRev = work.reduce((a, b) => a + b.amount, 0);
    const dayHrs = work.reduce((a, b) => a + b.hours, 0);
    const perDay = monthTargetPerDay(mk);
    const isWeekend = C.weekday(date) % 6 === 0;
    const cats = {}; work.forEach(b => { cats[b.category] = (cats[b.category] || 0) + b.hours; });
    const kmRows = entries.filter(r => r.kms);
    const kms = kmRows.reduce((a, r) => a + r.kms, 0), kmAmt = kmRows.reduce((a, r) => a + r.kmAmt, 0);

    const wd = C.weekday(date); const mon = C.addDays(date, -((wd + 6) % 7));
    const week = Array.from({ length: 7 }, (_, i) => C.addDays(mon, i)).map(x => ({ date: x, hours: d.rows.filter(r => r.date === x && r.client).reduce((a, r) => a + r.hours, 0) }));
    const maxH = Math.max(10, ...week.map(w => w.hours));

    // new-entry defaults: continue from the last entry
    const lastE = entries[entries.length - 1];
    const recent = d.rows.length ? d.rows[d.rows.length - 1] : null;
    const startT = lastE ? lastE.end : '08:00';
    const newE = { time: startT, end: C.timeAdd(startT, 60), client: (lastE || recent || {}).client || 'AC', project: (lastE || recent || {}).project || 'SF', activity: '', kms: 0, notes: '' };

    let tl = '';
    entries.forEach((b, i) => {
      if (i && entries[i - 1].end < b.time) tl += `<div class="gap">Break ${entries[i - 1].end} to ${b.time}</div>`;
      if (state.editing === b.id) { tl += entryFormHTML(b, false); return; }
      tl += `<div class="block" style="--c:${CAT_COLORS[b.category] || 'var(--accent)'}">
        <div class="t">${esc(b.time)} - ${esc(b.end)}</div>
        <div><div class="who">${esc(b.client)} <span class="muted" style="font-weight:400">· ${esc(b.project)}</span></div>
          <div class="act">${esc(b.activity) || '<span class="muted">No activity noted</span>'}${b.notes ? ` · <em>${esc(b.notes)}</em>` : ''}${b.kms ? ` · ${b.kms} km` : ''}</div></div>
        <div class="amt"><div><strong>${hrs(b.hours)} h</strong></div><div class="muted">${b.amount ? money(b.amount) : 'non-billable'}</div>
          <div class="row-actions"><button class="btn btn-small btn-quiet" data-edit="${esc(b.id)}">Edit</button><button class="btn btn-small btn-danger" data-delete="${esc(b.id)}" aria-label="Delete entry">Delete</button></div></div>
      </div>`;
    });
    const adding = state.editing === 'new';

    const tm = state.tsMonth || mk;
    const monthRows = d.rows.filter(r => C.monthKey(r.date) === tm);
    const byDate = new Map();
    for (const r of monthRows) {
      if (!byDate.has(r.date)) byDate.set(r.date, { date: r.date, hours: 0, amount: 0, kms: 0, clients: new Map() });
      const x = byDate.get(r.date);
      if (r.client) { x.hours += r.hours; x.amount += r.amount; x.clients.set(r.client, (x.clients.get(r.client) || 0) + r.hours); }
      x.kms += r.kms || 0;
    }
    const days = [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
    const months = allMonths();

    el.innerHTML = `
      <div class="view-head">
        <div class="daynav">
          <button class="btn btn-quiet btn-small" id="tPrev" aria-label="Previous day">&larr;</button>
          <div><div class="label">Timesheet</div><h1>${C.fmtDateLong(date)}</h1></div>
          <button class="btn btn-quiet btn-small" id="tNext" aria-label="Next day">&rarr;</button>
        </div>
        <div class="controls">
          <input type="date" id="tDate" value="${date}" aria-label="Go to date">
          <button class="btn btn-ghost btn-small" id="tToday">Today</button>
        </div>
      </div>

      <div class="week" role="group" aria-label="This week">${week.map(w => `
        <button data-date="${w.date}" ${w.date === date ? 'aria-current="date"' : ''}>
          <span class="wd">${C.DAYS[C.weekday(w.date)]} ${+w.date.slice(8)}</span>
          <span class="hrs">${w.hours ? hrs(w.hours) + ' h' : '<span class="muted">-</span>'}</span>
          <span class="wbar"><i style="width:${Math.min(100, w.hours / maxH * 100)}%"></i></span>
        </button>`).join('')}</div>

      <div class="day-summary">
        <div class="kpi lead"><span class="label">$ for the day</span><span class="value">${money0(dayRev)}</span>
          <span class="sub">${isWeekend ? 'Weekend' : `Target ${money0(perDay)}`}${!isWeekend && perDay ? ` · ${dayRev >= perDay ? '<span style="color:var(--good)">on target</span>' : `<span style="color:var(--bad)">${money0(dayRev - perDay)}</span>`}` : ''}</span></div>
        <div class="kpi"><span class="label">Hours</span><span class="value">${hrs(dayHrs)}</span>
          <span class="sub">${Object.entries(cats).map(([c, h]) => `<span class="cat-dot" style="background:${CAT_COLORS[c]}"></span>${c} ${hrs(h)}`).join(' &nbsp; ') || 'No time recorded'}</span></div>
        <div class="kpi"><span class="label">Vehicle</span><span class="value">${kms ? kms.toLocaleString() + ' km' : '-'}</span>
          <span class="sub">${kms ? money(kmAmt) + ' mileage · ' + kmRows.map(r => esc(r.client + ' ' + r.project)).join(', ') : 'No mileage recorded'}</span></div>
      </div>

      <div class="panel">
        <div class="panel-head"><h2>Day</h2>${adding ? '' : '<button class="btn" id="addEntry">+ Add time</button>'}</div>
        <div class="timeline">${tl || (adding ? '' : `<p class="muted">Nothing recorded for ${C.fmtDateLong(date)} yet. Use <strong>Add time</strong> to start.</p>`)}
          ${adding ? entryFormHTML(newE, true) : ''}</div>
      </div>

      <div class="panel">
        <div class="panel-head"><h2>Days in ${C.monthLabel(tm)}</h2>
          <select id="tMonth" aria-label="Month">${months.map(m => `<option value="${m}" ${m === tm ? 'selected' : ''}>${C.monthLabel(m)}</option>`).join('')}</select></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Date</th><th class="num">Hours</th><th class="num">$</th><th class="num">vs target</th><th>Clients</th><th class="num">Km</th></tr></thead>
          <tbody>${days.map(x => {
            const tgt = C.weekday(x.date) % 6 === 0 ? 0 : monthTargetPerDay(C.monthKey(x.date));
            const v = x.amount - tgt;
            return `<tr class="clickable" data-date="${x.date}" tabindex="0">
              <td>${C.fmtDateLong(x.date)}</td><td class="num">${hrs(x.hours)}</td><td class="num">${money(x.amount)}</td>
              <td class="num" style="color:${v >= 0 ? 'var(--good)' : 'var(--bad)'}">${tgt || x.amount ? (v >= 0 ? '+' : '') + money0(v) : ''}</td>
              <td>${[...x.clients.entries()].sort((a, b) => b[1] - a[1]).map(([c, h]) => `${esc(c)} <span class="muted">${hrs(h)}</span>`).join(', ')}</td>
              <td class="num">${x.kms || ''}</td></tr>`;
          }).join('') || '<tr><td colspan="6" class="muted">No entries.</td></tr>'}</tbody>
          <tfoot><tr><td>Total</td><td class="num">${hrs(days.reduce((a, x) => a + x.hours, 0))}</td><td class="num">${money(days.reduce((a, x) => a + x.amount, 0))}</td><td></td><td></td><td class="num">${days.reduce((a, x) => a + x.kms, 0) || ''}</td></tr></tfoot>
        </table></div>
      </div>`;

    const rerender = () => renderTimesheet(el);
    const setDate = x => { if (!x) return; state.tsDate = x; state.tsMonth = null; state.editing = null; rerender(); };
    $('#tPrev').onclick = () => setDate(C.addDays(date, -1));
    $('#tNext').onclick = () => setDate(C.addDays(date, 1));
    $('#tToday').onclick = () => setDate(todayISO());
    $('#tDate').onchange = e => setDate(e.target.value);
    $('#tMonth').onchange = e => { state.tsMonth = e.target.value; rerender(); };
    $$('.week button', el).forEach(b => b.onclick = () => setDate(b.dataset.date));
    $$('tr[data-date]', el).forEach(tr => { tr.onclick = () => { setDate(tr.dataset.date); window.scrollTo({ top: 0 }); }; tr.onkeydown = e => { if (e.key === 'Enter') tr.click(); }; });
    $('#addEntry')?.addEventListener('click', () => { state.editing = 'new'; rerender(); $('#fActivity')?.focus(); });
    $$('[data-edit]', el).forEach(b => b.onclick = () => { state.editing = b.dataset.edit; rerender(); $('#fActivity')?.focus(); });
    $$('[data-delete]', el).forEach(b => b.onclick = () => askDelete(b, date, rerender));
    wireEntryForm(el, date, rerender);
  }

  // Inline confirm (the page cannot use confirm dialogs)
  function askDelete(btn, date, rerender) {
    if (btn.dataset.armed) {
      const id = btn.dataset.delete;
      state.data.rows = state.data.rows.filter(r => r.id !== id);
      saveDay(date); rerender(); toast('Entry deleted');
      return;
    }
    btn.dataset.armed = '1'; btn.textContent = 'Confirm delete';
    setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = 'Delete'; } }, 4000);
  }

  function saveDay(date) {
    const dayEntries = state.data.rows.filter(r => r.date === date);
    state.inv = null;
    return track(db.saveDay(date, dayEntries));
  }

  function wireEntryForm(el, date, rerender) {
    const f = $('#entryForm', el); if (!f) return;
    const id = f.dataset.id;
    const prev = id ? state.data.rows.find(r => r.id === id) : null;
    const showRate = () => {
      const c = $('#fClient').value, p = $('#fProject').value;
      const rate = prev && prev.client === c && prev.project === p ? prev.rate : C.rateFor(state.config, c, p);
      const mins = C.toMin($('#fEnd').value) - C.toMin($('#fStart').value);
      const h = Math.max(0, Math.round(mins / 15) / 4);
      $('#fHours').textContent = hrs(h);
      $('#fRate').textContent = rate ? `${money(rate)}/h · ${money(h * rate)}` : 'Non-billable';
    };
    $('#fClient').onchange = () => {
      const ps = projectsFor($('#fClient').value);
      $('#fProject').innerHTML = ps.map(p => `<option>${esc(p)}</option>`).join('');
      showRate();
    };
    $('#fProject').onchange = showRate;
    $('#fStart').onchange = () => { if (C.toMin($('#fEnd').value) <= C.toMin($('#fStart').value)) $('#fEnd').value = C.timeAdd($('#fStart').value, 60); showRate(); };
    $('#fEnd').onchange = showRate;
    $('#fCancel').onclick = () => { state.editing = null; rerender(); };
    showRate();
    f.onsubmit = e => {
      e.preventDefault();
      const vals = { date, time: $('#fStart').value, end: $('#fEnd').value, client: $('#fClient').value, project: $('#fProject').value, activity: $('#fActivity').value, kms: $('#fKms').value, notes: $('#fNotes').value };
      if (!vals.time || !vals.end || C.toMin(vals.end) <= C.toMin(vals.time)) { toast('End time must be after the start time.'); return; }
      if (!vals.client || !vals.project) { toast('Choose a client and project. Add new ones on the Setup page.'); return; }
      const entry = C.makeEntry(vals, state.config, prev);
      if (prev) state.data.rows = state.data.rows.map(r => r.id === prev.id ? entry : r);
      else state.data.rows.push(entry);
      state.data.rows.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
      state.editing = prev ? null : 'new';
      saveDay(date); rerender();
      if (!prev) $('#fActivity')?.focus();
      toast(prev ? 'Entry updated' : `Added ${hrs(entry.hours)} h ${entry.client} ${entry.project}`);
    };
  }

  // ======================================================================
  // INVOICING
  // ======================================================================
  function billableClients(start, end) {
    const m = new Map();
    for (const x of (state.config.materials || [])) if (!x.invoice && x.date >= C.monthStart(C.monthKey(start)) && x.date <= end) m.set(x.client, (m.get(x.client) || 0) + C.matCalc(x).total);
    for (const r of state.data.rows) if (r.date >= start && r.date <= end && isBillable(r.client) && (r.amount || r.kms)) m.set(r.client, (m.get(r.client) || 0) + r.amount + r.kmAmt);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0]);
  }

  // Default project selection = the billing group (same contact + reference) of the client's biggest project in the period.
  function defaultProjects(client, start, end) {
    const m = new Map();
    for (const r of state.data.rows) if (r.client === client && r.date >= start && r.date <= end) m.set(r.project, (m.get(r.project) || 0) + r.amount + r.kmAmt);
    const list = [...m.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0]);
    if (list.length < 2) return [];
    const key = p => { const b = billingFor(client, p); return (b.contact || client) + '|' + (b.reference || ''); };
    const k0 = key(list[0]);
    const group = list.filter(p => key(p) === k0);
    return group.length === list.length ? [] : group;
  }
  // ----- sports field allocation (stored per client|project|date) -----
  const allocKey = d => state.inv.client + '|' + d.project + '|' + d.date;
  function allocFor(d) {
    const st = (state.settings.alloc || {})[allocKey(d)];
    return st ? st : C.suggestAlloc(d);
  }
  function setAlloc(d, field, value) {
    state.settings.alloc = state.settings.alloc || {};
    const cur = Object.assign({}, allocFor(d)); delete cur.suggested;
    cur[field] = value;
    state.settings.alloc[allocKey(d)] = cur;
    saveSettings();
  }
  const tripKey = d => state.inv.client + '|' + d.project + '|' + d.date;
  function tripFor(d) { const t = (state.settings.trips || {})[tripKey(d)]; return t !== undefined ? t : d.kmNotes.join('; '); }
  // ----- landscaping materials on invoices -----
  function invMats() {
    const inv = state.inv; if (!inv || !inv.land) return [];
    const num = (inv.meta && inv.meta.number) || '';
    return (state.config.materials || []).filter(m => m.client === inv.client && m.date >= C.monthStart(C.monthKey(inv.start)) && m.date <= inv.end && (!m.invoice || m.invoice === num))
      .sort((a, b) => (a.date + a.item).localeCompare(b.date + b.item));
  }
  function includedMats() { const off = state.inv.matOff || {}; return invMats().filter(m => !off[m.id]); }
  const matSum = list => C.round2(list.reduce((a, m) => a + C.matCalc(m).total, 0));
  function ensureMatLine() {
    const inv = state.inv;
    if (inv.land && includedMats().length && !inv.lines.some(l => l.kind === 'mat')) inv.lines.unshift({ id: Math.max(0, ...inv.lines.map(l => l.id)) + 1, kind: 'mat', project: '', description: 'Plants & Landscaping Materials as per schedule emailed' });
  }
  function firstProjectFor(client, start, end) {
    const m = new Map();
    for (const r of state.data.rows) if (r.client === client && r.date >= start && r.date <= end) m.set(r.project, (m.get(r.project) || 0) + r.amount + r.kmAmt + 0.001);
    return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '*';
  }
  function computeInv() {
    const inv = state.inv;
    if (inv.sf) {
      const desc = C.sfDescriptions(inv.days, allocFor);
      inv.lines.forEach(l => { if (l.kind === 'alloc' && l.auto) l.description = desc[l.cat]; });
    }
    return C.computeLines(inv.lines, inv.days, inv.assign, allocFor, { matTotal: inv.land ? matSum(includedMats()) : 0 });
  }

  function startInvoice(client, projects, start, end) {
    if (!projects || !projects.length) projects = client ? defaultProjects(client, start, end) : [];
    state.inv = { client, projects: projects || [], start, end, assign: {}, lines: null, meta: null };
    const first = (projects && projects[0]) || firstProjectFor(client, start, end);
    const bs = billingFor(client, first).schedule;
    state.inv.sf = bs === 'sf';
    state.inv.land = bs === 'land' || (!state.inv.sf && (first === 'Landscaping' || (first === '*' && (state.config.materials || []).some(m => m.client === client))));
    state.inv.matOff = {};
    rebuildInvoice(true);
  }

  function rebuildInvoice(resetMeta) {
    const inv = state.inv;
    inv.days = C.invoiceDays(state.data.rows, inv);
    const monthTxt = (() => { const [y, m] = inv.end.split('-').map(Number); return `${C.MONTHS[m - 1]} ${y}`; })();
    const bill = p => { const b = billingFor(inv.client, p); return { ...b, header: (b.header || '').replace('{month}', monthTxt) }; };
    const firstProj = inv.days.find(x => x.hours)?.project || '*';
    inv.lines = inv.land ? C.landLines(inv.days, includedMats()) : inv.sf ? C.sfLines(inv.days, allocFor, bill(firstProj).header) : C.defaultLines(inv.days, bill, { consultant: state.settings.consultant });
    inv.assign = {};
    if (resetMeta || !inv.meta) {
      const projs = [...new Set(inv.days.map(x => x.project))];
      const b = bill(projs[0] || '*');
      const refs = [...new Set(projs.map(p => bill(p).reference).filter(Boolean))];
      const contactName = b.contact || inv.client;
      inv.meta = {
        contactName, contactId: state.settings.contacts[contactName] || '',
        number: state.settings.nextInvoiceNumber || '', reference: refs[0] || '',
        date: inv.end, due: C.dueDateFor(inv.end, b.due)
      };
      inv.dueRule = b.due;
    }
    inv.result = null;
  }


  // Landscaping: materials table on the schedule (sell prices only; cost and margin stay private)
  function matTableHTML() {
    const list = invMats(), off = state.inv.matOff || {};
    if (!list.length) return `<div class="doc-section no-print"><h3>Materials</h3><p class="muted">No uninvoiced materials for ${esc(state.inv.client)} dated ${C.fmtDateNZ(state.inv.start)} to ${C.fmtDateNZ(state.inv.end)}. Add them on the <a href="#landscaping">Landscaping</a> page.</p></div>`;
    const inc = list.filter(m => !off[m.id]);
    return `<div class="doc-section"><h3>Materials</h3><div class="table-wrap"><table>
      <thead><tr><th class="no-print"></th><th>Month</th><th>Item</th><th>Supplier</th><th>Unit</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Amount</th></tr></thead>
      <tbody>${list.map(m => { const c = C.matCalc(m), isOff = !!off[m.id]; return `<tr class="${isOff ? 'mat-off no-print' : ''}">
        <td class="no-print"><input type="checkbox" data-matoff="${esc(m.id)}" ${isOff ? '' : 'checked'} aria-label="Include ${esc(m.item)}"></td>
        <td>${C.MONTHS[+m.date.slice(5, 7) - 1]}</td><td>${esc(m.item)}</td><td>${esc(m.supplier)}</td><td>${esc(m.unit)}</td>
        <td class="num">${hrs(m.qty)}</td><td class="num">${money(c.unitPrice)}</td><td class="num">${money(c.total)}</td></tr>`; }).join('')}</tbody>
      <tfoot><tr><td class="no-print"></td><td colspan="6">Total materials</td><td class="num">${money(matSum(inc))}</td></tr></tfoot>
    </table></div><p class="note no-print">Untick anything that should wait for a later invoice. Unticked items are left off the PDF and the invoice.</p></div>`;
  }

  // Sports field schedule table (matches the SF month tabs)
  function sfTableHTML(days) {
    const n = v => (+v || 0);
    const cell = (d, f, v, step = 0.25) => `<td class="num"><input type="number" min="0" step="${step}" class="alloc-in no-print" data-alloc="${esc(d.key)}" data-f="${f}" value="${n(v) || ''}" aria-label="${f} ${C.fmtDateNZ(d.date)}"><span class="print-only">${n(v) ? hrs(n(v)) : ''}</span></td>`;
    const tot = { hours: 0, adj: 0, visits: 0, nv: 0, p27: 0, admin: 0, tech: 0, total: 0 };
    let bad = 0, guessed = 0;
    const rowsH = days.map(d => {
      const a = allocFor(d); const total = C.allocTotal(a); const check = Math.round((total - n(a.adj)) * 100) / 100;
      if (check) bad++; if (a.suggested) guessed++;
      tot.hours += d.hours; tot.adj += n(a.adj); tot.visits += n(a.visits); tot.nv += n(a.nv); tot.p27 += n(a.p27); tot.admin += n(a.admin); tot.tech += n(a.tech); tot.total += total;
      return `<tr>
        <td style="white-space:nowrap">${C.fmtDateNZ(d.date)}${a.suggested ? ' <span class="no-print guess" title="First guess from the activity text. Edit any cell to confirm.">&bull;</span>' : ''}</td>
        <td class="act-cell">${esc(d.activityText) || '-'}</td>
        <td class="num screen-only">${hrs(d.hours)}</td>
        ${cell(d, 'adj', a.adj)}${cell(d, 'visits', a.visits)}${cell(d, 'nv', a.nv, 1)}${cell(d, 'p27', a.p27)}${cell(d, 'admin', a.admin)}${cell(d, 'tech', a.tech)}
        <td class="num"><strong>${hrs(total)}</strong></td>
        <td class="num" style="color:${check ? '#b3412f' : '#2e7d4f'}">${check ? (check > 0 ? '+' : '') + hrs(check) : '0'}</td>
      </tr>`;
    }).join('');
    const rate = days.find(d => d.rate)?.rate || 0;
    const tc = Math.round((tot.total - tot.adj) * 100) / 100;
    return `
      <div class="no-print sf-note">${bad ? `<span class="chip bad">${bad} day${bad === 1 ? '' : 's'} where Total does not match Adj Hours</span>` : '<span class="chip ok">All days balance</span>'}
        ${guessed ? `<span class="chip warn">${guessed} day${guessed === 1 ? '' : 's'} using a first guess (&bull;)</span>` : ''}
        <span class="note">Adj Hours is what you bill. Split it across Visits, P27, Reporting-Admin and Technical Support; Check must be 0.</span></div>
      <div class="table-wrap"><table class="sf-table">
        <colgroup><col class="c-date"><col class="c-act"><col class="c-n screen-only"><col class="c-in"><col class="c-in"><col class="c-in"><col class="c-in"><col class="c-in"><col class="c-in"><col class="c-n"><col class="c-n"></colgroup>
        <thead><tr><th>Date</th><th>Activities</th><th class="num screen-only">Hours</th><th class="num"><span class="screen-only">Adj Hours</span><span class="print-only">Total Hours</span></th><th class="num">Visits</th><th class="num">No of Visits</th><th class="num">P27</th><th class="num">Reporting-Admin</th><th class="num">Technical Support</th><th class="num">Total</th><th class="num">Check</th></tr></thead>
        <tbody>${rowsH || '<tr><td colspan="11" class="muted">No time in this period.</td></tr>'}</tbody>
        <tfoot>
          <tr><td colspan="2">Total hours</td><td class="num screen-only">${hrs(tot.hours)}</td><td class="num">${hrs(tot.adj)}</td><td class="num">${hrs(tot.visits)}</td><td class="num">${tot.nv}</td><td class="num">${hrs(tot.p27)}</td><td class="num">${hrs(tot.admin)}</td><td class="num">${hrs(tot.tech)}</td><td class="num">${hrs(tot.total)}</td><td class="num" style="color:${tc ? '#b3412f' : '#2e7d4f'}">${tc ? hrs(tc) : '0'}</td></tr>
          <tr class="sf-money"><td colspan="2">At ${money(rate)}/h</td><td class="screen-only"></td><td class="num">${money(tot.adj * rate)}</td><td class="num">${money(tot.visits * rate)}</td><td></td><td class="num">${money(tot.p27 * rate)}</td><td class="num">${money(tot.admin * rate)}</td><td class="num">${money(tot.tech * rate)}</td><td class="num">${money(tot.total * rate)}</td><td></td></tr>
        </tfoot>
      </table></div>`;
  }

  function renderInvoicing(el) {
    const t = todayISO();
    const months = allMonths();
    if (!state.inv) {
      const prev = C.addMonths(C.monthKey(t), -1);
      const mk = months.includes(prev) ? prev : months[months.length - 1];
      const clients = billableClients(C.monthStart(mk), C.monthEnd(mk));
      startInvoice(clients[0] || '', [], C.monthStart(mk), C.monthEnd(mk));
    }
    const inv = state.inv;
    const clients = billableClients(inv.start, inv.end);
    if (inv.client && !clients.includes(inv.client)) clients.unshift(inv.client);
    // projects with hours for this client & period
    const pm = new Map();
    for (const r of state.data.rows) if (r.client === inv.client && r.date >= inv.start && r.date <= inv.end && (r.hours || r.kms)) {
      const x = pm.get(r.project) || { h: 0, a: 0 }; x.h += r.hours; x.a += r.amount + r.kmAmt; pm.set(r.project, x);
    }
    const projList = [...pm.entries()].sort((a, b) => b[1].a - a[1].a);
    const periodMonth = inv.start === C.monthStart(C.monthKey(inv.start)) && inv.end === C.monthEnd(C.monthKey(inv.start)) ? C.monthKey(inv.start) : '';
    const comp = computeInv();
    const timeLines = comp.lines.filter(l => l.kind === 'time');
    const allocLines = comp.lines.filter(l => l.kind === 'alloc');
    const m = inv.meta;
    const multiProj = new Set(inv.days.map(x => x.project)).size > 1;
    const workDays = inv.days.filter(x => x.hours);
    const kmDays = inv.days.filter(x => x.kms);
    const labour = timeLines.concat(allocLines).reduce((a, l) => a + l.amount, 0);
    const vehicle = comp.lines.filter(l => l.kind === 'vehicle').reduce((a, l) => a + l.amount, 0);
    const other = comp.lines.filter(l => l.kind === 'manual').reduce((a, l) => a + l.amount, 0);
    const matAmt = comp.lines.filter(l => l.kind === 'mat').reduce((a, l) => a + l.amount, 0);
    const projTitle = inv.projects.length ? inv.projects.join(', ') : [...new Set(workDays.map(x => x.project))].join(', ');
    const lineLabel = l => `Line ${comp.lines.indexOf(l) + 1}`;

    el.innerHTML = `
      <div class="view-head">
        <div><div class="label">Invoicing</div><h1>${esc(m.contactName || 'Choose a client')}</h1></div>
        <div class="xero-status" id="xeroStatus">${xeroStatusHTML()}</div>
      </div>
      <div class="inv-layout${inv.sf ? ' wide' : ''}">
        <aside class="inv-side">
          <div class="panel">
            <h3>What to invoice</h3>
            <label class="field"><span>Period</span>
              <select id="iMonth"><option value="">Custom dates</option>${months.slice().reverse().map(mm => `<option value="${mm}" ${mm === periodMonth ? 'selected' : ''}>${C.monthLabel(mm)}</option>`).join('')}</select></label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              <label class="field"><span>From</span><input type="date" id="iStart" value="${inv.start}"></label>
              <label class="field"><span>To</span><input type="date" id="iEnd" value="${inv.end}"></label>
            </div>
            <label class="field"><span>Client (timesheet code)</span>
              <select id="iClient">${clients.map(c => `<option ${c === inv.client ? 'selected' : ''}>${esc(c)}</option>`).join('') || '<option value="">No billable time in this period</option>'}</select></label>
            <div class="field"><span>Projects</span>
              <div class="checklist">${projList.map(([p, x]) => `<label><input type="checkbox" value="${esc(p)}" ${!inv.projects.length || inv.projects.includes(p) ? 'checked' : ''}> ${esc(p)} <span class="num">${hrs(x.h)} h</span></label>`).join('') || '<span class="muted">None</span>'}</div>
            </div>
            <label class="checklist" style="display:flex;gap:8px;align-items:flex-start;font-size:.9rem"><input type="checkbox" id="iSF" ${inv.sf ? 'checked' : ''} style="margin-top:4px"> <span>Sports field schedule<br><span class="muted" style="font-size:.8rem">Split hours into Visits, P27, Reporting-Admin and Technical Support</span></span></label>
            <label class="checklist" style="display:flex;gap:8px;align-items:flex-start;font-size:.9rem"><input type="checkbox" id="iLand" ${inv.land ? 'checked' : ''} style="margin-top:4px"> <span>Landscaping schedule<br><span class="muted" style="font-size:.8rem">Labour from the timesheet plus this client's materials</span></span></label>
            ${billingFor(inv.client, projList[0]?.[0]).check ? `<div class="callout">Check who this project is billed to on the Setup page.</div>` : ''}
          </div>
          <div class="panel">
            <h3>Totals</h3>
            <div class="doc-totals" style="width:100%;margin:0">
              <div><span>Hours</span><span>${hrs(workDays.reduce((a, x) => a + x.hours, 0))}</span></div>
              <div><span>Labour</span><span>${money(labour)}</span></div>
              ${matAmt ? `<div><span>Materials</span><span>${money(matAmt)}</span></div>` : ''}
              ${vehicle ? `<div><span>Vehicle</span><span>${money(vehicle)}</span></div>` : ''}
              ${other ? `<div><span>Other items</span><span>${money(other)}</span></div>` : ''}
              <div><span>GST 15%</span><span>${money(comp.gst)}</span></div>
              <div class="grand"><span>Total NZD</span><span>${money(comp.total)}</span></div>
            </div>
          </div>
        </aside>

        <div class="inv-main">
          <!-- Supporting schedule -->
          <div class="panel">
            <div class="panel-head"><h2>Supporting schedule</h2>
              <div class="doc-tools">
                <button class="btn btn-small" id="pdfBtn">Download PDF</button>
                <button class="btn btn-small btn-quiet" id="printBtn">Print</button>
              </div></div>
            <div class="paper${inv.sf ? ' sf' : ''}" id="scheduleDoc">
              <div class="doc-head">
                <div><div class="org">Greenspace Consulting Limited</div><div style="font-size:.85rem;color:#5d6a61">stu@greenspaceconsulting.co.nz</div></div>
                <div><div class="doc-title">Schedule of Hours</div><div style="font-size:.85rem;color:#5d6a61;text-align:right">Supporting document${m.number ? ' for invoice ' + esc(m.number) : ''}</div></div>
              </div>
              <div class="doc-meta">
                <div><span>Client</span>${esc(m.contactName)}</div>
                <div><span>Project</span>${esc(projTitle)}</div>
                <div><span>Period</span>${C.fmtDateNZ(inv.start)} to ${C.fmtDateNZ(inv.end)}</div>
                <div><span>Reference</span>${esc(m.reference) || '-'}</div>
                <div><span>Consultant</span>${esc(state.settings.consultant)}</div>
              </div>
${inv.sf ? sfTableHTML(workDays) : (inv.land && !workDays.length) ? '' : `${inv.land ? '<h3 style="margin-bottom:8px">Labour</h3>' : ''}              <div class="table-wrap"><table>
                <thead><tr><th>Date</th>${multiProj ? '<th>Project</th>' : ''}<th>Activities</th><th class="num">Hours</th><th class="num">Rate</th><th class="num">Amount</th>${timeLines.length > 1 ? '<th class="no-print">Invoice line</th>' : ''}</tr></thead>
                <tbody>${workDays.map(x => `<tr>
                  <td style="white-space:nowrap">${C.fmtDateNZ(x.date)}</td>${multiProj ? `<td>${esc(x.project)}</td>` : ''}
                  <td class="act-cell">${esc(x.activityText) || '<span style="color:#5d6a61">-</span>'}</td>
                  <td class="num">${hrs(x.hours)}</td><td class="num">${money(x.rate)}</td><td class="num">${money(x.amount)}</td>
                  ${timeLines.length > 1 ? `<td class="no-print"><select class="line-sel" data-day="${esc(x.key)}">${timeLines.map(l => `<option value="${l.id}" ${l.dayKeys.includes(x.key) ? 'selected' : ''}>${lineLabel(l)}${l.project && l.project !== '__split' ? ' · ' + esc(l.project) : ''}</option>`).join('')}</select></td>` : ''}
                </tr>`).join('') || `<tr><td colspan="6" class="muted">No time in this period.</td></tr>`}</tbody>
                <tfoot><tr><td colspan="${multiProj ? 3 : 2}">Total time</td><td class="num">${hrs(workDays.reduce((a, x) => a + x.hours, 0))}</td><td></td><td class="num">${money(workDays.reduce((a, x) => a + x.amount, 0))}</td>${timeLines.length > 1 ? '<td class="no-print"></td>' : ''}</tr></tfoot>
              </table></div>
`}
              ${inv.land ? matTableHTML() : ''}
              ${kmDays.length ? `<div class="doc-section"><h3>Vehicle</h3><div class="table-wrap"><table>
                <thead><tr><th>Date</th>${multiProj ? '<th>Project</th>' : ''}<th>Trip</th><th class="num">Km</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
                <tbody>${kmDays.map(x => `<tr><td>${C.fmtDateNZ(x.date)}</td>${multiProj ? `<td>${esc(x.project)}</td>` : ''}<td>${(() => { const tv = tripFor(x); return `<input type="text" class="trip-in no-print" data-trip="${esc(x.key)}" value="${esc(tv)}" aria-label="Trip ${C.fmtDateNZ(x.date)}"><span class="print-only">${esc(tv) || '-'}</span>`; })()}</td><td class="num">${x.kms}</td><td class="num">${money(x.kms ? x.kmAmt / x.kms : 0)}</td><td class="num">${money(x.kmAmt)}</td></tr>`).join('')}</tbody>
                <tfoot><tr><td colspan="${multiProj ? 3 : 2}">Total vehicle</td><td class="num">${kmDays.reduce((a, x) => a + x.kms, 0)}</td><td></td><td class="num">${money(kmDays.reduce((a, x) => a + x.kmAmt, 0))}</td></tr></tfoot>
              </table></div></div>` : ''}
              <div class="doc-totals">
                <div><span>Labour</span><span>${money(labour)}</span></div>
                ${matAmt ? `<div><span>Materials</span><span>${money(matAmt)}</span></div>` : ''}
                ${vehicle ? `<div><span>Vehicle</span><span>${money(vehicle)}</span></div>` : ''}
                ${other ? `<div><span>Other items</span><span>${money(other)}</span></div>` : ''}
                <div><span>Subtotal (excl GST)</span><span>${money(comp.subtotal)}</span></div>
                <div><span>GST 15%</span><span>${money(comp.gst)}</span></div>
                <div class="grand"><span>Total (incl GST)</span><span>${money(comp.total)}</span></div>
              </div>
              <div class="doc-foot">Prepared from the Greenspace Consulting timesheet. Times are recorded in 15-minute units.</div>
            </div>
          </div>

          <!-- Xero draft invoice -->
          <div class="panel xero">
            <div class="panel-head"><h2>Draft invoice</h2><span class="note">Laid out like a Xero sales invoice</span></div>
            <div class="xero-head">
              <label class="field"><span>To (Xero contact)</span><input type="text" id="mContact" value="${esc(m.contactName)}" list="contactList"></label>
              <label class="field"><span>Invoice number</span><input type="text" id="mNumber" value="${esc(m.number)}"></label>
              <label class="field"><span>Reference</span><input type="text" id="mRef" value="${esc(m.reference)}"></label>
              <label class="field"><span>Date</span><input type="date" id="mDate" value="${m.date}"></label>
              <label class="field"><span>Due date</span><input type="date" id="mDue" value="${m.due}"></label>
            </div>
            <datalist id="contactList">${Object.keys(state.settings.contacts).map(c => `<option value="${esc(c)}">`).join('')}</datalist>
            ${m.contactId ? '' : `<p class="note">No Xero contact ID saved for this name. Xero will match it by name, so make sure it is spelled exactly as in Xero.</p>`}
            <div class="table-wrap"><table class="xero-lines">
              <thead><tr><th style="width:44%">Description</th><th class="num">Qty</th><th class="num">Unit price</th><th>Account</th><th>Tax rate</th><th class="num">Amount NZD</th><th></th></tr></thead>
              <tbody>${comp.lines.map((l, i) => `<tr class="${l.kind === 'heading' ? 'heading-row' : ''}">
                <td><div class="kind">${{ heading: 'Heading', time: 'Time' + (l.project && l.project !== '__split' ? ' · ' + esc(l.project) : ''), vehicle: 'Vehicle', manual: 'Item', mat: 'Materials', alloc: { visits: 'Site visits', admin: 'Reporting-Admin', tech: 'Technical Support', p27: 'P27' }[l.cat] + (l.quantity ? '' : ' · no hours, left off the invoice') }[l.kind]}</div>
                  <textarea rows="${l.kind === 'heading' ? 3 : 2}" data-desc="${i}" aria-label="Description line ${i + 1}">${esc(l.description)}</textarea></td>
                ${l.kind === 'heading' ? '<td colspan="5" class="muted" style="font-size:.8rem">Description only</td>' : `
                <td class="num">${l.kind === 'manual' ? `<input type="number" step="0.01" data-qty="${i}" value="${l.quantity0 ?? ''}">` : hrs(l.quantity)}</td>
                <td class="num">${l.kind === 'manual' ? `<input type="number" step="0.01" data-unit="${i}" value="${l.unitAmount0 ?? ''}">` : (l.kind === 'time' || l.kind === 'alloc') ? `<input type="number" step="0.01" data-rate="${i}" value="${l.unitAmount}" title="Change to override the timesheet rate">` : money(l.unitAmount)}</td>
                <td>${esc(state.settings.accountCode)} Sales</td><td>15% GST on Income</td>
                <td class="num">${money(l.amount)}</td>`}
                <td><button class="btn-danger btn" data-del="${i}" aria-label="Remove line ${i + 1}">&times;</button></td>
              </tr>`).join('')}</tbody>
              <tfoot>
                <tr><td colspan="5" class="num">Subtotal</td><td class="num">${money(comp.subtotal)}</td><td></td></tr>
                <tr><td colspan="5" class="num">Total GST 15%</td><td class="num">${money(comp.gst)}</td><td></td></tr>
                <tr><td colspan="5" class="num">Total</td><td class="num">${money(comp.total)}</td><td></td></tr>
              </tfoot>
            </table></div>
            <div class="add-lines">
              <button class="btn btn-small btn-quiet" data-add="heading">+ Heading</button>
              <button class="btn btn-small btn-quiet" data-add="time">+ Time line (split hours)</button>
              <button class="btn btn-small btn-quiet" data-add="manual">+ Item</button>
              <button class="btn btn-small btn-quiet" id="resetLines">Reset lines</button>
            </div>
            <div class="add-lines" style="margin-top:18px;padding-top:14px;border-top:1px solid var(--line)">
              <button class="btn" id="xeroCreate" ${state.xero.connected ? '' : 'disabled'} title="${state.xero.connected ? '' : 'Connect Xero first (available once deployed to Netlify)'}">Create draft in Xero</button>
              <button class="btn btn-quiet" id="csvBtn">Download Xero import file</button>
              <button class="btn btn-quiet" id="copyBtn">Copy invoice text</button>
              <button class="btn btn-quiet" id="markBtn">Mark as invoiced</button>
            </div>
            <div class="result" id="invResult">${inv.result || ''}</div>
          </div>
        </div>
      </div>`;

    // ----- wiring -----
    const rerender = () => renderInvoicing(el);
    $('#iMonth').onchange = e => { if (!e.target.value) return; const mk = e.target.value; const cl = billableClients(C.monthStart(mk), C.monthEnd(mk)); startInvoice(cl.includes(inv.client) ? inv.client : (cl[0] || ''), [], C.monthStart(mk), C.monthEnd(mk)); rerender(); };
    $('#iStart').onchange = e => { if (e.target.value) { inv.start = e.target.value; rebuildInvoice(true); rerender(); } };
    $('#iEnd').onchange = e => { if (e.target.value) { inv.end = e.target.value; rebuildInvoice(true); rerender(); } };
    $('#iClient').onchange = e => { startInvoice(e.target.value, [], inv.start, inv.end); rerender(); };
    $$('.checklist input', el).forEach(cb => cb.onchange = () => {
      const all = $$('.checklist input', el); const on = all.filter(x => x.checked).map(x => x.value);
      inv.projects = on.length === all.length ? [] : on; if (!on.length) { cb.checked = true; return; }
      rebuildInvoice(true); rerender();
    });
    $$('.line-sel', el).forEach(s => s.onchange = () => { inv.assign[s.dataset.day] = +s.value; rerender(); });
    $$('[data-trip]', el).forEach(inp => inp.onchange = () => {
      const d = inv.days.find(x => x.key === inp.dataset.trip); if (!d) return;
      state.settings.trips = state.settings.trips || {};
      state.settings.trips[tripKey(d)] = inp.value.trim();
      saveSettings(); toast('Trip name saved');
      const sp = inp.nextElementSibling; if (sp) sp.textContent = inp.value.trim() || '-';
    });
    $('#iSF').onchange = e => { inv.sf = e.target.checked; if (inv.sf) inv.land = false; rebuildInvoice(false); rerender(); };
    $('#iLand').onchange = e => { inv.land = e.target.checked; if (inv.land) inv.sf = false; inv.matOff = {}; rebuildInvoice(false); rerender(); };
    $$('[data-matoff]', el).forEach(cb => cb.onchange = () => { inv.matOff[cb.dataset.matoff] = !cb.checked; ensureMatLine(); const y = window.scrollY; rerender(); window.scrollTo({ top: y }); });
    $$('[data-alloc]', el).forEach(inp => inp.onchange = () => {
      const d = inv.days.find(x => x.key === inp.dataset.alloc); if (!d) return;
      const v = inp.value === '' ? 0 : +inp.value;
      setAlloc(d, inp.dataset.f, isFinite(v) ? v : 0);
      const y = window.scrollY; rerender(); window.scrollTo({ top: y });
    });
    const metaInput = (id, k) => { $(id).onchange = e => { m[k] = e.target.value.trim(); if (k === 'contactName') m.contactId = state.settings.contacts[m.contactName] || ''; if (k === 'date' && inv.dueRule) m.due = C.dueDateFor(m.date, inv.dueRule); rerender(); }; };
    metaInput('#mContact', 'contactName'); metaInput('#mNumber', 'number'); metaInput('#mRef', 'reference'); metaInput('#mDate', 'date'); metaInput('#mDue', 'due');
    $$('[data-desc]', el).forEach(t => t.oninput = () => { const l = inv.lines[+t.dataset.desc]; l.description = t.value; l.auto = false; });
    $$('[data-desc]', el).forEach(t => t.onchange = rerender);
    $$('[data-rate]', el).forEach(t => t.onchange = () => { const l = inv.lines[+t.dataset.rate]; const v = parseFloat(t.value); l.manualRate = isFinite(v) && v > 0 ? v : null; rerender(); });
    $$('[data-qty]', el).forEach(t => t.onchange = () => { inv.lines[+t.dataset.qty].quantity0 = t.value; rerender(); });
    $$('[data-unit]', el).forEach(t => t.onchange = () => { inv.lines[+t.dataset.unit].unitAmount0 = t.value; rerender(); });
    $$('[data-del]', el).forEach(b => b.onclick = () => { const i = +b.dataset.del; const l = inv.lines[i]; inv.lines.splice(i, 1); for (const k in inv.assign) if (inv.assign[k] === l.id) delete inv.assign[k]; rerender(); });
    $$('[data-add]', el).forEach(b => b.onclick = () => {
      const id = Math.max(0, ...inv.lines.map(l => l.id)) + 1; const kind = b.dataset.add;
      const first = workDays[0], last = workDays[workDays.length - 1];
      const desc = kind === 'time' ? `Consulting services - ${state.settings.consultant}${first ? ` (${C.rangeText(first.date, last.date)} as per schedule emailed)` : ''}` : '';
      const veh = inv.lines.findIndex(l => l.kind === 'vehicle');
      const line = { id, kind, project: kind === 'time' ? '__split' : '', description: desc };
      if (veh >= 0 && kind !== 'manual') inv.lines.splice(veh, 0, line); else inv.lines.push(line);
      rerender();
      if (kind === 'time') toast('New time line added. Use the Invoice line column in the schedule to move days onto it.', 4500);
    });
    $('#resetLines').onclick = () => { rebuildInvoice(false); rerender(); };
    $('#pdfBtn').onclick = () => downloadPDF();
    $('#printBtn').onclick = () => printDoc($('#scheduleDoc'));
    $('#csvBtn').onclick = () => {
      const csv = C.xeroCSV(invForExport(), computeInv(), state.settings);
      downloadBlob(new Blob([csv], { type: 'text/csv' }), `Xero import ${m.number || ''} ${m.contactName}.csv`.replace(/\s+/g, ' ').trim());
    };
    $('#copyBtn').onclick = () => copyText(invoiceText());
    $('#markBtn').onclick = () => { markInvoiced(); toast('Recorded as invoiced'); };
    $('#xeroCreate').onclick = createInXero;
    $('#xeroConnect')?.addEventListener('click', () => { location.href = '/api/xero-connect'; });
  }

  function invForExport() {
    const m = state.inv.meta;
    return { contactName: m.contactName, contactId: m.contactId, number: m.number, reference: m.reference, date: m.date, dueDate: m.due };
  }
  function invoiceText() {
    const inv = state.inv, m = inv.meta, comp = computeInv();
    const lines = comp.lines.map(l => l.kind === 'heading' ? l.description : `${l.description}\t${hrs(l.quantity)} x ${money(l.unitAmount)} = ${money(l.amount)}`);
    return [`To: ${m.contactName}`, `Invoice: ${m.number}`, `Reference: ${m.reference}`, `Date: ${C.fmtDateNZ(m.date)}  Due: ${C.fmtDateNZ(m.due)}`, '', ...lines, '', `Subtotal ${money(comp.subtotal)}`, `GST ${money(comp.gst)}`, `Total ${money(comp.total)}`].join('\n');
  }
  function markInvoiced(number, total) {
    const inv = state.inv;
    const projects = [...new Set(inv.days.map(x => x.project))];
    const mk = C.monthKey(inv.start);
    state.settings.invoiced = state.settings.invoiced.filter(i => !(i.month === mk && i.client === inv.client && i.projects.join() === projects.join()));
    state.settings.invoiced.push({ month: mk, client: inv.client, projects, start: inv.start, end: inv.end, number: number || inv.meta.number, total: total ?? computeInv().total, at: new Date().toISOString() });
    // move the suggested next number on
    const n = (number || inv.meta.number || '').match(/^(.*?)(\d+)$/);
    if (n && (number || inv.meta.number) === state.settings.nextInvoiceNumber) state.settings.nextInvoiceNumber = n[1] + String(+n[2] + 1).padStart(n[2].length, '0');
    if (inv.land) { const num = number || inv.meta.number || 'invoiced'; includedMats().forEach(m => { m.invoice = num; }); }
    saveSettings();
  }

  // ----- files -----
  function downloadBlob(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function pdfName() {
    const m = state.inv.meta; const [y, mo] = state.inv.end.split('-');
    return `Schedule ${m.number ? m.number + ' ' : ''}${m.contactName} ${C.MONTHS[+mo - 1]} ${y}.pdf`.replace(/[\\/:*?"<>|]/g, '');
  }
  // ----- Schedule of Hours PDF (built directly with jsPDF + AutoTable: real text, clean page breaks) -----
  function buildSchedulePDF() {
    const { jsPDF } = window.jspdf;
    const inv = state.inv, m = inv.meta, comp = computeInv();
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const W = doc.internal.pageSize.getWidth(), M = 14;
    const green = [44, 106, 68], ink = [27, 36, 30], grey = [93, 106, 97], line = [217, 224, 215];
    const workDays = inv.days.filter(x => x.hours), kmDays = inv.days.filter(x => x.kms);
    const multiProj = new Set(inv.days.map(x => x.project)).size > 1;
    const projTitle = inv.projects.length ? inv.projects.join(', ') : [...new Set(workDays.map(x => x.project))].join(', ');
    const n = v => (+v || 0), h = v => n(v) ? hrs(n(v)) : '';

    // header
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...green);
    doc.text('Greenspace Consulting Limited', M, 18);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...grey);
    doc.text('stu@greenspaceconsulting.co.nz', M, 23);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...ink);
    doc.text('Schedule of Hours', W - M, 18, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...grey);
    doc.text('Supporting document' + (m.number ? ' for invoice ' + m.number : ''), W - M, 23, { align: 'right' });
    doc.setDrawColor(...green); doc.setLineWidth(0.8); doc.line(M, 27, W - M, 27);
    // meta
    const meta = [['Client', m.contactName], ['Project', projTitle], ['Period', `${C.fmtDateNZ(inv.start)} to ${C.fmtDateNZ(inv.end)}`], ['Reference', m.reference || '-'], ['Consultant', state.settings.consultant]];
    const colW = (W - 2 * M) / 3;
    meta.forEach(([k, v], i) => {
      const x = M + (i % 3) * colW, y = 34 + Math.floor(i / 3) * 11;
      doc.setFontSize(7); doc.setTextColor(...grey); doc.setFont('helvetica', 'bold'); doc.text(k.toUpperCase(), x, y);
      doc.setFontSize(9.5); doc.setTextColor(...ink); doc.setFont('helvetica', 'normal'); doc.text(doc.splitTextToSize(String(v || ''), colW - 4)[0] || '', x, y + 4.5);
    });

    const base = {
      theme: 'plain', margin: { left: M, right: M, top: 16, bottom: 16 },
      styles: { font: 'helvetica', fontSize: 8, textColor: ink, cellPadding: { top: 1.6, bottom: 1.6, left: 1.5, right: 1.5 }, lineColor: line, lineWidth: { bottom: 0.2 }, valign: 'top' },
      headStyles: { fontSize: 6.8, fontStyle: 'bold', textColor: grey, lineWidth: { bottom: 0.4 }, valign: 'bottom' },
      footStyles: { fontStyle: 'bold', lineWidth: { top: 0.5 }, lineColor: line },
      rowPageBreak: 'avoid', showHead: 'everyPage'
    };
    let y = 34 + 2 * 11 + 2;

    if (inv.sf) {
      const rate = workDays.find(d => d.rate)?.rate || 0;
      const t = { adj: 0, visits: 0, nv: 0, p27: 0, admin: 0, tech: 0, total: 0 };
      const body = workDays.map(d => {
        const a = allocFor(d), total = C.allocTotal(a), check = Math.round((total - n(a.adj)) * 100) / 100;
        t.adj += n(a.adj); t.visits += n(a.visits); t.nv += n(a.nv); t.p27 += n(a.p27); t.admin += n(a.admin); t.tech += n(a.tech); t.total += total;
        return [C.fmtDateNZ(d.date), d.activityText || '-', h(a.adj), h(a.visits), n(a.nv) || '', h(a.p27), h(a.admin), h(a.tech), hrs(total), check ? hrs(check) : '0'];
      });
      const tc = Math.round((t.total - t.adj) * 100) / 100;
      doc.autoTable({ ...base, startY: y,
        head: [['Date', 'Activities', 'Total Hours', 'Visits', 'No of Visits', 'P27', 'Reporting-Admin', 'Technical Support', 'Total', 'Check']],
        body,
        foot: [
          ['Total hours', '', hrs(t.adj), hrs(t.visits), String(t.nv), hrs(t.p27), hrs(t.admin), hrs(t.tech), hrs(t.total), tc ? hrs(tc) : '0'],
          [`At ${money(rate)}/h`, '', money0(t.adj * rate), money0(t.visits * rate), '', money0(t.p27 * rate), money0(t.admin * rate), money0(t.tech * rate), money0(t.total * rate), '']
        ],
        columnStyles: { 0: { cellWidth: 18 }, 1: { cellWidth: 'auto' }, 2: { cellWidth: 14, halign: 'right' }, 3: { cellWidth: 13, halign: 'right' }, 4: { cellWidth: 12, halign: 'right' }, 5: { cellWidth: 12, halign: 'right' }, 6: { cellWidth: 16, halign: 'right' }, 7: { cellWidth: 16, halign: 'right' }, 8: { cellWidth: 13, halign: 'right', fontStyle: 'bold' }, 9: { cellWidth: 11, halign: 'right' } },
        didParseCell: c => {
          if (c.section === 'head' && c.column.index >= 2) c.cell.styles.halign = 'right';
          if (c.section === 'foot') { if (c.column.index >= 2) c.cell.styles.halign = 'right'; if (c.row.index === 1) { c.cell.styles.fontStyle = 'normal'; c.cell.styles.textColor = grey; c.cell.styles.fontSize = 7; c.cell.styles.lineWidth = 0; } }
          if (c.column.index === 9 && c.section !== 'head') c.cell.styles.textColor = c.cell.raw && c.cell.raw !== '0' ? [179, 65, 47] : [46, 125, 79];
        }
      });
    } else if (workDays.length) {
      const head = ['Date', ...(multiProj ? ['Project'] : []), 'Activities', 'Hours', 'Rate', 'Amount'];
      const body = workDays.map(d => [C.fmtDateNZ(d.date), ...(multiProj ? [d.project] : []), d.activityText || '-', hrs(d.hours), money(d.rate), money(d.amount)]);
      const off = multiProj ? 1 : 0;
      doc.autoTable({ ...base, startY: y, head: [head], body,
        foot: [['Total time', ...(multiProj ? [''] : []), '', hrs(workDays.reduce((a, x) => a + x.hours, 0)), '', money(workDays.reduce((a, x) => a + x.amount, 0))]],
        columnStyles: { 0: { cellWidth: 20 }, [2 + off]: { cellWidth: 16, halign: 'right' }, [3 + off]: { cellWidth: 20, halign: 'right' }, [4 + off]: { cellWidth: 24, halign: 'right' } },
        didParseCell: c => { if ((c.section === 'head' || c.section === 'foot') && c.column.index >= 2 + off) c.cell.styles.halign = 'right'; }
      });
    }
    if (doc.lastAutoTable) y = doc.lastAutoTable.finalY + 8;

    const mats = inv.land ? includedMats() : [];
    if (mats.length) {
      if (y > 250) { doc.addPage(); y = 18; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...ink); doc.text('Materials', M, y); y += 2;
      doc.autoTable({ ...base, startY: y,
        head: [['Month', 'Item', 'Supplier', 'Unit', 'Qty', 'Unit price', 'Amount']],
        body: mats.map(mm => { const c = C.matCalc(mm); return [C.MONTHS[+mm.date.slice(5, 7) - 1], mm.item, mm.supplier, mm.unit, hrs(mm.qty), money(c.unitPrice), money(c.total)]; }),
        foot: [[{ content: 'Total materials', colSpan: 6 }, money(matSum(mats))]],
        columnStyles: { 0: { cellWidth: 14 }, 2: { cellWidth: 26 }, 3: { cellWidth: 14 }, 4: { cellWidth: 12, halign: 'right' }, 5: { cellWidth: 20, halign: 'right' }, 6: { cellWidth: 24, halign: 'right' } },
        didParseCell: c => { if ((c.section === 'head' || c.section === 'foot') && c.column.index >= 4) c.cell.styles.halign = 'right'; }
      });
      y = doc.lastAutoTable.finalY + 8;
    }
    if (kmDays.length) {
      if (y > 250) { doc.addPage(); y = 18; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...ink); doc.text('Vehicle', M, y); y += 2;
      doc.autoTable({ ...base, startY: y,
        head: [['Date', ...(multiProj ? ['Project'] : []), 'Trip', 'Km', 'Rate', 'Amount']],
        body: kmDays.map(d => [C.fmtDateNZ(d.date), ...(multiProj ? [d.project] : []), tripFor(d) || '-', String(d.kms), money(d.kms ? d.kmAmt / d.kms : 0), money(d.kmAmt)]),
        foot: [['Total vehicle', ...(multiProj ? [''] : []), '', String(kmDays.reduce((a, x) => a + x.kms, 0)), '', money(kmDays.reduce((a, x) => a + x.kmAmt, 0))]],
        columnStyles: { 0: { cellWidth: 20 }, [multiProj ? 3 : 2]: { cellWidth: 16, halign: 'right' }, [multiProj ? 4 : 3]: { cellWidth: 18, halign: 'right' }, [multiProj ? 5 : 4]: { cellWidth: 24, halign: 'right' } },
        didParseCell: c => { if ((c.section === 'head' || c.section === 'foot') && c.column.index >= (multiProj ? 3 : 2)) c.cell.styles.halign = 'right'; }
      });
      y = doc.lastAutoTable.finalY + 8;
    }

    // totals block
    const labour = comp.lines.filter(l => l.kind === 'time' || l.kind === 'alloc').reduce((a, l) => a + l.amount, 0);
    const vehicle = comp.lines.filter(l => l.kind === 'vehicle').reduce((a, l) => a + l.amount, 0);
    const other = comp.lines.filter(l => l.kind === 'manual').reduce((a, l) => a + l.amount, 0);
    const matAmtP = comp.lines.filter(l => l.kind === 'mat').reduce((a, l) => a + l.amount, 0);
    const rows = [...(labour || !matAmtP ? [['Labour', money(labour)]] : []), ...(matAmtP ? [['Materials', money(matAmtP)]] : []), ...(vehicle ? [['Vehicle', money(vehicle)]] : []), ...(other ? [['Other items', money(other)]] : []), ['Subtotal (excl GST)', money(comp.subtotal)], ['GST 15%', money(comp.gst)]];
    if (y > 245) { doc.addPage(); y = 20; }
    const x0 = W - M - 80;
    doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(...ink);
    rows.forEach(([k, v]) => { doc.text(k, x0, y); doc.text(v, W - M, y, { align: 'right' }); y += 5.5; });
    doc.setDrawColor(...ink); doc.setLineWidth(0.5); doc.line(x0, y - 2.5, W - M, y - 2.5); y += 3;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text('Total (incl GST)', x0, y); doc.text(money(comp.total), W - M, y, { align: 'right' });

    // footer on every page
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...grey);
      doc.text('Prepared from the Greenspace Consulting timesheet. Times are recorded in 15-minute units.', M, 289);
      doc.text(`Page ${i} of ${pages}`, W - M, 289, { align: 'right' });
    }
    return doc;
  }
  async function downloadPDF() {
    if (!window.jspdf || !window.jspdf.jsPDF) { toast('The PDF tool did not load. Use Print and choose Save as PDF instead.'); return; }
    try { buildSchedulePDF().save(pdfName()); toast('PDF downloaded'); } catch (e) { console.error(e); toast('Could not build the PDF: ' + e.message); }
  }
  async function pdfBase64() {
    return buildSchedulePDF().output('datauristring').split(',')[1];
  }
  function printDoc(el) {
    el.classList.add('print-target'); document.body.classList.add('printing-doc');
    const done = () => { el.classList.remove('print-target'); document.body.classList.remove('printing-doc'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
    setTimeout(done, 2000);
  }
  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); toast('Copied'); }
    catch { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast('Copied'); } catch { toast('Copy is blocked here. Select the text manually.'); } ta.remove(); }
  }

  // ----- Xero -----
  function xeroStatusHTML() {
    const x = state.xero;
    if (!x.checked) return '<span class="chip">Checking Xero ...</span>';
    if (!x.available) return '<span class="chip" title="Creating drafts in Xero works once the app runs on Netlify with the Xero keys set">Xero: available on Netlify</span>';
    if (!x.configured) return '<span class="chip warn">Xero keys not set on Netlify</span>';
    if (!x.connected) return '<span class="chip warn">Xero not connected</span><button class="btn btn-small" id="xeroConnect">Connect Xero</button>';
    return `<span class="chip ok">Xero: ${esc(x.tenantName || 'connected')}</span><button class="btn btn-small btn-quiet" id="xeroConnect">Reconnect</button>`;
  }
  async function checkXero() {
    try {
      const r = await fetch('/api/xero-status', { headers: { accept: 'application/json' } });
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      state.xero = { checked: true, available: true, configured: !!j.configured, connected: !!j.connected, tenantName: j.tenantName };
    } catch { state.xero = { checked: true, available: false }; }
    const s = $('#xeroStatus'); if (s && state.view === 'invoicing') route();
  }
  async function createInXero() {
    const inv = state.inv, m = inv.meta;
    const comp = computeInv();
    if (!m.contactName) { toast('Add the Xero contact first.'); return; }
    const btn = $('#xeroCreate'); btn.disabled = true; btn.textContent = 'Creating draft ...';
    const out = $('#invResult');
    try {
      const payload = C.xeroPayload(invForExport(), comp, state.settings);
      let attachment = null;
      if (window.jspdf) { try { attachment = { fileName: pdfName(), base64: await pdfBase64() }; } catch (e) { console.warn('PDF for attachment failed', e); } }
      const r = await fetch('/api/xero-invoice', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ invoice: payload, attachment }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || ('Xero returned ' + r.status));
      markInvoiced(j.invoiceNumber, j.total);
      inv.result = `<p><span class="chip ok">Draft created</span> ${esc(j.invoiceNumber || '')} for ${money(j.total ?? comp.total)}${j.attached ? ', schedule attached' : ''}. <a href="${esc(j.url)}" target="_blank" rel="noopener">Open in Xero</a></p>`;
      out.innerHTML = inv.result; toast('Draft invoice created in Xero');
    } catch (e) {
      out.innerHTML = `<p class="callout">Xero did not accept the draft: ${esc(e.message)}</p>`;
    } finally { btn.disabled = false; btn.textContent = 'Create draft in Xero'; }
  }



  // ======================================================================
  // MATERIALS (landscaping client materials and subcontractors)
  // ======================================================================
  function renderMaterials(el) {
    const cfg = state.config, s = state.settings, tiers = s.tiers;
    cfg.materials = cfg.materials || [];
    const landClients = [...new Set([...cfg.projects.filter(p => p.project === 'Landscaping').map(p => p.client), ...cfg.materials.map(m => m.client)])].sort((a, b) => a.localeCompare(b));
    if (!state.matClient || !landClients.includes(state.matClient)) state.matClient = landClients.find(c => cfg.materials.some(m => m.client === c && !m.invoice)) || landClients[0] || '';
    const show = state.matShow || 'open';
    const list = cfg.materials.filter(m => m.client === state.matClient && (show === 'all' || !m.invoice)).sort((a, b) => (b.date + a.item).localeCompare(a.date + b.item));
    const tierOpts = v => { const opts = [['A', tiers.A], ['B', tiers.B], ['C', tiers.C], ['D', tiers.D], ['0', 0]]; const known = opts.some(([, x]) => Math.abs(x - v) < 1e-9);
      return opts.map(([k, x]) => `<option value="${x}" ${Math.abs(x - v) < 1e-9 ? 'selected' : ''}>${k === '0' ? 'No margin' : 'Tier ' + k} (${Math.round(x * 100)}%)</option>`).join('') + (known ? '' : `<option value="${v}" selected>Other (${Math.round(v * 1000) / 10}%)</option>`) + '<option value="custom">Other ...</option>'; };
    const T = { cost: 0, sell: 0, margin: 0, incl: 0 };
    const rowsH = list.map(m => { const c = C.matCalc(m); T.cost += c.costTotal; T.sell += c.total; T.margin += c.marginTotal; T.incl += c.totalIncl;
      return `<tr data-mid="${esc(m.id)}">
        <td><button class="btn btn-danger btn-small mat-del" data-mdel="${esc(m.id)}" aria-label="Delete ${esc(m.item)}" title="Delete this line">Delete</button></td>
        <td><input type="month" data-mf="date" value="${esc(m.date.slice(0, 7))}" aria-label="Month"></td>
        <td><input type="text" data-mf="item" value="${esc(m.item)}" aria-label="Item"></td>
        <td><input type="text" data-mf="supplier" value="${esc(m.supplier)}" list="supplierList" aria-label="Supplier"></td>
        <td><input type="text" data-mf="unit" value="${esc(m.unit)}" aria-label="Unit" style="width:5em"></td>
        <td><input type="number" step="any" data-mf="qty" value="${m.qty}" aria-label="Quantity" style="width:5.5em;text-align:right"></td>
        <td><input type="number" step="0.01" data-mf="cost" value="${C.round2(m.cost)}" aria-label="Cost per unit" style="width:6.5em;text-align:right"></td>
        <td><select data-mf="margin" aria-label="Margin">${tierOpts(+m.margin || 0)}</select></td>
        <td class="num">${money(c.unitPrice)}</td><td class="num"><strong>${money(c.total)}</strong></td><td class="num muted">${money(c.marginTotal)}</td>
        <td>${m.invoice ? `<span class="chip ok">${esc(m.invoice)}</span> <button class="btn btn-small btn-quiet" data-unbill="${esc(m.id)}" title="Make this item available to invoice again">Undo</button>` : '<span class="chip warn">To invoice</span>'}</td>
      </tr>`; }).join('');
    const suppliers = [...new Set(cfg.materials.map(m => m.supplier).filter(Boolean))].sort();

    el.innerHTML = `
      <div class="view-head">
        <div><div class="label">Landscaping</div><h1>${esc(state.matClient || 'Landscaping')}</h1></div>
        <div class="controls">
          <select id="mClient" aria-label="Client">${landClients.map(c => { const open = cfg.materials.filter(m => m.client === c && !m.invoice).length; return `<option value="${esc(c)}" ${c === state.matClient ? 'selected' : ''}>${esc(c)}${open ? ` (${open} to invoice)` : ''}</option>`; }).join('')}</select>
          <div class="seg" role="group" aria-label="Show"><button id="mOpen" aria-pressed="${show === 'open'}">Not yet invoiced</button><button id="mAll" aria-pressed="${show === 'all'}">All</button></div>
        </div>
      </div>
      <div class="kpis">
        <div class="kpi lead"><span class="label">To charge (excl GST)</span><span class="value">${money0(T.sell)}</span><span class="sub">${money(T.incl)} incl GST</span></div>
        <div class="kpi"><span class="label">Cost</span><span class="value">${money0(T.cost)}</span><span class="sub">${list.length} item${list.length === 1 ? '' : 's'}</span></div>
        <div class="kpi"><span class="label">Margin</span><span class="value">${money0(T.margin)}</span><span class="sub">${T.sell ? Math.round(T.margin / T.sell * 100) : 0}% of sell price</span></div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Materials and subcontractors</h2>
          <div class="add-lines" style="margin:0"><button class="btn" id="mAdd">+ Add item</button><button class="btn btn-quiet" id="mPrep" ${list.some(m => !m.invoice) ? '' : 'disabled'}>Prepare invoice</button></div></div>
        ${list.some(m => !m.invoice) ? `<form id="mBulk" class="add-lines" style="margin:0 0 12px;align-items:end">
          <label class="field"><span>Already billed? Items up to</span><input type="month" id="mBulkTo" value="${esc(list.filter(m => !m.invoice).map(m => m.date.slice(0, 7)).sort().slice(-1)[0] || '')}"></label>
          <label class="field"><span>Invoice number</span><input type="text" id="mBulkNo" placeholder="e.g. INV-0520" style="width:9em"></label>
          <button class="btn btn-small btn-quiet" type="submit">Mark as invoiced</button></form>` : ''}
        <div class="table-wrap"><table class="setup-table mat-table">
          <thead><tr><th></th><th>Month</th><th>Item</th><th>Supplier</th><th>Unit</th><th class="num">Qty</th><th class="num">Cost $ (unit)</th><th>Margin</th><th class="num">Unit price</th><th class="num">Total excl GST</th><th class="num">Margin $</th><th>Invoice</th></tr></thead>
          <tbody>${rowsH || `<tr><td colspan="12" class="muted">No ${show === 'open' ? 'uninvoiced ' : ''}materials for ${esc(state.matClient)}. Use Add item, or bring them in from the workbook below.</td></tr>`}</tbody>
          <tfoot><tr><td></td><td colspan="7">Total</td><td class="num">${money(T.sell)}</td><td class="num">${money(T.margin)}</td><td></td></tr></tfoot>
        </table></div>
        <datalist id="supplierList">${suppliers.map(x => `<option value="${esc(x)}">`).join('')}</datalist>
      </div>
      <div class="grid-2">
        <div class="panel" style="display:grid;gap:10px;align-content:start">
          <h2>Margin tiers</h2>
          <div class="add-lines" style="margin:0">${['A', 'B', 'C', 'D'].map(k => `<label class="field"><span>Tier ${k} %</span><input type="number" min="0" step="0.5" data-tier="${k}" value="${Math.round(tiers[k] * 1000) / 10}" style="width:6em"></label>`).join('')}</div>
          <p class="note">Changing a tier updates the choices for new items. Items keep the margin they were given.</p>
        </div>
        <div class="panel" style="display:grid;gap:10px;align-content:start">
          <h2>Bring in from the workbook</h2>
          <p class="note">Reads every client tab with Month, ITEM, Supplier, Unit, Quantity, Cost and Margin columns. Replaces items previously brought in from the workbook; items added in the app are kept.</p>
          <div><label class="btn btn-quiet" for="matFile">Choose workbook</label><input type="file" id="matFile" accept=".xlsx,.xlsm" hidden></div>
        </div>
      </div>`;

    const rerender = () => { const y = window.scrollY; renderMaterials(el); window.scrollTo({ top: y }); };
    const save = () => { state.inv = null; saveSettings(); };
    $('#mClient').onchange = e => { state.matClient = e.target.value; rerender(); };
    $('#mOpen').onclick = () => { state.matShow = 'open'; rerender(); };
    $('#mAll').onclick = () => { state.matShow = 'all'; rerender(); };
    $('#mAdd').onclick = () => {
      const last = cfg.materials.filter(m => m.client === state.matClient).slice(-1)[0];
      cfg.materials.push({ id: C.uid(), client: state.matClient, date: C.monthKey(todayISO()) + '-01', item: '', supplier: last ? last.supplier : '', unit: 'Ea', qty: 1, cost: 0, margin: tiers.A, source: 'app', invoice: '' });
      save(); rerender(); const first = el.querySelector('tbody [data-mf="item"]'); if (first) first.focus();
    };
    $('#mPrep').onclick = () => {
      const open = cfg.materials.filter(m => m.client === state.matClient && !m.invoice).map(m => m.date).sort();
      startInvoice(state.matClient, [], C.monthStart(C.monthKey(open[0])), C.monthEnd(C.monthKey(open[open.length - 1]))); state.inv.land = true; state.inv.sf = false; rebuildInvoice(false); go('invoicing');
    };
    $$('[data-mf]', el).forEach(inp => inp.onchange = () => {
      const m = cfg.materials.find(x => x.id === inp.closest('tr').dataset.mid); if (!m) return;
      const f = inp.dataset.mf; let v = inp.value;
      if (f === 'margin' && v === 'custom') { inp.outerHTML = `<input type="number" step="0.5" data-mf="marginPct" value="${Math.round(m.margin * 1000) / 10}" style="width:5em" aria-label="Margin percent">`; const ni = el.querySelector('[data-mf="marginPct"]'); ni.focus(); ni.onchange = () => { m.margin = (+ni.value || 0) / 100; save(); rerender(); }; return; }
      if (f === 'date') m.date = (v || C.monthKey(todayISO())) + '-01';
      else if (f === 'qty' || f === 'cost' || f === 'margin') m[f] = +v || 0;
      else m[f] = v.trim();
      save(); rerender();
    });
    $$('[data-mdel]', el).forEach(b => b.onclick = () => {
      if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Confirm delete'; setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = 'Delete'; } }, 4000); return; }
      cfg.materials = cfg.materials.filter(x => x.id !== b.dataset.mdel); save(); rerender(); toast('Item deleted');
    });
    $$('[data-unbill]', el).forEach(b => b.onclick = () => { const m = cfg.materials.find(x => x.id === b.dataset.unbill); if (m) { m.invoice = ''; save(); rerender(); } });
    $('#mBulk')?.addEventListener('submit', e => {
      e.preventDefault();
      const to = $('#mBulkTo').value, no = $('#mBulkNo').value.trim();
      if (!to || !no) { toast('Choose the month and enter the invoice number.'); return; }
      let n = 0; cfg.materials.forEach(m => { if (m.client === state.matClient && !m.invoice && m.date.slice(0, 7) <= to) { m.invoice = no; n++; } });
      save(); rerender(); toast(`${n} item${n === 1 ? '' : 's'} marked as ${no}`);
    });
    $$('[data-tier]', el).forEach(inp => inp.onchange = () => { tiers[inp.dataset.tier] = (+inp.value || 0) / 100; save(); rerender(); toast('Tier saved'); });
    $('#matFile').onchange = async e => {
      const file = e.target.files[0]; e.target.value = ''; if (!file) return;
      try {
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        const sheets = {}; for (const n of wb.SheetNames) sheets[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null });
        const mats = C.parseMaterials(sheets);
        // keep invoice stamps for items already invoiced in the app
        const stamp = new Map(cfg.materials.filter(m => m.source === 'workbook' && m.invoice).map(m => [m.client + '|' + m.date + '|' + m.item + '|' + m.qty, m.invoice]));
        mats.forEach(m => { const k = m.client + '|' + m.date + '|' + m.item + '|' + m.qty; if (stamp.has(k)) m.invoice = stamp.get(k); });
        cfg.materials = cfg.materials.filter(m => m.source !== 'workbook').concat(mats);
        save(); rerender(); toast(`Brought in ${mats.length} items from ${file.name}`, 4000);
      } catch (err) { toast('Could not read the workbook: ' + err.message, 6000); }
    };
  }

  // ======================================================================
  // SETUP
  // ======================================================================
  function renderSetup(el) {
    const s = state.settings, cfg = state.config;
    const used = new Map();
    for (const r of state.data.rows) if (r.client) used.set(r.client + '|' + r.project, (used.get(r.client + '|' + r.project) || 0) + r.hours);
    const billKeys = [...new Set([...Object.keys(s.projects), ...[...used.keys()].filter(k => isBillable(k.split('|')[0]))])].sort();
    const contacts = Object.keys(s.contacts).sort();
    const projects = cfg.projects.slice().sort((a, b) => (a.client + a.project).localeCompare(b.client + b.project));
    const t = todayISO();
    const tMonths = []; for (let m = C.monthKey(s.fromDate || '2026-09-01'); m <= C.addMonths(C.monthKey(t), 12); m = C.addMonths(m, 1)) tMonths.push(m);

    el.innerHTML = `
      <div class="view-head"><div><div class="label">Setup</div><h1>Rates, targets and billing</h1></div></div>

      <div class="grid-2">
        <div class="panel">
          <div class="panel-head"><h2>Clients, projects and rates</h2><span class="note">Rate per hour, excl GST. Changing a rate applies to new entries.</span></div>
          <div class="table-wrap" style="max-height:520px;overflow:auto"><table class="setup-table">
            <thead><tr><th>Client</th><th>Project</th><th class="num">Rate $/h</th><th class="num">Hours</th><th></th></tr></thead>
            <tbody>${projects.map(p => { const i = cfg.projects.indexOf(p); return `<tr>
              <td class="key">${esc(p.client)}</td><td>${esc(p.project)}</td>
              <td><input type="number" min="0" step="0.5" data-rate-i="${i}" value="${p.rate}" aria-label="Rate for ${esc(p.client + ' ' + p.project)}" style="text-align:right"></td>
              <td class="num muted">${used.has(p.client + '|' + p.project) ? hrs(used.get(p.client + '|' + p.project)) : ''}</td>
              <td>${used.has(p.client + '|' + p.project) ? '' : `<button class="btn btn-danger btn-small" data-rm-i="${i}" aria-label="Remove ${esc(p.client + ' ' + p.project)}">Remove</button>`}</td></tr>`; }).join('')}</tbody>
          </table></div>
          <form id="addProj" class="add-lines" style="align-items:end">
            <label class="field"><span>Client code</span><input type="text" id="npClient" list="clientCodes" required style="width:9em"></label>
            <label class="field"><span>Project</span><input type="text" id="npProject" required style="width:12em"></label>
            <label class="field"><span>Rate</span><input type="number" id="npRate" min="0" step="0.5" value="150" style="width:6em"></label>
            <button class="btn btn-small" type="submit">Add project</button>
          </form>
          <datalist id="clientCodes">${clientsList().map(c => `<option value="${esc(c)}">`).join('')}</datalist>
        </div>

        <div class="panel">
          <div class="panel-head"><h2>Monthly targets</h2><span class="note">Used on the Dashboard and the daily target</span></div>
          <div class="table-wrap" style="max-height:520px;overflow:auto"><table class="setup-table">
            <thead><tr><th>Month</th><th class="num">Target $</th><th class="num">Working days</th><th class="num">$ per day</th></tr></thead>
            <tbody>${tMonths.map(m => { const x = cfg.targets[m] || {}; return `<tr>
              <td class="key">${C.monthLabel(m)}</td>
              <td><input type="number" min="0" step="100" data-tg="${m}" data-f="target" value="${x.target ?? ''}" style="text-align:right" aria-label="Target for ${C.monthLabel(m)}"></td>
              <td><input type="number" min="0" step="1" data-tg="${m}" data-f="targetDays" value="${x.targetDays ?? ''}" style="text-align:right" aria-label="Working days in ${C.monthLabel(m)}"></td>
              <td class="num muted">${x.target && x.targetDays ? money0(x.target / x.targetDays) : ''}</td></tr>`; }).join('')}</tbody>
          </table></div>
          <label class="field" style="margin-top:12px;max-width:220px"><span>Mileage rate $/km</span><input type="number" min="0" step="0.01" id="sMileage" value="${cfg.mileageRate}"></label>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><h2>Who each project is billed to</h2><span class="note">Fills the draft invoice. "Client|*" covers every project for that client. Use {month} in a heading to insert the invoice month.</span></div>
        <div class="table-wrap"><table class="setup-table">
          <thead><tr><th>Client | Project</th><th>Xero contact</th><th>Reference / PO</th><th>Invoice heading</th><th>Due</th><th>Schedule</th></tr></thead>
          <tbody>${billKeys.map(k => { const p = s.projects[k] || { contact: '', reference: '', header: '', due: '20th' }; return `<tr data-key="${esc(k)}">
            <td class="key">${esc(k.replace('|', ' | '))}${p.check ? ' <span class="chip warn">check</span>' : ''}</td>
            <td><input type="text" data-f="contact" value="${esc(p.contact)}" list="contactList2" aria-label="Xero contact for ${esc(k)}"></td>
            <td><input type="text" data-f="reference" value="${esc(p.reference)}" aria-label="Reference for ${esc(k)}"></td>
            <td><input type="text" data-f="header" value="${esc(p.header)}" aria-label="Heading for ${esc(k)}"></td>
            <td><select data-f="due" aria-label="Due date rule for ${esc(k)}">${[['20th', '20th of next month'], ['7', '7 days'], ['3', '3 days'], ['2', '2 days'], ['14', '14 days'], ['30', '30 days']].map(([v, tx]) => `<option value="${v}" ${String(p.due) === v ? 'selected' : ''}>${tx}</option>`).join('')}</select></td>
            <td><select data-f="schedule" aria-label="Schedule type for ${esc(k)}"><option value="">Standard</option><option value="sf" ${p.schedule === 'sf' ? 'selected' : ''}>Sports fields</option><option value="land" ${p.schedule === 'land' ? 'selected' : ''}>Landscaping</option></select></td></tr>`; }).join('')}</tbody>
        </table></div>
        <datalist id="contactList2">${contacts.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
      </div>

      <div class="grid-2">
        <div class="panel" style="display:grid;gap:12px;align-content:start">
          <h2>Invoice defaults</h2>
          <label class="field"><span>Consultant name on invoice lines</span><input type="text" id="sConsultant" value="${esc(s.consultant)}"></label>
          <label class="field"><span>Next invoice number</span><input type="text" id="sNext" value="${esc(s.nextInvoiceNumber)}"></label>
          <label class="field"><span>Sales account code</span><input type="text" id="sAcct" value="${esc(s.accountCode)}"></label>
          <label class="field"><span>Not invoiced (internal time), comma separated</span><input type="text" id="sNonBill" value="${esc(s.nonBillable.join(', '))}"></label>
          <h3 style="margin-top:6px">Xero contacts</h3>
          <div class="table-wrap"><table><thead><tr><th>Name</th><th>Contact ID</th></tr></thead>
            <tbody>${contacts.map(c => `<tr><td>${esc(c)}</td><td class="mono" style="font-size:.75rem">${esc(s.contacts[c])}</td></tr>`).join('')}</tbody></table></div>
        </div>
        <div class="panel" style="display:grid;gap:12px;align-content:start">
          <h2>Your data</h2>
          <p class="note">${state.data.rows.length.toLocaleString()} timesheet entries${state.data.rows.length ? `, ${C.fmtDateLong(state.data.rows[0].date)} to ${C.fmtDateLong(state.data.rows[state.data.rows.length - 1].date)}` : ''}. ${db.mode === 'server' ? 'Stored on your Netlify site.' : 'Stored in this browser only (the database works once the app runs on Netlify).'}${s.importedFile ? ` Imported from ${esc(s.importedFile)} on ${new Date(s.importedAt).toLocaleDateString('en-NZ')}.` : ''}</p>
          <div class="add-lines">
            <button class="btn btn-small" id="xlsxBtn">Download timesheet (Excel)</button>
            <button class="btn btn-small btn-quiet" id="backupBtn">Download full backup</button>
          </div>
          <h3 style="margin-top:6px">Import from the workbook</h3>
          <p class="note">Replaces app entries from the chosen date onward with the workbook's Timesheet. Entries before that date are kept, and a backup is saved first. Use this once to bring your history across.</p>
          <div class="add-lines" style="align-items:end">
            <label class="field"><span>Replace entries from</span><input type="date" id="impFrom" value="${esc(s.fromDate || '2026-09-01')}"></label>
            <label class="btn btn-small btn-quiet" for="fileInput">Choose workbook</label>
          </div>
        </div>
      </div>`;

    const saved = () => { state.inv = null; saveSettings(); };
    $$('[data-rate-i]', el).forEach(inp => inp.onchange = () => { cfg.projects[+inp.dataset.rateI].rate = +inp.value || 0; saved(); toast('Rate saved'); });
    $$('[data-rm-i]', el).forEach(b => b.onclick = () => { cfg.projects.splice(+b.dataset.rmI, 1); saved(); renderSetup(el); toast('Project removed'); });
    $('#addProj').onsubmit = e => {
      e.preventDefault();
      const client = $('#npClient').value.trim(), project = $('#npProject').value.trim();
      if (!client || !project) return;
      if (cfg.projects.some(p => p.client === client && p.project === project)) { toast('That project already exists.'); return; }
      cfg.projects.push({ client, project, rate: +$('#npRate').value || 0 });
      saved(); renderSetup(el); toast(`Added ${client} | ${project}`);
    };
    $$('[data-tg]', el).forEach(inp => inp.onchange = () => {
      const m = inp.dataset.tg; cfg.targets[m] = Object.assign({ target: 0, targetDays: 21 }, cfg.targets[m]);
      cfg.targets[m][inp.dataset.f] = +inp.value || 0; saved(); renderSetup(el);
    });
    $('#sMileage').onchange = e => { cfg.mileageRate = +e.target.value || 0.8; state.data.mileageRate = cfg.mileageRate; saved(); toast('Saved'); };
    $$('tr[data-key] [data-f]', el).forEach(inp => inp.onchange = () => {
      const k = inp.closest('tr').dataset.key;
      const p = s.projects[k] = Object.assign({ contact: '', reference: '', header: '', due: '20th' }, s.projects[k]);
      p[inp.dataset.f] = inp.value.trim(); delete p.check;
      saved(); toast('Saved');
    });
    const bind = (id, fn) => { $(id).onchange = e => { fn(e.target.value.trim()); saved(); toast('Saved'); }; };
    bind('#sConsultant', v => s.consultant = v);
    bind('#sNext', v => s.nextInvoiceNumber = v);
    bind('#sAcct', v => s.accountCode = v || '200');
    bind('#sNonBill', v => s.nonBillable = v.split(',').map(x => x.trim()).filter(Boolean));
    $('#xlsxBtn').onclick = exportExcel;
    $('#backupBtn').onclick = () => downloadBlob(new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), entries: state.data.rows, config: state.config }, null, 1)], { type: 'application/json' }), `Greenspace Finance backup ${todayISO()}.json`);
  }

  function exportExcel() {
    if (!window.XLSX) { toast('The spreadsheet tool did not load.'); return; }
    const rows = state.data.rows.map(r => ({ Date: r.date, Start: r.time, End: r.end, Client: r.client, Project: r.project, Activity: r.activity, Hours: r.hours, Rate: r.rate, Amount: r.amount, Kms: r.kms || '', 'Km $': r.kmAmt || '', Category: r.category, Notes: r.notes }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Timesheet');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(state.config.projects.map(p => ({ Client: p.client, Project: p.project, Rate: p.rate }))), 'Rates');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Object.entries(state.config.targets).sort().map(([m, x]) => ({ Month: m, Target: x.target, 'Working days': x.targetDays }))), 'Targets');
    XLSX.writeFile(wb, `Greenspace timesheet ${todayISO()}.xlsx`);
  }

  // ---------- boot ----------
  (async function boot() {
    route();
    const res = await db.load();
    // carry over settings saved by the earlier browser-only version
    let cfg = res.config;
    const oldSettings = store.get('gs.settings', null);
    if (!cfg && oldSettings) cfg = { settings: oldSettings };
    applyConfig(cfg);
    setRows(res.entries || []);
    state.firstRun = !!res.empty && !(res.entries || []).length;
    pickDates();
    updateChip();
    route();
    checkXero();
  })();
})();
