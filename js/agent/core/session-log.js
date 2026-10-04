// In-memory record of changes made this session (for the auditor). Cleared with ↺.
let _log = [];
export function logChange({ tool, key, amount = 0, at = Date.now() }) { _log.push({ tool, key, amount: Number(amount) || 0, at }); if (_log.length > 200) _log.shift(); }
export function recentChanges(withinMs, now = Date.now()) { return _log.filter(c => now - c.at <= withinMs); }
export function clearSessionLog() { _log = []; }
