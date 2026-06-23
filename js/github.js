// ══════════════════════════════════════════════════════════════════
// ENHANCED GITHUB PUSH — includes Manager + Petty + Custom data
// ══════════════════════════════════════════════════════════════════

// ── Constants must be declared first (const is NOT hoisted) ──
const GH_T='bt_gh_token', GH_R='bt_gh_repo', GH_P='bt_gh_path', GH_S='bt_gh_sha';
let _autoHandle = null;

// ── Fetch the current remote file (sha + parsed JSON), or null if it doesn't exist yet ──
async function fetchRemoteFile(headers, apiBase, path) {
  const r = await fetch(`${apiBase}/contents/${path}`, { headers });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('Cannot read remote file: HTTP ' + r.status);
  const file = await r.json();
  let data = null;
  if (!file.content || file.size > 900000) {
    const rawResp = await fetch(file.download_url);
    if (!rawResp.ok) throw new Error('HTTP ' + rawResp.status + ' (raw)');
    data = await rawResp.json();
  } else {
    const b64 = file.content.replace(/\n/g, '').replace(/\s/g, '');
    if (b64) data = JSON.parse(atob(b64));
  }
  return { sha: file.sha, data };
}

// ── Merge incoming remote data into the local in-memory + localStorage state ──
// Per-collection rules (unchanged from the original pull-only logic):
//   monthly/daily : remote wins per-field on existing records, new records added either way
//   staff         : remote is the source of truth; local-only IDs (not yet pushed) are kept
//   manager       : LOCAL wins on key collision (your unsaved edits aren't clobbered by remote)
//   petty         : remote wins per month
//   custom        : remote wins for existing sections; local-only sections are kept
// Returns counts so callers can log what changed.
function mergeIncomingData(data) {
  let mN=0,dN=0,mU=0,dU=0;
  if (data.monthly) data.monthly.forEach(m=>{
    const idx=MONTHLY.findIndex(x=>x.Month_Year===m.Month_Year);
    if(idx===-1){ MONTHLY.push(m); mN++; }
    else{ Object.assign(MONTHLY[idx],m); mU++; }
  });
  if (data.daily) data.daily.forEach(d=>{
    const idx=DAILY.findIndex(x=>x.Date===d.Date&&x.Month_Year===d.Month_Year);
    if(idx===-1){ DAILY.push(d); dN++; }
    else{ Object.assign(DAILY[idx],d); dU++; }
  });
  if (data.staff && data.staff.length) {
    const localStaff = JSON.parse(localStorage.getItem(STAFF_KEY) || '[]');
    const merged = [...data.staff];
    localStaff.forEach(le => { if (!merged.find(r => r.id === le.id)) merged.push(le); });
    STAFF = merged;
    localStorage.setItem(STAFF_KEY, JSON.stringify(STAFF));
  }
  if (data.manager) { const cur=JSON.parse(localStorage.getItem(MGR_KEY)||'{}'); localStorage.setItem(MGR_KEY, JSON.stringify(Object.assign({},data.manager,cur))); }
  if (data.petty)   { Object.entries(data.petty).forEach(([k,v])=>{ if (v != null) localStorage.setItem(k, JSON.stringify(v)); }); }
  if (data.custom)  { const localCus=JSON.parse(localStorage.getItem(CSEC_KEY)||'{}'); localStorage.setItem(CSEC_KEY, JSON.stringify(Object.assign({},localCus,data.custom))); }
  return {mN,dN,mU,dU};
}

