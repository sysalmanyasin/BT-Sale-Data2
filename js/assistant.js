// ══════════════════════════════════════════════════════════════════════════
// AI ASSISTANT — local, rule-based chat widget (no API key required)
// Understands questions about DAILY/MONTHLY sales data, and gives live
// entry-assist hints (anomaly checks, missing fields, quick totals) while
// the Daily Entry form is open.
// ══════════════════════════════════════════════════════════════════════════

let _aiOpen = false;
let _aiHistory = []; // [{role:'user'|'bot', text}]

// ── Boot ─────────────────────────────────────────────────────────────────
window.addEventListener('load', function () {
  _aiInjectUI();
  _aiHistory.push({
    role: 'bot',
    text: "Hi! I'm your Sales Assistant. Ask me things like “total sales this month”, “top client last month”, “compare June vs May”, or open the Daily Entry form and I’ll flag anything unusual as you type."
  });
  _aiRender();
});

// ── UI injection (button + panel) ───────────────────────────────────────
function _aiInjectUI() {
  if (document.getElementById('ai-fab')) return;

  const fab = document.createElement('button');
  fab.id = 'ai-fab';
  fab.className = 'ai-fab';
  fab.title = 'Sales Assistant';
  fab.innerHTML = '🤖';
  fab.onclick = aiToggle;
  document.body.appendChild(fab);

  const panel = document.createElement('div');
  panel.id = 'ai-panel';
  panel.className = 'ai-panel';
  panel.innerHTML = `
    <div class="ai-head">
      <div class="ai-head-title">🤖 Sales Assistant</div>
      <button class="ai-close" onclick="aiToggle()">✕</button>
    </div>
    <div id="ai-msgs" class="ai-msgs"></div>
    <div id="ai-quick" class="ai-quick"></div>
    <div class="ai-input-row">
      <input id="ai-input" type="text" placeholder="Ask about your sales data…" onkeydown="if(event.key==='Enter')aiSend()">
      <button class="btn btn-p" onclick="aiSend()">➤</button>
    </div>`;
  document.body.appendChild(panel);
}

function aiToggle() {
  _aiOpen = !_aiOpen;
  const panel = document.getElementById('ai-panel');
  if (panel) panel.classList.toggle('on', _aiOpen);
  if (_aiOpen) {
    _aiRenderQuick();
    setTimeout(() => document.getElementById('ai-input')?.focus(), 150);
  }
}

function _aiRenderQuick() {
  const onEntry = !!document.getElementById('e-TOTAL');
  const opts = onEntry
    ? ['Check this entry', 'What does Cash to be Deposited mean?', 'Total this month so far']
    : ['Total sales this month', 'Top client last month', 'Compare this month vs last month', 'Any unusual days recently?'];
  const q = document.getElementById('ai-quick');
  if (!q) return;
  q.innerHTML = opts.map(o => `<button class="ai-chip" onclick="aiAsk('${o.replace(/'/g, "\\'")}')">${o}</button>`).join('');
}

function aiAsk(text) {
  document.getElementById('ai-input').value = text;
  aiSend();
}

function aiSend() {
  const input = document.getElementById('ai-input');
  const text = (input.value || '').trim();
  if (!text) return;
  input.value = '';
  _aiHistory.push({ role: 'user', text });
  _aiRender();
  setTimeout(() => {
    const reply = _aiAnswer(text);
    _aiHistory.push({ role: 'bot', text: reply });
    _aiRender();
  }, 250);
}

function _aiRender() {
  const box = document.getElementById('ai-msgs');
  if (!box) return;
  box.innerHTML = _aiHistory.map(m =>
    `<div class="ai-msg ${m.role}"><div class="ai-bubble">${m.text}</div></div>`
  ).join('');
  box.scrollTop = box.scrollHeight;
}

