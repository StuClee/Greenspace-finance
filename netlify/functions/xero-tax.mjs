import { session, xeroApi, json } from './_xero.mjs';

// GET /api/xero-tax?periods=YYYY-MM-DD:YYYY-MM-DD,YYYY-MM-DD:YYYY-MM-DD&basis=payments|invoice
// Tax position for the Tax page.
// -> { today, fyStart, lyFyStart, bs, months, ly, gst: [{ start, end, sales, purchases }], irdPayments, errors }
//   bs     = tax balances at today from the balance sheet: { gst, paye, deductions, wagesPayable, incomeTax, rwt }
//   months = this FY by month (Apr ..), each { mk, income, otherIncome, cogs, expenses, np, incomeTaxExp, nonDeductible, wages: { stu, rachel, other }, kiwisaver }
//   ly     = last FY totals { np, incomeTaxExp, nonDeductible }
//   gst    = for each requested period, invoice-basis GST from invoices, credit notes, bills and spend/receive money
//   irdPayments = bank payments to Inland Revenue since the start of last FY, classed by account (GST / PAYE / income tax)
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const pad = n => String(n).padStart(2, '0');
const dim = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const parts = s => s.split('-').map(Number);
const nzToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(new Date());
const num = v => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return isFinite(n) ? n : 0; };
const fmtDT = s => { const [y, m, d] = parts(s); return `DateTime(${y},${m},${d})`; };
// Xero JSON dates: "/Date(1700000000000+0000)/" or ISO
const xDate = v => { const m = /Date\((\d+)/.exec(v || ''); return m ? new Date(+m[1]).toISOString().slice(0, 10) : String(v || '').slice(0, 10); };

function groupOf(title) {
  const t = (title || '').toLowerCase();
  if (t.includes('cost of sales') || t.includes('cost of goods')) return 'cogs';
  if (t.includes('other income')) return 'otherIncome';
  if (t.includes('income') || t.includes('revenue') || t.includes('trading')) return 'income';
  if (t.includes('expense')) return 'expenses';
  return null;
}
function parsePnl(body) {
  const rep = body?.Reports?.[0]; if (!rep) throw new Error('Xero returned no profit and loss report');
  const lines = [];
  for (const sec of rep.Rows.filter(r => r.RowType === 'Section')) {
    const group = groupOf(sec.Title); if (!group) continue;
    for (const row of sec.Rows || []) {
      if (row.RowType !== 'Row') continue;
      const [first, ...rest] = row.Cells || [];
      lines.push({ group, name: first?.Value || '', values: rest.map(c => num(c.Value)) });
    }
  }
  return lines;
}
const isIncomeTax = n => /income tax/i.test(n);
const isNonDed = n => /non[- ]?deductible/i.test(n);
function wageKind(n) {
  const s = (n || '').toLowerCase();
  if (/kiwisaver|superannuation/.test(s)) return 'kiwisaver';
  if (!/wage|salar/.test(s)) return null;
  if (/rachel/.test(s)) return 'rachel';
  if (/wages & salaries|wages and salaries|stuart|stu\b/.test(s)) return 'stu';
  return 'other';
}
function totalsAt(lines, i) {
  const t = { income: 0, otherIncome: 0, cogs: 0, expenses: 0, incomeTaxExp: 0, nonDeductible: 0, wages: { stu: 0, rachel: 0, other: 0 }, kiwisaver: 0 };
  for (const l of lines) {
    const v = l.values[i] || 0;
    t[l.group] += v;
    if (l.group === 'expenses' || l.group === 'cogs') {
      if (isIncomeTax(l.name)) t.incomeTaxExp += v;
      if (isNonDed(l.name)) t.nonDeductible += v;
      const k = wageKind(l.name);
      if (k === 'kiwisaver') t.kiwisaver += v; else if (k) t.wages[k] += v;
    }
  }
  t.np = t.income + t.otherIncome - t.cogs - t.expenses;
  return t;
}

// Tax balances from a one-column balance sheet, matched by account name
function parseBs(body) {
  const rep = body?.Reports?.[0]; if (!rep) throw new Error('Xero returned no balance sheet');
  const rows = [];
  for (const sec of rep.Rows.filter(r => r.RowType === 'Section'))
    for (const row of sec.Rows || []) if (row.RowType === 'Row') rows.push({ section: sec.Title || '', name: row.Cells?.[0]?.Value || '', v: num(row.Cells?.[1]?.Value) });
  const pick = re => rows.filter(r => re.test(r.name)).reduce((a, r) => a + r.v, 0);
  return {
    gst: pick(/^gst$/i),
    paye: pick(/^paye payable/i),
    deductions: pick(/^wages deductions payable/i),
    wagesPayable: pick(/^wages payable/i),
    incomeTax: pick(/^income tax$/i),
    rwt: pick(/withholding tax paid|rwt/i),
    rows: rows.filter(r => /gst|paye|tax|wages|deduction/i.test(r.name))
  };
}

// Monthly P&L columns: one report per calendar month (Xero's periods=N&timeframe=MONTH steps back by
// day-of-month from the end date, so from a 30-day month it drops the 31st of longer months).
// Merges single-month reports (newest first) into one Xero-shaped report with a column per month.
function mergeMonths(bodies) {
  const head = [{}], secs = new Map();
  bodies.forEach((b, c) => {
    const rep = b?.Reports?.[0]; if (!rep) throw new Error('Xero returned no profit and loss report');
    head.push((rep.Rows.find(r => r.RowType === 'Header')?.Cells || [])[1] || { Value: '' });
    for (const sec of rep.Rows.filter(r => r.RowType === 'Section')) {
      const S = secs.get(sec.Title) || new Map(); secs.set(sec.Title, S);
      for (const row of sec.Rows || []) {
        if (row.RowType !== 'Row') continue;
        const first = row.Cells?.[0] || {}, k = first.Attributes?.find(a => a.Id === 'account')?.Value || first.Value;
        const o = S.get(k) || { first, vals: new Array(bodies.length).fill(0) };
        o.vals[c] = row.Cells?.[1]?.Value ?? 0; S.set(k, o);
      }
    }
  });
  return { Reports: [{ Rows: [{ RowType: 'Header', Cells: head }, ...[...secs].map(([Title, S]) => ({ RowType: 'Section', Title, Rows: [...S.values()].map(o => ({ RowType: 'Row', Cells: [o.first, ...o.vals.map(v => ({ Value: String(v) }))] })) }))] }] };
}

async function pool(jobs, n = 4) {
  const out = new Array(jobs.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => {
    while (i < jobs.length) { const k = i++; try { out[k] = { ok: true, v: await jobs[k]() }; } catch (e) { out[k] = { ok: false, e }; } }
  }));
  return out;
}

