/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  KNOWLEDGE SHEET  —  BT Sales App  ·  Phase 7                       ║
 * ╠══════════════════════════════════════════════════════════════════════╣
 * ║  Standalone "Knowledge Base" picker — unified entry point into       ║
 * ║  Instructions (ai-instructions-ui.js → ainOpen) and Memory            ║
 * ║  (ai-memory.js → aimOpenPanel). Ported verbatim from the retired      ║
 * ║  ai-page.js (aipOpenKnowledge/aipCloseKnowledge) so that file can     ║
 * ║  be deleted — this was its only unreachable, still-useful piece.     ║
 * ╠══════════════════════════════════════════════════════════════════════╣
 * ║  Public API:                                                          ║
 * ║    kshOpen()  — open the Knowledge Base sheet                        ║
 * ║    kshClose() — close it                                              ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

function kshOpen() {
  var existing = document.getElementById('ksh-knowledge-sheet');
  if (existing) { existing.remove(); }

  var sheet = document.createElement('div');
  sheet.id = 'ksh-knowledge-sheet';
  sheet.style.cssText = [
    'position:fixed;inset:0;z-index:22000;',
    'background:rgba(15,23,42,.55);backdrop-filter:blur(4px);',
    '-webkit-backdrop-filter:blur(4px);',
    'display:flex;align-items:flex-end;justify-content:center;',
    'opacity:0;transition:opacity .18s ease;',
  ].join('');

  sheet.innerHTML = [
    '<div style="',
      'width:100%;max-width:480px;',
      'background:#fff;border-radius:22px 22px 0 0;',
      'padding:0 0 env(safe-area-inset-bottom,0) 0;',
      'box-shadow:0 -8px 40px rgba(0,0,0,.18);',
      'transform:translateY(20px);transition:transform .22s cubic-bezier(.34,1.2,.64,1);',
    '" id="ksh-inner">',

      /* drag handle */
      '<div style="display:flex;justify-content:center;padding:12px 0 4px">',
        '<div style="width:40px;height:4px;border-radius:3px;background:#e2e8f0"></div>',
      '</div>',

      /* header */
      '<div style="padding:8px 20px 16px;border-bottom:1px solid #f1f5f9">',
        '<div style="font-size:18px;font-weight:800;color:#0f172a;display:flex;align-items:center;gap:9px">',
          '<span style="font-size:22px">📚</span> Knowledge Base',
        '</div>',
        '<div style="font-size:12px;color:#64748b;margin-top:3px">',
          'Everything you\u2019ve taught the AI about your business',
        '</div>',
      '</div>',

      /* two big choice tiles */
      '<div style="padding:16px 16px 10px;display:flex;flex-direction:column;gap:10px">',

        /* Instructions tile */
        '<button onclick="kshClose();setTimeout(function(){ainOpen&&ainOpen()},120)" style="',
          'display:flex;align-items:center;gap:14px;',
          'background:linear-gradient(135deg,#eff6ff,#dbeafe);',
          'border:1.5px solid #bfdbfe;border-radius:14px;',
          'padding:16px 18px;cursor:pointer;text-align:left;width:100%;',
          'transition:background .13s,border-color .13s;',
        '" onmouseenter="this.style.background=\'linear-gradient(135deg,#dbeafe,#bfdbfe)\'" ',
           'onmouseleave="this.style.background=\'linear-gradient(135deg,#eff6ff,#dbeafe)\'">',
          '<span style="font-size:32px;line-height:1;flex-shrink:0">🤖</span>',
          '<div>',
            '<div style="font-size:14px;font-weight:700;color:#1e40af">Instructions</div>',
            '<div style="font-size:12px;color:#3b82f6;margin-top:2px;line-height:1.45">',
              'Static facts &amp; rules you type once — always injected into every AI prompt.',
              '<br>E.g. \u201cWe close on Fridays\u201d or \u201cTarget is 5M\u201d',
            '</div>',
          '</div>',
        '</button>',

        /* Memory tile */
        '<button onclick="kshClose();setTimeout(function(){aimOpenPanel&&aimOpenPanel()},120)" style="',
          'display:flex;align-items:center;gap:14px;',
          'background:linear-gradient(135deg,#f5f3ff,#ede9fe);',
          'border:1.5px solid #c4b5fd;border-radius:14px;',
          'padding:16px 18px;cursor:pointer;text-align:left;width:100%;',
          'transition:background .13s,border-color .13s;',
        '" onmouseenter="this.style.background=\'linear-gradient(135deg,#ede9fe,#ddd6fe)\'" ',
           'onmouseleave="this.style.background=\'linear-gradient(135deg,#f5f3ff,#ede9fe)\'">',
          '<span style="font-size:32px;line-height:1;flex-shrink:0">🧠</span>',
          '<div>',
            '<div style="font-size:14px;font-weight:700;color:#6d28d9">Memory</div>',
            '<div style="font-size:12px;color:#7c3aed;margin-top:2px;line-height:1.45">',
              'AI\u2019s learned facts, IF\u2192THEN rules, correction training &amp; voice log.',
              '<br>Say \u201cRemember: Usman handles jazz cash\u201d to add here.',
            '</div>',
          '</div>',
        '</button>',

      '</div>',

      /* hint footer */
      '<div style="padding:4px 20px 18px;font-size:11px;color:#94a3b8;text-align:center">',
        'Tip: say \u201cRemember \u2026\u201d in chat to add a memory instantly &nbsp;\u00b7&nbsp; ',
        'say \u201cForget \u2026\u201d to remove one',
      '</div>',

    '</div>',
  ].join('');

  sheet.addEventListener('click', function(e) {
    if (e.target === sheet) kshClose();
  });

  document.body.appendChild(sheet);

  requestAnimationFrame(function() {
    sheet.style.opacity = '1';
    var inner = document.getElementById('ksh-inner');
    if (inner) inner.style.transform = 'translateY(0)';
  });
}

function kshClose() {
  var sheet = document.getElementById('ksh-knowledge-sheet');
  if (!sheet) return;
  sheet.style.opacity = '0';
  var inner = document.getElementById('ksh-inner');
  if (inner) inner.style.transform = 'translateY(20px)';
  setTimeout(function() { if (sheet.parentNode) sheet.remove(); }, 200);
}
