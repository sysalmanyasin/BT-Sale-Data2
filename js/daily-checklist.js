/* Daily Checklist module for BT Sales IC.
 * Safe first integration: reads the existing StockLedgerApp shared rows,
 * never writes to inventory, and clearly marks unavailable sales figures.
 */
(function (global) {
  'use strict';
  const KEY = 'bt_daily_checklist_v1';
  const checks = [
    ['customer_dealing', 'Customer dealing by officers satisfactory'],
    ['medicine_check', 'Medicines checked before handing to customer'],
    ['staff_appearance', 'Staff shave, overalls and name tags checked'],
    ['dusting', 'Customer-area consumer items dusted'],
    ['strengths_variants', 'Medicine strengths and variants placed separately'],
    ['stationery', 'Bags, printer paper, tag rolls and registers available'],
    ['generator', 'Generator status / working hours checked'],
    ['returns_verified', 'Returns checked and verified by manager'],
    ['home_delivery', 'Home delivery entries updated'],
    ['fifo', 'FIFO followed'],
    ['warehouse_entry', 'Warehouse stock entered under supervision'],
    ['sealed_cartons', 'Supply cartons dispatched sealed / signed'],
    ['cash_deposit', 'Cash deposit slips emailed'],
    ['id_cards', 'Customer ID recorded for bills of Rs 50,000 or more'],
    ['supply_issues', 'Supply issues checked'],
    ['maintenance', 'Lights, AC filters, sign board and fire extinguishers checked'],
    ['price_check', 'Computer prices and consumer-item tags checked'],
    ['narcotics_manual', 'Manual narcotics register updated'],
    ['narcotics_system', 'Narcotics updated in system at sale'],
    ['schedule_d_manual', 'Manual Schedule-D register updated'],
    ['schedule_d_system', 'Schedule-D updated in system at sale'],
    ['prescription_scan', 'Prescription scanning checked'],
    ['inspection_register', 'Inspection register available'],
    ['rpo_review', 'RPOs reviewed carefully'],
    ['amendments', 'RPO amendments reviewed']
  ];

  function dateKey(date) {
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }
  function defaultDate() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return dateKey(d);
  }
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function readDraft(date) {
    try { return JSON.parse(global.localStorage.getItem(KEY + ':' + date) || '{}'); }
    catch (_) { return {}; }
  }
  function saveDraft(date, draft) {
    try { global.localStorage.setItem(KEY + ':' + date, JSON.stringify(draft)); return true; }
    catch (_) { return false; }
  }
  function getInventory() {
    const app = global.StockLedgerApp;
    if (!app || typeof app.getRawRows !== 'function') return null;
    try {
      const rows = app.getRawRows();
      if (!Array.isArray(rows) || !rows.length) return null;
      let value = 0, negative = 0, zero = 0, products = 0;
      rows.forEach(r => {
        const stock = Number(r.stock) || 0;
        const price = Number(r.unitPrice) || 0;
        products++;
        value += stock * price;
        if (stock < 0) negative += stock * price;
        if (stock <= 0) zero++;
      });
      return { products, value, negativeValue: negative, zeroStock: zero };
    } catch (_) { return null; }
  }
  function money(n) {
    return 'Rs ' + Math.round(n).toLocaleString('en-PK');
  }
  function render(root) {
    if (!root) return;
    const date = root.querySelector('[data-dc-date]')?.value || defaultDate();
    const draft = readDraft(date);
    const inventory = getInventory();
    const checksHtml = checks.map(([id, label]) => {
      const val = draft.checks && draft.checks[id] || '';
      return '<div class="dc-check"><span>' + escapeHtml(label) + '</span><div class="dc-choices">' +
        ['Yes','No','N/A'].map(v => '<button type="button" class="dc-choice ' + (val === v ? 'is-selected' : '') + '" data-dc-check="' + id + '" data-value="' + v + '" aria-pressed="' + (val === v) + '">' + v + '</button>').join('') +
        '</div>' + (val === 'No' ? '<input class="dc-remark" data-dc-remark="' + id + '" placeholder="Brief issue / action required" value="' + escapeHtml(draft.remarks && draft.remarks[id] || '') + '">' : '') + '</div>';
    }).join('');
    root.innerHTML = '<div class="dc-shell">' +
      '<header class="dc-header"><div><p class="dc-eyebrow">BT SALES IC</p><h2>Daily Checklist</h2><p>Auto-fill what the app knows. Confirm what needs a human.</p></div><span class="dc-pill">Draft</span></header>' +
      '<label class="dc-date-label">Report date <input type="date" data-dc-date value="' + escapeHtml(date) + '"></label>' +
      '<section class="dc-panel"><div class="dc-panel-title"><h3>Inventory snapshot</h3><button type="button" class="dc-button" data-dc-refresh>Refresh</button></div>' +
      (inventory ? '<div class="dc-metrics">' +
        metric('Products', inventory.products.toLocaleString('en-PK')) +
        metric('Current stock value', money(inventory.value)) +
        metric('Zero / negative stock items', inventory.zeroStock.toLocaleString('en-PK')) +
        metric('Negative stock value', money(inventory.negativeValue)) +
      '</div><p class="dc-note">Live inventory snapshot · not historical closing stock for the selected report date.</p>' :
        '<p class="dc-warning">Inventory is not loaded yet. Open the Stock Ledger and refresh this checklist.</p>') +
      '</section>' +
      '<section class="dc-panel"><h3>Sales figures</h3><p class="dc-note">Sales figures are intentionally not guessed. Connect the authoritative daily sales report source to populate these fields.</p>' +
      '<div class="dc-fields">' + field('Cash sales','cashSales',draft) + field('Credit sales','creditSales',draft) + field('Cash sale returns','cashReturns',draft) + field('Credit sale returns','creditReturns',draft) + field('Warehouse receipts','receipts',draft) + field('Closing stock (verified)','closingStock',draft) + '</div>' +
      '<p class="dc-note">Net sales auto-calculates from the entered sales and return figures.</p><div class="dc-net"><span>Net sales</span><strong data-dc-net>Rs 0</strong></div></section>' +
      '<section class="dc-panel"><div class="dc-panel-title"><h3>Manual checks</h3><span data-dc-progress></span></div><div class="dc-checks">' + checksHtml + '</div></section>' +
      '<section class="dc-panel"><h3>Daily notes</h3><textarea data-dc-notes placeholder="Only exceptions, repair requests, supply issues or follow-up actions">' + escapeHtml(draft.notes || '') + '</textarea></section>' +
      '<footer class="dc-actions"><button type="button" class="dc-button dc-primary" data-dc-save>Save draft</button><button type="button" class="dc-button" data-dc-copy>Copy report</button></footer><p class="dc-status" aria-live="polite" data-dc-status>Draft stays on this device until sync is connected.</p></div>';
    bind(root);
    updateSummary(root);
  }
  function metric(label, value) {
    return '<div class="dc-metric"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></div>';
  }
  function field(label, key, draft) {
    const val = draft.figures && draft.figures[key] != null ? draft.figures[key] : '';
    return '<label class="dc-field">' + escapeHtml(label) + '<input type="number" min="0" step="0.01" inputmode="decimal" data-dc-figure="' + key + '" value="' + escapeHtml(val) + '"></label>';
  }
  function collect(root) {
    const date = root.querySelector('[data-dc-date]').value;
    const previous = readDraft(date);
    const checksData = {};
    const remarks = {};
    root.querySelectorAll('[data-dc-check].is-selected').forEach(el => { checksData[el.dataset.dcCheck] = el.dataset.value; });
    root.querySelectorAll('[data-dc-remark]').forEach(el => { remarks[el.dataset.dcRemark] = el.value; });
    const figures = {};
    root.querySelectorAll('[data-dc-figure]').forEach(el => { figures[el.dataset.dcFigure] = el.value; });
    return { date, checks: checksData, remarks, figures, notes: root.querySelector('[data-dc-notes]').value, updatedAt: new Date().toISOString(), meta: previous.meta || {} };
  }
  function updateSummary(root) {
    const d = collect(root), f = d.figures;
    const n = k => Number(f[k]) || 0;
    const net = n('cashSales') + n('creditSales') - n('cashReturns') - n('creditReturns');
    const out = root.querySelector('[data-dc-net]');
    if (out) out.textContent = money(net);
    const answered = Object.keys(d.checks).length;
    const progress = root.querySelector('[data-dc-progress]');
    if (progress) progress.textContent = answered + ' / ' + checks.length + ' answered';
  }
  function reportText(root) {
    const d = collect(root), f = d.figures;
    const n = k => Number(f[k]) || 0;
    const inventory = getInventory();
    const lines = ['BT SALES IC — DAILY CHECKLIST', 'Report date: ' + d.date, '',
      'DAILY FIGURES', 'Cash sales: ' + (f.cashSales || 'Not entered'), 'Credit sales: ' + (f.creditSales || 'Not entered'),
      'Cash returns: ' + (f.cashReturns || 'Not entered'), 'Credit returns: ' + (f.creditReturns || 'Not entered'),
      'Net sales: ' + money(n('cashSales') + n('creditSales') - n('cashReturns') - n('creditReturns')),
      'Warehouse receipts: ' + (f.receipts || 'Not entered'), 'Verified closing stock: ' + (f.closingStock || 'Not entered'), '',
      'CURRENT INVENTORY SNAPSHOT'];
    if (inventory) lines.push('Products: ' + inventory.products, 'Current stock value: ' + money(inventory.value), 'Zero/negative stock items: ' + inventory.zeroStock, 'Negative stock value: ' + money(inventory.negativeValue));
    else lines.push('Inventory: Not loaded');
    lines.push('', 'MANUAL CHECKS');
    checks.forEach(([id, label]) => lines.push((d.checks[id] || 'PENDING') + ' — ' + label + (d.remarks[id] ? ' | ' + d.remarks[id] : '')));
    lines.push('', 'NOTES', d.notes || 'None', '', 'Draft generated: ' + d.updatedAt);
    return lines.join('\n');
  }
  function reportHtml(root) {
    const d = collect(root), f = d.figures, inventory = getInventory();
    const n = k => Number(f[k]) || 0;
    const esc = escapeHtml;
    const cell = 'border:1px solid #cbd5e1;padding:7px 10px;font:13px Arial,sans-serif;';
    const heading = 'background:#17365d;color:#fff;font-weight:700;padding:10px;font:14px Arial,sans-serif;';
    const row = (label, value, bold) => '<tr><td style="' + cell + (bold ? 'font-weight:700;' : '') + '">' + esc(label) + '</td><td style="' + cell + 'text-align:right;' + (bold ? 'font-weight:700;' : '') + '">' + esc(value) + '</td></tr>';
    let html = '<div style="font-family:Arial,sans-serif;max-width:680px"><table style="width:100%;border-collapse:collapse;border:1px solid #cbd5e1"><tr><td colspan="2" style="' + heading + '">BT SALES IC — DAILY CHECKLIST · ' + esc(d.date) + '</td></tr>';
    html += '<tr><td colspan="2" style="' + cell + 'background:#eaf0f8;font-weight:700">DAILY FIGURES</td></tr>';
    html += row('Cash sales', f.cashSales || 'Not entered') + row('Credit sales', f.creditSales || 'Not entered') + row('Cash returns', f.cashReturns || 'Not entered') + row('Credit returns', f.creditReturns || 'Not entered');
    html += row('Net sales', money(n('cashSales') + n('creditSales') - n('cashReturns') - n('creditReturns')), true) + row('Warehouse receipts', f.receipts || 'Not entered') + row('Verified closing stock', f.closingStock || 'Not entered');
    html += '<tr><td colspan="2" style="' + cell + 'background:#eaf0f8;font-weight:700">CURRENT INVENTORY SNAPSHOT</td></tr>';
    if (inventory) html += row('Products', inventory.products.toLocaleString('en-PK')) + row('Current stock value', money(inventory.value)) + row('Zero / negative stock items', inventory.zeroStock.toLocaleString('en-PK')) + row('Negative stock value', money(inventory.negativeValue));
    else html += row('Inventory', 'Not loaded');
    html += '<tr><td colspan="2" style="' + cell + 'background:#eaf0f8;font-weight:700">MANUAL CHECKS</td></tr>';
    checks.forEach(([id, label]) => {
      const value = d.checks[id] || 'PENDING';
      const remark = d.remarks[id] ? ' — ' + d.remarks[id] : '';
      html += row(value + ' — ' + label, remark.trim() || (value === 'No' ? 'Action required' : ''), value === 'No');
    });
    html += '<tr><td colspan="2" style="' + cell + 'background:#eaf0f8;font-weight:700">NOTES</td></tr>';
    html += '<tr><td colspan="2" style="' + cell + '">' + esc(d.notes || 'None').replace(/\n/g, '<br>') + '</td></tr></table><p style="font:11px Arial,sans-serif;color:#64748b">Inventory values are a current snapshot, not historical closing stock. Review before sending.</p></div>';
    return html;
  }
  function bind(root) {
    root.querySelector('[data-dc-date]').addEventListener('change', () => render(root));
    root.querySelector('[data-dc-refresh]').addEventListener('click', () => render(root));
    root.addEventListener('click', event => {
      const choice = event.target.closest('[data-dc-check]');
      if (choice && root.contains(choice)) {
        const group = root.querySelectorAll('[data-dc-check="' + choice.dataset.dcCheck + '"]');
        group.forEach(el => { el.classList.toggle('is-selected', el === choice && !choice.classList.contains('is-selected')); el.setAttribute('aria-pressed', String(el.classList.contains('is-selected'))); });
        const selected = Array.from(group).find(el => el.classList.contains('is-selected'));
        const row = choice.closest('.dc-check');
        const old = row.querySelector('.dc-remark');
        if (old) old.remove();
        if (selected && selected.dataset.value === 'No') {
          const input = document.createElement('input'); input.className = 'dc-remark'; input.dataset.dcRemark = choice.dataset.dcCheck; input.placeholder = 'Brief issue / action required'; row.appendChild(input);
        }
        updateSummary(root);
      }
      if (event.target.closest('[data-dc-save]')) {
        const d = collect(root), ok = saveDraft(d.date, d);
        root.querySelector('[data-dc-status]').textContent = ok ? 'Draft saved on this device at ' + new Date().toLocaleTimeString() : 'Could not save locally. Check device storage.';
      }
      if (event.target.closest('[data-dc-copy]')) {
        const text = reportText(root);
        // Match BT Sales IC's existing Gmail workflow: write rich HTML and
        // plain text together so Gmail can preserve table styling on paste.
        const html = reportHtml(root);
        try {
          if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
            const item = new ClipboardItem({
              'text/html': new Blob([html], { type: 'text/html' }),
              'text/plain': new Blob([text], { type: 'text/plain' })
            });
            navigator.clipboard.write([item]).then(() => {
              root.querySelector('[data-dc-status]').textContent = 'Formatted report copied — paste into Gmail and review before sending.';
            }).catch(() => fallbackCopy(text, root));
          } else if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
              root.querySelector('[data-dc-status]').textContent = 'Copied as plain text in this browser. Rich HTML copy is not supported here.';
            }).catch(() => fallbackCopy(text, root));
          } else fallbackCopy(text, root);
        } catch (_) { fallbackCopy(text, root); }
      }
    });
    root.addEventListener('input', event => {
      if (event.target.matches('[data-dc-figure], [data-dc-notes], [data-dc-remark]')) {
        updateSummary(root);
        const d = collect(root);
        saveDraft(d.date, d);
      }
    });
  }
  function fallbackCopy(text, root) {
    const area = document.createElement('textarea'); area.value = text; area.style.position = 'fixed'; area.style.opacity = '0'; document.body.appendChild(area); area.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (_) {}
    area.remove();
    root.querySelector('[data-dc-status]').textContent = ok ? 'Report copied. Review it before sending.' : 'Copy unavailable on this browser; select and copy the report manually.';
  }
  global.DailyChecklist = { init: function (rootOrSelector) {
    const root = typeof rootOrSelector === 'string' ? document.querySelector(rootOrSelector) : rootOrSelector;
    if (!root) return false;
    const app = global.StockLedgerApp;
    if (app && typeof app.init === 'function') { try { app.init(); } catch (_) {} }
    render(root);
    return true;
  }};
})(window);
