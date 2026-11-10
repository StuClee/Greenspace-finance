/* Greenspace Finance: core logic (no DOM). Works in the browser (window.GSCore) and in Node for testing. */
(function (root) {
  'use strict';

  // ---------- dates ----------
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const addDays = (s, n) => { const d = parseISO(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  const monthKey = s => s.slice(0, 7);
  const monthStart = mk => mk + '-01';
  const monthEnd = mk => { const [y, m] = mk.split('-').map(Number); return iso(new Date(Date.UTC(y, m, 0))); };
  const addMonths = (mk, n) => { const [y, m] = mk.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return iso(d).slice(0, 7); };
  const weekday = s => parseISO(s).getUTCDay(); // 0 Sun
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthLabel = mk => { const [y, m] = mk.split('-').map(Number); return `${MONTHS_LONG[m - 1]} ${y}`; };
  const fmtDateNZ = s => { const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };
  const fmtDateLong = s => { const d = parseISO(s); return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };

  // Excel serial -> ISO date / HH:MM
  const serialToISO = v => {
    if (typeof v !== 'number' || !isFinite(v)) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return iso(d);
  };
  const serialToTime = v => {
    if (typeof v !== 'number' || !isFinite(v)) return null;
    const mins = Math.round((v - Math.floor(v)) * 1440);
    return `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`;
  };
  const timeAdd = (t, mins) => { const [h, m] = t.split(':').map(Number); const x = h * 60 + m + mins; return `${pad(Math.floor(x / 60))}:${pad(x % 60)}`; };

  // Day range text in Stu's Xero style: "3-30.09.2026" or "28.09-4.10.2026"
  function rangeText(a, b) {
    const [ya, ma, da] = a.split('-').map(Number);
    const [yb, mb, db] = b.split('-').map(Number);
    if (a === b) return `${da}.${pad(mb)}.${yb}`;
    if (ya === yb && ma === mb) return `${da}-${db}.${pad(mb)}.${yb}`;
    if (ya === yb) return `${da}.${pad(ma)}-${db}.${pad(mb)}.${yb}`;
    return `${da}.${pad(ma)}.${ya}-${db}.${pad(mb)}.${yb}`;
  }

  const num = v => (typeof v === 'number' && isFinite(v)) ? v : (typeof v === 'string' && v.trim() !== '' && isFinite(+v) ? +v : 0);
  const str = v => (v === null || v === undefined) ? '' : String(v).trim();
  const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

  // ---------- workbook parsing ----------
  // `sheets` = { Timesheet: [[...rows]], Config: [[...]], 'Working Days': [[...]] } from XLSX.utils.sheet_to_json(ws,{header:1,raw:true})
  function parseWorkbook(sheets, opts = {}) {
    const fromDate = opts.fromDate || '2026-09-01';
    const warnings = [];

    // Config
    const cfg = sheets.Config || [];
    const projects = [];
    let mileageRate = 0.8;
    let hdr = cfg.findIndex(r => r && str(r[0]) === 'Client' && str(r[1]) === 'Project');
    if (hdr >= 0) {
      const mr = cfg[hdr] && num(cfg[hdr][7]); if (mr) mileageRate = mr;
      for (let i = hdr + 1; i < cfg.length; i++) {
        const r = cfg[i] || [];
        if (!str(r[0])) continue;
        projects.push({ client: str(r[0]), project: str(r[1]), rateOld: num(r[2]), rateNew: num(r[3]), notes: str(r[4]) });
      }
    } else warnings.push('Config tab: could not find the Client / Project table.');

    // Working days / targets
    const wd = sheets['Working Days'] || [];
    const targets = {};
    for (const r of wd) {
      if (!r) continue;
      const m = MONTHS.indexOf(str(r[0]));
      const y = num(r[1]);
      if (m < 0 || !y) continue;
      const mk = `${y}-${pad(m + 1)}`;
      targets[mk] = { netDays: num(r[7]), targetDays: num(r[8]) || num(r[7]), target: num(r[9]) };
    }

    // Timesheet
    const ts = sheets.Timesheet || [];
    const h = ts.findIndex(r => r && str(r[0]) === 'Date' && str(r[2]) === 'Client');
    if (h < 0) throw new Error('Could not find the Timesheet header row (Date, Time, Client, Project ...).');
    const col = {}; ts[h].forEach((v, i) => { const k = str(v); if (k && !(k in col)) col[k] = i; });
    const need = ['Date', 'Time', 'Client', 'Project', 'Activity', 'Hours', 'Rate', 'Amount', 'Kms', 'Rate2', 'km $', 'Category'];
    for (const k of need) if (!(k in col)) warnings.push(`Timesheet: column "${k}" not found.`);

    const rateFor = (client, project, date) => {
      const p = projects.find(x => x.client === client && x.project === project) || projects.find(x => x.client === client);
      if (!p) return 0;
      return date >= '2026-07-01' ? (p.rateNew || p.rateOld) : p.rateOld;
    };

    const rows = [];
    for (let i = h + 1; i < ts.length; i++) {
      const r = ts[i]; if (!r) continue;
      const date = serialToISO(r[col.Date]);
      if (!date || date < fromDate) continue;
      const client = str(r[col.Client]);
      const kms = num(r[col.Kms]);
      if (!client && !kms) continue;
      const project = str(r[col.Project]);
      let hours = num(r[col.Hours]);
      if (client && !hours) hours = 0.25;
      let rate = num(r[col.Rate]);
      if (!rate && client) rate = rateFor(client, project, date);
      let amount = num(r[col.Amount]);
      if (!amount && hours && rate) amount = hours * rate;
      const kmRate = num(r[col.Rate2]) || mileageRate;
      let kmAmt = num(r[col['km $']]);
      if (!kmAmt && kms) kmAmt = round2(kms * kmRate);
      let category = str(r[col.Category]);
      if (!category && client) category = categorise(client, project, str(r[col.Activity]));
      rows.push({
        date, time: serialToTime(r[col.Time]) || '', client, project,
        activity: str(r[col.Activity]), notes: str(r[col.Notes]),
        hours, rate, amount: round2(amount), kms, kmRate, kmAmt: round2(kmAmt), category
      });
    }
    rows.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    return { rows, projects, mileageRate, targets, fromDate, warnings, loadedAt: new Date().toISOString() };
  }

  function categorise(client, project, activity) {
    if (project === 'Landscaping') return 'Landscaping';
    if (project === 'Admin' || client === 'Admin') return 'Admin';
    if (/travel|flight|accomm/i.test(activity) || /travel/i.test(project) || /travel/i.test(client)) return 'Travel';
    return 'Consulting';
  }

  // ---------- daily view ----------
  // Merge consecutive 15-min slots with the same client/project/activity into blocks.
  function dayBlocks(rows, date) {
    const day = rows.filter(r => r.date === date && r.client);
    const blocks = [];
    for (const r of day) {
      const last = blocks[blocks.length - 1];
      const end = timeAdd(r.time || '00:00', Math.round(r.hours * 60));
      if (last && last.client === r.client && last.project === r.project && last.activity === r.activity && last.end === r.time) {
        last.end = end; last.hours += r.hours; last.amount += r.amount;
      } else {
        blocks.push({ start: r.time, end, client: r.client, project: r.project, activity: r.activity, category: r.category, hours: r.hours, rate: r.rate, amount: r.amount, notes: r.notes });
      }
    }
    const kmRows = rows.filter(r => r.date === date && r.kms);
    return { blocks, kmRows };
  }

  // ---------- entries (the app's own records) ----------
  const toMin = t => { const [h, m] = (t || '0:0').split(':').map(Number); return h * 60 + m; };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  // Merge the workbook's 15-minute rows into time blocks (one entry per continuous activity).
  function rowsToEntries(rows) {
    const out = [];
    for (const r of rows) {
      const last = out[out.length - 1];
      if (!r.client) { // mileage-only row: attach to the previous entry that day
        if (r.kms && last && last.date === r.date) { last.kms += r.kms; last.kmAmt = round2(last.kmAmt + r.kmAmt); }
        continue;
      }
      const end = timeAdd(r.time || '00:00', Math.round(r.hours * 60));
      if (last && last.date === r.date && last.client === r.client && last.project === r.project && last.activity === r.activity && last.rate === r.rate && last.end === r.time) {
        last.end = end; last.hours += r.hours; last.amount = round2(last.amount + r.amount);
        if (r.kms) { last.kms += r.kms; last.kmAmt = round2(last.kmAmt + r.kmAmt); }
        if (r.notes && !last.notes.includes(r.notes)) last.notes = last.notes ? last.notes + '; ' + r.notes : r.notes;
      } else {
        out.push({ id: uid(), date: r.date, time: r.time, end, client: r.client, project: r.project, activity: r.activity, notes: r.notes || '',
          hours: r.hours, rate: r.rate, amount: round2(r.amount), kms: r.kms || 0, kmRate: r.kmRate, kmAmt: round2(r.kmAmt || 0), category: r.category });
      }
    }
    return out;
  }

  function rateFor(config, client, project) {
    const p = (config.projects || []).find(x => x.client === client && x.project === project);
    return p ? (+p.rate || 0) : 0;
  }

  // Build or update an entry from form fields. Keeps the stored rate unless client/project changed or keepRate is false.
  function makeEntry(f, config, prev) {
    const mins = Math.max(0, toMin(f.end) - toMin(f.time));
    const hours = Math.round(mins / 15) / 4;
    const sameJob = prev && prev.client === f.client && prev.project === f.project;
    const rate = f.rate !== undefined && f.rate !== '' && f.rate !== null ? +f.rate : (sameJob ? prev.rate : rateFor(config, f.client, f.project));
    const kms = +f.kms || 0;
    const kmRate = (prev && prev.kmRate) || config.mileageRate || 0.8;
    return {
      id: (prev && prev.id) || uid(), date: f.date, time: f.time, end: f.end, client: f.client, project: f.project,
      activity: (f.activity || '').trim(), notes: (f.notes || '').trim(), hours, rate, amount: round2(hours * rate),
      kms, kmRate, kmAmt: round2(kms * kmRate), category: categorise(f.client, f.project, f.activity || '')
    };
  }

  function sumBy(list, keyFn, valFn) {
    const m = new Map();
    for (const x of list) { const k = keyFn(x); m.set(k, (m.get(k) || 0) + valFn(x)); }
    return m;
  }

  // ---------- invoicing ----------
  // Group timesheet rows for one client (+ optional project filter) and period into one row per day per project.
  function invoiceDays(rows, { client, projects, start, end }) {
    const sel = rows.filter(r => r.client === client && r.date >= start && r.date <= end && (!projects || !projects.length || projects.includes(r.project)));
    const map = new Map();
    for (const r of sel) {
      const k = r.date + '|' + r.project;
      if (!map.has(k)) map.set(k, { key: k, date: r.date, project: r.project, activities: [], hours: 0, amount: 0, kms: 0, kmAmt: 0, kmNotes: [] });
      const d = map.get(k);
      if (r.hours) {
        d.hours += r.hours; d.amount += r.amount;
        const a = r.activity; if (a && !d.activities.includes(a)) d.activities.push(a);
      }
      if (r.kms) { d.kms += r.kms; d.kmAmt += r.kmAmt; if (r.activity && !d.kmNotes.includes(r.activity)) d.kmNotes.push(r.activity); }
    }
    const days = [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
    days.forEach(d => { d.amount = round2(d.amount); d.kmAmt = round2(d.kmAmt); d.rate = d.hours ? round2(d.amount / d.hours) : 0; d.activityText = d.activities.join('; '); });
    return days;
  }

  // Default invoice lines: one heading line + one consulting line per project (+ vehicle line).
  function defaultLines(days, billing, opts) {
    const consultant = opts.consultant || 'S Cameron-Lee';
    const projects = [...new Set(days.filter(d => d.hours).map(d => d.project))];
    const lines = [];
    let id = 1;
    for (const p of projects) {
      const pd = days.filter(d => d.project === p && d.hours);
      const b = billing(p) || {};
      const first = pd[0].date, last = pd[pd.length - 1].date;
      const acts = uniqueJoin(pd.flatMap(d => d.activities), 600);
      const header = (b.header || '').trim();
      lines.push({ id: id++, kind: 'heading', project: p, header, auto: true, description: header ? (acts ? `${header} - ${acts}` : header) : acts || p });
      lines.push({ id: id++, kind: 'time', project: p, description: `Consulting services - ${consultant} (${rangeText(first, last)} as per schedule emailed)` });
    }
    const kd = days.filter(d => d.kms);
    if (kd.length) {
      lines.push({ id: id++, kind: 'vehicle', project: '', description: `Vehicle (${rangeText(kd[0].date, kd[kd.length - 1].date)} as per schedule emailed)` });
    }
    return lines;
  }

  function uniqueJoin(list, max) {
    const seen = new Set(); const out = [];
    for (const a of list) { const k = a.toLowerCase(); if (!a || seen.has(k)) continue; seen.add(k); out.push(a); }
    let s = out.join('; ');
    if (max && s.length > max) s = s.slice(0, max).replace(/;[^;]*$/, '') + '; etc.';
    return s;
  }

  // ---------- Sports field schedule (SF tabs: Adj Hours / Visits / No of Visits / P27 / Reporting-Admin / Technical) ----------
  const SF_CATS = ['visits', 'admin', 'tech', 'p27'];
  // First-guess allocation for a day from its activity text. Visits are left for you to enter.
  function suggestAlloc(day) {
    const t = (day.activityText || '').toLowerCase();
    const a = { adj: day.hours, visits: 0, nv: 0, p27: 0, admin: 0, tech: 0, suggested: true };
    if (/p27|saving/.test(t)) a.p27 = day.hours;
    else if (day.kms && !/civic|albert st|meeting|call|email|teams/.test(t)) { a.visits = day.hours; a.nv = 1; }
    else if (/meeting|call|email|teams|civic|admin|follow ?up|report to/.test(t)) a.admin = day.hours;
    else a.tech = day.hours;
    return a;
  }
  const allocTotal = a => (+a.visits || 0) + (+a.p27 || 0) + (+a.admin || 0) + (+a.tech || 0);

  function sfDescriptions(days, allocFn, opts = {}) {
    const pick = cat => days.filter(d => d.hours && (+allocFn(d)[cat] || 0) > 0);
    const range = list => list.length ? rangeText(list[0].date, list[list.length - 1].date) : '';
    const acts = list => uniqueJoin(list.flatMap(d => d.activities), 420);
    const v = pick('visits'), nv = v.reduce((s, d) => s + (+allocFn(d).nv || 0), 0);
    return {
      visits: `Site visits (${nv || v.length} visit${(nv || v.length) === 1 ? '' : 's'} as per schedule emailed - ${range(v)})`,
      admin: `Admin/Meetings/Reporting - ${acts(pick('admin'))} (${range(pick('admin'))})`,
      tech: `Technical Support - Sports Fields - ${acts(pick('tech'))} (${range(pick('tech'))})`,
      p27: `P27 - ${acts(pick('p27'))} (${range(pick('p27'))})`
    };
  }
  function sfLines(days, allocFn, header) {
    const desc = sfDescriptions(days, allocFn);
    let id = 1;
    const lines = [{ id: id++, kind: 'heading', project: '', description: header || 'Project Management Services – Sports Delivery Programme' }];
    for (const cat of SF_CATS) lines.push({ id: id++, kind: 'alloc', cat, project: '', description: desc[cat], auto: true });
    if (days.some(d => d.kms)) {
      const kd = days.filter(d => d.kms);
      lines.push({ id: id++, kind: 'vehicle', project: '', description: `Vehicle (${rangeText(kd[0].date, kd[kd.length - 1].date)} as per schedule emailed)` });
    }
    return lines;
  }

  // ---------- Landscaping materials (client tabs: Month / ITEM / Supplier / Unit / Quantity / Cost $ (unit) / Margin %) ----------
  function matCalc(m) {
    const qty = num(m.qty), cost = num(m.cost), margin = num(m.margin);
    const unitPrice = round2(cost * (1 + margin));
    const total = round2(qty * cost * (1 + margin)), costTotal = round2(qty * cost);
    return { unitPrice, total, costTotal, marginTotal: round2(total - costTotal), gst: round2(total * 0.15), totalIncl: round2(total * 1.15) };
  }
  // Read every client tab that has an ITEM / Supplier / Quantity header row.
  function parseMaterials(sheets, opts = {}) {
    const year = opts.year || 2026;
    const out = [];
    for (const [name, rows] of Object.entries(sheets)) {
      const h = rows.findIndex(r => r && r.some(v => str(v) === 'ITEM') && r.some(v => str(v) === 'Supplier') && r.some(v => str(v) === 'Quantity'));
      if (h < 0) continue;
      const col = {}; rows[h].forEach((v, i) => { const k = str(v); if (k && !(k in col)) col[k] = i; });
      for (let i = h + 1; i < rows.length; i++) {
        const r = rows[i]; if (!r) continue;
        const item = str(r[col.ITEM]); if (!item) continue;
        const mi = MONTHS.indexOf(str(r[col.Month]).slice(0, 3));
        const qty = num(r[col.Quantity]), cost = num(r[col['Cost $ (unit)']]);
        if (!qty && !cost) continue;
        out.push({ id: uid(), client: name.trim(), date: mi >= 0 ? `${year}-${pad(mi + 1)}-01` : `${year}-01-01`, item, supplier: str(r[col.Supplier]), unit: str(r[col.Unit]),
          qty, cost: Math.round(cost * 10000) / 10000, margin: num(r[col['Margin %']]), source: 'workbook', invoice: '' });
      }
    }
    return out;
  }
  function landLines(days, mats, opts = {}) {
    const work = days.filter(d => d.hours), kd = days.filter(d => d.kms);
    let id = 1; const lines = [];
    if (mats.length) lines.push({ id: id++, kind: 'mat', project: '', description: opts.matText || 'Plants & Landscaping Materials as per schedule emailed' });
    if (work.length) lines.push({ id: id++, kind: 'time', project: work[0].project, description: `Labour as per schedule emailed (${rangeText(work[0].date, work[work.length - 1].date)})` });
    if (kd.length) lines.push({ id: id++, kind: 'vehicle', project: '', description: `Vehicle (${rangeText(kd[0].date, kd[kd.length - 1].date)})` });
    return lines;
  }

  // Compute quantities/amounts for lines from day assignments.
  // assign: { dayKey: lineId } for time lines (defaults to the time line of that day's project).
  function computeLines(lines, days, assign, allocFn, ctx = {}) {
    const out = lines.map(l => ({ ...l, quantity: null, unitAmount: null, amount: 0, dayKeys: [] }));
    const byId = new Map(out.map(l => [l.id, l]));
    const timeLines = out.filter(l => l.kind === 'time');
    for (const d of days) {
      if (!d.hours) continue;
      let l = byId.get(assign && assign[d.key]);
      if (!l || l.kind !== 'time') l = timeLines.find(t => t.project === d.project) || timeLines[0];
      if (!l) continue;
      l.quantity = (l.quantity || 0) + d.hours;
      l.amount += d.amount;
      l.dayKeys.push(d.key);
    }
    for (const l of timeLines) {
      if (l.manualRate) { l.unitAmount = l.manualRate; l.amount = round2((l.quantity || 0) * l.manualRate); }
      else l.unitAmount = l.quantity ? round2(l.amount / l.quantity) : 0;
      l.amount = round2(l.amount);
    }
    for (const l of out.filter(l => l.kind === 'alloc')) {
      let q = 0, amt = 0;
      for (const d of days) { if (!d.hours || !allocFn) continue; const v = +allocFn(d)[l.cat] || 0; q += v; amt += v * d.rate; }
      l.quantity = q;
      l.unitAmount = l.manualRate || (q ? round2(amt / q) : (days.find(d => d.rate)?.rate || 0));
      l.amount = round2(q * l.unitAmount);
    }
    for (const l of out.filter(l => l.kind === 'mat')) { l.quantity = 1; l.unitAmount = round2(ctx.matTotal || 0); l.amount = l.unitAmount; }
    const veh = out.find(l => l.kind === 'vehicle');
    if (veh) {
      const kms = days.reduce((s, d) => s + d.kms, 0), amt = days.reduce((s, d) => s + d.kmAmt, 0);
      veh.quantity = kms; veh.unitAmount = kms ? round2(amt / kms) : 0; veh.amount = round2(veh.quantity * veh.unitAmount);
    }
    for (const l of out.filter(l => l.kind === 'manual')) {
      l.quantity = num(l.quantity0); l.unitAmount = num(l.unitAmount0); l.amount = round2(l.quantity * l.unitAmount);
    }
    const subtotal = round2(out.reduce((s, l) => s + (l.amount || 0), 0));
    // Xero rounds GST per line on exclusive invoices
    const gst = round2(out.reduce((s, l) => s + round2((l.amount || 0) * 0.15), 0));
    return { lines: out, subtotal, gst, total: round2(subtotal + gst) };
  }

  function dueDateFor(invoiceDate, rule) {
    rule = rule || '20th';
    if (rule === '20th') { const mk = addMonths(monthKey(invoiceDate), 1); return mk + '-20'; }
    const n = parseInt(rule, 10); return addDays(invoiceDate, isFinite(n) ? n : 20);
  }

  // Xero API payload (POST /api.xro/2.0/Invoices)
  function xeroPayload(inv, computed, opts = {}) {
    const items = computed.lines.filter(l => l.kind === 'heading' ? l.description : (l.quantity || l.amount)).map(l => {
      if (l.kind === 'heading') return { Description: l.description };
      return { Description: l.description, Quantity: round2(l.quantity), UnitAmount: l.unitAmount, AccountCode: opts.accountCode || '200', TaxType: opts.taxType || 'OUTPUT2' };
    });
    const contact = inv.contactId ? { ContactID: inv.contactId } : { Name: inv.contactName };
    const p = { Type: 'ACCREC', Contact: contact, Date: inv.date, DueDate: inv.dueDate, Reference: inv.reference || undefined, LineAmountTypes: 'Exclusive', Status: 'DRAFT', CurrencyCode: 'NZD', LineItems: items };
    if (inv.number) p.InvoiceNumber = inv.number;
    return p;
  }

  // Xero sales-invoice import CSV (Business > Invoices > Import)
  function xeroCSV(inv, computed, opts = {}) {
    const H = ['*ContactName', 'EmailAddress', 'POAddressLine1', 'POAddressLine2', 'POAddressLine3', 'POAddressLine4', 'POCity', 'PORegion', 'POPostalCode', 'POCountry', '*InvoiceNumber', 'Reference', '*InvoiceDate', '*DueDate', 'InventoryItemCode', '*Description', '*Quantity', '*UnitAmount', 'Discount', '*AccountCode', '*TaxType', 'TrackingName1', 'TrackingOption1', 'TrackingName2', 'TrackingOption2', 'Currency', 'BrandingTheme'];
    const esc = v => { v = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const rows = [H];
    for (const l of computed.lines) {
      if (l.kind !== 'heading' && !(l.quantity || l.amount)) continue;
      if (l.kind === 'heading' && !l.description) continue;
      const r = new Array(H.length).fill('');
      r[0] = inv.contactName; r[10] = inv.number || ''; r[11] = inv.reference || '';
      r[12] = fmtDateNZ(inv.date); r[13] = fmtDateNZ(inv.dueDate); r[15] = l.description;
      if (l.kind !== 'heading') { r[16] = round2(l.quantity); r[17] = l.unitAmount; r[19] = opts.accountCode || '200'; r[20] = opts.taxLabel || '15% GST on Income'; }
      r[25] = 'NZD';
      rows.push(r);
    }
    return rows.map(r => r.map(esc).join(',')).join('\r\n');
  }

  // ---------- dashboard ----------
  function monthStats(data, mk, today) {
    const rows = data.rows.filter(r => monthKey(r.date) === mk);
    const work = rows.filter(r => r.client);
    const revenue = round2(work.reduce((s, r) => s + r.amount, 0));
    const hours = work.reduce((s, r) => s + r.hours, 0);
    const kms = rows.reduce((s, r) => s + r.kms, 0);
    const mileage = round2(rows.reduce((s, r) => s + r.kmAmt, 0));
    const daysWorked = new Set(work.filter(r => r.hours).map(r => r.date)).size;
    const t = data.targets[mk] || {};
    const target = t.target || 0;
    // Weekday-based target pacing
    const start = monthStart(mk), end = monthEnd(mk);
    const weekdays = []; for (let d = start; d <= end; d = addDays(d, 1)) if (weekday(d) % 6 !== 0) weekdays.push(d);
    // daily target = target / net working days; the running target stops at the month target
    const netDays = t.targetDays || weekdays.length;
    const perDay = netDays ? target / netDays : 0;
    const daily = [];
    let cumA = 0, cumT = 0;
    for (let d = start; d <= end; d = addDays(d, 1)) {
      const a = round2(work.filter(r => r.date === d).reduce((s, r) => s + r.amount, 0));
      const hrs = work.filter(r => r.date === d).reduce((s, r) => s + r.hours, 0);
      cumA += a; if (weekday(d) % 6 !== 0) cumT = Math.min(target, cumT + perDay);
      daily.push({ date: d, actual: a, hours: hrs, cumActual: round2(cumA), cumTarget: round2(cumT), future: today && d > today });
    }
    const asOf = today && today < end ? (today < start ? start : today) : end;
    const targetToDate = round2(daily.filter(x => x.date <= asOf).slice(-1)[0]?.cumTarget || 0);
    const cat = sumBy(work, r => r.category || 'Consulting', r => r.amount);
    const catH = sumBy(work, r => r.category || 'Consulting', r => r.hours);
    const byProj = new Map();
    for (const r of work) {
      const k = r.client + '|' + r.project;
      if (!byProj.has(k)) byProj.set(k, { client: r.client, project: r.project, hours: 0, amount: 0, rates: new Set() });
      const p = byProj.get(k); p.hours += r.hours; p.amount += r.amount; if (r.rate) p.rates.add(r.rate);
    }
    const projects = [...byProj.values()].map(p => ({ ...p, amount: round2(p.amount), rate: [...p.rates].join('/') })).sort((a, b) => b.amount - a.amount);
    return { mk, revenue, hours, kms, mileage, daysWorked, target, targetDays: t.targetDays || weekdays.length, targetToDate, daily, categories: Object.fromEntries(cat), categoryHours: Object.fromEntries(catH), projects };
  }

  // NZ public holidays on weekdays (Auckland), including Mondayised days. Used to pre-fill Stats.
  const NZ_HOLIDAYS = {
    '2026-10-26': 'Labour Day', '2026-12-25': 'Christmas Day', '2026-12-28': 'Boxing Day (observed)',
    '2027-01-01': "New Year's Day", '2027-01-04': "Day after New Year's (observed)", '2027-02-01': 'Auckland Anniversary', '2027-02-08': 'Waitangi Day (observed)',
    '2027-03-26': 'Good Friday', '2027-03-29': 'Easter Monday', '2027-04-26': 'Anzac Day (observed)', '2027-06-07': "King's Birthday", '2027-06-25': 'Matariki',
    '2027-10-25': 'Labour Day', '2027-12-27': 'Christmas Day (observed)', '2027-12-28': 'Boxing Day (observed)'
  };
  const holidaysIn = mk => Object.keys(NZ_HOLIDAYS).filter(d => d.startsWith(mk)).map(d => ({ date: d, name: NZ_HOLIDAYS[d] }));
  function weekdaysIn(mk) {
    let n = 0; for (let d = monthStart(mk); d <= monthEnd(mk); d = addDays(d, 1)) if (weekday(d) % 6 !== 0) n++;
    return n;
  }
  function monthsInData(data) {
    return [...new Set(data.rows.map(r => monthKey(r.date)))].sort();
  }

  function api() { return { holidaysIn, NZ_HOLIDAYS, weekdaysIn, matCalc, parseMaterials, landLines, SF_CATS, suggestAlloc, allocTotal, sfDescriptions, sfLines, rowsToEntries, makeEntry, rateFor, toMin, uid, timeAdd, pad, iso, parseISO, addDays, monthKey, monthStart, monthEnd, addMonths, weekday, monthLabel, fmtDateNZ, fmtDateLong, rangeText, round2, MONTHS, DAYS, parseWorkbook, categorise, dayBlocks, invoiceDays, defaultLines, computeLines, dueDateFor, xeroPayload, xeroCSV, monthStats, monthsInData, uniqueJoin }; }
  if (typeof module !== 'undefined' && module.exports) module.exports = api();
  else root.GSCore = api();
})(typeof window !== 'undefined' ? window : globalThis);
