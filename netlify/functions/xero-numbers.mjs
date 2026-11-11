import { session, xeroApi, json } from './_xero.mjs';

// GET /api/xero-numbers?from=YYYY-MM-DD&to=YYYY-MM-DD
//   -> { invoices: [{ invoiceId, number, contactId, contactName, reference, date, total, status }], next: 'INV-0530' }
// Sales invoices dated in the range (so the app can show the real Xero number on a schedule), plus the next free number.
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const dt = s => { const [y, m, d] = s.split('-').map(Number); return `DateTime(${y},${m},${d})`; };
const iso = s => { const m = /\/Date\((\d+)/.exec(s || ''); return m ? new Date(+m[1]).toISOString().slice(0, 10) : (s || '').slice(0, 10); };

export default async (req) => {
  const u = new URL(req.url);
  const from = u.searchParams.get('from'), to = u.searchParams.get('to');
  if (!DAY.test(from || '') || !DAY.test(to || '')) return json({ error: 'from and to dates are needed' }, 400);
  try {
    const t = await session();
    const where = encodeURIComponent(`Type=="ACCREC" AND Date>=${dt(from)} AND Date<=${dt(to)}`);
    const [inRange, latest] = await Promise.all([
      xeroApi(t, `/Invoices?where=${where}&Statuses=DRAFT,SUBMITTED,AUTHORISED,PAID&summaryOnly=true`),
      xeroApi(t, `/Invoices?where=${encodeURIComponent('Type=="ACCREC"')}&order=${encodeURIComponent('InvoiceNumber DESC')}&summaryOnly=true&page=1&pageSize=10`)
    ]);
    const invoices = (inRange.Invoices || []).filter(i => i.InvoiceNumber).map(i => ({
      invoiceId: i.InvoiceID, number: i.InvoiceNumber, contactId: i.Contact?.ContactID || '', contactName: i.Contact?.Name || '',
      reference: i.Reference || '', date: iso(i.DateString || i.Date), total: i.Total, status: i.Status
    })).sort((a, b) => a.number.localeCompare(b.number));
    // next number = highest INV-nnnn + 1
    let best = null;
    for (const i of latest.Invoices || []) {
      const m = /^(.*?)(\d+)$/.exec(i.InvoiceNumber || ''); if (!m) continue;
      if (!best || +m[2] > best.n) best = { pre: m[1], n: +m[2], w: m[2].length };
    }
    const next = best ? best.pre + String(best.n + 1).padStart(best.w, '0') : '';
    return json({ invoices, next });
  } catch (e) { return json({ error: e.message }, 502); }
};
