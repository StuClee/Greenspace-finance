import { configured, loadTokens, json, hasReportScopes, hasPayrollScopes, txAccess } from './_xero.mjs';
export default async () => {
  if (!configured()) return json({ configured: false, connected: false });
  try {
    const t = await loadTokens();
    return json({ configured: true, connected: !!(t && t.refresh_token), tenantName: t?.tenantName || null, connectedAt: t?.connectedAt || null, reports: hasReportScopes(t?.scope), payroll: hasPayrollScopes(t?.scope), access: txAccess(t?.scope), scope: t?.scope || null });
  } catch (e) { return json({ configured: true, connected: false, error: e.message }); }
};