async function pushToGitHub() {
  const cfg = ghCfg();
  if (!cfg) { toast('⚠ GitHub not configured','w'); return; }
  setSyncBadge('syncing');
  ghLog('Pushing to GitHub…');
  try {
    const headers = {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    };
    const apiBase = `https://api.github.com/repos/${cfg.repo}`;

    // ── Conflict check: has the remote moved since we last synced? ──
    // If another device/tab pushed since our last pull, blindly overwriting
    // with our local snapshot would silently discard their changes. Detect
    // that here and fold the remote changes in first, using the same
    // collection-level merge rules as a manual pull.
    let mergeNote = '';
    let remoteSha = null;
    try {
      const remote = await fetchRemoteFile(headers, apiBase, cfg.path);
      const lastKnownSha = localStorage.getItem(GH_S);
      if (remote) {
        remoteSha = remote.sha;
        if (lastKnownSha && remote.sha !== lastKnownSha && remote.data) {
          ghLog('⚠ Remote changed since last sync — merging before push…', 'info');
          const {mN,dN,mU,dU} = mergeIncomingData(remote.data);
          recomputeAllMonths(); // keep MONTHLY totals in sync with DAILY entries
          rebuildAll();
          idbSaveData();
          mergeNote = ` · merged remote: +${mN}/${mU}u months, +${dN}/${dU}u daily`;
        }
      }
    } catch(e) {
      ghLog('⚠ Could not check remote before push (' + e.message + ') — pushing anyway', 'info');
    }

    // Collect all petty months
    const pettyAll = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('mw_petty_')) pettyAll[k] = JSON.parse(localStorage.getItem(k) || 'null');
    }
    const payload = {
      monthly:  MONTHLY,
      daily:    DAILY,
      staff:    STAFF,
      manager:  JSON.parse(localStorage.getItem(MGR_KEY)  || '{}'),
      petty:    pettyAll,
      custom:   JSON.parse(localStorage.getItem(CSEC_KEY) || '{}'),
      pushedAt: new Date().toISOString()
    };
    const jsonStr = JSON.stringify(payload, null, 2);

    // ── Strategy: try Contents API first (simple); fall back to Git Data API for large files ──
    const tryContentsAPI = async () => {
      // Fresh SHA fetch
      let sha = null;
      try {
        const shaResp = await fetch(`${apiBase}/contents/${cfg.path}`, { headers });
        if (shaResp.ok) {
          const shaData = await shaResp.json();
          sha = shaData.sha;
          localStorage.setItem(GH_S, sha);
        }
      } catch(e) {}

      // Safe base64 encode (works for Unicode + large strings)
      const b64 = btoa(encodeURIComponent(jsonStr).replace(/%([0-9A-F]{2})/g,
        (_, p1) => String.fromCharCode('0x' + p1)));

      const body = {
        message: 'BT Sales IC — ' + new Date().toLocaleString('en-PK'),
        content: b64,
        branch: 'main'
      };
      if (sha) body.sha = sha;

      const r = await fetch(`${apiBase}/contents/${cfg.path}`, {
        method: 'PUT', headers, body: JSON.stringify(body)
      });
      if (!r.ok) {
        const e = await r.json();
        throw Object.assign(new Error(e.message || 'HTTP ' + r.status), { status: r.status, apiErr: e });
      }
      const res = await r.json();
      localStorage.setItem(GH_S, res.content.sha);
      return res.content.sha;
    };

    // Git Data API — no size limit, uses blobs + trees + commits
    // Self-healing: if the ref moved between read and write (another device/tab
    // pushed in the meantime), rebuild the commit on top of the new tip and
    // retry instead of failing immediately.
    const MAX_PUSH_ATTEMPTS = 4;
    const tryGitDataAPI = async (attempt = 1) => {
      ghLog('File large — using Git Data API…' + (attempt > 1 ? ` (retry ${attempt}/${MAX_PUSH_ATTEMPTS})` : ''));

      // 1. Get latest commit SHA on main branch
      const refResp = await fetch(`${apiBase}/git/refs/heads/main`, { headers });
      if (!refResp.ok) throw new Error('Cannot read branch ref: HTTP ' + refResp.status);
      const refData = await refResp.json();
      const latestCommitSha = refData.object.sha;

      // 2. Get base tree SHA from that commit
      const commitResp = await fetch(`${apiBase}/git/commits/${latestCommitSha}`, { headers });
      if (!commitResp.ok) throw new Error('Cannot read commit: HTTP ' + commitResp.status);
      const commitData = await commitResp.json();
      const baseTreeSha = commitData.tree.sha;

      // 3. Create a blob with the file content
      const blobResp = await fetch(`${apiBase}/git/blobs`, {
        method: 'POST', headers,
        body: JSON.stringify({ content: jsonStr, encoding: 'utf-8' })
      });
      if (!blobResp.ok) throw new Error('Cannot create blob: HTTP ' + blobResp.status);
      const blobData = await blobResp.json();

      // 4. Create a new tree referencing the blob
      const treeResp = await fetch(`${apiBase}/git/trees`, {
        method: 'POST', headers,
        body: JSON.stringify({
          base_tree: baseTreeSha,
          tree: [{ path: cfg.path, mode: '100644', type: 'blob', sha: blobData.sha }]
        })
      });
      if (!treeResp.ok) throw new Error('Cannot create tree: HTTP ' + treeResp.status);
      const treeData = await treeResp.json();

      // 5. Create a new commit, parented on whatever the tip was *just now*
      const newCommitResp = await fetch(`${apiBase}/git/commits`, {
        method: 'POST', headers,
        body: JSON.stringify({
          message: 'BT Sales IC — ' + new Date().toLocaleString('en-PK'),
          tree: treeData.sha,
          parents: [latestCommitSha]
        })
      });
      if (!newCommitResp.ok) throw new Error('Cannot create commit: HTTP ' + newCommitResp.status);
      const newCommitData = await newCommitResp.json();

      // 6. Update the branch ref to point to the new commit
      const updateRefResp = await fetch(`${apiBase}/git/refs/heads/main`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ sha: newCommitData.sha, force: false })
      });
      if (!updateRefResp.ok) {
        const refErr = await updateRefResp.json().catch(() => ({}));
        const refMsg = (refErr.message || '').toLowerCase();
        const isConflict = updateRefResp.status === 422
          || refMsg.includes('not a fast forward')
          || refMsg.includes('update is not');

        if (isConflict && attempt < MAX_PUSH_ATTEMPTS) {
          // Ref moved since step 1 — someone else pushed. Rebuild on the new
          // tip and try again rather than bothering the user.
          ghLog('Push conflict (ref moved) — rebuilding on latest tip…', 'info');
          return tryGitDataAPI(attempt + 1);
        }
        if (isConflict) {
          throw new Error('Push conflict — another device pushed repeatedly while retrying. Pull, then push again.');
        }
        throw new Error('Cannot update ref: HTTP ' + updateRefResp.status);
      }

      localStorage.setItem(GH_S, newCommitData.sha);
      return newCommitData.sha;
    };

    let finalSha;
    try {
      finalSha = await tryContentsAPI();
    } catch(e) {
      const msg = (e.message || '').toLowerCase();
      const isShaConflict = e.status === 409
        || msg.includes('does not match')
        || msg.includes('sha')
        || msg.includes('conflict');
      const isTooLarge = msg.includes('too large') || msg.includes('blob');
      // SHA conflict (409), too large (422), permission issue (403) → all use Git Data API
      if (e.status === 422 || e.status === 409 || e.status === 403 || isShaConflict || isTooLarge) {
        ghLog('Contents API rejected (' + (e.status || '?') + ') — switching to Git Data API…');
        finalSha = await tryGitDataAPI();
      } else {
        // Re-throw with friendly messages for unrecoverable errors
        let errMsg = e.message;
        if (e.status === 401) errMsg = 'Token invalid or expired — paste a new token in GitHub Sync settings';
        if (e.status === 403) errMsg = 'Token lacks write permission — regenerate with "repo" scope at github.com/settings/tokens';
        throw new Error(errMsg);
      }
    }

    ghLog('✓ Pushed successfully. SHA: ' + finalSha.slice(0, 8) + '…' + mergeNote, 'ok');
    setSyncBadge('ok');
    toast(mergeNote ? '✓ Merged & pushed to GitHub' : '✓ Pushed to GitHub');
    // Sync IDB cache and rebuild UI so all tabs reflect the pushed data
    rebuildAll();
    idbSaveData();
  } catch(e) {
    ghLog('✕ Push failed: ' + e.message, 'err');
    setSyncBadge('err');
    toast('✕ ' + e.message.slice(0, 60), 'e');
  }
}

