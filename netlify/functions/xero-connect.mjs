import { configured, env, SCOPES, redirectUri, loadTokens, hasPayrollScopes } from './_xero.mjs';
export default async (req) => {
  const q = new URL(req.url).searchParams;
  const back = /^[a-z]+$/.test(q.get('back') || '') ? q.get('back') : 'invoicing';
  const variant = q.get('reports') === 'legacy' ? 'legacy' : 'granular';
  const tx = q.get('tx') === 'broad' ? 'broad' : 'granular';
  // Payroll scopes: asked for by the payroll button (?payroll=1), kept on later reconnects once granted, dropped with ?payroll=0
  let payroll = q.get('payroll') === '1';
  if (!q.has('payroll')) { try { payroll = !!hasPayrollScopes((await loadTokens())?.scope); } catch { payroll = false; } }
  if (!configured()) return new Response('Set XERO_CLIENT_ID and XERO_CLIENT_SECRET in Netlify first.', { status: 500 });
  const state = crypto.randomUUID();
  const url = new URL('https://login.xero.com/identity/connect/authorize');
  url.search = new URLSearchParams({ response_type: 'code', client_id: env('XERO_CLIENT_ID'), redirect_uri: redirectUri(req), scope: SCOPES(variant, payroll, tx), state }).toString();
  return new Response(null, { status: 302, headers: new Headers([['location', url.toString()],
    ['set-cookie', `xero_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`],
    ['set-cookie', `xero_back=${back}.${variant}.${payroll ? 'pay' : 'nopay'}.${tx}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`]]) });
};