// ── Brain: answer questions using DAILY / MONTHLY in-memory data ───────────
function _aiAnswer(q) {
  try {
    const ql = q.toLowerCase();

    if (document.getElementById('e-TOTAL') && /check|review|look at|this entry/.test(ql)) {
      return _aiCheckCurrentEntry();
    }
    if (/cash to be deposited/.test(ql)) {
      return 'Cash to be Deposited = Cash Sale (after Cash Returns) minus Amount Received, i.e. the physical cash left to bank after settlements.';
    }
    if (/comp sale|diff/.test(ql)) {
      return 'DIFF = Total Sale − COMP SALE. It flags any mismatch between your recorded total and the pump computer reading for that month.';
    }
    if (/top client/.test(ql)) return _aiTopClient(ql);
    if (/compare|vs\b|versus/.test(ql)) return _aiCompareMonths(ql);
    if (/unusual|anomal|outlier|odd day/.test(ql)) return _aiFindAnomalies();
    if (/total|sales?\b/.test(ql) && /(this month|today|so far)/.test(ql)) return _aiThisMonthTotal();
    if (/total|sales?\b/.test(ql)) return _aiGeneralTotal(ql);
    if (/average|avg/.test(ql)) return _aiAverage(ql);
    if (/help|what can you/.test(ql)) {
      return "I can: total/average sales for a month or year, compare two months, name the top client, spot unusual days, and sanity-check a Daily Entry form before you save it. Try “total sales June 2026” or “compare June vs May”.";
    }
    return "I didn't quite catch that. Try things like: “total sales last month”, “top client this month”, “compare June vs May”, or “check this entry” while filling the Daily Entry form.";
  } catch (e) {
    return "Sorry, I hit a snag reading the data (" + e.message + "). Make sure your data has loaded, then try again.";
  }
}

function _aiMonthList() {
  return (typeof MONTHLY !== 'undefined' ? MONTHLY : []);
}

function _aiFindMonthByName(ql) {
  const M = _aiMonthList();
  if (!M.length) return null;
  // exact "Month Year" match anywhere in the query
  for (const m of M) if (ql.includes(m.Month_Year.toLowerCase())) return m;
  // just month name -> most recent matching year
  const names = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  for (const nm of names) {
    if (ql.includes(nm)) {
      const matches = M.filter(m => m.Month_Year.toLowerCase().startsWith(nm));
      if (matches.length) return matches[matches.length - 1];
    }
  }
  if (/this month|current/.test(ql)) return M[M.length - 1];
  if (/last month|previous month/.test(ql)) return M[M.length - 2];
  return null;
}

function _aiThisMonthTotal() {
  const M = _aiMonthList();
  if (!M.length) return 'No monthly data loaded yet.';
  const m = M[M.length - 1];
  return `${m.Month_Year}: total sales so far are <b>${fc(n(m.TOTAL))}</b>, across ${M.filter(x=>x===m).length>=0 ? '' : ''}the recorded days.`;
}

function _aiGeneralTotal(ql) {
  const m = _aiFindMonthByName(ql);
  if (m) return `Total sales for <b>${m.Month_Year}</b>: <b>${fc(n(m.TOTAL))}</b>.`;
  const M = _aiMonthList();
  if (!M.length) return 'No monthly data loaded yet.';
  const grand = M.reduce((s, x) => s + n(x.TOTAL), 0);
  return `I couldn't spot a specific month in your question, so here's the grand total across all ${M.length} recorded months: <b>${fc(grand)}</b>. You can also ask “total sales June 2026”.`;
}

function _aiAverage(ql) {
  const M = _aiMonthList();
  if (!M.length) return 'No monthly data loaded yet.';
  const avg = M.reduce((s, x) => s + n(x.TOTAL), 0) / M.length;
  return `Average monthly sales across ${M.length} months: <b>${fc(avg)}</b>.`;
}