// Restore manager/petty/custom on pull from GitHub
async function manualSync(silent=false) {
  const cfg = ghCfg();
  if (!cfg) { if (!silent) toast('⚠ GitHub not configured — go to Tools','w'); return; }
  setSyncBadge('syncing');
  ghLog('Fetching from GitHub…');
  try {
    const r = await fetch(`https://api.github.com/repos/${cfg.repo}/contents/${cfg.path}`,{
      headers:{Authorization:`Bearer ${cfg.token}`,Accept:'application/vnd.github.v3+json'}
    });
    if (r.status===404) { ghLog('File not found — will be created on first push.','info'); setSyncBadge('ok'); return; }
    if (!r.ok) throw new Error('HTTP '+r.status);
    const file = await r.json();
    localStorage.setItem(GH_S, file.sha);
    let data;
    if (!file.content || file.size > 900000) {
      const rawResp = await fetch(file.download_url);
      if (!rawResp.ok) throw new Error('HTTP '+rawResp.status+' (raw)');
      data = await rawResp.json();
    } else {
      const b64 = file.content.replace(/\n/g,'').replace(/\s/g,'');
      if (!b64) throw new Error('Empty file from GitHub');
      data = JSON.parse(atob(b64));
    }
    const {mN,dN,mU,dU} = mergeIncomingData(data);
    recomputeAllMonths(); // keep MONTHLY totals in sync with DAILY entries
    ghLog(`✓ Pulled. +${mN} new / ${mU} updated months · +${dN} new / ${dU} updated daily records.`,'ok');
    setSyncBadge('ok');
    rebuildAll();
    idbSaveData();
    if (!silent) toast('✓ Synced from GitHub');
  } catch(e){ ghLog('✕ Pull failed: '+e.message,'err'); setSyncBadge('err'); if(!silent) toast('✕ Pull failed: '+e.message,'e'); }
}

