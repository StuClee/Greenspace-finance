import { session, payrollApi, json, hasPayrollScopes } from './_xero.mjs';
import { getStore } from '@netlify/blobs';

// Posted pay runs do not change, so each one's payslips are read from Xero once and kept in Netlify Blobs
// (store "xero", key payslips-v1: { [payRunID]: { date, slips: [{ id, name, ...slipRow }] } }). ?fresh=1 ignores the store.
const CACHE_KEY = 'payslips-v1';
const cacheStore = () => getStore('xero');

// GET /api/xero-payroll?from=YYYY-MM-DD&to=YYYY-MM-DD
// Posted Xero (NZ) pay runs paid between from and to, split by employee and by pay month (payment date).
// -> { from, to, people: [{ id, name }], entries: [{ date, id, ...Row }], runs, needsReconnect, errors }
//   one entry per pay run per employee; date = the pay run's payment date
//   Row = { gross, paye, ksEmployee, ksEmployer, esct, studentLoan, otherDeductions, net, toIrd, slips }
//   paye = totalEmployeeTaxes (PAYE including the ACC earner levy)
//   ksEmployer = employer KiwiSaver before ESCT (what goes to IRD); esct = the ESCT part of it
//   toIrd = paye + studentLoan + ksEmployee + ksEmployer
// Needs the payroll.payruns.read and payroll.payslip.read scopes.
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const num = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const r2 = n => Math.round(n * 100) / 100;
const day = s => String(s || '').slice(0, 10);
const nameOf = l => `${l.displayName || ''} ${l.description || ''} ${l.name || ''}`.toLowerCase();

async function pool(jobs, n = 4) {
  const out = new Array(jobs.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => {
    while (i < jobs.length) { const k = i++; try { out[k] = { ok: true, v: await jobs[k]() }; } catch (e) { out[k] = { ok: false, e }; } }
  }));
  return out;
}

// One payslip -> the figures above.
// NZ payslips: superannuationLines hold the employer KiwiSaver (often just named "KiwiSaver");
// statutoryDeductionLines hold the employee KiwiSaver, student loan and child support, usually with no name.
const KS_RATES = [3, 3.5, 4, 6, 8, 10];
export function slipRow(s) {
  const gross = num(s.grossEarnings ?? s.totalEarnings);
  const paye = num(s.totalEmployeeTaxes);
  const isRate = a => KS_RATES.some(r => Math.abs(a - gross * r / 100) <= 0.05);
  let ksEmployee = 0, ksEmployer = 0, esct = 0, studentLoan = 0, otherStatutory = 0, otherDeductions = 0, employerPct = null;
  for (const l of s.superannuationLines || []) {
    const a = num(l.amount), n = nameOf(l);
    if (/employee/.test(n)) ksEmployee += a;
    else { ksEmployer += a; if (l.percentage != null) employerPct = num(l.percentage); }
  }
  for (const l of s.statutoryDeductionLines || []) {
    const a = num(l.amount), n = nameOf(l);
    if (/student/.test(n)) studentLoan += a;
    else if (/employer/.test(n)) ksEmployer += a;
    else if (/kiwi|super/.test(n) || (!n.trim() && isRate(a) && !ksEmployee)) ksEmployee += a;
    else otherStatutory += a;                                            // student loan / child support with no name
  }
  for (const l of s.employerTaxLines || []) {
    const n = nameOf(l);
    if (/esct|contribution tax|super/.test(n) || !n.trim()) esct += num(l.amount);
  }
  if (!esct && num(s.totalEmployerTaxes)) esct = num(s.totalEmployerTaxes);
  // Some payslips show the employer KiwiSaver after ESCT. If it is short of its percentage of gross, put the ESCT back.
  if (esct && ksEmployer && employerPct && Math.abs(ksEmployer - gross * employerPct / 100) > 0.05 && Math.abs(ksEmployer + esct - gross * employerPct / 100) <= 0.05) ksEmployer += esct;
  for (const l of s.deductionLines || []) otherDeductions += num(l.amount);
  const net = num(s.totalPay);
  return { gross, paye, ksEmployee, ksEmployer, esct, studentLoan: studentLoan + otherStatutory, otherDeductions, net, toIrd: paye + studentLoan + otherStatutory + ksEmployee + ksEmployer, slips: 1 };
}

