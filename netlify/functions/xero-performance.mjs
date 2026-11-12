import { session, xeroApi, json } from './_xero.mjs';

// GET /api/xero-performance?asAt=YYYY-MM-DD
// Financial performance for the financial year to asAt, against the same point last year.
// -> { asAt, lyAsAt, fyStart, lyFyStart, ty: pnl, ly: pnl, months: { ty: [12], ly: [12] }, bs, clients, errors }
//   pnl = { lines: [{ key, group, name, value }] }      group: income | otherIncome | cogs | expenses
//   months.* = 12 slots (Apr..Mar), each { income, otherIncome, cogs, expenses, people: { wages, kiwisaver, acc, contractors } } or null
// Report calls need the Xero reports scopes; when they are missing, needsReconnect is true.
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const pad = n => String(n).padStart(2, '0');
const dim = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();          // m is 1-12
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const parts = s => s.split('-').map(Number);
const nzToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(new Date());
const num = v => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return isFinite(n) ? n : 0; };

// Same calendar point a year earlier (month ends stay month ends, 29 Feb -> 28 Feb)
function yearBack(s) {
  const [y, m, d] = parts(s);
  return ymd(y - 1, m, d === dim(y, m) ? dim(y - 1, m) : Math.min(d, dim(y - 1, m)));
}

function groupOf(title) {
  const t = (title || '').toLowerCase();
  if (!t) return null;
  if (t.includes('cost of sales') || t.includes('cost of goods')) return 'cogs';
  if (t.includes('other income')) return 'otherIncome';
  if (t.includes('income') || t.includes('revenue') || t.includes('trading')) return 'income';
  if (t.includes('expense')) return 'expenses';
  return null;
}

// Xero P&L report -> { headers, lines: [{ key, group, name, values: [] }] }
function parsePnl(body) {
  const rep = body?.Reports?.[0]; if (!rep) throw new Error('Xero returned no profit and loss report');
  const headers = (rep.Rows.find(r => r.RowType === 'Header')?.Cells || []).slice(1).map(c => c.Value);
  const lines = [];
  for (const sec of rep.Rows.filter(r => r.RowType === 'Section')) {
    const group = groupOf(sec.Title); if (!group) continue;
    for (const row of sec.Rows || []) {
      if (row.RowType !== 'Row') continue;
      const [first, ...rest] = row.Cells || [];
      const id = first?.Attributes?.find(a => a.Id === 'account')?.Value;
      lines.push({ key: id || first?.Value, group, name: first?.Value || '', values: rest.map(c => num(c.Value)) });
    }
  }
  return { headers, lines };
}
// Employment-cost accounts, matched by name (wages analysis)
export function peopleKind(name) {
  const n = (name || '').toLowerCase();
  if (/kiwisaver|superannuation/.test(n)) return 'kiwisaver';
  if (/^acc\b|acc levy|acc levies/.test(n)) return 'acc';
  if (/sub-?contract|contractor/.test(n)) return 'contractors';
  if (/wage|salar|holiday pay|bonus|staff cost|payroll/.test(n)) return 'wages';
  return null;
}
const totals = (lines, i) => {
  const t = { income: 0, otherIncome: 0, cogs: 0, expenses: 0, people: { wages: 0, kiwisaver: 0, acc: 0, contractors: 0 } };
  for (const l of lines) {
    const v = l.values[i] || 0;
    t[l.group] += v;
    const k = (l.group === 'expenses' || l.group === 'cogs') && peopleKind(l.name);
    if (k) t.people[k] += v;
  }
  return t;
};

// Xero balance sheet with two columns (asAt and a year earlier)
function parseBs(body) {
  const rep = body?.Reports?.[0]; if (!rep) throw new Error('Xero returned no balance sheet');
  const headers = (rep.Rows.find(r => r.RowType === 'Header')?.Cells || []).slice(1).map(c => c.Value);
  const rows = [], sums = {};
  for (const sec of rep.Rows.filter(r => r.RowType === 'Section')) {
    for (const row of sec.Rows || []) {
      const [first, ...rest] = row.Cells || [];
      const vals = rest.map(c => num(c.Value));
      if (row.RowType === 'SummaryRow') sums[(first?.Value || '').toLowerCase()] = vals;
      else if (row.RowType === 'Row') { rows.push({ section: sec.Title || '', name: first?.Value || '', vals }); if (!sec.Title) sums[(first?.Value || '').toLowerCase()] = vals; }
    }
  }
  const pick = re => { const r = rows.find(x => re.test(x.name)); return r ? r.vals : [0, 0]; };
  const sum = k => sums[k] || [0, 0];
  return {
    headers,
    bank: sum('total bank'),
    receivables: pick(/^accounts receivable/i),
    payables: pick(/^accounts payable/i),
    currentAssets: sum('total current assets'),
    currentLiabilities: sum('total current liabilities'),
    netAssets: sum('net assets')
  };
}

const fmtDT = s => { const [y, m, d] = parts(s); return `DateTime(${y},${m},${d})`; };

// Runs async jobs with at most `n` in flight (Xero allows 5 concurrent calls per organisation)
async function pool(jobs, n = 4) {
  const out = new Array(jobs.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => {
    while (i < jobs.length) { const k = i++; try { out[k] = { ok: true, v: await jobs[k]() }; } catch (e) { out[k] = { ok: false, e }; } }
  }));
  return out;
}

