// RULE-BASED INSTANT PATH — common one-line commands answered with NO model call (no tokens, no
// provider, works when every free tier is down). Deliberately strict: a command must match a short
// whole-message pattern, otherwise it falls through to the AI. Only read/ui tools can ever run here,
// and the answer text is built from the tool result, never invented.
import { runTool } from './tool-registry.js';

const clean = s => String(s || '').toLowerCase().replace(/[?.!,]+/g, ' ').replace(/\s+/g, ' ').trim();
const rs = v => 'Rs ' + Math.round(Number(v) || 0).toLocaleString('en-PK');

// target phrase → page id (only ids that exist in index.html; unknown ids are refused by navigate_to anyway)
const PAGES = [
  [/^(dashboard|home|cover)$/, 'dashboard', 'Dashboard'],
  [/^(entry|daily entry|add entry|new entry)$/, 'entry', 'Entry'],
  [/^(reports?)$/, 'report', 'Reports'],
  [/^(closing|closing book)$/, 'closing-book', 'Closing book'],
  [/^(credit ledger)$/, 'credit-ledger', 'Credit ledger'],
  [/^(ledgers?|petty|expenses?|jazz ?cash)$/, 'manager', 'Manager (the ledgers are inside it)'],
  [/^(manager|staff)$/, 'manager', 'Manager'],
  [/^(inventory|stock)$/, 'inventory', 'Inventory'],
  [/^(reorder)$/, 'reorder', 'Reorder'],
  [/^(str|transfers?|stock transfers?)$/, 'str', 'STR'],
  [/^(str report)$/, 'str-report', 'STR report'],
  [/^(zero dispatch|str zero dispatch)$/, 'str-zero-dispatch', 'STR zero dispatch'],
  [/^(notes|sheets|notes and sheets|notes sheets)$/, 'notesheets', 'Notes & sheets'],
  [/^(activity log|activity)$/, 'activity-log', 'Activity log'],
  [/^(cash deposit|deposits?)$/, 'cashdeposit', 'Cash deposit'],
  [/^(emergency billing)$/, 'emergency-billing', 'Emergency billing'],
  [/^(diff|diff report)$/, 'diff', 'Diff report'],
];

