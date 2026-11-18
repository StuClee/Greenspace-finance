// Shared Xero OAuth helpers. Tokens are kept in Netlify Blobs (store "xero").
import { getStore } from '@netlify/blobs';

export const env = k => (globalThis.Netlify?.env?.get(k)) ?? process.env[k];
// Xero is replacing the broad accounting.transactions scope with granular ones (invoices, payments, bank transactions).
// Granular by default; ?tx=broad on xero-connect asks for the old broad scope instead.
const BASE_SCOPES = 'openid profile email offline_access accounting.contacts.read accounting.attachments';
export const TX_SCOPES = { granular: 'accounting.invoices accounting.payments.read accounting.banktransactions.read', broad: 'accounting.transactions' };
// Report scopes for the Performance page. Granular names by default; ?reports=legacy (or XERO_REPORT_SCOPES) uses the older broad scope.
export const REPORT_SCOPES = { granular: 'accounting.reports.profitandloss.read accounting.reports.balancesheet.read', legacy: 'accounting.reports.read' };
// Payroll scopes (read only) for the wages and PAYE split by person. XERO_PAYROLL_SCOPES=none leaves them out.
export const PAYROLL_SCOPES = 'payroll.payruns.read payroll.payslip.read';
export const SCOPES = (variant = 'granular', payroll = true, tx = 'granular') => {
  const base = (env('XERO_SCOPES') || BASE_SCOPES + ' ' + (TX_SCOPES[tx] || TX_SCOPES.granular)).split(/\s+/).filter(Boolean);
  const extra = (env('XERO_REPORT_SCOPES') || REPORT_SCOPES[variant] || REPORT_SCOPES.granular).split(/\s+/);
  const ps = env('XERO_PAYROLL_SCOPES') || PAYROLL_SCOPES;
  const pay = payroll && ps !== 'none' ? ps.split(/\s+/) : [];
  return [...new Set([...base, ...extra, ...pay])].filter(Boolean).join(' ');
};
export const hasReportScopes = scope => !scope ? null : /accounting\.reports\.read|accounting\.reports\.profitandloss\.read/.test(scope);
// Which data the saved token can read: { invoices, payments, bank } true/false (null if unknown)
export const txAccess = scope => !scope ? null : {
  invoices: /accounting\.transactions\b|accounting\.invoices\b/.test(scope),
  payments: /accounting\.transactions\b|accounting\.payments\b/.test(scope),
  bank: /accounting\.transactions\b|accounting\.banktransactions\b/.test(scope)
};
export const hasPayrollScopes = scope => !scope ? null : /payroll\.payruns(\.read)?\b/.test(scope) && /payroll\.payslip(\.read)?\b/.test(scope);
export const redirectUri = req => env('XERO_REDIRECT_URI') || new URL('/api/xero-callback', req.url).toString();
export const configured = () => !!(env('XERO_CLIENT_ID') && env('XERO_CLIENT_SECRET'));
const store = () => getStore('xero');

export const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export async function loadTokens() { return await store().get('tokens', { type: 'json' }); }
export async function saveTokens(t) { await store().setJSON('tokens', t); }

const basic = () => 'Basic ' + Buffer.from(`${env('XERO_CLIENT_ID')}:${env('XERO_CLIENT_SECRET')}`).toString('base64');

export async function tokenRequest(params) {
  const r = await fetch('https://identity.xero.com/connect/token', {
    method: 'POST',
    headers: { authorization: basic(), 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error_description || j.error || `Xero token request failed (${r.status})`);
  return j;
}

// Returns a valid access token + tenant, refreshing (and rotating the refresh token) when needed.
export async function session() {
  const t = await loadTokens();
  if (!t || !t.refresh_token) throw new Error('Xero is not connected. Use Connect Xero on the Invoicing page.');
  if (t.access_token && t.expires_at && Date.now() < t.expires_at - 60_000) return t;
  const j = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token });
  const next = { ...t, access_token: j.access_token, refresh_token: j.refresh_token || t.refresh_token, expires_at: Date.now() + (j.expires_in || 1800) * 1000 };
  await saveTokens(next);
  return next;
}

export const xeroApi = (t, path, init = {}) => callXero('https://api.xero.com/api.xro/2.0', t, path, init);
// NZ Payroll API (v2): camelCase JSON, errors in body.problem
export const payrollApi = (t, path, init = {}) => callXero('https://api.xero.com/payroll.xro/2.0', t, path, init);

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function callXero(base, t, path, init = {}) {
  // Xero allows 60 calls a minute per organisation. On 429, wait as asked (up to 4s) and try again, twice at most.
  let r;
  for (let tries = 0; ; tries++) {
    r = await fetch(base + path, {
      ...init,
      headers: { authorization: `Bearer ${t.access_token}`, 'xero-tenant-id': t.tenantId, accept: 'application/json', ...(init.headers || {}) }
    });
    if (r.status !== 429 || tries >= 2) break;
    const wait = Math.min(4, Math.max(1, parseFloat(r.headers.get('retry-after')) || 2));
    await r.text().catch(() => {});
    await sleep(wait * 1000 + Math.random() * 500);
  }
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!r.ok) {
    const ve = body?.Elements?.[0]?.ValidationErrors?.map(e => e.Message).join('; ');
    const pe = body?.problem && (body.problem.detail || body.problem.title || (body.problem.invalidFields || []).map(f => f.reason).join('; '));
    throw new Error(ve || pe || (r.status === 401 || r.status === 403 ? `Xero API error ${r.status} (not authorised)` : r.status === 429 ? 'Xero API error 429 (too many requests, try again in a minute)' : '') || body?.Detail || body?.Message || body?.Title || `Xero API error ${r.status}`);
  }
  return body;
}
