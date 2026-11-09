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

  // ---------- storage ----------
  const store = {
    get(k, fb) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch { } }
  };

  const clone = o => JSON.parse(JSON.stringify(o));
  function loadSettings() {
    const d = clone(window.GS_BILLING_DEFAULTS);
    const s = store.get('gs.settings', null);
    const merged = Object.assign(d, s || {});
    merged.projects = Object.assign(clone(window.GS_BILLING_DEFAULTS.projects), (s && s.projects) || {});
    merged.contacts = Object.assign(clone(window.GS_BILLING_DEFAULTS.contacts), (s && s.contacts) || {});
    merged.invoiced = (s && s.invoiced) || [];
    merged.fromDate = (s && s.fromDate) || '2026-09-01';
    return merged;
  }
  const saveSettings = () => store.set('gs.settings', state.settings);

  const state = {
    data: null, source: null, settings: loadSettings(), view: 'dashboard',
    tsDate: null, tsMonth: null, dashMonth: null,
    inv: null, xero: { checked: false, available: false, connected: false }, charts: {}
  };

  // ---------- toast ----------
  let toastTimer;
  function toast(msg, ms = 2800) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }

  // ---------- workbook loading ----------
  async function loadFile(file) {
    if (!file) return;
    if (!window.XLSX) { toast('The spreadsheet reader did not load. Check your connection and reload the page.'); return; }
    toast('Reading ' + file.name + ' ...', 8000);
    try {
      const buf = await file.arrayBuffer();
      const names = ['Timesheet', 'Config', 'Working Days'];
      const wb = XLSX.read(buf, { type: 'array', sheets: names });
      const sheets = {};
      for (const n of names) if (wb.Sheets[n]) sheets[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null });
      if (!sheets.Timesheet) throw new Error('This workbook has no Timesheet tab.');
      const data = C.parseWorkbook(sheets, { fromDate: state.settings.fromDate });
      data.fileName = file.name; data.fileModified = file.lastModified ? new Date(file.lastModified).toISOString() : null;
      setData(data, 'file');
      if (!store.set('gs.data', data)) toast('Loaded, but this browser could not save it. You will need to load the workbook again next visit.', 5000);
      else toast(`Loaded ${data.rows.length.toLocaleString()} timesheet entries from ${file.name}`);
      if (data.warnings.length) console.warn(data.warnings);
    } catch (e) {
      console.error(e);
      toast('Could not read the workbook: ' + e.message, 6000);
    }
  }

  function setData(data, source) {
    state.data = data; state.source = source;
    const last = data.rows.length ? data.rows[data.rows.length - 1].date : todayISO();
    const t = todayISO();
    state.tsDate = state.tsDate || (last < t ? last : t);
    state.dashMonth = state.dashMonth || C.monthKey(last < t ? last : t);
    state.inv = null;
    updateChip();
    route();
  }

  function updateChip() {
    const chip = $('#dataChip');
    if (!state.data) { chip.textContent = 'No workbook loaded'; chip.className = 'chip warn'; return; }
    const d = state.data;
    const last = d.rows.length ? d.rows[d.rows.length - 1].date : null;
    const src = state.source === 'snapshot' ? 'Snapshot of 2 Nov workbook' : (d.fileName || 'Workbook');
    chip.textContent = `${src} · entries to ${last ? C.fmtDateLong(last) : 'none'}`;
    chip.className = 'chip ' + (state.source === 'snapshot' ? 'warn' : 'ok');
    chip.title = 'Loaded ' + new Date(d.loadedAt).toLocaleString('en-NZ');
  }

  // drag & drop anywhere
  let dragDepth = 0;
  window.addEventListener('dragenter', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { dragDepth++; document.body.classList.add('dragging'); } });
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove('dragging'); });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => { e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging'); const f = e.dataTransfer?.files?.[0]; if (f) loadFile(f); });
  $('#fileInput').addEventListener('change', e => { loadFile(e.target.files[0]); e.target.value = ''; });

  // ---------- routing ----------
  const VIEWS = ['dashboard', 'timesheet', 'invoicing', 'setup'];
  function route() {
    const h = (location.hash || '').replace('#', '');
    state.view = VIEWS.includes(h) ? h : 'dashboard';
    $$('.tabs a').forEach(a => a.setAttribute('aria-current', a.dataset.view === state.view ? 'page' : 'false'));
    $$('.view').forEach(v => { v.hidden = true; });
    if (!state.data && state.view !== 'setup') { $('#view-empty').hidden = false; return; }
    const el = $('#view-' + state.view); el.hidden = false;
    ({ dashboard: renderDashboard, timesheet: renderTimesheet, invoicing: renderInvoicing, setup: renderSetup })[state.view](el);
  }
  window.addEventListener('hashchange', route);
  const go = v => { if (location.hash === '#' + v) route(); else location.hash = v; };

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

  // ======================================================================
  // DASHBOARD
  // ======================================================================
  function renderDashboard(el) {
    const d = state.data;
    const months = C.monthsInData(d);
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
  // TIMESHEET
  // ======================================================================
  function renderTimesheet(el) {
    const d = state.data;
    const date = state.tsDate;
    const mk = C.monthKey(date);
    const { blocks, kmRows } = C.dayBlocks(d.rows, date);
    const dayRev = blocks.reduce((a, b) => a + b.amount, 0);
    const dayHrs = blocks.reduce((a, b) => a + b.hours, 0);
    const perDay = monthTargetPerDay(mk);
    const isWeekend = C.weekday(date) % 6 === 0;
    const cats = {}; blocks.forEach(b => { cats[b.category] = (cats[b.category] || 0) + b.hours; });
    const kms = kmRows.reduce((a, r) => a + r.kms, 0), kmAmt = kmRows.reduce((a, r) => a + r.kmAmt, 0);

    // week strip (Mon to Sun)
    const wd = C.weekday(date); const mon = C.addDays(date, -((wd + 6) % 7));
    const week = Array.from({ length: 7 }, (_, i) => C.addDays(mon, i)).map(x => ({ date: x, hours: d.rows.filter(r => r.date === x && r.client).reduce((a, r) => a + r.hours, 0) }));
    const maxH = Math.max(10, ...week.map(w => w.hours));

    // timeline with gaps
    let tl = '';
    blocks.forEach((b, i) => {
      if (i && blocks[i - 1].end < b.start) tl += `<div class="gap">Break ${blocks[i - 1].end} to ${b.start}</div>`;
      tl += `<div class="block" style="--c:${CAT_COLORS[b.category] || 'var(--accent)'}">
        <div class="t">${b.start} - ${b.end}</div>
        <div><div class="who">${esc(b.client)} <span class="muted" style="font-weight:400">· ${esc(b.project)}</span></div><div class="act">${esc(b.activity) || '<span class="muted">No activity noted</span>'}${b.notes ? ` · <em>${esc(b.notes)}</em>` : ''}</div></div>
        <div class="amt"><div><strong>${hrs(b.hours)} h</strong></div><div class="muted">${b.amount ? money(b.amount) : 'non-billable'}</div></div>
      </div>`;
    });

    // month list
    const monthRows = d.rows.filter(r => C.monthKey(r.date) === (state.tsMonth || mk));
    const byDate = new Map();
    for (const r of monthRows) {
      if (!byDate.has(r.date)) byDate.set(r.date, { date: r.date, hours: 0, amount: 0, kms: 0, cats: {}, clients: new Map() });
      const x = byDate.get(r.date);
      if (r.client) { x.hours += r.hours; x.amount += r.amount; x.cats[r.category] = (x.cats[r.category] || 0) + r.hours; x.clients.set(r.client, (x.clients.get(r.client) || 0) + r.hours); }
      x.kms += r.kms;
    }
    const days = [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
    const tm = state.tsMonth || mk;
    const months = C.monthsInData(d);

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
        <div class="panel-head"><h2>Day</h2><span class="note">15-minute entries from the Timesheet tab, joined into blocks</span></div>
        <div class="timeline">${tl || `<p class="muted">Nothing recorded for ${C.fmtDateLong(date)}.</p>`}</div>
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

    const setDate = x => { if (!x) return; state.tsDate = x; state.tsMonth = null; renderTimesheet(el); };
    $('#tPrev').onclick = () => setDate(C.addDays(date, -1));
    $('#tNext').onclick = () => setDate(C.addDays(date, 1));
    $('#tToday').onclick = () => setDate(todayISO());
    $('#tDate').onchange = e => setDate(e.target.value);
    $('#tMonth').onchange = e => { state.tsMonth = e.target.value; renderTimesheet(el); };
    $$('.week button', el).forEach(b => b.onclick = () => setDate(b.dataset.date));
    $$('tr[data-date]', el).forEach(tr => { tr.onclick = () => { setDate(tr.dataset.date); window.scrollTo({ top: 0 }); }; tr.onkeydown = e => { if (e.key === 'Enter') tr.click(); }; });
  }

  // ======================================================================
  // INVOICING
  // ======================================================================
  function billableClients(start, end) {
    const m = new Map();
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
  function startInvoice(client, projects, start, end) {
    if (!projects || !projects.length) projects = client ? defaultProjects(client, start, end) : [];
    state.inv = { client, projects: projects || [], start, end, assign: {}, lines: null, meta: null };
    rebuildInvoice(true);
  }

  function rebuildInvoice(resetMeta) {
    const inv = state.inv;
    inv.days = C.invoiceDays(state.data.rows, inv);
    const monthTxt = (() => { const [y, m] = inv.end.split('-').map(Number); return `${C.MONTHS[m - 1]} ${y}`; })();
    const bill = p => { const b = billingFor(inv.client, p); return { ...b, header: (b.header || '').replace('{month}', monthTxt) }; };
    inv.lines = C.defaultLines(inv.days, bill, { consultant: state.settings.consultant });
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

  function renderInvoicing(el) {
    const t = todayISO();
    const months = C.monthsInData(state.data);
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
    const comp = C.computeLines(inv.lines, inv.days, inv.assign);
    const timeLines = comp.lines.filter(l => l.kind === 'time');
    const m = inv.meta;
    const multiProj = new Set(inv.days.map(x => x.project)).size > 1;
    const workDays = inv.days.filter(x => x.hours);
    const kmDays = inv.days.filter(x => x.kms);
    const labour = timeLines.reduce((a, l) => a + l.amount, 0);
    const vehicle = comp.lines.filter(l => l.kind === 'vehicle').reduce((a, l) => a + l.amount, 0);
    const other = comp.lines.filter(l => l.kind === 'manual').reduce((a, l) => a + l.amount, 0);
    const projTitle = inv.projects.length ? inv.projects.join(', ') : [...new Set(workDays.map(x => x.project))].join(', ');
    const lineLabel = l => `Line ${comp.lines.indexOf(l) + 1}`;

    el.innerHTML = `
      <div class="view-head">
        <div><div class="label">Invoicing</div><h1>${esc(m.contactName || 'Choose a client')}</h1></div>
        <div class="xero-status" id="xeroStatus">${xeroStatusHTML()}</div>
      </div>
      <div class="inv-layout">
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
            ${billingFor(inv.client, projList[0]?.[0]).check ? `<div class="callout">Check who this project is billed to on the Setup page.</div>` : ''}
          </div>
          <div class="panel">
            <h3>Totals</h3>
            <div class="doc-totals" style="width:100%;margin:0">
              <div><span>Hours</span><span>${hrs(workDays.reduce((a, x) => a + x.hours, 0))}</span></div>
              <div><span>Labour</span><span>${money(labour)}</span></div>
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
            <div class="paper" id="scheduleDoc">
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
              <div class="table-wrap"><table>
                <thead><tr><th>Date</th>${multiProj ? '<th>Project</th>' : ''}<th>Activities</th><th class="num">Hours</th><th class="num">Rate</th><th class="num">Amount</th>${timeLines.length > 1 ? '<th class="no-print">Invoice line</th>' : ''}</tr></thead>
                <tbody>${workDays.map(x => `<tr>
                  <td style="white-space:nowrap">${C.fmtDateNZ(x.date)}</td>${multiProj ? `<td>${esc(x.project)}</td>` : ''}
                  <td class="act-cell">${esc(x.activityText) || '<span style="color:#5d6a61">-</span>'}</td>
                  <td class="num">${hrs(x.hours)}</td><td class="num">${money(x.rate)}</td><td class="num">${money(x.amount)}</td>
                  ${timeLines.length > 1 ? `<td class="no-print"><select class="line-sel" data-day="${esc(x.key)}">${timeLines.map(l => `<option value="${l.id}" ${l.dayKeys.includes(x.key) ? 'selected' : ''}>${lineLabel(l)}${l.project && l.project !== '__split' ? ' · ' + esc(l.project) : ''}</option>`).join('')}</select></td>` : ''}
                </tr>`).join('') || `<tr><td colspan="6" class="muted">No time in this period.</td></tr>`}</tbody>
                <tfoot><tr><td colspan="${multiProj ? 3 : 2}">Total time</td><td class="num">${hrs(workDays.reduce((a, x) => a + x.hours, 0))}</td><td></td><td class="num">${money(workDays.reduce((a, x) => a + x.amount, 0))}</td>${timeLines.length > 1 ? '<td class="no-print"></td>' : ''}</tr></tfoot>
              </table></div>
              ${kmDays.length ? `<div class="doc-section"><h3>Vehicle</h3><div class="table-wrap"><table>
                <thead><tr><th>Date</th>${multiProj ? '<th>Project</th>' : ''}<th>Trip</th><th class="num">Km</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
                <tbody>${kmDays.map(x => `<tr><td>${C.fmtDateNZ(x.date)}</td>${multiProj ? `<td>${esc(x.project)}</td>` : ''}<td>${esc(x.kmNotes.join('; ')) || '-'}</td><td class="num">${x.kms}</td><td class="num">${money(x.kms ? x.kmAmt / x.kms : 0)}</td><td class="num">${money(x.kmAmt)}</td></tr>`).join('')}</tbody>
                <tfoot><tr><td colspan="${multiProj ? 3 : 2}">Total vehicle</td><td class="num">${kmDays.reduce((a, x) => a + x.kms, 0)}</td><td></td><td class="num">${money(kmDays.reduce((a, x) => a + x.kmAmt, 0))}</td></tr></tfoot>
              </table></div></div>` : ''}
              <div class="doc-totals">
                <div><span>Labour</span><span>${money(labour)}</span></div>
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
                <td><div class="kind">${{ heading: 'Heading', time: 'Time' + (l.project && l.project !== '__split' ? ' · ' + esc(l.project) : ''), vehicle: 'Vehicle', manual: 'Item' }[l.kind]}</div>
                  <textarea rows="${l.kind === 'heading' ? 3 : 2}" data-desc="${i}" aria-label="Description line ${i + 1}">${esc(l.description)}</textarea></td>
                ${l.kind === 'heading' ? '<td colspan="5" class="muted" style="font-size:.8rem">Description only</td>' : `
                <td class="num">${l.kind === 'manual' ? `<input type="number" step="0.01" data-qty="${i}" value="${l.quantity0 ?? ''}">` : hrs(l.quantity)}</td>
                <td class="num">${l.kind === 'manual' ? `<input type="number" step="0.01" data-unit="${i}" value="${l.unitAmount0 ?? ''}">` : l.kind === 'time' ? `<input type="number" step="0.01" data-rate="${i}" value="${l.unitAmount}" title="Change to override the timesheet rate">` : money(l.unitAmount)}</td>
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
    const metaInput = (id, k) => { $(id).onchange = e => { m[k] = e.target.value.trim(); if (k === 'contactName') m.contactId = state.settings.contacts[m.contactName] || ''; if (k === 'date' && inv.dueRule) m.due = C.dueDateFor(m.date, inv.dueRule); rerender(); }; };
    metaInput('#mContact', 'contactName'); metaInput('#mNumber', 'number'); metaInput('#mRef', 'reference'); metaInput('#mDate', 'date'); metaInput('#mDue', 'due');
    $$('[data-desc]', el).forEach(t => t.oninput = () => { inv.lines[+t.dataset.desc].description = t.value; });
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
      const csv = C.xeroCSV(invForExport(), C.computeLines(inv.lines, inv.days, inv.assign), state.settings);
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
    const inv = state.inv, m = inv.meta, comp = C.computeLines(inv.lines, inv.days, inv.assign);
    const lines = comp.lines.map(l => l.kind === 'heading' ? l.description : `${l.description}\t${hrs(l.quantity)} x ${money(l.unitAmount)} = ${money(l.amount)}`);
    return [`To: ${m.contactName}`, `Invoice: ${m.number}`, `Reference: ${m.reference}`, `Date: ${C.fmtDateNZ(m.date)}  Due: ${C.fmtDateNZ(m.due)}`, '', ...lines, '', `Subtotal ${money(comp.subtotal)}`, `GST ${money(comp.gst)}`, `Total ${money(comp.total)}`].join('\n');
  }
  function markInvoiced(number, total) {
    const inv = state.inv;
    const projects = [...new Set(inv.days.map(x => x.project))];
    const mk = C.monthKey(inv.start);
    state.settings.invoiced = state.settings.invoiced.filter(i => !(i.month === mk && i.client === inv.client && i.projects.join() === projects.join()));
    state.settings.invoiced.push({ month: mk, client: inv.client, projects, start: inv.start, end: inv.end, number: number || inv.meta.number, total: total ?? C.computeLines(inv.lines, inv.days, inv.assign).total, at: new Date().toISOString() });
    // move the suggested next number on
    const n = (number || inv.meta.number || '').match(/^(.*?)(\d+)$/);
    if (n && (number || inv.meta.number) === state.settings.nextInvoiceNumber) state.settings.nextInvoiceNumber = n[1] + String(+n[2] + 1).padStart(n[2].length, '0');
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
  function pdfWorker() {
    const el = $('#scheduleDoc');
    return html2pdf().set({
      margin: [12, 12, 14, 12], filename: pdfName(), image: { type: 'jpeg', quality: 0.96 },
      html2canvas: { scale: 2, backgroundColor: '#ffffff', useCORS: true, onclone: doc => { doc.body.classList.add('pdf-mode'); const p = doc.getElementById('scheduleDoc'); p.style.boxShadow = 'none'; p.style.border = '0'; p.style.width = '780px'; p.style.padding = '0'; } },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }, pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', '.doc-totals'] }
    }).from(el);
  }
  async function downloadPDF() {
    if (!window.html2pdf) { toast('The PDF tool did not load. Use Print and choose Save as PDF instead.'); return; }
    try { toast('Building PDF ...'); await pdfWorker().save(); } catch (e) { console.error(e); toast('Could not build the PDF: ' + e.message); }
  }
  async function pdfBase64() {
    const blob = await pdfWorker().outputPdf('blob');
    return await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
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
    const comp = C.computeLines(inv.lines, inv.days, inv.assign);
    if (!m.contactName) { toast('Add the Xero contact first.'); return; }
    const btn = $('#xeroCreate'); btn.disabled = true; btn.textContent = 'Creating draft ...';
    const out = $('#invResult');
    try {
      const payload = C.xeroPayload(invForExport(), comp, state.settings);
      let attachment = null;
      if (window.html2pdf) { try { attachment = { fileName: pdfName(), base64: await pdfBase64() }; } catch (e) { console.warn('PDF for attachment failed', e); } }
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
  // SETUP
  // ======================================================================
  function renderSetup(el) {
    const s = state.settings;
    const used = new Map();
    if (state.data) for (const r of state.data.rows) if (r.client && isBillable(r.client)) used.set(r.client + '|' + r.project, (used.get(r.client + '|' + r.project) || 0) + r.hours);
    const keys = [...new Set([...Object.keys(s.projects), ...used.keys()])].sort();
    const contacts = Object.keys(s.contacts).sort();
    el.innerHTML = `
      <div class="view-head"><div><div class="label">Setup</div><h1>Billing and data</h1></div></div>
      <div class="panel">
        <div class="panel-head"><h2>Who each project is billed to</h2><span class="note">Used to fill the draft invoice. "Client|*" covers every project for that client. Use {month} in a heading to insert the invoice month.</span></div>
        <div class="table-wrap"><table class="setup-table">
          <thead><tr><th>Client | Project</th><th>Xero contact</th><th>Reference / PO</th><th>Invoice heading</th><th>Due</th><th class="num">Hours</th></tr></thead>
          <tbody>${keys.map(k => { const p = s.projects[k] || { contact: '', reference: '', header: '', due: '20th' }; return `<tr data-key="${esc(k)}">
            <td class="key">${esc(k.replace('|', ' | '))}${p.check ? ' <span class="chip warn">check</span>' : ''}</td>
            <td><input type="text" data-f="contact" value="${esc(p.contact)}" list="contactList2" aria-label="Xero contact for ${esc(k)}"></td>
            <td><input type="text" data-f="reference" value="${esc(p.reference)}" aria-label="Reference for ${esc(k)}"></td>
            <td><input type="text" data-f="header" value="${esc(p.header)}" aria-label="Heading for ${esc(k)}"></td>
            <td><select data-f="due" aria-label="Due date rule for ${esc(k)}">${[['20th', '20th of next month'], ['7', '7 days'], ['3', '3 days'], ['2', '2 days'], ['14', '14 days'], ['30', '30 days']].map(([v, t]) => `<option value="${v}" ${String(p.due) === v ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
            <td class="num muted">${used.has(k) ? hrs(used.get(k)) : ''}</td></tr>`; }).join('')}</tbody>
        </table></div>
        <datalist id="contactList2">${contacts.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
      </div>

      <div class="grid-2">
        <div class="panel" style="display:grid;gap:12px">
          <h2>Invoice defaults</h2>
          <label class="field"><span>Consultant name on invoice lines</span><input type="text" id="sConsultant" value="${esc(s.consultant)}"></label>
          <label class="field"><span>Next invoice number</span><input type="text" id="sNext" value="${esc(s.nextInvoiceNumber)}"></label>
          <label class="field"><span>Sales account code</span><input type="text" id="sAcct" value="${esc(s.accountCode)}"></label>
          <label class="field"><span>Not invoiced (internal time), comma separated</span><input type="text" id="sNonBill" value="${esc(s.nonBillable.join(', '))}"></label>
          <label class="field"><span>Read timesheet entries from</span><input type="date" id="sFrom" value="${esc(s.fromDate)}"></label>
          <p class="note">Changing the start date takes effect next time you load the workbook.</p>
        </div>
        <div class="panel" style="display:grid;gap:12px;align-content:start">
          <h2>Xero contacts</h2>
          <p class="note">Contact IDs let the app attach invoices to the exact Xero contact. Names without an ID are matched by name.</p>
          <div class="table-wrap"><table><thead><tr><th>Name</th><th>Contact ID</th></tr></thead>
            <tbody>${contacts.map(c => `<tr><td>${esc(c)}</td><td class="mono" style="font-size:.75rem">${esc(s.contacts[c])}</td></tr>`).join('')}</tbody></table></div>
          <h2 style="margin-top:8px">Saved in this browser</h2>
          <p class="note">${state.data ? `Workbook data: ${state.data.rows.length.toLocaleString()} entries from ${esc(state.data.fileName || 'snapshot')}.` : 'No workbook data saved.'} ${s.invoiced.length} invoice records.</p>
          <div class="add-lines">
            <button class="btn btn-small btn-quiet" id="sExport">Export settings</button>
            <label class="btn btn-small btn-quiet" for="sImport">Import settings</label><input type="file" id="sImport" accept=".json" hidden>
            <button class="btn btn-small btn-quiet" id="sClearData">Forget workbook data</button>
          </div>
        </div>
      </div>`;

    $$('tr[data-key] [data-f]', el).forEach(inp => inp.onchange = () => {
      const k = inp.closest('tr').dataset.key;
      const p = s.projects[k] = Object.assign({ contact: '', reference: '', header: '', due: '20th' }, s.projects[k]);
      p[inp.dataset.f] = inp.value.trim(); delete p.check;
      saveSettings(); state.inv = null; toast('Saved');
    });
    const bind = (id, fn) => { $(id).onchange = e => { fn(e.target.value.trim()); saveSettings(); state.inv = null; toast('Saved'); }; };
    bind('#sConsultant', v => s.consultant = v);
    bind('#sNext', v => s.nextInvoiceNumber = v);
    bind('#sAcct', v => s.accountCode = v || '200');
    bind('#sNonBill', v => s.nonBillable = v.split(',').map(x => x.trim()).filter(Boolean));
    bind('#sFrom', v => s.fromDate = v || '2026-09-01');
    $('#sExport').onclick = () => downloadBlob(new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' }), 'greenspace-finance-settings.json');
    $('#sImport').onchange = async e => {
      try { const j = JSON.parse(await e.target.files[0].text()); store.set('gs.settings', j); state.settings = loadSettings(); toast('Settings imported'); renderSetup(el); }
      catch (err) { toast('That file is not a settings export: ' + err.message); }
    };
    $('#sClearData').onclick = () => { store.del('gs.data'); state.data = null; updateChip(); toast('Workbook data removed from this browser'); };
  }

  // ---------- boot ----------
  const saved = store.get('gs.data', null);
  if (saved && saved.rows) setData(saved, 'file');
  else if (window.GS_SNAPSHOT) setData(window.GS_SNAPSHOT, 'snapshot');
  else { updateChip(); route(); }
  checkXero();
})();