export default async (req) => {
  const u = new URL(req.url);
  const today = nzToday();
  let asAt = u.searchParams.get('asAt') || today;
  if (!DAY.test(asAt)) return json({ error: 'asAt must be YYYY-MM-DD' }, 400);
  if (asAt > today) asAt = today;
  const fyEndMonth = 3;                                            // 31 March balance date
  const [ay, am] = parts(asAt);
  const fyY = am > fyEndMonth ? ay : ay - 1;                       // year the FY starts in
  const fyStart = ymd(fyY, fyEndMonth + 1, 1), lyFyStart = ymd(fyY - 1, fyEndMonth + 1, 1);
  const lyAsAt = yearBack(asAt);
  const nMonths = (ay - fyY) * 12 + am - fyEndMonth;               // Apr = 1 ... Mar = 12

  try {
    const t = await session();
    const pnl = (from, to, extra = '') => () => xeroApi(t, `/Reports/ProfitAndLoss?fromDate=${from}&toDate=${to}&standardLayout=true${extra}`);
    const monthly = (y, m, count) => pnl(ymd(y, m, 1), ymd(y, m, dim(y, m)), count > 1 ? `&periods=${count - 1}&timeframe=MONTH` : '');
    const docs = (path, type, from, to) => () => xeroApi(t, `/${path}?where=${encodeURIComponent(`Type=="${type}" AND Date>=${fmtDT(from)} AND Date<=${fmtDT(to)}`)}&Statuses=AUTHORISED,PAID&summaryOnly=true`);
    const jobs = [
      pnl(fyStart, asAt),                                          // 0 this year to date
      pnl(lyFyStart, lyAsAt),                                      // 1 last year to same point
      monthly(ay, am, nMonths),                                    // 2 this FY by month
      monthly(fyY, fyEndMonth, 12),                                // 3 last FY by month (Apr..Mar)
      () => xeroApi(t, `/Reports/BalanceSheet?date=${asAt}&periods=1&timeframe=YEAR&standardLayout=true`), // 4
      docs('Invoices', 'ACCREC', fyStart, asAt),                   // 5
      docs('Invoices', 'ACCREC', lyFyStart, lyAsAt),               // 6
      docs('CreditNotes', 'ACCRECCREDIT', fyStart, asAt),          // 7
      docs('CreditNotes', 'ACCRECCREDIT', lyFyStart, lyAsAt)       // 8
    ];
    const r = await pool(jobs);
    const errors = [];
    const scopeErr = e => /401|403|unauthori[sz]ed|forbidden|scope/i.test(e?.message || '');
    const needsReconnect = [0, 1, 2, 3, 4].some(i => !r[i].ok && scopeErr(r[i].e));
    const get = (i, fn, label) => { if (!r[i].ok) { errors.push(`${label}: ${r[i].e.message}`); return null; } try { return fn(r[i].v); } catch (e) { errors.push(`${label}: ${e.message}`); return null; } };

    const asTotals = p => p && { lines: p.lines.map(l => ({ key: l.key, group: l.group, name: l.name, value: l.values[0] || 0, people: (l.group === 'expenses' || l.group === 'cogs') ? peopleKind(l.name) : null })) };
    const ty = asTotals(get(0, parsePnl, 'Profit and loss (this year)'));
    const ly = asTotals(get(1, parsePnl, 'Profit and loss (last year)'));
    // Monthly columns come newest first; slot them Apr..Mar
    const series = (p, count) => {
      const out = new Array(12).fill(null); if (!p) return out;
      for (let c = 0; c < count; c++) out[count - 1 - c] = totals(p.lines, c);
      return out;
    };
    const tyM = get(2, parsePnl, 'Monthly (this year)'), lyM = get(3, parsePnl, 'Monthly (last year)');
    const months = { ty: series(tyM, nMonths), ly: series(lyM, 12), headers: { ty: tyM?.headers || [], ly: lyM?.headers || [] } };
    const bs = get(4, parseBs, 'Balance sheet');

    const byClient = (inv, cn) => {
      if (!inv) return null;
      const m = {};
      for (const i of inv.Invoices || []) { const n = i.Contact?.Name || 'Unknown'; m[n] = (m[n] || 0) + num(i.SubTotal); }
      for (const c of cn?.CreditNotes || []) { const n = c.Contact?.Name || 'Unknown'; m[n] = (m[n] || 0) - num(c.SubTotal); }
      return m;
    };
    const clients = {
      ty: byClient(get(5, x => x, 'Invoices (this year)'), r[7].ok ? r[7].v : null),
      ly: byClient(get(6, x => x, 'Invoices (last year)'), r[8].ok ? r[8].v : null)
    };

    if (!ty && !ly && !bs && !clients.ty) return json({ error: errors[0] || 'Nothing came back from Xero', needsReconnect, errors }, needsReconnect ? 403 : 502);
    return json({ asAt, lyAsAt, today, fyStart, lyFyStart, nMonths, ty, ly, months, bs, clients, needsReconnect, errors, fetchedAt: new Date().toISOString() });
  } catch (e) { return json({ error: e.message, needsReconnect: /not connected/i.test(e.message) }, 502); }
};
