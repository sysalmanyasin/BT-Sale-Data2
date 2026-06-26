/* ── DIFF REPORT ─────────────────────────────────────────────────── */
/* Cumulative Difference (Total Sale − COMP SALE) by month + running  */

function renderDiffReport() {
  const wrap = document.getElementById('diff-report-wrap');
  if (!wrap) return;

  /* ── sort months chronologically ── */
  const sorted = [...MONTHLY]
    .filter(m => m.Month_Year)
    .sort((a, b) => a.Month_Year.localeCompare(b.Month_Year));

  if (!sorted.length) {
    wrap.innerHTML = '<p style="color:var(--muted);text-align:center;padding:40px">No data yet.</p>';
    return;
  }

  /* ── compute per-month diff + running cumulative ── */
  let running = 0;
  let totTotal = 0, totComp = 0, totDiff = 0;

  const rows = sorted.map(m => {
    const total = Math.round(n(m.TOTAL));
    const comp  = Math.round(n(m['COMP SALE']));
    const diff  = total - comp;
    running    += diff;
    totTotal   += total;
    totComp    += comp;
    totDiff    += diff;

    const dSign  = diff  > 0 ? '+' : '';
    const rSign  = running > 0 ? '+' : '';
    const dColor = diff    > 0 ? 'var(--green)' : diff    < 0 ? 'var(--red)' : 'var(--muted)';
    const rColor = running > 0 ? 'var(--green)' : running < 0 ? 'var(--red)' : 'var(--muted)';

    return `<tr>
      <td style="font-weight:600;white-space:nowrap">${m.Month_Year}</td>
      <td class="dr-num">₨${fc(total)}</td>
      <td class="dr-num">₨${fc(comp)}</td>
      <td class="dr-num" style="color:${dColor};font-weight:700">${dSign}${fc(diff)}</td>
      <td class="dr-num" style="color:${rColor};font-weight:700">${rSign}${fc(running)}</td>
    </tr>`;
  }).join('');

  /* ── footer totals ── */
  const fSign  = totDiff  > 0 ? '+' : '';
  const fColor = totDiff  > 0 ? 'var(--green)' : totDiff  < 0 ? 'var(--red)' : 'var(--muted)';
  const rFinal = running;
  const rfColor = rFinal  > 0 ? 'var(--green)' : rFinal   < 0 ? 'var(--red)' : 'var(--muted)';

  const foot = `<tr style="background:var(--s2);border-top:2px solid var(--border)">
    <td style="font-weight:700">ALL TIME</td>
    <td class="dr-num" style="font-weight:700">₨${fc(totTotal)}</td>
    <td class="dr-num" style="font-weight:700">₨${fc(totComp)}</td>
    <td class="dr-num" style="font-weight:700;color:${fColor}">${fSign}${fc(totDiff)}</td>
    <td class="dr-num" style="font-weight:700;color:${rfColor}">${fSign}${fc(rFinal)}</td>
  </tr>`;

  /* ── summary banner ── */
  const bannerColor = rFinal > 0 ? '#ecfdf5' : '#fef2f2';
  const bannerBorder = rFinal > 0 ? '#6ee7b7' : '#fca5a5';
  const bannerText  = rFinal > 0 ? 'var(--green)' : 'var(--red)';
  const bannerLabel = rFinal > 0
    ? '📈 Physical sales are ahead of computer records'
    : '📉 Computer records are ahead of physical sales';

  const nMonths = sorted.length;
  const avgDiff = Math.round(totDiff / nMonths);
  const avgSign = avgDiff >= 0 ? '+' : '';

  wrap.innerHTML = `
    <!-- Summary banner -->
    <div style="background:${bannerColor};border:1px solid ${bannerBorder};border-radius:12px;padding:16px 18px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.08em;text-transform:uppercase;margin-bottom:4px">CC Difference</div>
        <div style="font-size:28px;font-weight:800;font-family:var(--mono);color:${bannerText}">${rFinal>=0?'+':''}₨${fc(rFinal)}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:4px">${bannerLabel}</div>
      </div>
      <div style="display:flex;gap:20px;flex-wrap:wrap">
        <div style="text-align:center">
          <div style="font-size:16px;font-weight:700;font-family:var(--mono);color:var(--text)">${nMonths}</div>
          <div style="font-size:10px;color:var(--muted);margin-top:2px">Months</div>
        </div>
        <div style="text-align:center">
          <div style="font-size:16px;font-weight:700;font-family:var(--mono);color:${bannerText}">${avgSign}₨${fc(avgDiff)}</div>
          <div style="font-size:10px;color:var(--muted);margin-top:2px">Avg / Month</div>
        </div>
      </div>
    </div>

    <!-- Table -->
    <div class="twrap tscroll">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:var(--s2);border-bottom:2px solid var(--border)">
            <th style="padding:10px 12px;text-align:left;font-weight:700;color:var(--muted);font-size:11px;letter-spacing:.06em;text-transform:uppercase">Month</th>
            <th style="padding:10px 12px;text-align:right;font-weight:700;color:var(--muted);font-size:11px;letter-spacing:.06em;text-transform:uppercase">Total Sale</th>
            <th style="padding:10px 12px;text-align:right;font-weight:700;color:var(--muted);font-size:11px;letter-spacing:.06em;text-transform:uppercase">COMP SALE</th>
            <th style="padding:10px 12px;text-align:right;font-weight:700;color:var(--muted);font-size:11px;letter-spacing:.06em;text-transform:uppercase">Difference</th>
            <th style="padding:10px 12px;text-align:right;font-weight:700;color:var(--muted);font-size:11px;letter-spacing:.06em;text-transform:uppercase">Running Total</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>${foot}</tfoot>
      </table>
    </div>

    <style>
      .dr-num { padding: 9px 12px; text-align:right; font-family:var(--mono); font-size:12px; }
      #diff-report-wrap tbody tr { border-bottom:1px solid var(--border); }
      #diff-report-wrap tbody tr:hover { background:var(--s2); }
      #diff-report-wrap td { padding:9px 12px; }
    </style>
  `;
}