function _aiTopClient(ql) {
  const m = _aiFindMonthByName(ql) || _aiMonthList()[_aiMonthList().length - 1];
  if (!m) return 'No monthly data loaded yet.';
  let best = null, bestVal = -Infinity;
  CLIENT_COLS.forEach(c => {
    const v = n(m[c]);
    if (v > bestVal) { bestVal = v; best = c; }
  });
  if (!best || bestVal <= 0) return `No positive credit-client sales found for ${m.Month_Year}.`;
  return `Top credit client in <b>${m.Month_Year}</b> was <b>${best}</b> with <b>${fc(bestVal)}</b>.`;
}

function _aiCompareMonths(ql) {
  const M = _aiMonthList();
  if (M.length < 2) return 'Need at least two months of data to compare.';
  const names = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  const found = [];
  for (const nm of names) {
    if (ql.includes(nm)) {
      const match = M.filter(m => m.Month_Year.toLowerCase().startsWith(nm));
      if (match.length) found.push(match[match.length - 1]);
    }
  }
  let a, b;
  if (found.length >= 2) { [a, b] = found; }
  else { a = M[M.length - 1]; b = M[M.length - 2]; }
  const ta = n(a.TOTAL), tb = n(b.TOTAL);
  const diff = ta - tb;
  const pctv = tb ? (diff / tb * 100).toFixed(1) : '—';
  const dir = diff >= 0 ? 'up' : 'down';
  return `<b>${a.Month_Year}</b>: ${fc(ta)} vs <b>${b.Month_Year}</b>: ${fc(tb)} — that's ${dir} ${fc(Math.abs(diff))} (${pctv}%).`;
}

function _aiFindAnomalies() {
  const D = (typeof DAILY !== 'undefined' ? DAILY : []);
  if (D.length < 5) return 'Not enough daily data yet to detect patterns.';
  const recent = D.slice(-30);
  const vals = recent.map(d => n(d.TOTAL));
  const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((s, v) => s + (v - avg) ** 2, 0) / vals.length) || 1;
  const flagged = recent.filter(d => Math.abs(n(d.TOTAL) - avg) > 1.8 * sd);
  if (!flagged.length) return `Nothing stands out in the last ${recent.length} days — totals are within normal range (avg ${fc(avg)}).`;
  const lines = flagged.slice(0, 5).map(d => `• ${d.Date}: ${fc(n(d.TOTAL))} (avg is ${fc(avg)})`);
  return `Found ${flagged.length} day(s) that deviate noticeably from the recent average:<br>${lines.join('<br>')}`;
}

// ── Entry-assist: sanity-check the open Daily Entry form ───────────────────
function _aiCheckCurrentEntry() {
  const get = id => { const el = document.getElementById('e-' + id); return el ? n(el.value) : 0; };
  const issues = [];

  const cash = get('Cash_Sale'), cashRet = get('Cash_Returns');
  if (cashRet > 0) issues.push('“Cash Returns” is positive — it should usually be entered as 0 or a negative number since it reduces the total.');

  const total = (() => { const el = document.getElementById('e-TOTAL'); return el ? n(el.value) : 0; })();
  if (total === 0) issues.push('Total is currently 0 — looks like no values have been entered yet.');

  const customers = get('Customers');
  if (customers === 0 && total > 0) issues.push('Customers is 0 but there’s a non-zero total — worth double-checking the customer count.');

  // Compare against this-month average if monthly history exists
  const M = _aiMonthList();
  if (M.length) {
    const m = M[M.length - 1];
    const days = (typeof DAILY !== 'undefined' ? DAILY : []).filter(d => d.Month_Year === m.Month_Year);
    if (days.length >= 3) {
      const avg = days.reduce((s, d) => s + n(d.TOTAL), 0) / days.length;
      if (avg > 0 && total > 0 && Math.abs(total - avg) > avg * 0.5) {
        const dir = total > avg ? 'higher' : 'lower';
        issues.push(`Today's total (${fc(total)}) is notably ${dir} than this month's daily average (${fc(avg)}) — just flagging in case it's a typo.`);
      }
    }
  }

  if (!issues.length) return 'Looks good — no obvious issues with the numbers entered so far.';
  return 'A few things to double-check:<br>' + issues.map(i => '• ' + i).join('<br>');
}
