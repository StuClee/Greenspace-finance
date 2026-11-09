// Shared Xero OAuth helpers. Tokens are kept in Netlify Blobs (store "xero").
import { getStore } from '@netlify/blobs';

export const env = k => (globalThis.Netlify?.env?.get(k)) ?? process.env[k];
export const SCOPES = () => env('XERO_SCOPES') || 'openid profile email offline_access accounting.transactions accounting.contacts.read accounting.attachments';
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

export async function xeroApi(t, path, init = {}) {
  const r = await fetch('https://api.xero.com/api.xro/2.0' + path, {
    ...init,
    headers: { authorization: `Bearer ${t.access_token}`, 'xero-tenant-id': t.tenantId, accept: 'application/json', ...(init.headers || {}) }
  });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!r.ok) {
    const ve = body?.Elements?.[0]?.ValidationErrors?.map(e => e.Message).join('; ');
    throw new Error(ve || body?.Detail || body?.Message || body?.Title || `Xero API error ${r.status}`);
  }
  return body;
}
