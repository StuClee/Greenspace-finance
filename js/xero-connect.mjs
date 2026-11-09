import { configured, env, SCOPES, redirectUri } from './_xero.mjs';
export default async (req) => {
  if (!configured()) return new Response('Set XERO_CLIENT_ID and XERO_CLIENT_SECRET in Netlify first.', { status: 500 });
  const state = crypto.randomUUID();
  const url = new URL('https://login.xero.com/identity/connect/authorize');
  url.search = new URLSearchParams({ response_type: 'code', client_id: env('XERO_CLIENT_ID'), redirect_uri: redirectUri(req), scope: SCOPES(), state }).toString();
  return new Response(null, { status: 302, headers: { location: url.toString(), 'set-cookie': `xero_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600` } });
};