const COMMANDS = [
  { re: /^(what('?s| is)? )?(today'?s |todays |the )?(sale|sales|total sale|total sales)( today| so far)?$|^(how (are|is) )?(today'?s |todays )?(sale|sales)( today| so far)?$|^aaj (ki|ka) (bikri|sale)( kitni| kitna)?( hai)?$/,
    tool: 'get_daily_sales', args: { date: 'today' },
    say: r => r.error ? 'There is no sales entry for today yet.' : 'Today: total sale ' + rs(r.total_sale) + (r.comp_sale ? ', COMP ' + rs(r.comp_sale) + ' (diff ' + rs(r.diff) + ')' : '') + (r.customers ? ', ' + r.customers + ' customers' : '') + '.' },
  { re: /^(what('?s| is)? )?(yesterday'?s |yesterdays )(sale|sales|total sale)$|^(how (were|was) )?yesterday'?s? (sale|sales)$/,
    tool: 'get_daily_sales', args: { date: 'yesterday' },
    say: r => r.error ? 'There is no sales entry for yesterday.' : 'Yesterday: total sale ' + rs(r.total_sale) + (r.comp_sale ? ', COMP ' + rs(r.comp_sale) + ' (diff ' + rs(r.diff) + ')' : '') + '.' },
  { re: /^(what('?s| is)? )?(the )?(date|day|date today|today'?s date)( today)?$/,
    tool: 'get_app_context', args: {}, say: r => 'Today is ' + r.weekday + ', ' + r.today + '.' },
  { re: /^(target pace|pace|are we on target|target)( this month)?$/,
    tool: 'get_target_pace', args: {},
    say: r => r.error ? String(r.error) : null }, // pace output is rich: let the AI explain it (null = fall through)
  { re: /^(pending strs?|pending transfers?|awaited strs?|open strs?)$/,
    tool: 'str_overview', args: {},
    say: r => 'STRs: ' + r.awaited.all + ' awaited, ' + r.dispatched_not_received.all + ' dispatched but not received, ' + r.received + ' received.' + (r.oldest_open ? ' Oldest open: ' + r.oldest_open.str + ' (' + r.oldest_open.age_days + ' days).' : '') },
  { re: /^(closing status|closing today|is closing done|shift status)$/,
    tool: 'closing_status', args: {},
    say: r => r.error ? String(r.error) : 'Closing today: ' + r.shifts.map(s => s.shift + ' ' + s.status + (s.net_sale != null ? ' (' + rs(s.net_sale) + ')' : '')).join(', ') + '.' },
  { re: /^(forecast|sales forecast|month forecast|monthly forecast|weekday forecast|today'?s? forecast|forecast today|will i hit (the )?target|will we hit (the )?target)$/,
    tool: 'weekday_forecast', args: {},
    say: r => r.error ? String(r.error)
      : r.month + ': sold ' + rs(r.sold_so_far) + ' so far; expected month-end about ' + rs(r.projected_month_end) + ' (typical ' + rs(r.projected_low) + ' to ' + rs(r.projected_high) + ').'
        + (r.vs_target ? ' Target ' + rs(r.target) + ': ' + (r.vs_target.on_track ? 'on track' : 'short by about ' + rs(-r.vs_target.gap_at_projection)) + ' (need ' + rs(r.vs_target.needed_per_remaining_day) + '/day, weekday pattern expects ' + rs(r.vs_target.expected_per_remaining_day) + '/day).' : '')
        + ' ' + (r.today.entered ? 'Today is already entered.' : r.today.weekday + ' usually sells about ' + rs(r.today.expected) + ' (typical ' + rs(r.today.typical_low) + ' to ' + rs(r.today.typical_high) + ').') },
  { re: /^(draft reorder|reorder draft|reorder list|draft reorder list|draft the reorder|what should i reorder|what to reorder)$/,
    tool: 'reorder_draft', args: { limit: 8 },
    say: r => r.error ? String(r.error)
      : 'Reorder draft: ' + r.total_lines + ' lines (' + r.out_of_stock_selling + ' out of stock but selling, ' + r.low_cover + ' running low), about ' + rs(r.est_value_at_sale_price) + ' at sale price, net of stock in transit.'
        + (r.groups.length ? ' Most urgent: ' + r.groups.flatMap(g => g.items).filter(i => i.status !== 'reorder').slice(0, 5).map(i => i.name + ' (buy ' + i.suggested_qty + ')').join(', ') + '.' : '')
        + ' The full supplier-grouped list is in the AI Center.' },
  { re: /^(str fill rate|fill rate|transfer fill rate|str fill)$/,
    tool: 'str_fill_rate', args: {},
    say: r => r.error ? String(r.error)
      : r.fill_rate_pct == null ? 'No dispatched incoming STR lines in the last ' + r.window_days + ' days to measure.'
        : 'STR fill rate (last ' + r.window_days + ' days, incoming): ' + r.fill_rate_pct + '% of requested packs dispatched across ' + r.strs_counted + ' STRs; ' + r.zero_dispatch_lines + ' lines got nothing, ' + r.short_lines + ' short.'
          + (r.receipt_accuracy_pct != null ? ' Receipt accuracy ' + r.receipt_accuracy_pct + '%.' : '')
          + (r.by_source.length ? ' Weakest source: ' + r.by_source[0].source + ' (' + r.by_source[0].fill_rate_pct + '%).' : '') },
  { re: /^(what needs my attention|what needs my attention today|attention|briefing|morning briefing)$/,
    tool: 'daily_briefing', args: {}, say: () => null }, // briefing is rich: AI explains it
];

/** Every tool the instant path can call (tests assert none is a change tool). */
export const INSTANT_TOOLS = Object.freeze([...new Set([...COMMANDS.map(c => c.tool), 'navigate_to'])]);

/**
 * @returns {null | {kind:'answer', text:string, tool:string} | {kind:'navigate', text:string, tool:string}}
 * null means "not an instant command": ask the AI.
 */
export async function tryInstant(userText) {
  const t = clean(userText);
  if (!t || t.length > 60) return null;

  const nav = /^(open|go to|take me to|show me|switch to)( the)? (.+?)( page| screen| tab)?$/.exec(t);
  if (nav) {
    const target = nav[3].trim();
    const hit = PAGES.find(([re]) => re.test(target));
    if (!hit) return null;
    const r = await runTool('navigate_to', { page: hit[1] }, { allow: ['ui'] });
    let body = null; try { body = JSON.parse(r.text); } catch (_) { /* fall through */ }
    if (!r.ok || !body || body.error) return null; // let the AI handle odd cases
    return { kind: 'navigate', tool: 'navigate_to', text: 'Opened ' + hit[2] + '.' };
  }

  for (const c of COMMANDS) {
    if (!c.re.test(t)) continue;
    const r = await runTool(c.tool, c.args, { allow: ['read'] });
    if (!r.ok) return null;
    let body; try { body = JSON.parse(r.text); } catch (_) { return null; }
    const text = c.say(body);
    return text ? { kind: 'answer', tool: c.tool, text } : null;
  }
  return null;
}