const IRD = /inland revenue|\bird\b/i;
const isIrd = x => IRD.test(x.Contact?.Name || '') || (x.LineItems || []).some(l => /^(820|825|816|830)$/.test(l.AccountCode || ''));
function taxKindOf(code, name) {
  const s = `${code || ''} ${name || ''}`.toLowerCase();
  if (/^820\b|gst/.test(s)) return 'gst';
  if (/^82[5]\b|^816\b|paye|deduction|kiwisaver|esct/.test(s)) return 'paye';
  if (/^830\b|income tax|provisional|terminal/.test(s)) return 'incomeTax';
  return 'other';
}

export default async (req) => {
  const u = new URL(req.url);
  const today = nzToday();
  const periods = (u.searchParams.get('periods') || '').split(',').filter(Boolean).map(p => p.split(':'))
    .filter(([a, b]) => DAY.test(a) && DAY.test(b) && a <= b).slice(0, 3);
  const basis = u.searchParams.get('basis') === 'payments' ? 'payments' : 'invoice';
  const [ty, tm] = parts(today);
  const fyY = tm > 3 ? ty : ty - 1;
  const fyStart = ymd(fyY, 4, 1), lyFyStart = ymd(fyY - 1, 4, 1), lyFyEnd = ymd(fyY, 3, 31);
  const nMonths = (ty - fyY) * 12 + tm - 3;
  const earliest = [lyFyStart, ...periods.map(p => p[0])].sort()[0];

  try {
    const t = await session();
    const docs = (path, type, from, to) => () => xeroApi(t, `/${path}?where=${encodeURIComponent(`Type=="${type}" AND Date>=${fmtDT(from)} AND Date<=${fmtDT(to)}`)}&Statuses=AUTHORISED,PAID&summaryOnly=true`);
    // Bank transactions (spend and receive money), all pages since the earliest date needed
    const bankTx = async () => {
      const out = [];
      for (let page = 1; page <= 20; page++) {
        const b = await xeroApi(t, `/BankTransactions?where=${encodeURIComponent(`Date>=${fmtDT(earliest)} AND Date<=${fmtDT(today)} AND Status=="AUTHORISED"`)}&page=${page}`);
        const list = b.BankTransactions || [];
        out.push(...list);
        if (list.length < 100) break;
      }
      return out;
    };
    const jobs = [
      () => xeroApi(t, `/Reports/BalanceSheet?date=${today}&standardLayout=true`),                              // 0
      async () => null,                                                                                         // 1 (months below)
      () => xeroApi(t, `/Reports/ProfitAndLoss?fromDate=${lyFyStart}&toDate=${lyFyEnd}&standardLayout=true`),  // 2
      bankTx                                                                                                    // 3
    ];
    // Payments basis: invoice and bill payments in the period, with the GST share of each invoice
    const payments = (a, b) => async () => {
      const list = [];
      for (let page = 1; page <= 20; page++) {
        const r = await xeroApi(t, `/Payments?where=${encodeURIComponent(`Date>=${fmtDT(a)} AND Date<=${fmtDT(b)} AND Status=="AUTHORISED"`)}&page=${page}`);
        const p = r.Payments || []; list.push(...p); if (p.length < 100) break;
      }
      const ids = [...new Set(list.map(p => p.Invoice?.InvoiceID).filter(Boolean))];
      const inv = {};
      for (let i = 0; i < ids.length; i += 40) {
        const r = await xeroApi(t, `/Invoices?IDs=${ids.slice(i, i + 40).join(',')}&summaryOnly=true`);
        for (const x of r.Invoices || []) inv[x.InvoiceID] = x;
      }
      const out = { sales: { net: 0, gst: 0, n: 0 }, purchases: { net: 0, gst: 0, n: 0 }, missing: 0 };
      for (const p of list) {
        if (!p.Invoice?.InvoiceID) continue;                      // credit note and overpayment refunds
        const x = inv[p.Invoice?.InvoiceID]; const amt = num(p.Amount);
        if (!x || !num(x.Total)) { out.missing++; continue; }
        const side = x.Type === 'ACCREC' ? out.sales : x.Type === 'ACCPAY' ? out.purchases : null; if (!side) continue;
        if (IRD.test(x.Contact?.Name || '')) continue;
        const g = amt * num(x.TotalTax) / num(x.Total);
        side.gst += g; side.net += amt - g; side.n++;
      }
      return out;
    };
    for (const [a, b] of periods) {
      if (basis === 'payments') jobs.push(payments(a, b), async () => null, async () => null, async () => null);
      else jobs.push(
        docs('Invoices', 'ACCREC', a, b), docs('CreditNotes', 'ACCRECCREDIT', a, b),
        docs('Invoices', 'ACCPAY', a, b), docs('CreditNotes', 'ACCPAYCREDIT', a, b));
    }
    // One P&L per month, newest first, appended after everything else
    const monthBase = jobs.length;
    for (let c = 0; c < nMonths; c++) {
      const k = nMonths - 1 - c, y = fyY + (3 + k >= 12 ? 1 : 0), m = ((3 + k) % 12) + 1;
      jobs.push(() => xeroApi(t, `/Reports/ProfitAndLoss?fromDate=${ymd(y, m, 1)}&toDate=${ymd(y, m, dim(y, m))}&standardLayout=true`));
    }
    const r = await pool(jobs);
    { const ms = r.slice(monthBase); const bad = ms.find(x => !x.ok);
      r[1] = bad ? bad : (() => { try { return { ok: true, v: mergeMonths(ms.map(x => x.v)) }; } catch (e) { return { ok: false, e }; } })(); }
    const errors = [];
    const scopeErr = e => /401|403|unauthori[sz]ed|forbidden|scope/i.test(e?.message || '');
    const needsReconnect = [0, 1, 2].some(i => !r[i].ok && scopeErr(r[i].e));
    const get = (i, fn, label) => { if (!r[i].ok) { errors.push(`${label}: ${r[i].e.message}`); return null; } try { return fn(r[i].v); } catch (e) { errors.push(`${label}: ${e.message}`); return null; } };

    const bs = get(0, parseBs, 'Balance sheet');
    const mLines = get(1, parsePnl, 'Profit and loss by month');
    const months = [];
    if (mLines) for (let c = nMonths - 1; c >= 0; c--) {           // columns come newest first
      const k = nMonths - 1 - c, y = fyY + (3 + k >= 12 ? 1 : 0), m = ((3 + k) % 12) + 1;
      months.push({ mk: `${y}-${pad(m)}`, ...totalsAt(mLines, c) });
    }
    const lyLines = get(2, parsePnl, 'Profit and loss (last year)');
    const ly = lyLines ? totalsAt(lyLines, 0) : null;
    const bank = get(3, x => x, 'Bank transactions') || [];

    // GST by period (invoice basis): documents dated in the period
    const sum = (arr, key) => (arr || []).reduce((a, d) => a + num(d[key]), 0);
    const gst = periods.map(([a, b], pi) => {
      const base = 4 + pi * 4;
      const v = i => r[base + i].ok ? r[base + i].v : (errors.push(`GST documents ${a} to ${b}: ${r[base + i].e.message}`), null);
      const inP = bank.filter(x => { const d = xDate(x.DateString || x.Date); return d >= a && d <= b && !isIrd(x); });
      const recv0 = inP.filter(x => x.Type === 'RECEIVE'), spend0 = inP.filter(x => x.Type === 'SPEND');
      if (basis === 'payments') {
        const p = v(0); if (!p) return { start: a, end: b, basis, sales: { net: 0, gst: 0 }, purchases: { net: 0, gst: 0 }, failed: true };
        return {
          start: a, end: b, basis, unmatched: p.missing,
          sales: { net: p.sales.net + sum(recv0, 'SubTotal'), gst: p.sales.gst + sum(recv0, 'TotalTax'), payments: p.sales.n, receiveMoney: recv0.length },
          purchases: { net: p.purchases.net + sum(spend0, 'SubTotal'), gst: p.purchases.gst + sum(spend0, 'TotalTax'), payments: p.purchases.n, spendMoney: spend0.length }
        };
      }
      const inv = v(0)?.Invoices, cr = v(1)?.CreditNotes, bills = v(2)?.Invoices, bcr = v(3)?.CreditNotes;
      const recv = recv0, spend = spend0;
      return {
        start: a, end: b, basis,
        sales: { net: sum(inv, 'SubTotal') - sum(cr, 'SubTotal') + sum(recv, 'SubTotal'), gst: sum(inv, 'TotalTax') - sum(cr, 'TotalTax') + sum(recv, 'TotalTax'), invoices: (inv || []).length, creditNotes: (cr || []).length, receiveMoney: recv.length },
        purchases: { net: sum(bills, 'SubTotal') - sum(bcr, 'SubTotal') + sum(spend, 'SubTotal'), gst: sum(bills, 'TotalTax') - sum(bcr, 'TotalTax') + sum(spend, 'TotalTax'), bills: (bills || []).length, creditNotes: (bcr || []).length, spendMoney: spend.length }
      };
    });

    // Payments to (and refunds from) Inland Revenue
    const irdPayments = bank.filter(isIrd)
      .map(x => {
        const kinds = {};
        for (const l of x.LineItems || []) { const k = taxKindOf(l.AccountCode, l.Description); kinds[k] = (kinds[k] || 0) + num(l.LineAmount); }
        const sign = x.Type === 'RECEIVE' ? -1 : 1;
        return { date: xDate(x.DateString || x.Date), type: x.Type, total: sign * num(x.Total), reference: x.Reference || '', contact: x.Contact?.Name || '', kinds: Object.fromEntries(Object.entries(kinds).map(([k, val]) => [k, sign * val])) };
      }).sort((a, b) => b.date.localeCompare(a.date));

    if (!bs && !mLines) return json({ error: errors[0] || 'Nothing came back from Xero', needsReconnect, errors }, needsReconnect ? 403 : 502);
    return json({ today, fyStart, lyFyStart, nMonths, bs, months, ly, gst, irdPayments, needsReconnect, errors, fetchedAt: new Date().toISOString() });
  } catch (e) { return json({ error: e.message, needsReconnect: /not connected/i.test(e.message) }, 502); }
};