// Reads every page of a payroll list. Xero's page size varies, so stop on its pagination or an empty page.
async function allPages(t, path, key) {
  const out = []; let prev = null;
  for (let page = 1; page <= 50; page++) {
    const b = await payrollApi(t, `${path}${path.includes('?') ? '&' : '?'}page=${page}`);
    const list = b[key] || b[key[0].toUpperCase() + key.slice(1)] || [];
    const first = JSON.stringify(list[0] || null);
    if (first === prev) break;                                           // page ignored: same page again
    prev = first;
    out.push(...list);
    const pg = b.pagination;
    if (!list.length || (pg && pg.pageCount != null && pg.page >= pg.pageCount)) break;
  }
  return out;
}

export default async (req) => {
  const u = new URL(req.url);
  const from = u.searchParams.get('from'), to = u.searchParams.get('to');
  if (!DAY.test(from || '') || !DAY.test(to || '')) return json({ error: 'from and to must be YYYY-MM-DD' }, 400);
  const scopeErr = e => /401|403|unauthori[sz]ed|forbidden|scope/i.test(e?.message || '');
  try {
    const t = await session();
    if (hasPayrollScopes(t.scope) === false) return json({ error: 'Xero has not allowed payroll access yet', needsReconnect: true }, 403);

    const runs = await allPages(t, '/PayRuns', 'payRuns');
    const wanted = runs.filter(r => /posted/i.test(r.payRunStatus || '') && day(r.paymentDate) >= from && day(r.paymentDate) <= to);

    const debug = u.searchParams.get('debug') === '1', fresh = u.searchParams.get('fresh') === '1' || debug;
    let cache = {};
    if (!fresh) { try { cache = (await cacheStore().get(CACHE_KEY, { type: 'json' })) || {}; } catch { cache = {}; } }
    const todo = debug ? wanted.slice(-3) : wanted.filter(r => !cache[r.payRunID]).slice(0, 40);   // keep within the function time limit
    const res = await pool(todo.map(r => async () => ({ run: r, slips: await allPages(t, `/PaySlips?PayRunID=${r.payRunID}`, 'paySlips') })), 2);

    // ?debug=1: the line names and amounts of the latest payslip per employee, to check how Xero labels them
    if (u.searchParams.get('debug') === '1') {
      const last = new Map();
      for (const x of res) if (x.ok) for (const s of x.v.slips) last.set(s.employeeID, { date: day(x.v.run.paymentDate), name: `${s.firstName} ${s.lastName}`,
        totals: { grossEarnings: s.grossEarnings, totalEmployeeTaxes: s.totalEmployeeTaxes, totalEmployerTaxes: s.totalEmployerTaxes, totalDeductions: s.totalDeductions, totalPay: s.totalPay },
        lines: Object.fromEntries(['superannuationLines', 'statutoryDeductionLines', 'deductionLines', 'employeeTaxLines', 'employerTaxLines'].map(k => [k, (s[k] || []).map(l => ({ name: l.displayName || l.description || l.name || '', amount: l.amount, percentage: l.percentage }))])) });
      return json({ runsListed: runs.length, runsInRange: wanted.length, latest: [...last.values()] });
    }

    // New runs: summarise and add to the store
    const errors = [];
    let added = 0;
    for (const x of res) {
      if (!x.ok) { errors.push(x.e.message); continue; }
      cache[x.v.run.payRunID] = { date: day(x.v.run.paymentDate), slips: x.v.slips.map(s => ({ id: s.employeeID || `${s.firstName} ${s.lastName}`, name: `${s.firstName || ''} ${s.lastName || ''}`.trim() || 'Unnamed employee', ...slipRow(s) })) };
      added++;
    }
    if (added) { try { await cacheStore().setJSON(CACHE_KEY, cache); } catch (e) { /* store is a convenience; carry on */ } }

    const people = new Map(), entries = [];
    let missing = 0;
    for (const r of wanted) {
      const c = cache[r.payRunID];
      if (!c) { missing++; continue; }
      const byId = new Map();
      for (const s of c.slips) {
        if (!people.has(s.id)) people.set(s.id, { id: s.id, name: s.name });
        const { id, name, ...row } = s, o = byId.get(id);
        if (!o) byId.set(id, { date: c.date, id, ...row }); else for (const k of Object.keys(row)) o[k] += row[k];
      }
      for (const o of byId.values()) { for (const k of Object.keys(o)) if (typeof o[k] === 'number' && k !== 'slips') o[k] = r2(o[k]); entries.push(o); }
    }
    entries.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    const needsReconnect = errors.some(m => scopeErr({ message: m }));
    return json({ from, to, people: [...people.values()], entries, runs: wanted.length, missing, fromXero: added, needsReconnect, errors: [...new Set(errors)], complete: missing === 0, fetchedAt: new Date().toISOString() });
  } catch (e) {
    return json({ error: e.message, needsReconnect: scopeErr(e) || /not connected/i.test(e.message) }, scopeErr(e) ? 403 : 502);
  }
};
