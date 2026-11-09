import { configured, loadTokens, json } from './_xero.mjs';
export default async () => {
  if (!configured()) return json({ configured: false, connected: false });
  try {
    const t = await loadTokens();
    return json({ configured: true, connected: !!(t && t.refresh_token), tenantName: t?.tenantName || null, connectedAt: t?.connectedAt || null });
  } catch (e) { return json({ configured: true, connected: false, error: e.message }); }
};