// ══════════════════════════════════════════

function ghCfg() {
  const t=localStorage.getItem(GH_T);
  if(!t) return null;
  return { token:t, repo:localStorage.getItem(GH_R)||'sysalmanyasin/BT-Sale-Data', path:localStorage.getItem(GH_P)||'data/sales.json' };
}

function ghLog(msg, cls='info') {
  const el=document.getElementById('ghlog'); if(!el) return;
  const t=new Date().toLocaleTimeString('en-PK',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  el.innerHTML+=`<div><span style="color:var(--accent)">[${t}]</span> <span style="color:${cls==='ok'?'var(--green)':cls==='err'?'var(--red)':'var(--t2)'}">${msg}</span></div>`;
  el.scrollTop=el.scrollHeight;
}

function setSyncBadge(state) {
  const sb=document.getElementById('synci'),si=document.getElementById('sync-icon'),st=document.getElementById('sync-text');
  if(!sb) return;
  sb.className='syncbadge '+state;
  if(state==='syncing'){si.textContent='↻';st.textContent='Syncing…';}
  else if(state==='ok'){si.textContent='✓';st.textContent='Synced';}
  else if(state==='err'){si.textContent='✕';st.textContent='Error';}
  else{si.textContent='🐙';st.textContent='GitHub';}
  if(state==='ok'||state==='err') setTimeout(()=>setSyncBadge('idle'),4000);
}

function updateGhBadge() {
  const ok=!!ghCfg();
  const b=document.getElementById('gh-badge');
  if(b){ b.className='badge '+(ok?'bg-green':'bg-amber'); b.textContent=ok?'Connected':'Not configured'; }
  setSyncBadge('idle');
  if(ok){ const si=document.getElementById('sync-icon'); if(si) si.textContent='🐙'; }
}

async function _legacyManualSync(silent=false) {
  const cfg=ghCfg();
  if(!cfg){ if(!silent) toast('⚠ GitHub not configured — go to Tools','w'); return; }
  setSyncBadge('syncing');
  ghLog('Fetching from GitHub…');
  try {
    const r=await fetch(`https://api.github.com/repos/${cfg.repo}/contents/${cfg.path}`,{
      headers:{Authorization:`Bearer ${cfg.token}`,Accept:'application/vnd.github.v3+json'}
    });
    if(r.status===404){ ghLog('File not found — will be created on first push.','info'); setSyncBadge('ok'); return; }
    if(!r.ok) throw new Error('HTTP '+r.status);
    const file=await r.json();
    localStorage.setItem(GH_S,file.sha);
    let data;
    if (!file.content || file.size > 900000) {
      // File exceeds GitHub Contents API 1MB limit — fetch raw via download_url
      const rawResp = await fetch(file.download_url);
      if (!rawResp.ok) throw new Error('HTTP ' + rawResp.status + ' (raw download)');
      data = await rawResp.json();
    } else {
      const b64 = file.content.replace(/\n/g, '').replace(/\s/g, '');
      if (!b64) throw new Error('Empty file content returned by GitHub API');
      data = JSON.parse(atob(b64));
    }
    let mN=0,dN=0;
    if(data.monthly) data.monthly.forEach(m=>{ if(!MONTHLY.find(x=>x.Month_Year===m.Month_Year)){ MONTHLY.push(m); mN++; }});
    if(data.daily)   data.daily.forEach(d=>{ if(!DAILY.find(x=>x.Date===d.Date&&x.Month_Year===d.Month_Year)){ DAILY.push(d); dN++; }});
    ghLog(`✓ Pulled. +${mN} months, +${dN} daily records.`,'ok');
    setSyncBadge('ok');
    rebuildAll();
    idbSaveData(); // persist synced data for next session
    if(!silent) toast('✓ Synced from GitHub');
  } catch(e){ ghLog('✕ Pull failed: '+e.message,'err'); setSyncBadge('err'); if(!silent) toast('✕ Pull failed: '+e.message,'e'); }
}

async function _legacyPushToGitHub() {
  const cfg=ghCfg();
  if(!cfg){ toast('⚠ GitHub not configured','w'); return; }
  setSyncBadge('syncing');
  ghLog('Pushing to GitHub…');
  try {
    const payload={monthly:MONTHLY,daily:DAILY,pushedAt:new Date().toISOString()};
    const content=btoa(unescape(encodeURIComponent(JSON.stringify(payload,null,2))));
    const sha=localStorage.getItem(GH_S);
    const body={message:'BT Sales IC — '+new Date().toLocaleString('en-PK'),content,branch:'main'};
    if(sha) body.sha=sha;
    const r=await fetch(`https://api.github.com/repos/${cfg.repo}/contents/${cfg.path}`,{
      method:'PUT',
      headers:{Authorization:`Bearer ${cfg.token}`,Accept:'application/vnd.github.v3+json','Content-Type':'application/json'},
      body:JSON.stringify(body)
    });
    if(!r.ok){ const e=await r.json(); throw new Error(e.message||'HTTP '+r.status); }
    const res=await r.json();
    localStorage.setItem(GH_S,res.content.sha);
    ghLog('✓ Pushed. SHA: '+res.content.sha.slice(0,8)+'…','ok');
    setSyncBadge('ok');
    toast('✓ Pushed to GitHub');
  } catch(e){ ghLog('✕ Push failed: '+e.message,'err'); setSyncBadge('err'); toast('✕ Push failed','e'); }
}

function saveGhConfig() {
  const t=document.getElementById('gh-token').value.trim();
  if(!t){ toast('⚠ Enter a GitHub token','w'); return; }
  localStorage.setItem(GH_T,t);
  localStorage.setItem(GH_R,document.getElementById('gh-repo').value.trim());
  localStorage.setItem(GH_P,document.getElementById('gh-path').value.trim());
  document.getElementById('gh-token').value='';
  document.getElementById('gh-token').placeholder='Token saved ✓ (paste new to update)';
  updateGhBadge();
  ghLog('✓ Config saved. Token stored in browser only.','ok');
  toast('✓ GitHub configured');
}

function clearGhConfig() {
  [GH_T,GH_R,GH_P,GH_S].forEach(k=>localStorage.removeItem(k));
  updateGhBadge();
  toast('Token cleared');
}

function saveAutoSettings() {
  localStorage.setItem('bt_auto_load',document.getElementById('auto-load').checked?'1':'0');
  localStorage.setItem('bt_auto_save',document.getElementById('auto-save').checked?'1':'0');
  localStorage.setItem('bt_auto_interval',document.getElementById('auto-interval').checked?'1':'0');
  startAutoInterval();
  toast('✓ Auto-sync settings saved');
}

function startAutoInterval() {
  if(_autoHandle) clearInterval(_autoHandle);
  if(localStorage.getItem('bt_auto_interval')==='1') _autoHandle=setInterval(()=>manualSync(true),30*60*1000);
}

