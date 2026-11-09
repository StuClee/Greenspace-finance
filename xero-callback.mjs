import { configured, tokenRequest, saveTokens, redirectUri, env } from './_xero.mjs';
const page = (msg, ok) => new Response(`<!DOCTYPE html><meta charset="utf-8"><title>Xero connection</title><body style="font-family:system-ui;padding:40px;max-width:560px"><h1 style="color:${ok ? '#2c6a44' : '#b3412f'}">${ok ? 'Xero connected' : 'Xero not connected'}</h1><p>${msg}</p><p><a href="/#invoicing">Back to Invoicing</a></p></body>`, { status: ok ? 200 : 400, headers: { 'content-type': 'text/html; charset=utf-8', 'set-cookie': 'xero_state=; Path=/; Max-Age=0' } });

export default async (req) => {
  if (!configured()) return page('Xero keys are not set on Netlify.', false);
  const u = new URL(req.url);
  if (u.searchParams.get('error')) return page('Xero said: ' + u.searchParams.get('error'), false);
  const cookie = (req.headers.get('cookie') || '').match(/xero_state=([^;]+)/)?.[1];
  if (!cookie || cookie !== u.searchParams.get('state')) return page('The sign-in link expired. Start again from Connect Xero.', false);
  try {
    const tok = await tokenRequest({ grant_type: 'authorization_code', code: u.searchParams.get('code'), redirect_uri: redirectUri(req) });
    const conns = await (await fetch('https://api.xero.com/connections', { headers: { authorization: `Bearer ${tok.access_token}` } })).json();
    const wanted = env('XERO_TENANT_NAME') || 'Greenspace Consulting';
    const tenant = conns.find(c => c.tenantType === 'ORGANISATION' && c.tenantName.toLowerCase().includes(wanted.toLowerCase())) || conns.find(c => c.tenantType === 'ORGANISATION');
    if (!tenant) return page('No Xero organisation was authorised.', false);
    await saveTokens({ access_token: tok.access_token, refresh_token: tok.refresh_token, expires_at: Date.now() + tok.expires_in * 1000, tenantId: tenant.tenantId, tenantName: tenant.tenantName, connectedAt: new Date().toISOString() });
    return page(`Connected to <strong>${tenant.tenantName}</strong>. You can now create draft invoices.`, true);
  } catch (e) { return page(e.message, false); }
};
