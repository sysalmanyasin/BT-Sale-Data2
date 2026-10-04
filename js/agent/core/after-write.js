// What the app's own pages do after every save: refresh the dashboards and,
// if the user has auto-save on, push to Supabase. Best-effort, never throws.
import { Repository } from '../../repository.js';

export function afterWrite({ rebuild = false } = {}) {
  try { if (rebuild && typeof window.rebuildAll === 'function') window.rebuildAll(); } catch (e) { console.error('[agent] rebuildAll failed', e); }
  try {
    if (Repository.getItem('bt_auto_save') === '1' && typeof window.pushToSupabase === 'function') window.pushToSupabase();
  } catch (e) { console.error('[agent] auto-save push failed', e); }
}
