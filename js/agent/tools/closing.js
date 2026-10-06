// Closing domain — READ tools over the Closing app's synced shift sheets (read-only bridge).
// No Closing maths is recomputed here: net sale / draft / locked come straight from the sheets.
import { registerTool } from '../core/tool-registry.js';
import { clampInt, rs } from './_util.js';

const SHIFTS = ['Night', 'Morning', 'Evening'];
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

function db() {
  const d = typeof window.closingBridgeGetFullDb === 'function' ? window.closingBridgeGetFullDb() : null;
  if (!d || !d.sheets) throw new Error('Closing data is not loaded yet. Open the Closing page once, then ask again.');
  return d;
}
function shiftOf(sheets, day, shift) {
  const rec = sheets[day + '_' + shift];
  if (!rec) return { shift, status: 'pending' };
  if (rec.draft && !rec.locked) return { shift, status: 'draft' };
  const net = rec.profileMode === 'final' ? rec.finalNetSale : rec.outNetSale;
  return { shift, status: 'closed', net_sale: rs(net) };
}
const dayLine = (sheets, day) => { const shifts = SHIFTS.map(s => shiftOf(sheets, day, s)); return { date: day, shifts, closed: shifts.filter(s => s.status === 'closed').length, net_sale_total: shifts.reduce((t, s) => t + (s.net_sale || 0), 0) }; };

registerTool({
  name: 'closing_status', domain: 'closing', risk: 'read',
  description: "Closing book status for one day (default today): each shift (Night, Morning, Evening) as pending, draft or closed, with its net sale.",
  parameters: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD, default today' } } },
  run: ({ date }) => {
    const d = db(); const day = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? date : iso(new Date());
    return dayLine(d.sheets, day);
  },
});

registerTool({
  name: 'closing_recent_days', domain: 'closing', risk: 'read',
  description: 'Closing book for the last N days (default 7): which shifts are still pending or draft, and net sale per day. Use to find days that were never closed.',
  parameters: { type: 'object', properties: { days: { type: 'integer', description: 'how many days back, 1-31, default 7' } } },
  run: ({ days }) => {
    const d = db(); const n = clampInt(days, 1, 31, 7); const out = [];
    for (let i = 0; i < n; i++) { const dt = new Date(); dt.setDate(dt.getDate() - i); out.push(dayLine(d.sheets, iso(dt))); }
    const incomplete = out.filter(x => x.closed < SHIFTS.length).map(x => ({ date: x.date, missing: x.shifts.filter(s => s.status !== 'closed').map(s => s.shift + ' (' + s.status + ')') }));
    return { days: out, incomplete_days: incomplete };
  },
});
