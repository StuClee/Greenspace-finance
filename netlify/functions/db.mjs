// Greenspace Finance database (Netlify Blobs, store "gsdata").
//   GET  /api/db                 -> { entries, config, empty }
//   PUT  /api/db?day=YYYY-MM-DD  -> body { entries: [...] } replaces that day's entries
//   GET  /api/db?config=1        -> { config } settings only
//   PUT  /api/db?config=1        -> body { config, base } replaces settings, rates and targets; 409 + { config } if base is not the stored savedAt
//   POST /api/db?import=1        -> body { entries, config, from } one-off import (backs up first)
import { getStore } from '@netlify/blobs';

const store = () => getStore({ name: 'gsdata', consistency: 'strong' });
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const stable = v => Array.isArray(v) ? '[' + v.map(stable).join(',') + ']' : v && typeof v === 'object' ? '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}' : JSON.stringify(v ?? null);
const sortEntries = list => list.sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));

async function allEntries(s) {
  const { blobs } = await s.list({ prefix: 'entries/' });
  const months = await Promise.all(blobs.map(b => s.get(b.key, { type: 'json' })));
  return sortEntries(months.flat().filter(Boolean));
}

export default async (req) => {
  const s = store();
  const u = new URL(req.url);
  try {
    if (req.method === 'GET' && u.searchParams.has('config')) {
      return json({ config: await s.get('config', { type: 'json' }) });
    }
    if (req.method === 'GET') {
      const [entries, config] = await Promise.all([allEntries(s), s.get('config', { type: 'json' })]);
      return json({ entries, config, empty: !config && !entries.length });
    }

    const body = await req.json().catch(() => null);
    if (!body) return json({ error: 'Invalid JSON' }, 400);

    if (req.method === 'PUT' && u.searchParams.get('day')) {
      const day = u.searchParams.get('day');
      if (!DAY.test(day)) return json({ error: 'Bad date' }, 400);
      const key = 'entries/' + day.slice(0, 7);
      const list = (await s.get(key, { type: 'json' })) || [];
      // Refuse a save made from an out-of-date copy of this day (changed in another tab or on another device
      // since this one loaded it), so an old tab can never put back entries that were changed or merged. The app merges and tries again.
      if (Array.isArray(body.base)) {
        const current = list.filter(e => e.date === day);
        const norm = l => stable(l.map(e => ({ ...e, date: day })).sort((a, b) => String(a.id).localeCompare(String(b.id))));
        if (norm(current) !== norm(body.base)) return json({ error: 'conflict', entries: current }, 409);
      }
      const incoming = (body.entries || []).map(e => ({ ...e, date: day }));
      const next = sortEntries(list.filter(e => e.date !== day).concat(incoming));
      await s.setJSON(key, next);
      return json({ ok: true, day, count: incoming.length });
    }

    if (req.method === 'PUT' && u.searchParams.has('config')) {
      if (!body.config || typeof body.config !== 'object') return json({ error: 'Missing config' }, 400);
      // Refuse a save made from an out-of-date copy (another tab or device saved since this one loaded),
      // so an old tab can never wipe newer settings. The app merges and tries again.
      const current = await s.get('config', { type: 'json' });
      if (current && current.savedAt && body.base !== undefined && body.base !== current.savedAt) {
        return json({ error: 'conflict', config: current }, 409);
      }
      const savedAt = new Date().toISOString();
      await s.setJSON('config', { ...body.config, savedAt });
      return json({ ok: true, savedAt });
    }

    if (req.method === 'POST' && u.searchParams.has('import')) {
      const from = DAY.test(body.from || '') ? body.from : '0000-00-00';
      // back up what is there now
      const before = await allEntries(s);
      const oldConfig = await s.get('config', { type: 'json' });
      if (before.length || oldConfig) await s.setJSON('backup/' + new Date().toISOString(), { entries: before, config: oldConfig });
      // keep entries before `from`, replace everything from `from` onward
      const keep = before.filter(e => e.date < from);
      const merged = sortEntries(keep.concat((body.entries || []).filter(e => DAY.test(e.date) && e.date >= from)));
      const byMonth = new Map();
      for (const e of merged) { const k = e.date.slice(0, 7); if (!byMonth.has(k)) byMonth.set(k, []); byMonth.get(k).push(e); }
      const { blobs } = await s.list({ prefix: 'entries/' });
      await Promise.all(blobs.filter(b => !byMonth.has(b.key.slice(8))).map(b => s.delete(b.key)));
      await Promise.all([...byMonth].map(([k, v]) => s.setJSON('entries/' + k, v)));
      if (body.config) await s.setJSON('config', { ...body.config, savedAt: new Date().toISOString() });
      return json({ ok: true, entries: merged.length, months: byMonth.size });
    }

    return json({ error: 'Not found' }, 404);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
};
