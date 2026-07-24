// ══════════════════════════════════════════════════════════════════════
// AIInstructions — User-defined AI Instruction System  v1.0
// BT Sales App
//
// Lets the owner teach the AI how their business works.
// Stored in localStorage AND marked for Supabase sync.
//
// Public API:
//   AIInstructions.getAll()              → all instructions (active + inactive)
//   AIInstructions.getActive()           → active only
//   AIInstructions.getByCategory(cat)    → filtered by category id
//   AIInstructions.add(text, cat)        → create & return instruction
//   AIInstructions.update(id, fields)    → partial update
//   AIInstructions.delete(id)            → remove
//   AIInstructions.search(query)         → fuzzy search
//   AIInstructions.toggle(id)            → flip active flag
//   AIInstructions.exportJSON()          → JSON string
//   AIInstructions.importJSON(str, mode) → mode: "merge"|"replace"
//   AIInstructions.syncToSupabase()      → cloud push
//   AIInstructions.syncFromSupabase()    → cloud pull
//   AIInstructions.buildPromptBlock()    → text block for LLM prompt
// ══════════════════════════════════════════════════════════════════════

var AIInstructions = (function () {
  'use strict';

  /* ──────────────────────────────────────────────────────────────────
     CATEGORY DEFINITIONS
  ────────────────────────────────────────────────────────────────── */
  var CATEGORIES = [
    {
      id:      'business_profile',
      label:   'Business Profile',
      emoji:   '🏢',
      color:   '#2563eb',
      bg:      '#eff6ff',
      border:  '#bfdbfe',
      hint:    'Currency, language, location, store hours, staff count…',
      examples: [
        'Currency = PKR',
        'Language = Urdu & English mix',
        'Business name = Bahria Town Sales IC',
        'Tax number = NTN-1234567',
      ],
    },
    {
      id:      'interpretation',
      label:   'Interpretation Rules',
      emoji:   '🔤',
      color:   '#7c3aed',
      bg:      '#faf5ff',
      border:  '#e9d5ff',
      hint:    'How to interpret terms like "credit", "sale", "salary"…',
      examples: [
        '"credit" always means employee credit ledger',
        '"salary" means current month\'s salary sheet',
        '"sale" can mean daily, monthly, or all-time — ask when unclear',
        '"daalo" means add/enter a new record',
      ],
    },
    {
      id:      'behavior',
      label:   'AI Behavior',
      emoji:   '🤖',
      color:   '#0891b2',
      bg:      '#ecfeff',
      border:  '#a5f3fc',
      hint:    'How the AI should confirm, edit, and handle edge cases…',
      examples: [
        'Always ask for confirmation before deleting',
        'Prefer updating existing records over creating new ones',
        'Ask before modifying entries older than 7 days',
        'Never delete without showing what will be removed',
      ],
    },
    {
      id:      'knowledge',
      label:   'Business Knowledge',
      emoji:   '📚',
      color:   '#d97706',
      bg:      '#fffbeb',
      border:  '#fde68a',
      hint:    'Custom terms, clients, channels specific to this business…',
      examples: [
        'JazzCash = Digital Sale → add to "Salman Jazz Cash" section',
        'Easypaisa = Digital Sale',
        'HBL, MCB, Meezan = bank credit sales',
        'FDPP Con = consumer FDPP sales',
        'Patty HO = head-office petty cash handover',
      ],
    },
    {
      id:      'response',
      label:   'Response Preferences',
      emoji:   '💬',
      color:   '#16a34a',
      bg:      '#f0fdf4',
      border:  '#bbf7d0',
      hint:    'Tone, format, language, verbosity of AI replies…',
      examples: [
        'Keep replies short and to the point',
        'Always show totals after data entry',
        'Show a confirmation message after every action',
        'Use Urdu for casual replies, English for numbers',
      ],
    },
  ];

  /* ──────────────────────────────────────────────────────────────────
     STORAGE
  ────────────────────────────────────────────────────────────────── */
  var STORE_KEY   = 'bt_ai_instructions_v1';
  var SYNC_KEY    = 'bt_ai_instructions_synced'; // last cloud sync timestamp

  function _uid() {
    return 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }
  function _now() { return new Date().toISOString(); }

  function _load() {
    try { return JSON.parse(Repository.getItem(STORE_KEY) || '[]'); }
    catch (_) { return []; }
  }
  function _save(list) {
    try { Actions.saveFeatureData(STORE_KEY, JSON.stringify(list)); } catch (_) {}
    // Signal Supabase to sync (same mechanism as ai-memory.js)
    if (typeof _markPending === 'function') _markPending();
  }

  /* ──────────────────────────────────────────────────────────────────
     CRUD
  ────────────────────────────────────────────────────────────────── */
  function getAll() { return _load(); }

  function getActive() {
    return _load().filter(function (i) { return i.active !== false; });
  }

  function getByCategory(catId) {
    return _load().filter(function (i) { return i.category === catId; });
  }

  function add(text, catId) {
    text  = (text || '').trim();
    catId = catId || 'business_profile';
    if (!text) return null;
    var list = _load();
    // Avoid near-duplicate within same category
    var norm = function(s){ return s.toLowerCase().replace(/\s+/g,' ').trim(); };
    var dupe = list.find(function(i){
      return i.category === catId && norm(i.text) === norm(text);
    });
    if (dupe) return dupe;
    var entry = {
      id:        _uid(),
      category:  catId,
      text:      text,
      active:    true,
      createdAt: _now(),
      updatedAt: _now(),
    };
    list.unshift(entry);
    _save(list);
    if (typeof renderAiInstructionsPanel === 'function') renderAiInstructionsPanel();
    return entry;
  }

  function update(id, fields) {
    var list = _load();
    var idx  = list.findIndex(function(i){ return i.id === id; });
    if (idx === -1) return null;
    Object.assign(list[idx], fields, { updatedAt: _now() });
    _save(list);
    if (typeof renderAiInstructionsPanel === 'function') renderAiInstructionsPanel();
    return list[idx];
  }

  function del(id) {
    var list = _load().filter(function(i){ return i.id !== id; });
    _save(list);
    if (typeof renderAiInstructionsPanel === 'function') renderAiInstructionsPanel();
  }

  function toggle(id) {
    var list = _load();
    var item = list.find(function(i){ return i.id === id; });
    if (!item) return;
    item.active    = !item.active;
    item.updatedAt = _now();
    _save(list);
    if (typeof renderAiInstructionsPanel === 'function') renderAiInstructionsPanel();
    return item;
  }

  function search(query) {
    if (!query || !query.trim()) return _load();
    var q = query.trim().toLowerCase();
    return _load().filter(function(i){
      return i.text.toLowerCase().includes(q) ||
        (i.category || '').toLowerCase().includes(q);
    });
  }

  /* ──────────────────────────────────────────────────────────────────
     EXPORT / IMPORT
  ────────────────────────────────────────────────────────────────── */
  function exportJSON() {
    return JSON.stringify({
      exported:     _now(),
      version:      1,
      instructions: _load(),
    }, null, 2);
  }

  function importJSON(jsonStr, mode) {
    mode = mode || 'merge'; // "merge" | "replace"
    var parsed;
    try { parsed = JSON.parse(jsonStr); } catch (_) { return { ok: false, error: 'Invalid JSON' }; }
    var incoming = parsed.instructions || (Array.isArray(parsed) ? parsed : []);
    if (!incoming.length) return { ok: false, error: 'No instructions found in file' };

    if (mode === 'replace') {
      _save(incoming);
      return { ok: true, count: incoming.length, mode: 'replace' };
    }

    // Merge — skip exact text+category duplicates
    var existing = _load();
    var added = 0;
    incoming.forEach(function(item) {
      var norm = function(s){ return (s||'').toLowerCase().replace(/\s+/g,' ').trim(); };
      var dupe = existing.find(function(e){
        return e.category === item.category && norm(e.text) === norm(item.text);
      });
      if (!dupe) { existing.push(Object.assign({}, item, { id: _uid(), createdAt: _now(), updatedAt: _now() })); added++; }
    });
    _save(existing);
    return { ok: true, count: added, mode: 'merge' };
  }

  /* ──────────────────────────────────────────────────────────────────
     CLOUD SYNC — uses the app's existing Supabase functions if available
  ────────────────────────────────────────────────────────────────── */
  function syncToSupabase() {
    // pushToSupabase() now includes instructions via aimBuildAssistantPayload()
    if (typeof pushToSupabase === 'function') {
      return pushToSupabase().then(function() {
        try { Actions.saveFeatureData(SYNC_KEY, _now()); } catch(_) {}
        return { ok: true, count: _load().length };
      }).catch(function(e) {
        return { ok: false, error: e.message };
      });
    }
    return Promise.resolve({ ok: false, error: 'Supabase not configured' });
  }

  function syncFromSupabase() {
    // pullFromSupabase() → mergeIncomingData() → aimMergeAssistantIncoming()
    // which now merges assistant.instructions and stamps SYNC_KEY automatically.
    if (typeof pullFromSupabase === 'function') {
      var beforeCount = _load().length;
      return pullFromSupabase(true).then(function() {
        var afterCount = _load().length;
        // Ensure SYNC_KEY is stamped even if aimMergeAssistantIncoming didn't run
        try { Actions.saveFeatureData(SYNC_KEY, _now()); } catch(_) {}
        return { ok: true, count: afterCount, added: Math.max(0, afterCount - beforeCount) };
      }).catch(function(e) {
        return { ok: false, error: e.message };
      });
    }
    return Promise.resolve({ ok: false, error: 'Supabase not configured' });
  }

  function getLastSyncTime() {
    try { return Repository.getItem(SYNC_KEY) || null; } catch(_) { return null; }
  }

  /* ──────────────────────────────────────────────────────────────────
     PROMPT BLOCK — injected first (highest priority) before every Groq call
  ────────────────────────────────────────────────────────────────── */
  function buildPromptBlock() {
    var active = getActive();
    if (!active.length) return '';

    // Group by category
    var byCategory = {};
    CATEGORIES.forEach(function(c){ byCategory[c.id] = []; });
    active.forEach(function(i){
      if (byCategory[i.category]) byCategory[i.category].push(i.text);
      else byCategory['business_profile'] = (byCategory['business_profile'] || []).concat(i.text);
    });

    var lines = ['\n══════════ USER INSTRUCTIONS — FOLLOW EXACTLY (highest priority) ══════════'];
    CATEGORIES.forEach(function(c) {
      var items = byCategory[c.id];
      if (!items || !items.length) return;
      lines.push('[' + c.emoji + ' ' + c.label + ']');
      items.forEach(function(t){ lines.push('• ' + t); });
      lines.push('');
    });
    lines.push('══════════════════════════════════════════════════════════════════');
    return lines.join('\n');
  }

  /* ──────────────────────────────────────────────────────────────────
     HELPERS — exposed for UI
  ────────────────────────────────────────────────────────────────── */
  function getCategories() { return CATEGORIES; }
  function getCategoryById(id) {
    return CATEGORIES.find(function(c){ return c.id === id; }) || CATEGORIES[0];
  }
  function getStats() {
    var all = _load();
    var stats = { total: all.length, active: 0, byCategory: {} };
    CATEGORIES.forEach(function(c){ stats.byCategory[c.id] = 0; });
    all.forEach(function(i){
      if (i.active !== false) stats.active++;
      if (stats.byCategory[i.category] !== undefined) stats.byCategory[i.category]++;
    });
    return stats;
  }

  /* ──────────────────────────────────────────────────────────────────
     EXPORT
  ────────────────────────────────────────────────────────────────── */
  return {
    getAll:           getAll,
    getActive:        getActive,
    getByCategory:    getByCategory,
    add:              add,
    update:           update,
    delete:           del,
    toggle:           toggle,
    search:           search,
    exportJSON:       exportJSON,
    importJSON:       importJSON,
    syncToSupabase:   syncToSupabase,
    syncFromSupabase: syncFromSupabase,
    getLastSyncTime:  getLastSyncTime,
    buildPromptBlock: buildPromptBlock,
    getCategories:    getCategories,
    getCategoryById:  getCategoryById,
    getStats:         getStats,
  };

}());
