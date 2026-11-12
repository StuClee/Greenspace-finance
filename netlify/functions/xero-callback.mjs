import { configured, tokenRequest, saveTokens, redirectUri, env } from './_xero.mjs';
const page = (msg, ok, back = 'invoicing', extra = '') => new Response(`<!DOCTYPE html><meta charset="utf-8"><title>Xero connection</title><body style="font-family:system-ui;padding:40px;max-width:560px"><h1 style="color:${ok ? '#2c6a44' : '#b3412f'}">${ok ? 'Xero connected' : 'Xero not connected'}</h1><p>${msg}</p>${extra}<p><a href="/#${back}">Back to ${back[0].toUpperCase() + back.slice(1)}</a></p></body>`, { status: ok ? 200 : 400, headers: { 'content-type': 'text/html; charset=utf-8', 'set-cookie': 'xero_state=; Path=/; Max-Age=0' } });

export default async (req) => {
  if (!configured()) return page('Xero keys are not set on Netlify.', false);
  const u = new URL(req.url);
  const [back = 'invoicing', variant = 'granular'] = ((req.headers.get('cookie') || '').match(/xero_back=([a-z.]+)/)?.[1] || '').split('.').filter(Boolean);
  const err = u.searchParams.get('error');
  if (err) {
    // If Xero refuses the newer report permissions, offer the older one (works for apps created before March 2026)
    const retry = /scope/i.test(err) && variant !== 'legacy' ? `<p>This can happen if the Xero app uses the older permission names. <a href="/api/xero-connect?back=${back}&reports=legacy">Try again with the older report permission</a>.</p>` : '';
    return page('Xero said: ' + err, false, back, retry);
  }
  const cookie = (req.headers.get('cookie') || '').match(/xero_state=([^;]+)/)?.[1];
  if (!cookie || cookie !== u.searchParams.get('state')) return page('The sign-in link expired. Start again from Connect Xero.', false, back);
  try {
    const tok = await tokenRequest({ grant_type: 'authorization_code', code: u.searchParams.get('code'), redirect_uri: redirectUri(req) });
    const conns = await (await fetch('https://api.xero.com/connections', { headers: { authorization: `Bearer ${tok.access_token}` } })).json();
    const wanted = env('XERO_TENANT_NAME') || 'Greenspace Consulting';
    const tenant = conns.find(c => c.tenantType === 'ORGANISATION' && c.tenantName.toLowerCase().includes(wanted.toLowerCase())) || conns.find(c => c.tenantType === 'ORGANISATION');
    if (!tenant) return page('No Xero organisation was authorised.', false, back);
    await saveTokens({ access_token: tok.access_token, refresh_token: tok.refresh_token, expires_at: Date.now() + tok.expires_in * 1000, tenantId: tenant.tenantId, tenantName: tenant.tenantName, scope: tok.scope || '', connectedAt: new Date().toISOString() });
    return page(`Connected to <strong>${tenant.tenantName}</strong>. Draft invoices and the Performance page can now use Xero.`, true, back);
  } catch (e) { return page(e.message, false, back); }
};
