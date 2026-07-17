/**
 * CANA QC Tracker — Application logic
 * UI, sync, exports, and rendering.
 */
/* ============ STATE ============ */
let state = null;
let currentFarm = '';
let currentView = 'dashboard'; // 'dashboard' | 'allFarms' | 'farm'
let dashSubTab = 'overview'; // 'overview' | 'exports'
let currentFarmTab = 'qc'; // 'qc' | 'documents'
let docCategoryFilter = '';
let docSearchText = '';
let fileHandle = null;
let fileType = 'xlsx'; // 'xlsx' | 'json' — format of the currently linked file
let dashMonth = '';
let pendingOnly = false;
let searchText = '';
let viewMode = 'compact'; // 'compact' | 'full'
let filterStatus = '';
let filterDateFrom = '';
let filterDateTo = '';
let farmMonthFilter = '';
let expandedRows = {};
let modalDirty = false;
let appsScriptUrl = localStorage.getItem(APPS_SCRIPT_URL_KEY) || '';
let sheetViewUrl = localStorage.getItem(SHEET_VIEW_URL_KEY) || '';
let sheetPollTimer = null;
let sheetSaveTimer = null;
let sheetSaveInFlight = false;
let sheetSaveQueued = false;
let localDirty = false;
let lastRemoteJson = '';
let lastSyncTime = '';
let sheetSyncActive = false;
let sheetSyncOk = false;

/* ============ COMPUTE ============ */
function num(v){
  if(v===''||v===undefined||v===null) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function computeRow(rec){
  const bigsG=num(rec.bigsG), popsG=num(rec.popsG), scrapsG=num(rec.scrapsG),
        seedsG=num(rec.seedsG), moldG=num(rec.moldG), wasteG=num(rec.wasteG), startWt=num(rec.startWt);
  let totalFlower=null, totalOut=null, diff=null, yieldPct=null;
  if(bigsG!==null){
    totalFlower = bigsG + (popsG||0);
    totalOut = bigsG + (popsG||0) + (scrapsG||0) + (seedsG||0) + (moldG||0) + (wasteG||0);
  }
  if(startWt!==null && totalOut!==null){ diff = startWt - totalOut; }
  if(startWt!==null && startWt!==0 && totalFlower!==null){ yieldPct = totalFlower/startWt; }
  const month = rec.date ? formatMonth(rec.date) : '';
  return {totalFlower, totalOut, diff, yieldPct, month};
}

function formatMonth(dateStr){
  const d = new Date(dateStr+'T00:00:00');
  if(isNaN(d.getTime())) return '';
  const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[d.getMonth()]+' '+d.getFullYear();
}

function isPending(rec){
  // considered pending QC if manager has delivered (has a date or grossWt) but QC section is empty
  const hasDelivery = rec.date || rec.strain || rec.grossWt;
  const hasQC = rec.qcBy || rec.passFail || rec.bigsG || rec.startWt;
  return !!hasDelivery && !hasQC;
}

function fmtNum(v, dec){
  if(v===null||v===undefined||v==='') return '';
  const n = Number(v);
  if(isNaN(n)) return '';
  return n.toLocaleString(undefined,{maximumFractionDigits: dec===undefined?2:dec});
}
function fmtPct(v){
  if(v===null||v===undefined||v==='') return '';
  return (Number(v)*100).toFixed(1)+'%';
}
function esc(s){
  if(s===undefined||s===null) return '';
  return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function getFarmList(){
  if(state && Array.isArray(state.farmList) && state.farmList.length) return state.farmList;
  return DEFAULT_FARMS;
}
function suggestFarmCode(name){
  const words = String(name||'').trim().split(/\s+/).filter(Boolean);
  if(words.length >= 2) return words.map(w=>w[0]).join('').toUpperCase().slice(0,3);
  return String(name||'').trim().slice(0,2).toUpperCase();
}
function validateFarmName(name){
  const n = String(name||'').trim();
  if(!n) return 'Farm name is required / ต้องใส่ชื่อฟาร์ม';
  if(n.length > 50) return 'Name too long (max 50 characters)';
  if(/[:\\/?*\[\]]/.test(n)) return 'Name cannot contain : \\ / ? * [ ]';
  if(getFarmList().some(f=>f.toLowerCase()===n.toLowerCase())) return 'Farm already exists / มีฟาร์มนี้แล้ว';
  return '';
}
function farmCode(farm){
  if(state && state.farmCodes && state.farmCodes[farm]) return state.farmCodes[farm];
  return DEFAULT_FARM_CODES[farm] || farm.slice(0,2).toUpperCase();
}
function todayISO(){
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function batchDatePart(dateStr){
  if(dateStr) return dateStr.replace(/-/g,'').slice(2);
  return todayISO().replace(/-/g,'').slice(2);
}
function nextBatchSeqFor(farm, datePart, excludeId){
  let max = 0;
  (state.farms[farm]||[]).forEach(r=>{
    if(r.id === excludeId || !r.batchId) return;
    const m = r.batchId.match(/^[A-Z]{2,3}-(\d{6})-(\d{3})$/);
    if(m && m[1] === datePart) max = Math.max(max, parseInt(m[2],10));
  });
  return max + 1;
}
function computeBatchIdPreview(rec, farm, skipStored){
  if(!skipStored && rec.batchId) return rec.batchId;
  const datePart = batchDatePart(rec.date);
  const seq = nextBatchSeqFor(farm, datePart, rec.id);
  return farmCode(farm) + '-' + datePart + '-' + String(seq).padStart(3,'0');
}
function getBatchId(rec, farm){
  return rec.batchId || computeBatchIdPreview(rec, farm);
}
function assignBatchId(rec, farm){
  if(rec.batchId) return rec.batchId;
  rec.batchId = computeBatchIdPreview(rec, farm);
  return rec.batchId;
}
function getAllFarmRecords(){
  const out = [];
  getFarmList().forEach(farm=>{
    (state.farms[farm]||[]).forEach(rec=> out.push({rec, farm}));
  });
  return out;
}
function recordsForMonth(month, farmFilter){
  return getAllFarmRecords().filter(({rec, farm})=>{
    if(farmFilter && farm !== farmFilter) return false;
    return (rec.date ? formatMonth(rec.date) : '') === month;
  });
}
function exportRowValue(rec, farm, col){
  const c = computeRow(rec);
  if(col.key === 'batchId') return getBatchId(rec, farm);
  if(col.key === 'farm') return farm;
  if(col.computed){
    const v = c[col.key];
    if(col.pct) return v===null ? '' : Number((v*100).toFixed(2));
    return v===null ? '' : v;
  }
  if(col.num) return numOrBlank(rec[col.key]);
  return rec[col.key] || '';
}
function countPendingFarm(farm){
  return (state.farms[farm]||[]).filter(isPending).length;
}
function countPendingAll(){
  return getFarmList().reduce((n,f)=> n + countPendingFarm(f), 0);
}
function getRowStatus(rec){
  if(isPending(rec)) return {key:'pending', label:'Pending QC / รอ QC'};
  if(rec.passFail || rec.qcBy || rec.bigsG) return {key:'complete', label:'QC Complete / เสร็จแล้ว'};
  if(rec.date || rec.grossWt) return {key:'delivered', label:'Delivered / รับแล้ว'};
  return {key:'delivered', label:'Delivered / รับแล้ว'};
}
function passFailBadgeClass(rec){
  const pf = rec.passFail||'';
  if(pf.startsWith('Pass')) return 'pass';
  if(pf.startsWith('Fail')) return 'fail';
  if(pf.startsWith('Conditional')) return 'cond';
  return '';
}
function conditionBadge(rec){
  const c = rec.condition||'';
  if(c.startsWith('Good')) return {cls:'good', text:c};
  if(c.startsWith('Minor')) return {cls:'minor', text:c};
  if(c.startsWith('Damaged')) return {cls:'damaged', text:c};
  return null;
}
function labTestBadge(val){
  const v = val||'';
  if(v.startsWith('Pass')) return {cls:'pass', short:'Pass'};
  if(v.startsWith('Fail')) return {cls:'fail', short:'Fail'};
  if(v.startsWith('Conditional')) return {cls:'cond', short:'Cond'};
  if(v.startsWith('Pending')) return {cls:'pending', short:'Pending'};
  if(v.startsWith('Not tested')) return {cls:'', short:'N/T'};
  return null;
}
function renderLabTestBadges(rec){
  const ef = labTestBadge(rec.eurofinsTest);
  const tnr = labTestBadge(rec.tnrTest);
  const parts = [];
  parts.push(ef ? `<span class="cond-badge ${ef.cls}" title="Eurofins: ${esc(rec.eurofinsTest)}">E: ${ef.short}</span>` : `<span class="cond-badge" title="Eurofins">E: —</span>`);
  parts.push(tnr ? `<span class="cond-badge ${tnr.cls}" title="TNR: ${esc(rec.tnrTest)}">T: ${tnr.short}</span>` : `<span class="cond-badge" title="TNR">T: —</span>`);
  return `<span style="display:inline-flex;gap:4px;flex-wrap:wrap;">${parts.join('')}</span>`;
}
function resetSheetConnection(){
  localStorage.removeItem(APPS_SCRIPT_URL_KEY);
  localStorage.removeItem(SHEET_VIEW_URL_KEY);
  appsScriptUrl = '';
  sheetViewUrl = '';
  stopSheetPolling();
  lastRemoteJson = '';
  localDirty = false;
  updateConnPill();
}
function diffClass(diff){
  if(diff===null||diff===undefined||diff==='') return '';
  const n = Math.abs(Number(diff));
  if(isNaN(n)) return '';
  if(n > 50) return 'diff-bad';
  if(n > 5) return 'diff-warn';
  return '';
}
function matchesRecordFilters(r, farmCtx){
  const farmForBatch = farmCtx || currentFarm;
  if(pendingOnly && !isPending(r)) return false;
  if(filterStatus === 'pending' && !isPending(r)) return false;
  if(filterStatus === 'pass' && !(r.passFail||'').startsWith('Pass')) return false;
  if(filterStatus === 'fail' && !(r.passFail||'').startsWith('Fail')) return false;
  if(filterStatus === 'cond' && !(r.passFail||'').startsWith('Conditional')) return false;
  if(farmMonthFilter && (r.date?formatMonth(r.date):'') !== farmMonthFilter) return false;
  if(filterDateFrom && (r.date||'') < filterDateFrom) return false;
  if(filterDateTo && (r.date||'') > filterDateTo) return false;
  if(searchText){
    const hay = [r.strain,r.invoice,r.receivedBy,r.notes,r.qcBy,r.passFail,r.condition,r.eurofinsTest,r.tnrTest,getBatchId(r,farmForBatch)].join(' ').toLowerCase();
    if(!hay.includes(searchText.toLowerCase())) return false;
  }
  return true;
}
function sortRecords(records){
  return records.slice().sort((a,b)=>{
    const ap = isPending(a)?1:0, bp = isPending(b)?1:0;
    if(ap !== bp) return bp - ap;
    return (b.date||'').localeCompare(a.date||'');
  });
}
function updateConnPill(){
  const pill = document.getElementById('connPill');
  if(!pill) return;
  if(appsScriptUrl && sheetSyncActive && sheetSyncOk){
    pill.className = 'conn-pill ok sync';
    pill.innerHTML = 'Google Sheet Live ✓' + (lastSyncTime ? '<span class="sync-time">' + esc(lastSyncTime) + '</span>' : '');
  } else if(appsScriptUrl && sheetSyncActive){
    pill.className = 'conn-pill warn';
    pill.textContent = 'Sheet not syncing / ยังซิงค์ไม่ได้';
  } else if(appsScriptUrl){
    pill.className = 'conn-pill warn';
    pill.textContent = 'Sheet linked (paused) / หยุดชั่วคราว';
  } else if(fileHandlePending){
    pill.className = 'conn-pill warn';
    pill.textContent = 'Reconnect needed / ต้องเชื่อมใหม่';
  } else if(fileHandle){
    pill.className = 'conn-pill ok';
    pill.textContent = 'Excel linked ✓';
  } else {
    pill.className = 'conn-pill off';
    pill.textContent = 'Not linked / ยังไม่เชื่อม';
  }
  const openBtn = document.getElementById('btnOpenSheet');
  if(openBtn) openBtn.style.display = appsScriptUrl ? '' : 'none';
}
function toggleMoreMenu(open){
  const menu = document.getElementById('moreMenu');
  if(!menu) return;
  menu.classList.toggle('open', open !== undefined ? open : !menu.classList.contains('open'));
}
function ensureStateShape(){
  if(!state.farms) state.farms = {};
  if(!state.documents) state.documents = {};
  if(!state.farmList || !state.farmList.length) state.farmList = DEFAULT_FARMS.slice();
  if(!state.farmCodes) state.farmCodes = {...DEFAULT_FARM_CODES};
  getFarmList().forEach(f=>{
    if(!state.farms[f]) state.farms[f] = [];
    if(!state.documents[f]) state.documents[f] = [];
  });
  if(!currentFarm || !getFarmList().includes(currentFarm)) currentFarm = getFarmList()[0] || '';
}
function formatFileSize(bytes){
  if(!bytes) return '0 B';
  if(bytes < 1024) return bytes + ' B';
  if(bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB';
  return (bytes/(1024*1024)).toFixed(1) + ' MB';
}
function docFileIcon(doc){
  const m = (doc.mimeType||'').toLowerCase();
  const n = (doc.fileName||doc.title||'').toLowerCase();
  if(doc.url && !doc.data) return {cls:'link', icon:'🔗'};
  if(m.includes('pdf') || n.endsWith('.pdf')) return {cls:'pdf', icon:'📄'};
  if(m.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp)$/.test(n)) return {cls:'img', icon:'🖼️'};
  if(m.includes('sheet') || m.includes('excel') || /\.(xlsx?|csv)$/.test(n)) return {cls:'xls', icon:'📊'};
  return {cls:'', icon:'📎'};
}
function farmSubtabsHtml(){
  const docCount = (state.documents[currentFarm]||[]).length;
  return `<div class="farm-subtabs">
    <button type="button" class="${currentFarmTab==='qc'?'active':''}" id="btnFarmQc">📋 QC Records <span class="bi">/ บันทึก QC</span></button>
    <button type="button" class="${currentFarmTab==='documents'?'active':''}" id="btnFarmDocs">📁 Documents <span class="bi">/ เอกสาร</span>${docCount ? ' (' + docCount + ')' : ''}</button>
  </div>`;
}
function bindFarmSubtabs(root){
  const qc = root.querySelector('#btnFarmQc');
  const docs = root.querySelector('#btnFarmDocs');
  if(qc) qc.onclick = ()=>{ currentFarmTab='qc'; render(); };
  if(docs) docs.onclick = ()=>{ currentFarmTab='documents'; render(); };
}
function renderYieldChart(perFarm){
  const rows = perFarm.filter(r=>r.batches > 0 && r.avgYield !== null);
  if(!rows.length) return '<div style="color:var(--muted);font-size:12px;">No yield data for this month.</div>';
  const max = Math.max(...rows.map(r=>r.avgYield), 0.01);
  return '<div class="bar-chart">' + rows.map(r=>{
    const pct = Math.round(r.avgYield / max * 100);
    return `<div class="bar-row"><span class="lbl" title="${esc(r.farm)}">${esc(r.farm)}</span><div class="track"><div class="fill" style="width:${pct}%"></div></div><span class="val">${fmtPct(r.avgYield)}</span></div>`;
  }).join('') + '</div>';
}
function renderMoldChart(perFarm){
  const rows = perFarm.filter(r=>r.totalMold > 0);
  if(!rows.length) return '<div style="color:var(--muted);font-size:12px;">No mold recorded this month.</div>';
  const max = Math.max(...rows.map(r=>r.totalMold), 1);
  return '<div class="bar-chart">' + rows.map(r=>{
    const pct = Math.round(r.totalMold / max * 100);
    return `<div class="bar-row"><span class="lbl" title="${esc(r.farm)}">${esc(r.farm)}</span><div class="track"><div class="fill" style="width:${pct}%;background:linear-gradient(90deg,#f59e0b,#dc2626)"></div></div><span class="val">${fmtNum(r.totalMold)} g</span></div>`;
  }).join('') + '</div>';
}
function renderPassFailChart(total){
  const pass = total.pass, fail = total.fail, cond = total.cond;
  const sum = pass + fail + cond;
  if(!sum) return '<div style="color:var(--muted);font-size:12px;">No QC results for this month.</div>';
  const pW = (pass/sum*100).toFixed(1), fW = (fail/sum*100).toFixed(1), cW = (cond/sum*100).toFixed(1);
  return `<div class="stacked-bar">
    ${pass ? `<div class="seg" style="width:${pW}%;background:var(--pass)" title="Pass: ${pass}"></div>` : ''}
    ${cond ? `<div class="seg" style="width:${cW}%;background:var(--cond)" title="Conditional: ${cond}"></div>` : ''}
    ${fail ? `<div class="seg" style="width:${fW}%;background:var(--fail)" title="Fail: ${fail}"></div>` : ''}
  </div>
  <div class="stacked-legend">
    <span><i style="display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;background:var(--pass);vertical-align:-1px;"></i>Pass ${pass}</span>
    <span><i style="display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;background:var(--cond);vertical-align:-1px;"></i>Conditional ${cond}</span>
    <span><i style="display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;background:var(--fail);vertical-align:-1px;"></i>Fail ${fail}</span>
  </div>`;
}
function goToFarmMonth(farm, month){
  currentView = 'farm';
  currentFarmTab = 'qc';
  currentFarm = farm;
  farmMonthFilter = month;
  render();
}
function downloadDocument(doc){
  ensureDocData(doc).then(data=>{
    if(data){
      const mime = doc.mimeType || 'application/octet-stream';
      const blob = b64ToBlob(data, mime);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = doc.fileName || doc.title || 'document';
      a.click();
      setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
    } else if(doc.url){
      window.open(doc.url, '_blank', 'noopener');
    } else {
      alert('File is only on the device that uploaded it. Add a Google Drive URL for team access.\nไฟล์อยู่เฉพาะเครื่องที่อัปโหลด — ใส่ลิงก์ Google Drive สำหรับทีม');
    }
  });
}
function openDocument(doc){
  ensureDocData(doc).then(data=>{
    if(data){
      const mime = doc.mimeType || 'application/octet-stream';
      const blob = b64ToBlob(data, mime);
      window.open(URL.createObjectURL(blob), '_blank');
    } else if(doc.url){
      window.open(doc.url, '_blank', 'noopener');
    } else {
      alert('File is only on the device that uploaded it. Add a Google Drive URL for team access.\nไฟล์อยู่เฉพาะเครื่องที่อัปโหลด — ใส่ลิงก์ Google Drive สำหรับทีม');
    }
  });
}
function b64ToBlob(b64, mime){
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], {type:mime});
}
function readFileAsBase64(file){
  return new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onload = ()=>{
      const result = reader.result;
      const b64 = typeof result === 'string' && result.includes(',') ? result.split(',')[1] : '';
      resolve(b64);
    };
    reader.onerror = ()=>reject(reader.error);
    reader.readAsDataURL(file);
  });
}
function matchesDocFilters(doc){
  if(docCategoryFilter && doc.category !== docCategoryFilter) return false;
  if(docSearchText){
    const hay = [doc.title,doc.fileName,doc.notes,doc.category,doc.uploadedBy].join(' ').toLowerCase();
    if(!hay.includes(docSearchText.toLowerCase())) return false;
  }
  return true;
}
function stripDocsForSheet(documents){
  const out = {};
  getFarmList().forEach(f=>{
    out[f] = (documents[f]||[]).map(d=>({
      id: d.id,
      title: d.title || '',
      category: d.category || '',
      fileName: d.fileName || '',
      url: d.url || '',
      notes: d.notes || '',
      uploadedBy: d.uploadedBy || '',
      uploadedAt: d.uploadedAt || '',
      size: d.size || 0,
      mimeType: d.mimeType || '',
      hasLocalFile: !!(d.data || d._fileInIdb)
    }));
  });
  return out;
}
function mergeDocumentsFromRemote(remoteDocs){
  if(!remoteDocs) return;
  getFarmList().forEach(f=>{
    const local = state.documents[f] || [];
    const remote = remoteDocs[f] || [];
    const localById = Object.fromEntries(local.map(d=>[d.id, d]));
    const merged = remote.map(rd=>{
      const localDoc = localById[rd.id];
      if(localDoc && (localDoc.data || localDoc._fileInIdb)){
        return {...rd, _fileInIdb: true, data: localDoc.data || ''};
      }
      return rd;
    });
    const remoteIds = new Set(remote.map(d=>d.id));
    local.forEach(ld=>{
      if(!remoteIds.has(ld.id)) merged.push(ld);
    });
    state.documents[f] = merged;
  });
}

/* ============ GOOGLE SHEETS SYNC (via Apps Script) ============ */
function stateFingerprint(){
  return JSON.stringify({
    farms: state.farms,
    documents: stripDocsForSheet(state.documents),
    farmList: getFarmList(),
    farmCodes: state.farmCodes || {}
  });
}
function debouncedPushToSheet(){
  clearTimeout(sheetSaveTimer);
  sheetSaveTimer = setTimeout(()=> pushToGoogleSheet(true), 800);
}
function parseAppsScriptError(text, status){
  if(status === 401 || status === 403 || /ServiceLogin|accounts\.google/i.test(text)){
    return 'Access denied. Redeploy Apps Script → Who has access: Anyone (not only Google account).';
  }
  if(/ไม่พบเพจ|Page not found|could not open|405/i.test(text)){
    return 'Save failed (HTTP 405). Update Apps Script code and redeploy, then hard-refresh the app.';
  }
  return 'Invalid response from Google Sheet backend';
}
function utf8ToBase64(str){
  return btoa(unescape(encodeURIComponent(str)));
}
function gasPostXHR(url, body){
  return new Promise((resolve, reject)=>{
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'text/plain;charset=utf-8');
    xhr.onload = ()=>{
      const text = xhr.responseText || '';
      if(xhr.status >= 200 && xhr.status < 300){
        try { resolve(JSON.parse(text)); }
        catch(e){ reject(new Error(parseAppsScriptError(text, xhr.status))); }
      } else reject(new Error(parseAppsScriptError(text, xhr.status) + ' (HTTP ' + xhr.status + ')'));
    };
    xhr.onerror = ()=> reject(new Error('Network error calling Google Sheet'));
    xhr.send(body);
  });
}
async function callAppsScript(payload){
  if(!appsScriptUrl) throw new Error('No Apps Script URL configured');
  const body = JSON.stringify(payload);

  // Primary: GET write — same reliable path as Reload (POST often returns 405 from Vercel)
  if(payload.action === 'write'){
    const encoded = utf8ToBase64(body);
    if(encoded.length > 180000) throw new Error('Data too large to sync in one request');
    const url = appsScriptUrl
      + (appsScriptUrl.includes('?') ? '&' : '?')
      + 'action=write&payload=' + encodeURIComponent(encoded)
      + '&_=' + Date.now();
    const res = await fetch(url, { mode: 'cors', redirect: 'follow' });
    const text = await res.text();
    if(!res.ok) throw new Error(parseAppsScriptError(text, res.status) + ' (HTTP ' + res.status + ')');
    try { return JSON.parse(text); }
    catch(e){ throw new Error(parseAppsScriptError(text, res.status)); }
  }

  // POST fallback for read/other actions
  try {
    return await gasPostXHR(appsScriptUrl, body);
  } catch(xhrErr) {
    console.warn('XHR POST failed, trying fetch', xhrErr);
  }
  const res = await fetch(appsScriptUrl, {
    method: 'POST',
    mode: 'cors',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body
  });
  const text = await res.text();
  if(!res.ok) throw new Error(parseAppsScriptError(text, res.status) + ' (HTTP ' + res.status + ')');
  try { return JSON.parse(text); }
  catch(e){ throw new Error(parseAppsScriptError(text, res.status)); }
}
async function pullFromGoogleSheet(silent){
  if(!appsScriptUrl) return;
  const modalOpen = document.getElementById('modalRoot').innerHTML.trim() !== '';
  if(modalOpen || modalDirty) return;
  if(localDirty || sheetSaveInFlight) return;
  try{
    const url = appsScriptUrl + (appsScriptUrl.includes('?') ? '&' : '?') + 'action=read&_=' + Date.now();
    const res = await fetch(url, { mode: 'cors', redirect: 'follow' });
    const text = await res.text();
    if(!res.ok) throw new Error(parseAppsScriptError(text, res.status) + ' (HTTP ' + res.status + ')');
    let data;
    try { data = JSON.parse(text); }
    catch(e){ throw new Error(parseAppsScriptError(text, res.status)); }
    if(!data.ok || !data.farms) throw new Error(data.error || 'Read failed');
    sheetSyncOk = true;
    const fp = JSON.stringify({
      farms: data.farms,
      documents: data.documents || {},
      farmList: data.farmList || getFarmList(),
      farmCodes: data.farmCodes || {}
    });
    if(fp === lastRemoteJson) return;
    state.farms = data.farms;
    if(data.farmList && data.farmList.length) state.farmList = data.farmList;
    if(data.farmCodes) state.farmCodes = {...(state.farmCodes||{}), ...data.farmCodes};
    mergeDocumentsFromRemote(data.documents);
    ensureStateShape();
    lastRemoteJson = fp;
    saveLocal();
    render();
    lastSyncTime = new Date().toLocaleTimeString();
    updateConnPill();
    if(!silent) alert('Reloaded from Google Sheet.\nโหลดข้อมูลจาก Google Sheet แล้ว');
  }catch(e){
    sheetSyncOk = false;
    updateConnPill();
    console.warn('sheet pull failed', e);
    if(!silent) alert('Could not reload Google Sheet:\n' + e.message + '\n\nRedeploy Apps Script with access set to Anyone.\nไม่สามารถโหลด Google Sheet ได้');
  }
}
async function pushToGoogleSheet(silent){
  if(!appsScriptUrl) return;
  if(sheetSaveInFlight){ sheetSaveQueued = true; return; }
  sheetSaveInFlight = true;
  try{
    const payload = {
      action: 'write',
      state: {
        farms: state.farms,
        documents: stripDocsForSheet(state.documents),
        farmList: getFarmList(),
        farmCodes: state.farmCodes || {}
      }
    };
    const data = await callAppsScript(payload);
    if(!data.ok) throw new Error(data.error || 'Write failed');
    if(!data.updatedAt) throw new Error('Backend outdated — paste latest CANA_QC_GoogleAppsScript.gs in Apps Script, run upgradeDocumentsTab, redeploy.');
    localDirty = false;
    sheetSyncOk = true;
    lastRemoteJson = stateFingerprint();
    lastSyncTime = new Date().toLocaleTimeString();
    updateConnPill();
  }catch(e){
    sheetSyncOk = false;
    updateConnPill();
    console.warn('sheet push failed', e);
    if(!silent) alert('Could not save to Google Sheet:\n' + e.message + '\n\nFix: Apps Script → Deploy → Who has access: Anyone → copy new URL to config.json\nไม่สามารถบันทึกลง Google Sheet ได้');
  }finally{
    sheetSaveInFlight = false;
    if(sheetSaveQueued){ sheetSaveQueued = false; pushToGoogleSheet(silent); }
  }
}
function startSheetPolling(){
  stopSheetPolling();
  if(!appsScriptUrl) return;
  sheetSyncActive = true;
  updateConnPill();
  sheetPollTimer = setInterval(()=> pullFromGoogleSheet(true), SHEET_POLL_MS);
}
function stopSheetPolling(){
  sheetSyncActive = false;
  if(sheetPollTimer){ clearInterval(sheetPollTimer); sheetPollTimer = null; }
}

function addFarm(name, code){
  const err = validateFarmName(name);
  if(err) return err;
  const farm = String(name).trim();
  if(!state.farmList) state.farmList = getFarmList().slice();
  state.farmList.push(farm);
  if(!state.farmCodes) state.farmCodes = {...DEFAULT_FARM_CODES};
  const c = String(code||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,3)
    || suggestFarmCode(farm);
  state.farmCodes[farm] = c;
  state.farms[farm] = state.farms[farm] || [];
  state.documents[farm] = state.documents[farm] || [];
  currentFarm = farm;
  currentView = 'farm';
  onDataChanged();
  return '';
}
function removeFarm(farm){
  const recs = (state.farms[farm]||[]).length;
  const docs = (state.documents[farm]||[]).length;
  if(recs || docs) return 'Remove all QC records and documents first / ลบข้อมูล QC และเอกสารก่อน';
  if(getFarmList().length <= 1) return 'Cannot remove the last farm / ลบฟาร์มสุดท้ายไม่ได้';
  state.farmList = getFarmList().filter(f=>f!==farm);
  delete state.farms[farm];
  delete state.documents[farm];
  if(state.farmCodes) delete state.farmCodes[farm];
  if(currentFarm === farm){
    currentFarm = getFarmList()[0] || '';
    currentView = currentFarm ? 'farm' : 'dashboard';
  }
  onDataChanged();
  return '';
}
function openManageFarmsModal(){
  modalDirty = true;
  const root = document.getElementById('modalRoot');
  const list = getFarmList();
  root.innerHTML = `
  <div class="overlay" id="overlay">
    <div class="modal" style="max-width:560px">
      <h2>🏡 Manage Farms / จัดการฟาร์ม</h2>
      <div class="sub">Add new supplier farms — syncs to Google Sheet for the whole team<br>เพิ่มฟาร์มใหม่ — ซิงค์ไป Google Sheet ให้ทั้งทีม</div>
      <div class="farm-manage-list">
        ${list.map(f=>{
          const n = (state.farms[f]||[]).length;
          const d = (state.documents[f]||[]).length;
          const empty = !n && !d;
          return `<div class="farm-manage-row">
            <div>
              <strong>${esc(f)}</strong>
              <span class="farm-manage-meta">Batch code: ${esc(farmCode(f))} · ${n} QC · ${d} docs</span>
            </div>
            ${empty ? `<button type="button" class="small danger" data-remove-farm="${esc(f)}">Remove</button>` : `<span class="farm-manage-meta" title="Clear data first">Has data</span>`}
          </div>`;
        }).join('')}
      </div>
      <form id="addFarmForm" class="farm-add-form">
        <label>Farm name / ชื่อฟาร์ม
          <input type="text" name="name" placeholder="e.g. Sunrise Farm" required maxlength="50" autocomplete="off">
        </label>
        <label>Batch ID code (optional) / รหัส Batch
          <input type="text" name="code" placeholder="e.g. SF" maxlength="3" pattern="[A-Za-z0-9]{2,3}" autocomplete="off">
        </label>
        <p class="farm-add-hint">Batch IDs look like <b>SF-260717-001</b>. If empty, a code is suggested automatically.</p>
        <div class="modal-actions">
          <button type="button" class="ghost" id="btnCloseManageFarms">Close</button>
          <button type="submit" class="primary">+ Add Farm</button>
        </div>
      </form>
    </div>
  </div>`;
  const close = ()=>{ modalDirty = false; closeModal(); };
  root.querySelector('#btnCloseManageFarms').onclick = close;
  root.querySelector('#overlay').onclick = (e)=>{ if(e.target.id==='overlay') close(); };
  root.querySelectorAll('[data-remove-farm]').forEach(btn=>{
    btn.onclick = ()=>{
      const farm = btn.dataset.removeFarm;
      if(!confirm('Remove farm "' + farm + '"?\nลบฟาร์ม "' + farm + '"?')) return;
      const err = removeFarm(farm);
      if(err){ alert(err); return; }
      close();
      render();
    };
  });
  const form = root.querySelector('#addFarmForm');
  const nameInput = form.querySelector('[name=name]');
  const codeInput = form.querySelector('[name=code]');
  nameInput.oninput = ()=>{
    if(!codeInput.value.trim()) codeInput.placeholder = suggestFarmCode(nameInput.value) || 'e.g. SF';
  };
  form.onsubmit = (e)=>{
    e.preventDefault();
    const name = form.querySelector('[name=name]').value;
    const code = form.querySelector('[name=code]').value;
    const err = addFarm(name, code);
    if(err){ alert(err); return; }
    close();
    render();
    alert('Farm added: ' + name.trim() + '\nเพิ่มฟาร์มแล้ว — ข้อมูลจะซิงค์ไป Google Sheet');
  };
}

function openSheetSetupGuide(){
  const root = document.getElementById('modalRoot');
  root.innerHTML = `
  <div class="overlay" id="overlay">
    <div class="modal" style="max-width:720px">
      <h2>📗 Google Sheet Setup — Real-time team sync</h2>
      <div class="sub">ทีมทุกคนดูข้อมูลเดียวกันแบบ real-time ผ่าน Google Sheet</div>
      <div class="helpbox">
        <h3>Step 1 — Google Sheet / สร้าง Google Sheet</h3>
        <b>Option A (recommended):</b> Upload <b>CANA QC Tracker v4.xlsx</b> to Google Drive → Open with Google Sheets<br>
        <b>Option B:</b> Create blank sheet at sheets.google.com named <b>"CANA QC Tracker"</b><br>
        อัปโหลดไฟล์ v4.xlsx ไป Google Drive แล้วเปิดด้วย Google Sheets (แนะนำ)
        <h3>Step 2 — Install backend script / ติดตั้งสคริปต์</h3>
        In the sheet: <b>Extensions → Apps Script</b><br>
        Copy all code from <b>CANA_QC_GoogleAppsScript.gs</b> (in same folder as this app)<br>
        Change <code>SPREADSHEET_ID</code> to your Sheet ID (from the URL)<br>
        If you used v4.xlsx: click <b>Run → migrateV4Sheets</b> (keeps your data, cleans format)<br>
        After updating script: click <b>Run → upgradeSheetHeaders</b> (adds Eurofins + TNR columns)<br>
        If new blank sheet: click <b>Run → setupSheets</b><br>
        <h3>Step 3 — Deploy web app / Deploy</h3>
        <b>Deploy → New deployment → Web app</b> (or Manage deployments → Edit → New version if redeploying)<br>
        Execute as: <b>Me</b> · Who has access: <b>Anyone</b> (required for Vercel — not “Anyone with Google account”)<br>
        Copy the <b>Web App URL</b> (ends with /exec)
        <h3>Step 4 — Deploy app on Vercel / Deploy แอป</h3>
        Push this folder to GitHub → import on <b>vercel.com</b> → team opens your Vercel link<br>
        Edit <code>config.json</code> with your Web App URL — team auto-connects, no paste needed<br>
        อัปโหลดโปรเจกต์ขึ้น Vercel แล้วแชร์ลิงก์ให้ทีม
        <h3>Step 5 — Share with team / แชร์ให้ทีม</h3>
        Share the Google Sheet with all staff as <b>Editor</b><br>
        Each staff member: open this app → click <b>Google Sheet</b> → paste the Web App URL<br>
        <h3>Step 6 — Real-time sync / ซิงค์อัตโนมัติ</h3>
        App auto-syncs every <b>${SHEET_POLL_MS/1000} seconds</b>. Status shows <b>Google Sheet Live ✓</b><br>
        แอปซิงค์อัตโนมัติทุก ${SHEET_POLL_MS/1000} วินาที — ทุกคนเห็นข้อมูลเดียวกัน<br>
        <b>Note:</b> Documents tab stays in browser only. QC data goes to Google Sheet.
      </div>
      <div class="modal-actions">
        <button type="button" id="cancelBtn">Close / ปิด</button>
        <button type="button" class="primary" id="btnGuideLink">Connect now / เชื่อมตอนนี้</button>
      </div>
    </div>
  </div>`;
  document.getElementById('cancelBtn').onclick = closeModal;
  document.getElementById('overlay').addEventListener('mousedown', (e)=>{ if(e.target.id==='overlay') closeModal(); });
  document.getElementById('btnGuideLink').onclick = ()=>{ closeModal(); openLinkSheetModal(); };
}
function openLinkSheetModal(){
  const root = document.getElementById('modalRoot');
  root.innerHTML = `
  <div class="overlay" id="overlay">
    <div class="modal">
      <h2>📗 Connect Google Sheet / เชื่อม Google Sheet</h2>
      <div class="sub">Paste the Web App URL from Apps Script deployment</div>
      <div class="ctx" style="margin-bottom:12px;font-size:12px;">
        <b>Need a new link?</b> Apps Script → Deploy → Manage deployments → copy Web App URL (/exec)<br>
        Then update <code>config.json</code> on GitHub/Vercel and click <b>Test connection</b> below.<br>
        <span class="bi">ถ้า link cũ không work: Deploy lại Apps Script → copy URL mới → Test connection</span>
      </div>
      <form id="linkSheetForm">
        <div class="form-grid">
          <div class="field full">
            <label>Web App URL <span>URL จาก Deploy → Web app</span></label>
            <input type="url" name="url" value="${esc(appsScriptUrl)}" placeholder="https://script.google.com/macros/s/...../exec" required>
          </div>
          <div class="field full">
            <label>Google Sheet URL <span>ลิงก์เปิดชีต (ไม่บังคับ)</span></label>
            <input type="url" name="sheetUrl" value="${esc(sheetViewUrl)}" placeholder="https://docs.google.com/spreadsheets/d/...../edit">
          </div>
        </div>
        <p style="font-size:12px;color:var(--muted);margin:12px 0 0;">First time? Click <b>More → Google Sheet Setup</b> for full instructions.<br>ครั้งแรก? กด More → Google Sheet Setup เพื่อดูวิธีตั้งค่า</p>
        <div class="modal-actions">
          <button type="button" id="btnResetConn">Reset / รีเซ็ต</button>
          <button type="button" id="btnTestConn">Test connection / ทดสอบ</button>
          <button type="button" id="cancelBtn">Cancel / ยกเลิก</button>
          <button type="submit" class="primary">Connect / เชื่อมต่อ</button>
        </div>
      </form>
    </div>
  </div>`;
  document.getElementById('cancelBtn').onclick = closeModal;
  document.getElementById('btnResetConn').onclick = ()=>{ resetSheetConnection(); alert('Connection cleared. Paste new URL and Connect.\nล้างการเชื่อมต่อแล้ว ใส่ URL ใหม่'); };
  document.getElementById('btnTestConn').onclick = async ()=>{
    const url = (document.querySelector('#linkSheetForm input[name=url]')||{}).value||appsScriptUrl;
    if(!url){ alert('Enter Web App URL first'); return; }
    try{
      const old = appsScriptUrl;
      appsScriptUrl = url.trim();
      await testSheetConnection();
      appsScriptUrl = old;
      alert('Connection OK! Click Connect to save.\nเชื่อมต่อได้แล้ว กด Connect เพื่อบันทึก');
    }catch(e){
      alert('Connection failed:\n' + e.message + '\n\nRedeploy Apps Script (New version) and copy fresh /exec URL.');
    }
  };
  document.getElementById('overlay').addEventListener('mousedown', (e)=>{ if(e.target.id==='overlay') closeModal(); });
  document.getElementById('linkSheetForm').onsubmit = async (e)=>{
    e.preventDefault();
    const url = new FormData(e.target).get('url').trim();
    if(!url.includes('script.google.com')){ alert('Please paste a valid Apps Script Web App URL.\nกรุณาใส่ URL ที่ถูกต้อง'); return; }
    appsScriptUrl = url.split('#')[0];
    sheetViewUrl = (new FormData(e.target).get('sheetUrl') || '').trim();
    localStorage.setItem(APPS_SCRIPT_URL_KEY, appsScriptUrl);
    if(sheetViewUrl) localStorage.setItem(SHEET_VIEW_URL_KEY, sheetViewUrl);
    closeModal();
    try{
      await pullFromGoogleSheet(true);
      lastRemoteJson = stateFingerprint();
      localDirty = false;
      startSheetPolling();
      updateConnPill();
      alert('Connected! Data syncs every ' + (SHEET_POLL_MS/1000) + ' seconds. All team members can use the same Web App URL.\nเชื่อมต่อแล้ว! ข้อมูลซิงค์อัตโนมัติทุก ' + (SHEET_POLL_MS/1000) + ' วินาที');
    }catch(err){
      alert('Connection failed. Check the URL and that the script is deployed.\nเชื่อมต่อไม่สำเร็จ');
    }
  };
}
function openGoogleSheetInBrowser(){
  const url = sheetViewUrl || localStorage.getItem(SHEET_VIEW_URL_KEY);
  if(url) window.open(url, '_blank', 'noopener');
  else alert('Add your Google Sheet URL when connecting (optional field), or open it from Google Drive.\nใส่ URL ของ Google Sheet ตอนเชื่อมต่อ หรือเปิดจาก Google Drive');
}

/* ============ PERSISTENCE ============ */
function buildStateForStorage(){
  const documents = {};
  getFarmList().forEach(f=>{
    documents[f] = (state.documents[f]||[]).map(d=>{
      const copy = {...d};
      if(copy.data){ copy._fileInIdb = true; delete copy.data; }
      return copy;
    });
  });
  return {
    farms: state.farms,
    documents,
    farmList: getFarmList(),
    farmCodes: state.farmCodes || {}
  };
}
function saveLocal(){
  (state.documents && getFarmList().forEach(f=>{
    (state.documents[f]||[]).forEach(doc=>{
      if(doc.data) idbSetDocData(doc.id, doc.data);
    });
  }));
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify(buildStateForStorage()));
    document.getElementById('lastSavedTag') && (document.getElementById('lastSavedTag').textContent = 'Saved locally ' + new Date().toLocaleTimeString());
  }catch(e){
    if(e && e.name === 'QuotaExceededError'){
      alert('Browser storage full. Use <b>External URL</b> (Google Drive link) instead of uploading large files.\nพื้นที่เก็บข้อมูลเต็ม — ใช้ลิงก์ Google Drive แทนการอัปโหลดไฟล์');
    }
    console.warn('saveLocal failed', e);
  }
}
function loadLocal(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw) return JSON.parse(raw);
  }catch(e){ console.warn('local load failed', e); }
  return null;
}
async function hydrateDocumentsFromIdb(){
  if(!state || !state.documents) return;
  for(const f of getFarmList()){
    for(const doc of (state.documents[f]||[])){
      if((doc._fileInIdb || doc.hasLocalFile) && !doc.data){
        doc.data = await idbGetDocData(doc.id) || '';
        if(doc.data) doc._fileInIdb = true;
      }
    }
  }
}
async function ensureDocData(doc){
  if(doc.data) return doc.data;
  if(doc._fileInIdb || doc.hasLocalFile){
    doc.data = await idbGetDocData(doc.id) || '';
    return doc.data;
  }
  return '';
}
function onDataChanged(){
  saveLocal();
  localDirty = true;
  if(appsScriptUrl){ debouncedPushToSheet(); }
  if(fileHandle){ debouncedSaveToFile(); }
}
let saveFileTimer=null;
function debouncedSaveToFile(){
  clearTimeout(saveFileTimer);
  saveFileTimer = setTimeout(saveDataFile, 700);
}

/* ---- remember the linked file across sessions (IndexedDB) so staff don't have to re-link every time ---- */
const IDB_NAME = 'cana_qc_handle_db', IDB_STORE = 'handles', IDB_DOC_STORE = 'docFiles', IDB_KEY = 'linkedFile';
function idbOpen(){
  return new Promise((resolve,reject)=>{
    const req = indexedDB.open(IDB_NAME, 2);
    req.onupgradeneeded = (e)=>{
      const db = e.target.result;
      if(!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      if(!db.objectStoreNames.contains(IDB_DOC_STORE)) db.createObjectStore(IDB_DOC_STORE);
    };
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=> reject(req.error);
  });
}
async function idbSetDocData(id, b64){
  if(!id || !b64) return;
  try{
    const db = await idbOpen();
    await new Promise((res,rej)=>{
      const tx = db.transaction(IDB_DOC_STORE,'readwrite');
      tx.objectStore(IDB_DOC_STORE).put(b64, id);
      tx.oncomplete=res; tx.onerror=()=>rej(tx.error);
    });
  }catch(e){ console.warn('idb doc save failed', e); }
}
async function idbGetDocData(id){
  if(!id) return '';
  try{
    const db = await idbOpen();
    return await new Promise((res,rej)=>{
      const tx = db.transaction(IDB_DOC_STORE,'readonly');
      const req = tx.objectStore(IDB_DOC_STORE).get(id);
      req.onsuccess = ()=> res(req.result || '');
      req.onerror = ()=> rej(req.error);
    });
  }catch(e){ console.warn('idb doc load failed', e); return ''; }
}
async function idbDeleteDocData(id){
  if(!id) return;
  try{
    const db = await idbOpen();
    await new Promise((res,rej)=>{
      const tx = db.transaction(IDB_DOC_STORE,'readwrite');
      tx.objectStore(IDB_DOC_STORE).delete(id);
      tx.oncomplete=res; tx.onerror=()=>rej(tx.error);
    });
  }catch(e){ console.warn('idb doc delete failed', e); }
}
async function idbSetHandle(handle){
  try{
    const db = await idbOpen();
    await new Promise((res,rej)=>{
      const tx = db.transaction(IDB_STORE,'readwrite');
      tx.objectStore(IDB_STORE).put(handle, IDB_KEY);
      tx.oncomplete=res; tx.onerror=()=>rej(tx.error);
    });
  }catch(e){ console.warn('idb set failed', e); }
}
async function idbGetHandle(){
  try{
    const db = await idbOpen();
    return await new Promise((res,rej)=>{
      const tx = db.transaction(IDB_STORE,'readonly');
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = ()=>res(req.result||null);
      req.onerror = ()=>rej(req.error);
    });
  }catch(e){ return null; }
}

let fileHandlePending = null;
async function tryAutoReconnect(){
  if(!window.showOpenFilePicker || !('indexedDB' in window)) return;
  const handle = await idbGetHandle();
  if(!handle) return;
  try{
    const perm = await handle.queryPermission({mode:'readwrite'});
    if(perm === 'granted'){
      fileHandle = handle;
      fileType = handle.name.toLowerCase().endsWith('.json') ? 'json' : 'xlsx';
      await reloadFromFile(true);
      updateStatusLine('Linked to: ' + handle.name);
    } else if(perm === 'prompt'){
      fileHandlePending = handle;
      const btn = document.getElementById('btnReconnect');
      btn.textContent = '🔌 Reconnect: ' + handle.name;
      btn.className = 'reconnect';
      btn.style.display = '';
    }
  }catch(e){ console.warn('auto reconnect failed', e); }
}
async function reconnectFile(){
  if(!fileHandlePending) return;
  try{
    const perm = await fileHandlePending.requestPermission({mode:'readwrite'});
    if(perm === 'granted'){
      fileHandle = fileHandlePending;
      fileType = fileHandle.name.toLowerCase().endsWith('.json') ? 'json' : 'xlsx';
      fileHandlePending = null;
      document.getElementById('btnReconnect').style.display = 'none';
      await reloadFromFile(true);
      updateStatusLine('Linked to: ' + fileHandle.name);
    }
  }catch(e){ console.warn(e); }
}

/* ---- pull the latest data your teammates saved ---- */
async function reloadFromFile(silent){
  if(!fileHandle) return;
  const modalOpen = document.getElementById('modalRoot').innerHTML.trim() !== '';
  if(modalOpen) return; // don't yank data out from under someone mid-edit
  try{
    const file = await fileHandle.getFile();
    const name = file.name.toLowerCase();
    if(name.endsWith('.json')){
      const text = await file.text();
      const parsed = JSON.parse(text);
      if(parsed && parsed.farms) state = parsed;
    } else {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, {type:'array', cellDates:true});
      state = parseWorkbookToState(wb);
    }
    ensureStateShape();
    saveLocal();
    render();
    if(!silent) updateStatusLine('Reloaded latest from: ' + fileHandle.name + ' — ' + new Date().toLocaleTimeString());
  }catch(e){
    console.warn('reload failed', e);
    if(!silent) alert('Could not reload the file. It may have been moved, renamed, or you may need to relink.\nไม่สามารถโหลดไฟล์ได้ อาจถูกย้าย/เปลี่ยนชื่อ หรือต้องเชื่อมไฟล์ใหม่');
  }
}

async function openDataFile(){
  if(!window.showOpenFilePicker){
    alert('Your browser doesn\'t support linking directly to a file (this works in Chrome/Edge). Please use Export JSON / Import JSON instead to pass data between devices.');
    return;
  }
  try{
    const [handle] = await window.showOpenFilePicker({types:[
      {description:'CANA QC Tracker (Excel)', accept:{'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':['.xlsx']}},
      {description:'QC Tracker Data (legacy JSON)', accept:{'application/json':['.json']}}
    ]});
    fileHandle = handle;
    const file = await handle.getFile();
    const name = file.name.toLowerCase();
    if(name.endsWith('.json')){
      fileType = 'json';
      const text = await file.text();
      const parsed = JSON.parse(text);
      if(parsed && parsed.farms) state = parsed;
    } else {
      fileType = 'xlsx';
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, {type:'array', cellDates:true});
      state = parseWorkbookToState(wb);
    }
    ensureStateShape();
    saveLocal();
    render();
    updateStatusLine('Linked to: ' + handle.name);
    idbSetHandle(handle);
  }catch(e){
    if(e.name !== 'AbortError') console.warn(e);
  }
}
let saveInFlight = false;
let saveQueuedAgain = false;
async function saveDataFile(){
  if(!fileHandle){ return saveDataFileAs(); }
  // Never allow two createWritable() streams on the same handle at once — that's how the
  // linked file gets corrupted (a second save truncating the file while the first is mid-write).
  if(saveInFlight){ saveQueuedAgain = true; return; }
  saveInFlight = true;
  try{
    const writable = await fileHandle.createWritable();
    if(fileType === 'json'){
      await writable.write(JSON.stringify(state, null, 2));
    } else {
      const wb = buildWorkbook();
      const wbout = XLSX.write(wb, {bookType:'xlsx', type:'array'});
      // Guarantee a proper binary buffer is written regardless of what shape SheetJS returns.
      const bytes = new Uint8Array(wbout);
      if(bytes.length < 100) throw new Error('Generated Excel file looked empty/corrupt (' + bytes.length + ' bytes) — save aborted to avoid overwriting your data with a bad file.');
      await writable.write(bytes);
    }
    await writable.close();
    updateStatusLine('Linked to: ' + fileHandle.name + ' — saved ' + new Date().toLocaleTimeString());
  }catch(e){
    console.warn('save to file failed', e);
    updateStatusLine('⚠️ Save failed — ' + (e && e.message ? e.message : 'unknown error') + '. Try Save again, or re-link the file.');
    alert('Could not save to the linked file. Please click Save again, or use Link Excel File to reconnect.\nไม่สามารถบันทึกลงไฟล์ที่เชื่อมไว้ได้ กรุณากด Save อีกครั้ง หรือเชื่อมไฟล์ใหม่');
  }finally{
    saveInFlight = false;
    if(saveQueuedAgain){ saveQueuedAgain = false; saveDataFile(); }
  }
}
async function saveDataFileAs(){
  if(!window.showSaveFilePicker){
    alert('Your browser doesn\'t support saving directly to a file (this works in Chrome/Edge). Please use Export to Excel or Export JSON instead.');
    return;
  }
  try{
    const handle = await window.showSaveFilePicker({suggestedName:'Cana QC tracker.xlsx', types:[
      {description:'CANA QC Tracker (Excel)', accept:{'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':['.xlsx']}}
    ]});
    fileHandle = handle;
    fileType = 'xlsx';
    await saveDataFile();
    idbSetHandle(handle);
  }catch(e){ if(e.name!=='AbortError') console.warn(e); }
}
function updateStatusLine(msg){
  updateConnPill();
}

function exportJSON(){
  const blob = new Blob([JSON.stringify(state,null,2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'cana-qc-data.json';
  a.click();
}
function importJSONFile(evt){
  const file = evt.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const parsed = JSON.parse(reader.result);
      if(!parsed.farms) throw new Error('bad format');
      state = parsed;
      fileHandle = null;
      ensureStateShape();
      getFarmList().forEach(f=>{
        (state.documents[f]||[]).forEach(doc=>{
          if(doc.data) idbSetDocData(doc.id, doc.data);
        });
      });
      saveLocal();
      hydrateDocumentsFromIdb().then(()=>{
        render();
        updateStatusLine('Loaded from imported file: ' + file.name);
      });
    }catch(e){ alert('Could not read that file — is it a CANA QC Tracker JSON export?'); }
  };
  reader.readAsText(file);
  evt.target.value = '';
}

/* ============ EXCEL READ/WRITE ============ */
function excelDateToISO(v){
  if(Object.prototype.toString.call(v)==='[object Date]' && !isNaN(v.getTime())){
    return v.getUTCFullYear()+'-'+String(v.getUTCMonth()+1).padStart(2,'0')+'-'+String(v.getUTCDate()).padStart(2,'0');
  }
  if(typeof v === 'number' && isFinite(v)){
    const utcDays = Math.floor(v - 25569);
    const d = new Date(utcDays*86400*1000);
    return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0')+'-'+String(d.getUTCDate()).padStart(2,'0');
  }
  if(typeof v === 'string'){
    const m = v.match(/^(\d{4}-\d{2}-\d{2})/);
    if(m) return m[1];
    const d = new Date(v);
    if(!isNaN(d.getTime())) return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }
  return '';
}

function numOrBlank(v){
  if(v===''||v===undefined||v===null) return '';
  const n = Number(v);
  return isNaN(n) ? '' : n;
}

function buildWorkbook(){
  const wb = XLSX.utils.book_new();
  getFarmList().forEach(farm=>{
    const rows = [XLSX_HEADER];
    (state.farms[farm]||[]).forEach(rec=>{
      const c = computeRow(rec);
      rows.push([
        rec.date||'', rec.strain||'', numOrBlank(rec.bigsCount), numOrBlank(rec.popsCount), numOrBlank(rec.grossWt), rec.condition||'', rec.eurofinsTest||'', rec.tnrTest||'', rec.invoice||'', rec.receivedBy||'', rec.notes||'',
        rec.qcStart||'', rec.qcEnd||'', numOrBlank(rec.startWt), numOrBlank(rec.bigsG), numOrBlank(rec.popsG), numOrBlank(rec.scrapsG), numOrBlank(rec.seedsG), numOrBlank(rec.moldG), numOrBlank(rec.wasteG), rec.passFail||'', rec.qcBy||'',
        c.totalFlower===null?'':c.totalFlower, c.totalOut===null?'':c.totalOut, c.diff===null?'':c.diff, c.yieldPct===null?'':Number((c.yieldPct*100).toFixed(2)), c.month||''
      ]);
    });
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, farm.slice(0,31));
  });

  // Dashboard sheet for currently selected month
  const month = dashMonth || currentMonthLabel();
  const dashHeader = ['Farm','Batches','Total Start (g)','Total Bigs (g)','Total Pops (g)','Total Flower (g)','Avg Yield %','Total Mold (g)','Pass','Fail','Conditional'];
  const dashRows = [ ['Filter Month:', month], [], dashHeader ];
  const summary = computeDashboard(month);
  summary.perFarm.forEach(r=>{
    dashRows.push([r.farm, r.batches, r.totalStart, r.totalBigs, r.totalPops, r.totalFlower, r.avgYield===null?'':Number((r.avgYield*100).toFixed(2)), r.totalMold, r.pass, r.fail, r.cond]);
  });
  dashRows.push(['TOTAL', summary.total.batches, summary.total.totalStart, summary.total.totalBigs, summary.total.totalPops, summary.total.totalFlower, summary.total.avgYield===null?'':Number((summary.total.avgYield*100).toFixed(2)), summary.total.totalMold, summary.total.pass, summary.total.fail, summary.total.cond]);
  const dashWs = XLSX.utils.aoa_to_sheet(dashRows);
  XLSX.utils.book_append_sheet(wb, dashWs, 'Dashboard');

  return wb;
}

function parseWorkbookToState(wb){
  const skipSheets = new Set(['Dashboard', 'README', 'Documents', '_Meta']);
  const farmNames = new Set(getFarmList());
  wb.SheetNames.forEach(name=>{
    if(!skipSheets.has(name)) farmNames.add(name);
  });
  const farmList = [...farmNames];
  const farms = {};
  farmList.forEach(farm=>{
    farms[farm] = [];
    const ws = wb.Sheets[farm];
    if(!ws) return;
    const rows = XLSX.utils.sheet_to_json(ws, {header:1, raw:true, defval:''});
    for(let i=1;i<rows.length;i++){
      const r = rows[i];
      if(!r || r.length===0) continue;
      const isEmpty = ALL_COLS.every((c,idx)=>{ const v=r[idx]; return v===''||v===undefined||v===null; });
      if(isEmpty) continue;
      const rec = {id:uid()};
      ALL_COLS.forEach((c,idx)=>{
        let v = r[idx];
        if(v===undefined||v===null) v='';
        rec[c.key] = c.type==='date' ? (v===''?'':excelDateToISO(v)) : String(v);
      });
      farms[farm].push(rec);
    }
  });
  const preservedDocs = (state && state.documents) ? state.documents : Object.fromEntries(farmList.map(f=>[f,[]]));
  return {
    farmList,
    farmCodes: (state && state.farmCodes) ? state.farmCodes : {...DEFAULT_FARM_CODES},
    farms,
    documents: preservedDocs
  };
}

function exportExcel(){
  const wb = buildWorkbook();
  XLSX.writeFile(wb, 'CANA_QC_Tracker_export.xlsx');
}
function exportMonthExcel(month){
  const m = month || dashMonth || currentMonthLabel();
  const wb = XLSX.utils.book_new();
  const summary = computeDashboard(m);
  const dashHeader = ['Farm','Batches','Total Start (g)','Total Bigs (g)','Total Pops (g)','Total Flower (g)','Avg Yield %','Total Mold (g)','Pass','Fail','Conditional'];
  const dashRows = [['CANA QC Tracker — Month:', m], [], dashHeader];
  summary.perFarm.forEach(r=>{
    dashRows.push([r.farm, r.batches, r.totalStart, r.totalBigs, r.totalPops, r.totalFlower, r.avgYield===null?'':Number((r.avgYield*100).toFixed(2)), r.totalMold, r.pass, r.fail, r.cond]);
  });
  dashRows.push(['TOTAL', summary.total.batches, summary.total.totalStart, summary.total.totalBigs, summary.total.totalPops, summary.total.totalFlower, summary.total.avgYield===null?'':Number((summary.total.avgYield*100).toFixed(2)), summary.total.totalMold, summary.total.pass, summary.total.fail, summary.total.cond]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dashRows), 'Summary');

  const allHeader = ['Batch ID','Farm','Date','Strain','Gross Wt (g)','Physical Condition','Eurofins','TNR','Start Wt (g)','Total Flower (g)','Diff (g)','Yield %','Pass/Fail','QC by','Invoice'];
  const allRows = [allHeader];
  recordsForMonth(m).sort((a,b)=>(a.rec.date||'').localeCompare(b.rec.date||'')).forEach(({rec,farm})=>{
    const c = computeRow(rec);
    allRows.push([
      getBatchId(rec,farm), farm, rec.date||'', rec.strain||'', numOrBlank(rec.grossWt), rec.condition||'', rec.eurofinsTest||'', rec.tnrTest||'',
      numOrBlank(rec.startWt), c.totalFlower===null?'':c.totalFlower, c.diff===null?'':c.diff, c.yieldPct===null?'':Number((c.yieldPct*100).toFixed(2)),
      rec.passFail||'', rec.qcBy||'', rec.invoice||''
    ]);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(allRows), 'All Farms');

  EXPORT_COMPANIES.forEach(company=>{
    const rows = [company.columns.map(c=>c.label)];
    recordsForMonth(m).sort((a,b)=>(a.rec.date||'').localeCompare(b.rec.date||'')).forEach(({rec,farm})=>{
      rows.push(company.columns.map(col=> exportRowValue(rec, farm, col)));
    });
    const safeName = company.name.slice(0,31);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), safeName);
  });

  const fileMonth = m.replace(' ','_');
  XLSX.writeFile(wb, 'CANA_QC_' + fileMonth + '.xlsx');
}
function exportCompanyExcel(companyId, month){
  const company = EXPORT_COMPANIES.find(c=>c.id === companyId);
  if(!company) return;
  const m = month || dashMonth || currentMonthLabel();
  const wb = XLSX.utils.book_new();
  const rows = [['Report for:', company.name], ['Month:', m], [], company.columns.map(c=>c.label)];
  recordsForMonth(m).sort((a,b)=>(a.rec.date||'').localeCompare(b.rec.date||'')).forEach(({rec,farm})=>{
    rows.push(company.columns.map(col=> exportRowValue(rec, farm, col)));
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), company.name.slice(0,31));
  XLSX.writeFile(wb, 'CANA_' + company.name + '_' + m.replace(' ','_') + '.xlsx');
}

/* ============ DASHBOARD COMPUTE ============ */
function allMonths(){
  const set = new Set();
  getFarmList().forEach(f=>(state.farms[f]||[]).forEach(r=>{ const m = r.date?formatMonth(r.date):''; if(m) set.add(m); }));
  return Array.from(set).sort((a,b)=>new Date('1 '+a) - new Date('1 '+b));
}
function currentMonthLabel(){
  const d = new Date();
  const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[d.getMonth()]+' '+d.getFullYear();
}
function computeDashboard(month){
  const perFarm = getFarmList().map(farm=>{
    const recs = (state.farms[farm]||[]).filter(r => (r.date?formatMonth(r.date):'') === month);
    let totalStart=0, totalBigs=0, totalPops=0, totalMold=0, pass=0, fail=0, cond=0;
    recs.forEach(r=>{
      totalStart += num(r.startWt)||0;
      totalBigs += num(r.bigsG)||0;
      totalPops += num(r.popsG)||0;
      totalMold += num(r.moldG)||0;
      if((r.passFail||'').startsWith('Pass')) pass++;
      else if((r.passFail||'').startsWith('Fail')) fail++;
      else if((r.passFail||'').startsWith('Conditional')) cond++;
    });
    const totalFlower = totalBigs+totalPops;
    const avgYield = totalStart ? totalFlower/totalStart : null;
    return {farm, batches:recs.length, totalStart, totalBigs, totalPops, totalFlower, avgYield, totalMold, pass, fail, cond};
  });
  const total = perFarm.reduce((acc,r)=>{
    acc.batches+=r.batches; acc.totalStart+=r.totalStart; acc.totalBigs+=r.totalBigs; acc.totalPops+=r.totalPops;
    acc.totalFlower+=r.totalFlower; acc.totalMold+=r.totalMold; acc.pass+=r.pass; acc.fail+=r.fail; acc.cond+=r.cond;
    return acc;
  }, {batches:0,totalStart:0,totalBigs:0,totalPops:0,totalFlower:0,totalMold:0,pass:0,fail:0,cond:0});
  total.avgYield = total.totalStart ? total.totalFlower/total.totalStart : null;
  return {perFarm, total};
}

/* ============ RENDER: SHELL ============ */
function render(){
  renderTabs();
  if(currentView==='dashboard') renderDashboard();
  else if(currentView==='allFarms') renderAllFarmsView();
  else if(currentFarmTab==='documents') renderFarmDocuments();
  else renderFarmView();
}

function renderTabs(){
  const nav = document.getElementById('tabsNav');
  nav.innerHTML = '';
  const totalPending = countPendingAll();
  if(totalPending > 0){
    const banner = document.createElement('div');
    banner.className = 'pending-banner';
    banner.style.cssText = 'margin:0 24px 0;padding:10px 16px;border-radius:0;border-left:none;border-right:none;border-top:none;';
    banner.innerHTML = '<span>⚠️ <b>' + totalPending + ' batch(es) waiting for QC</b> across all farms / <span class="bi">มี ' + totalPending + ' รายการรอ QC ทุกฟาร์ม</span></span>';
    nav.parentNode.insertBefore(banner, nav.nextSibling);
    const old = document.getElementById('globalPendingBanner');
    if(old) old.remove();
    banner.id = 'globalPendingBanner';
  } else {
    const old = document.getElementById('globalPendingBanner');
    if(old) old.remove();
  }
  getFarmList().forEach(farm=>{
    const pending = countPendingFarm(farm);
    const b = document.createElement('button');
    b.innerHTML = esc(farm) + (pending ? ' <span class="tab-badge">' + pending + '</span>' : '');
    b.className = (currentView==='farm' && currentFarm===farm) ? 'active' : '';
    b.onclick = () => { currentView='farm'; currentFarm=farm; render(); };
    nav.appendChild(b);
  });
  const all = document.createElement('button');
  all.innerHTML = '🌐 All Farms <span class="bi">/ ทุกฟาร์ม</span>';
  all.className = currentView==='allFarms' ? 'active' : '';
  all.onclick = () => { currentView='allFarms'; render(); };
  nav.insertBefore(all, nav.firstChild);
  const d = document.createElement('button');
  d.innerHTML = '📊 Main Dashboard <span class="bi">/ แดชบอร์ดหลัก</span>';
  d.className = currentView==='dashboard' ? 'active' : '';
  d.onclick = () => { currentView='dashboard'; render(); };
  nav.insertBefore(d, nav.firstChild);
}

/* ============ RENDER: FARM VIEW ============ */
function renderFarmView(){
  const main = document.getElementById('mainArea');
  const records = (state.farms[currentFarm]||[]);
  const filtered = sortRecords(records.filter(matchesRecordFilters));
  const farmPending = countPendingFarm(currentFarm);

  main.innerHTML = `
    ${farmSubtabsHtml()}

    <div class="panel">
      <details>
        <summary>ℹ️ How to use / วิธีใช้</summary>
        <div class="helpbox">
          <h3>Manager (blue 🔵)</h3>
          On arrival, click <b>+ New Delivery</b> and fill the delivery info.<br>
          เมื่อสินค้ามาถึง กดปุ่ม "+ New Delivery" แล้วกรอกข้อมูลการรับสินค้า
          <h3>QC Staff (purple 🟣)</h3>
          Same day, find the row (or use "Pending QC only") and click <b>Enter QC</b> to fill results. All weights in grams.<br>
          วันเดียวกัน หาแถวที่รอ QC แล้วกดปุ่ม "Enter QC" เพื่อกรอกผล น้ำหนักทั้งหมดเป็นกรัม
          <h3>Auto-calculated (grey)</h3>
          Total Flower, Total Out, Diff, Yield % are calculated automatically — you never edit these.<br>
          ดอกรวม, รวมออกทั้งหมด, ผลต่าง, เปอร์เซ็นต์ผลผลิต คำนวณอัตโนมัติ — ไม่ต้องแก้ไขเอง
        </div>
      </details>
    </div>

    ${farmPending ? `<div class="pending-banner"><span>⚠️ <b>${farmPending} batch(es) need QC</b> on ${esc(currentFarm)} / <span class="bi">มี ${farmPending} รายการรอ QC ที่ ${esc(currentFarm)}</span></span><button class="small" id="btnShowPending">Show pending only / แสดงรอ QC</button></div>` : ''}

    <div class="panel">
      <div class="legend">
        <span><span class="dot" style="background:var(--blue-50);border:1px solid var(--blue-300)"></span>Manager fills on arrival / ผู้จัดการกรอก</span>
        <span><span class="dot" style="background:var(--purple-50);border:1px solid var(--purple-300)"></span>QC staff fills same day / QC กรอกวันเดียวกัน</span>
        <span><span class="dot" style="background:var(--grey-bg);border:1px solid var(--grey-border)"></span>Auto-calculated / คำนวณอัตโนมัติ</span>
      </div>
    </div>

    <div class="row-actions">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
        <button class="primary" id="btnNewDelivery">+ New Delivery <span class="bi">/ รับสินค้าใหม่</span></button>
        <input class="search-box" id="searchBox" placeholder="Search strain, invoice, QC by…" value="${esc(searchText)}">
        <label class="chk"><input type="checkbox" id="chkPending" ${pendingOnly?'checked':''}> Pending QC only</label>
        <div class="view-toggle">
          <button class="${viewMode==='compact'?'active':''}" id="btnViewCompact">Compact / กระทัดรัด</button>
          <button class="${viewMode==='full'?'active':''}" id="btnViewFull">Full table / ตารางเต็ม</button>
        </div>
      </div>
      <div style="font-size:12.5px;color:var(--muted);">${filtered.length} of ${records.length} record(s) — ${esc(currentFarm)}</div>
    </div>

    <div class="filter-row">
      <label>Status: <select id="filterStatus">
        <option value="">All / ทั้งหมด</option>
        <option value="pending" ${filterStatus==='pending'?'selected':''}>Pending QC</option>
        <option value="pass" ${filterStatus==='pass'?'selected':''}>Pass</option>
        <option value="fail" ${filterStatus==='fail'?'selected':''}>Fail</option>
        <option value="cond" ${filterStatus==='cond'?'selected':''}>Conditional</option>
      </select></label>
      <label>From: <input type="date" id="filterDateFrom" value="${esc(filterDateFrom)}"></label>
      <label>To: <input type="date" id="filterDateTo" value="${esc(filterDateTo)}"></label>
      ${farmMonthFilter ? `<span style="font-size:12px;color:var(--blue-700);font-weight:600;">Month: ${esc(farmMonthFilter)} <button class="small" id="btnClearMonth">✕</button></span>` : ''}
    </div>

    <div class="table-wrap desktop-table">
      ${filtered.length ? (viewMode==='full' ? renderFullTable(filtered) : renderCompactTable(filtered)) : `<div class="empty-state">${records.length? 'No records match your filters.' : `<b>No records yet for ${esc(currentFarm)}.</b><br>Click "+ New Delivery" to add the first batch.`}</div>`}
    </div>
    <div class="card-list">
      ${filtered.length ? renderCardList(filtered) : ''}
    </div>
  `;

  bindFarmSubtabs(main);
  document.getElementById('btnNewDelivery').onclick = () => openDeliveryModal(null);
  document.getElementById('searchBox').oninput = (e)=>{ searchText = e.target.value; renderFarmView(); };
  document.getElementById('chkPending').onchange = (e)=>{ pendingOnly = e.target.checked; renderFarmView(); };
  document.getElementById('btnViewCompact').onclick = ()=>{ viewMode='compact'; renderFarmView(); };
  document.getElementById('btnViewFull').onclick = ()=>{ viewMode='full'; renderFarmView(); };
  document.getElementById('filterStatus').onchange = (e)=>{ filterStatus = e.target.value; renderFarmView(); };
  document.getElementById('filterDateFrom').onchange = (e)=>{ filterDateFrom = e.target.value; renderFarmView(); };
  document.getElementById('filterDateTo').onchange = (e)=>{ filterDateTo = e.target.value; renderFarmView(); };
  if(document.getElementById('btnShowPending')) document.getElementById('btnShowPending').onclick = ()=>{ pendingOnly=true; renderFarmView(); };
  if(document.getElementById('btnClearMonth')) document.getElementById('btnClearMonth').onclick = ()=>{ farmMonthFilter=''; renderFarmView(); };
  bindRowActions(main);
}

/* ============ RENDER: ALL FARMS ============ */
function renderAllFarmsCompactTable(items){
  let head = `<thead><tr>
    <th></th>
    <th class="sticky">Batch ID</th>
    <th>Farm</th>
    <th class="sticky">Date</th>
    <th>Strain</th>
    <th>Gross Wt</th>
    <th>Physical</th>
    <th>Eurofins / TNR</th>
    <th>Status</th>
    <th>Pass/Fail</th>
    <th>Diff</th>
    <th>Yield %</th>
    <th>QC by</th>
    <th>Actions</th>
  </tr></thead>`;
  let body = '<tbody>' + items.map(({rec,farm})=>{
    const c = computeRow(rec);
    const pend = isPending(rec);
    const status = getRowStatus(rec);
    const badgeClass = passFailBadgeClass(rec);
    const cond = conditionBadge(rec);
    const bid = getBatchId(rec, farm);
    const expanded = expandedRows[rec.id];
    return `<tr class="${pend?'pending':''}">
      <td><button class="expand-btn" data-expand="${rec.id}" title="Expand details">${expanded?'▼':'▶'}</button></td>
      <td class="sticky"><span class="batch-id">${esc(bid)}</span></td>
      <td><span class="farm-pill">${esc(farm)}</span></td>
      <td class="sticky flag">${esc(rec.date||'—')}</td>
      <td><b>${esc(rec.strain||'—')}</b></td>
      <td>${fmtNum(rec.grossWt)} g</td>
      <td>${cond ? `<span class="cond-badge ${cond.cls}">${esc(cond.text.split(' / ')[0])}</span>` : '—'}</td>
      <td>${renderLabTestBadges(rec)}</td>
      <td><span class="status-chip ${status.key}">${esc(status.label.split(' / ')[0])}</span></td>
      <td>${rec.passFail? `<span class="badge ${badgeClass}">${esc(rec.passFail.split(' / ')[0])}</span>` : (pend?'<span class="badge pending">Pending</span>':'—')}</td>
      <td class="${diffClass(c.diff)}">${c.diff!==null?fmtNum(c.diff)+' g':'—'}</td>
      <td>${fmtPct(c.yieldPct)||'—'}</td>
      <td>${esc(rec.qcBy||'—')}</td>
      <td><div class="action-group">
        <button class="small" data-farm="${esc(farm)}" data-edit-delivery="${rec.id}">Edit</button>
        <button class="small purple" data-farm="${esc(farm)}" data-edit-qc="${rec.id}">${pend?'Enter QC':'QC'}</button>
      </div></td>
    </tr>${expanded ? renderExpandedDetail(rec) : ''}`;
  }).join('') + '</tbody>';
  return `<table class="compact-table">${head}${body}</table>`;
}

function renderAllFarmsView(){
  const main = document.getElementById('mainArea');
  const allItems = getAllFarmRecords();
  const sortedItems = allItems.filter(({rec,farm})=> matchesRecordFilters(rec, farm))
    .sort((a,b)=>{
      const ap = isPending(a.rec)?1:0, bp = isPending(b.rec)?1:0;
      if(ap !== bp) return bp - ap;
      return (b.rec.date||'').localeCompare(a.rec.date||'');
    });

  main.innerHTML = `
    <div class="panel">
      <div class="helpbox" style="font-size:13px;">
        <b>All Farms — combined view</b> / <span class="bi">ทุกฟาร์มในมุมมองเดียว</span><br>
        Every batch from all ${getFarmList().length} farms in one table. Click a farm tab to add new deliveries or manage documents per farm.
        <br><span class="bi">รวมทุกรายการจากทุกฟาร์ม — กดแท็บฟาร์มเพื่อรับสินค้าใหม่หรือจัดการเอกสาร</span>
      </div>
    </div>

    <div class="row-actions">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
        <input class="search-box" id="searchBox" placeholder="Search batch, strain, farm, invoice…" value="${esc(searchText)}">
        <label class="chk"><input type="checkbox" id="chkPending" ${pendingOnly?'checked':''}> Pending QC only</label>
      </div>
      <div style="font-size:12.5px;color:var(--muted);">${sortedItems.length} of ${allItems.length} batch(es) across all farms</div>
    </div>

    <div class="filter-row">
      <label>Status: <select id="filterStatus">
        <option value="">All / ทั้งหมด</option>
        <option value="pending" ${filterStatus==='pending'?'selected':''}>Pending QC</option>
        <option value="pass" ${filterStatus==='pass'?'selected':''}>Pass</option>
        <option value="fail" ${filterStatus==='fail'?'selected':''}>Fail</option>
        <option value="cond" ${filterStatus==='cond'?'selected':''}>Conditional</option>
      </select></label>
      <label>Month: <select id="allFarmsMonth">
        <option value="">All months / ทุกเดือน</option>
        ${allMonths().map(m=>`<option value="${esc(m)}" ${farmMonthFilter===m?'selected':''}>${esc(m)}</option>`).join('')}
      </select></label>
      <label>From: <input type="date" id="filterDateFrom" value="${esc(filterDateFrom)}"></label>
      <label>To: <input type="date" id="filterDateTo" value="${esc(filterDateTo)}"></label>
      ${farmMonthFilter ? `<button class="small" id="btnClearMonth">Clear month / ล้างเดือน</button>` : ''}
    </div>

    <div class="table-wrap desktop-table">
      ${sortedItems.length ? renderAllFarmsCompactTable(sortedItems) : `<div class="empty-state"><b>No batches match your filters.</b><br>Try clearing filters or add deliveries from a farm tab.</div>`}
    </div>
  `;

  document.getElementById('searchBox').oninput = (e)=>{ searchText = e.target.value; renderAllFarmsView(); };
  document.getElementById('chkPending').onchange = (e)=>{ pendingOnly = e.target.checked; renderAllFarmsView(); };
  document.getElementById('filterStatus').onchange = (e)=>{ filterStatus = e.target.value; renderAllFarmsView(); };
  document.getElementById('allFarmsMonth').onchange = (e)=>{ farmMonthFilter = e.target.value; renderAllFarmsView(); };
  document.getElementById('filterDateFrom').onchange = (e)=>{ filterDateFrom = e.target.value; renderAllFarmsView(); };
  document.getElementById('filterDateTo').onchange = (e)=>{ filterDateTo = e.target.value; renderAllFarmsView(); };
  if(document.getElementById('btnClearMonth')) document.getElementById('btnClearMonth').onclick = ()=>{ farmMonthFilter=''; renderAllFarmsView(); };
  bindRowActions(main, 'allFarms');
}

function showDocToast(msg){
  const old = document.querySelector('.doc-toast');
  if(old) old.remove();
  const el = document.createElement('div');
  el.className = 'doc-toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(()=>{ el.remove(); }, 3200);
}

/* ============ RENDER: FARM DOCUMENTS ============ */
function renderFarmDocuments(){
  const main = document.getElementById('mainArea');
  const docs = (state.documents[currentFarm]||[]).filter(matchesDocFilters)
    .slice().sort((a,b)=>(b.uploadedAt||'').localeCompare(a.uploadedAt||''));
  const linkedCount = docs.filter(d=>d.url).length;

  main.innerHTML = `
    ${farmSubtabsHtml()}

    <div class="doc-header">
      <h3>📁 Document Library — ${esc(currentFarm)}</h3>
      <p>Professional document tracking for invoices, COAs, lab reports, and contracts. Metadata and Google Drive links sync to the <b>Documents</b> tab in Google Sheet for your whole team.</p>
      <div class="doc-header-meta">
        <span class="doc-badge">${docs.length} document${docs.length===1?'':'s'}</span>
        <span class="doc-badge">${linkedCount} team link${linkedCount===1?'':'s'}</span>
        <span class="doc-badge">↻ Syncs to Google Sheet</span>
      </div>
    </div>

    <div class="doc-steps">
      <div class="doc-step"><div class="doc-step-num">1</div><b>Upload to Google Drive</b><span>Save PDF, COA, or invoice in your shared Drive folder.</span></div>
      <div class="doc-step"><div class="doc-step-num">2</div><b>Add in CANA QC Tracker</b><span>Click + Add Document → paste Drive link in External URL.</span></div>
      <div class="doc-step"><div class="doc-step-num">3</div><b>Team sees it everywhere</b><span>Appears in app + Google Sheet Documents tab after Save.</span></div>
    </div>

    <div class="doc-toolbar">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
        <button class="primary" id="btnAddDoc">+ Add Document <span class="bi">/ เพิ่มเอกสาร</span></button>
        <button id="btnUploadDoc">📎 Upload File <span class="bi">/ อัปโหลดไฟล์</span></button>
        <input class="search-box" id="docSearchBox" placeholder="Search documents… / ค้นหาเอกสาร…" value="${esc(docSearchText)}">
        <select id="docCategoryFilter">
          <option value="">All categories / ทุกหมวด</option>
          ${DOCUMENT_CATEGORIES.map(c=>`<option value="${esc(c)}" ${docCategoryFilter===c?'selected':''}>${esc(c)}</option>`).join('')}
        </select>
      </div>
    </div>

    ${docs.length ? `<div class="doc-grid">${docs.map(renderDocCard).join('')}</div>` : `
      <div class="panel empty-state">
        <b>No documents yet for ${esc(currentFarm)}. / ยังไม่มีเอกสาร</b><br>
        Follow the 3 steps above — recommended: Google Drive link for team access.
        <div class="upload-hint">Quick upload (this device only): Upload File · max 8 MB</div>
      </div>`}
  `;

  bindFarmSubtabs(main);
  document.getElementById('btnAddDoc').onclick = ()=> openDocumentModal(null);
  document.getElementById('btnUploadDoc').onclick = ()=> document.getElementById('docUploadInput').click();
  document.getElementById('docSearchBox').oninput = (e)=>{ docSearchText = e.target.value; renderFarmDocuments(); };
  document.getElementById('docCategoryFilter').onchange = (e)=>{ docCategoryFilter = e.target.value; renderFarmDocuments(); };
  main.querySelectorAll('[data-edit-doc]').forEach(el=> el.onclick = ()=> openDocumentModal(el.dataset.editDoc));
  main.querySelectorAll('[data-download-doc]').forEach(el=> el.onclick = ()=>{
    const doc = state.documents[currentFarm].find(d=>d.id===el.dataset.downloadDoc);
    if(doc) downloadDocument(doc);
  });
  main.querySelectorAll('[data-open-doc]').forEach(el=> el.onclick = ()=>{
    const doc = state.documents[currentFarm].find(d=>d.id===el.dataset.openDoc);
    if(doc) openDocument(doc);
  });
  main.querySelectorAll('[data-delete-doc]').forEach(el=> el.onclick = ()=> deleteDocument(el.dataset.deleteDoc));
}

function renderDocCard(doc){
  const icon = docFileIcon(doc);
  const hasFile = !!(doc.data || doc.url || doc._fileInIdb || doc.hasLocalFile);
  const hasLink = !!doc.url;
  const cardClass = hasLink ? 'has-link' : ((doc._fileInIdb || doc.data || doc.hasLocalFile) ? 'local-only' : '');
  const syncTag = hasLink
    ? '<span class="doc-sync-tag synced">Team link · Google Sheet ✓</span>'
    : ((doc._fileInIdb || doc.data || doc.hasLocalFile)
      ? '<span class="doc-sync-tag local">This device only</span>'
      : '<span class="doc-sync-tag synced">Notes sync · Google Sheet ✓</span>');
  return `<div class="doc-card ${cardClass}">
    <div class="doc-card-top">
      <div class="doc-icon ${icon.cls}">${icon.icon}</div>
      <div style="min-width:0;flex:1;">
        <p class="doc-title">${esc(doc.title || doc.fileName || 'Untitled')}</p>
        <div class="doc-meta">
          <span class="doc-cat">${esc((doc.category||'Other').split(' / ')[0])}</span><br>
          ${syncTag}
          ${doc.fileName ? '<br>' + esc(doc.fileName) + (doc.size ? ' · ' + formatFileSize(doc.size) : '') : ''}
          ${doc.uploadedAt ? '<br>📅 ' + esc(doc.uploadedAt) : ''}${doc.uploadedBy ? ' · 👤 ' + esc(doc.uploadedBy) : ''}
        </div>
      </div>
    </div>
    ${doc.url ? `<div class="doc-link-row"><a href="${esc(doc.url)}" target="_blank" rel="noopener">Open in Google Drive ↗</a></div>` : ''}
    ${doc.notes ? `<div class="doc-notes">${esc(doc.notes)}</div>` : ''}
    <div class="doc-actions">
      ${hasFile ? `<button class="small" data-open-doc="${doc.id}">Open / เปิด</button><button class="small" data-download-doc="${doc.id}">Download / ดาวน์โหลด</button>` : ''}
      <button class="small" data-edit-doc="${doc.id}">Edit / แก้ไข</button>
      <button class="small danger" data-delete-doc="${doc.id}">Delete / ลบ</button>
    </div>
  </div>`;
}

function openDocumentModal(id, prefill){
  const doc = id ? state.documents[currentFarm].find(d=>d.id===id) : {
    id:uid(), title:'', category:DOCUMENT_CATEGORIES[0], fileName:'', mimeType:'', size:0,
    notes:'', uploadedBy:'', uploadedAt:new Date().toISOString().slice(0,10), url:'', data:''
  };
  if(prefill) Object.assign(doc, prefill);
  const isNew = !id;
  const root = document.getElementById('modalRoot');
  root.innerHTML = `
  <div class="overlay" id="overlay">
    <div class="modal">
      <h2>${isNew?'+ Add Document / เพิ่มเอกสาร':'Edit Document / แก้ไขเอกสาร'} — ${esc(currentFarm)}</h2>
      <div class="sub">Store a file attachment or external link (Google Drive, etc.) / แนบไฟล์หรือลิงก์ภายนอก</div>
      <form id="docForm">
        <div class="form-grid">
          <div class="field full"><label>Title <span>ชื่อเอกสาร</span></label><input type="text" name="title" value="${esc(doc.title)}" required></div>
          <div class="field"><label>Category <span>หมวดหมู่</span></label>
            <select name="category">${DOCUMENT_CATEGORIES.map(c=>`<option value="${esc(c)}" ${doc.category===c?'selected':''}>${esc(c)}</option>`).join('')}</select>
          </div>
          <div class="field"><label>Date <span>วันที่</span></label><input type="date" name="uploadedAt" value="${esc(doc.uploadedAt||'')}"></div>
          <div class="field"><label>Uploaded by <span>อัปโหลดโดย</span></label><input type="text" name="uploadedBy" value="${esc(doc.uploadedBy)}"></div>
          <div class="field full"><label>External URL <span>ลิงก์ภายนอก (ถ้ามี)</span></label><input type="url" name="url" value="${esc(doc.url)}" placeholder="https://drive.google.com/..."></div>
          <div class="field full"><label>Notes <span>หมายเหตุ</span></label><textarea name="notes">${esc(doc.notes)}</textarea></div>
          ${doc.fileName ? `<div class="field full"><label>Attached file <span>ไฟล์แนบ</span></label><div class="ctx">📎 ${esc(doc.fileName)}${doc.size?' · '+formatFileSize(doc.size):''} — upload a new file below to replace</div></div>` : ''}
          <div class="field full"><label>Replace / attach file <span>แนบไฟล์ (สูงสุด 8 MB)</span></label><input type="file" name="file" id="docModalFile"></div>
        </div>
        <div class="modal-actions">
          <button type="button" id="cancelBtn">Cancel / ยกเลิก</button>
          <button type="submit" class="primary">Save / บันทึก</button>
        </div>
      </form>
    </div>
  </div>`;
  const form = document.getElementById('docForm');
  setupModalDirty(form);
  document.getElementById('cancelBtn').onclick = tryCloseModal;
  document.getElementById('overlay').addEventListener('mousedown', (e)=>{ if(e.target.id==='overlay') tryCloseModal(); });
  form.onsubmit = async (e)=>{
    e.preventDefault();
    const fd = new FormData(form);
    const updated = {...doc,
      title: fd.get('title') || '',
      category: fd.get('category') || DOCUMENT_CATEGORIES[0],
      uploadedAt: fd.get('uploadedAt') || '',
      uploadedBy: fd.get('uploadedBy') || '',
      url: fd.get('url') || '',
      notes: fd.get('notes') || ''
    };
    const fileInput = document.getElementById('docModalFile');
    const file = fileInput && fileInput.files[0];
    if(file){
      if(file.size > MAX_DOC_BYTES){
        alert('File is too large (max 8 MB). Use an external URL instead.\nไฟล์ใหญ่เกินไป (สูงสุด 8 MB) ใช้ลิงก์ภายนอกแทน');
        return;
      }
      updated.data = await readFileAsBase64(file);
      updated.fileName = file.name;
      updated.mimeType = file.type || 'application/octet-stream';
      updated.size = file.size;
      if(!updated.title) updated.title = file.name.replace(/\.[^.]+$/,'');
    }
    if(!updated.data && !updated.url && isNew){
      alert('Please attach a file or enter an external URL.\nกรุณาแนบไฟล์หรือใส่ลิงก์ภายนอก');
      return;
    }
    if(isNew) state.documents[currentFarm].push(updated);
    else Object.assign(doc, updated);
    onDataChanged();
    closeModal();
    renderFarmDocuments();
    showDocToast(updated.url ? 'Document saved · syncing to Google Sheet' : 'Document saved on this device');
  };
}

async function handleDocUploadInput(evt){
  const files = Array.from(evt.target.files || []);
  evt.target.value = '';
  if(!files.length) return;
  for(const file of files){
    if(file.size > MAX_DOC_BYTES){
      alert('Skipped "' + file.name + '" — too large (max 8 MB).\nข้ามไฟล์นี้ — ใหญ่เกิน 8 MB');
      continue;
    }
    const data = await readFileAsBase64(file);
    state.documents[currentFarm].push({
      id: uid(),
      title: file.name.replace(/\.[^.]+$/,''),
      category: DOCUMENT_CATEGORIES[DOCUMENT_CATEGORIES.length - 1],
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      notes: '',
      uploadedBy: '',
      uploadedAt: new Date().toISOString().slice(0,10),
      url: '',
      data
    });
  }
  onDataChanged();
  currentFarmTab = 'documents';
  render();
  showDocToast('File saved on this device · add Google Drive link for team access');
}

function deleteDocument(id){
  const doc = state.documents[currentFarm].find(d=>d.id===id);
  if(!doc) return;
  const label = doc.title || doc.fileName || 'this document';
  if(!confirm('Delete "' + label + '"? This cannot be undone.\nลบ "' + label + '" หรือไม่?')) return;
  state.documents[currentFarm] = state.documents[currentFarm].filter(d=>d.id!==id);
  idbDeleteDocData(id);
  onDataChanged();
  renderFarmDocuments();
}

function bindRowActions(root, viewMode){
  root.querySelectorAll('[data-edit-delivery]').forEach(el=> el.onclick = (e)=>{
    e.stopPropagation();
    if(el.dataset.farm) currentFarm = el.dataset.farm;
    openDeliveryModal(el.dataset.editDelivery);
  });
  root.querySelectorAll('[data-edit-qc]').forEach(el=> el.onclick = (e)=>{
    e.stopPropagation();
    if(el.dataset.farm) currentFarm = el.dataset.farm;
    openQCModal(el.dataset.editQc);
  });
  root.querySelectorAll('[data-delete]').forEach(el=> el.onclick = (e)=>{
    e.stopPropagation();
    if(el.dataset.farm) currentFarm = el.dataset.farm;
    deleteRecord(el.dataset.delete);
  });
  root.querySelectorAll('[data-expand]').forEach(el=> el.onclick = (e)=>{
    e.stopPropagation();
    expandedRows[el.dataset.expand] = !expandedRows[el.dataset.expand];
    if(viewMode === 'allFarms') renderAllFarmsView();
    else renderFarmView();
  });
}

function renderDetailSection(cols, rec, computed, cls, title){
  const items = cols.map(c=>{
    let val = computed && computed[c.key] !== undefined ? computed[c.key] : rec[c.key];
    if(c.key==='yieldPct') val = fmtPct(val);
    else if(['totalFlower','totalOut','diff','grossWt','startWt','bigsG','popsG','scrapsG','seedsG','moldG','wasteG'].includes(c.key)) val = fmtNum(val);
    return `<div class="detail-item"><span>${esc(c.label)}</span><b>${esc(val||'—')}</b></div>`;
  }).join('');
  return `<div class="detail-section ${cls}"><h4>${title}</h4>${items}</div>`;
}

function renderExpandedDetail(rec){
  const c = computeRow(rec);
  return `<tr class="detail-row"><td colspan="12">
    <div class="detail-grid">
      ${renderDetailSection(BLUE_COLS, rec, null, 'blue', '📦 Delivery / การรับ')}
      ${renderDetailSection(PURPLE_COLS, rec, null, 'purple', '🧪 QC Results / ผล QC')}
      ${renderDetailSection(GREY_COLS.filter(x=>x.key!=='month'), rec, c, 'grey', '📊 Calculated / คำนวณ')}
    </div>
  </td></tr>`;
}

function renderCompactTable(records){
  let head = `<thead><tr>
    <th></th>
    <th class="sticky">Batch ID</th>
    <th class="sticky">Date</th>
    <th>Strain</th>
    <th>Gross Wt</th>
    <th>Physical</th>
    <th>Eurofins / TNR</th>
    <th>Status</th>
    <th>Pass/Fail</th>
    <th>Diff</th>
    <th>Yield %</th>
    <th>QC by</th>
    <th>Actions</th>
  </tr></thead>`;

  let body = '<tbody>' + records.map(rec=>{
    const c = computeRow(rec);
    const pend = isPending(rec);
    const status = getRowStatus(rec);
    const badgeClass = passFailBadgeClass(rec);
    const cond = conditionBadge(rec);
    const bid = getBatchId(rec, currentFarm);
    const expanded = expandedRows[rec.id];
    return `<tr class="${pend?'pending':''}">
      <td><button class="expand-btn" data-expand="${rec.id}" title="Expand details">${expanded?'▼':'▶'}</button></td>
      <td class="sticky"><span class="batch-id">${esc(bid)}</span></td>
      <td class="sticky flag">${esc(rec.date||'—')}</td>
      <td><b>${esc(rec.strain||'—')}</b></td>
      <td>${fmtNum(rec.grossWt)} g</td>
      <td>${cond ? `<span class="cond-badge ${cond.cls}">${esc(cond.text.split(' / ')[0])}</span>` : '—'}</td>
      <td>${renderLabTestBadges(rec)}</td>
      <td><span class="status-chip ${status.key}">${esc(status.label.split(' / ')[0])}</span></td>
      <td>${rec.passFail? `<span class="badge ${badgeClass}">${esc(rec.passFail.split(' / ')[0])}</span>` : (pend?'<span class="badge pending">Pending</span>':'—')}</td>
      <td class="${diffClass(c.diff)}">${c.diff!==null?fmtNum(c.diff)+' g':'—'}</td>
      <td>${fmtPct(c.yieldPct)||'—'}</td>
      <td>${esc(rec.qcBy||'—')}</td>
      <td><div class="action-group">
        <button class="small" data-edit-delivery="${rec.id}">Edit</button>
        <button class="small purple" data-edit-qc="${rec.id}">${pend?'Enter QC':'QC'}</button>
        <button class="small danger" data-delete="${rec.id}">Del</button>
      </div></td>
    </tr>${expanded ? renderExpandedDetail(rec) : ''}`;
  }).join('') + '</tbody>';

  return `<table class="compact-table">${head}${body}</table>`;
}

function renderCardList(records){
  return records.map(rec=>{
    const c = computeRow(rec);
    const pend = isPending(rec);
    const badgeClass = passFailBadgeClass(rec);
    const bid = getBatchId(rec, currentFarm);
    return `<div class="batch-card ${pend?'pending':''}">
      <div class="card-top">
        <div><span class="batch-id">${esc(bid)}</span><br><b style="font-size:15px;">${esc(rec.strain||'No strain')}</b></div>
        ${rec.passFail? `<span class="badge ${badgeClass}">${esc(rec.passFail.split(' / ')[0])}</span>` : (pend?'<span class="badge pending">Pending QC</span>':'')}
      </div>
      <div class="card-meta">
        <span>📅 ${esc(rec.date||'—')}</span>
        <span>⚖️ ${fmtNum(rec.grossWt)} g</span>
        <span>👤 ${esc(rec.receivedBy||'—')}</span>
      </div>
      <div class="card-stats">
        <div class="stat"><div class="n">${fmtNum(c.totalFlower)||'—'}</div><div class="t">Flower g</div></div>
        <div class="stat"><div class="n ${diffClass(c.diff)}">${c.diff!==null?fmtNum(c.diff):'—'}</div><div class="t">Diff g</div></div>
        <div class="stat"><div class="n">${fmtPct(c.yieldPct)||'—'}</div><div class="t">Yield</div></div>
      </div>
      <div class="action-group">
        <button class="small" data-edit-delivery="${rec.id}">Edit Delivery</button>
        <button class="small purple" data-edit-qc="${rec.id}">${pend?'Enter QC':'Edit QC'}</button>
        <button class="small danger" data-delete="${rec.id}">Delete</button>
      </div>
    </div>`;
  }).join('');
}

function renderFullTable(records){
  let head = `<thead>
    <tr class="grp">
      <th class="blue" colspan="${BLUE_COLS.length}">📦 SECTION 1 — GOODS RECEIVED (Manager) / การรับสินค้า (ผู้จัดการ)</th>
      <th class="purple" colspan="${PURPLE_COLS.length}">🧪 SECTION 2 — QC RESULTS (QC Staff) / ผล QC (เจ้าหน้าที่ QC)</th>
      <th class="grey" colspan="${GREY_COLS.length}">📊 AUTO CALC / คำนวณอัตโนมัติ</th>
      <th colspan="1"></th>
    </tr>
    <tr>
      ${BLUE_COLS.map(c=>`<th class="blue">${esc(c.label)}<br><small>${esc(c.labelTh)}</small></th>`).join('')}
      ${PURPLE_COLS.map(c=>`<th class="purple">${esc(c.label)}<br><small>${esc(c.labelTh)}</small></th>`).join('')}
      ${GREY_COLS.map(c=>`<th class="grey">${esc(c.label)}<br><small>${esc(c.labelTh)}</small></th>`).join('')}
      <th>Actions<br><small>การดำเนินการ</small></th>
    </tr>
  </thead>`;

  let body = '<tbody>' + records.map(rec=>{
    const c = computeRow(rec);
    const pend = isPending(rec);
    const badgeClass = (rec.passFail||'').startsWith('Pass')?'pass':(rec.passFail||'').startsWith('Fail')?'fail':(rec.passFail||'').startsWith('Conditional')?'cond':'';
    const cond = conditionBadge(rec);
    return `<tr class="${pend?'pending':''}">
      <td class="blue-col flag">${esc(rec.date)}</td>
      <td class="blue-col">${esc(rec.strain)}</td>
      <td class="blue-col">${esc(rec.bigsCount)}</td>
      <td class="blue-col">${esc(rec.popsCount)}</td>
      <td class="blue-col">${fmtNum(rec.grossWt)}</td>
      <td class="blue-col">${cond ? `<span class="cond-badge ${cond.cls}">${esc(rec.condition)}</span>` : esc(rec.condition)}</td>
      <td class="blue-col">${renderLabTestBadges(rec)}</td>
      <td class="blue-col">${esc(rec.invoice)}</td>
      <td class="blue-col">${esc(rec.receivedBy)}</td>
      <td class="blue-col">${esc(rec.notes)}</td>
      <td class="purple-col">${esc(rec.qcStart)}</td>
      <td class="purple-col">${esc(rec.qcEnd)}</td>
      <td class="purple-col">${fmtNum(rec.startWt)}</td>
      <td class="purple-col">${fmtNum(rec.bigsG)}</td>
      <td class="purple-col">${fmtNum(rec.popsG)}</td>
      <td class="purple-col">${fmtNum(rec.scrapsG)}</td>
      <td class="purple-col">${fmtNum(rec.seedsG)}</td>
      <td class="purple-col">${fmtNum(rec.moldG)}</td>
      <td class="purple-col">${fmtNum(rec.wasteG)}</td>
      <td class="purple-col">${rec.passFail? `<span class="badge ${badgeClass}">${esc(rec.passFail)}</span>` : (pend?'<span class="badge pending">Pending / รอ QC</span>':'')}</td>
      <td class="purple-col">${esc(rec.qcBy)}</td>
      <td class="grey-col">${fmtNum(c.totalFlower)}</td>
      <td class="grey-col">${fmtNum(c.totalOut)}</td>
      <td class="grey-col ${diffClass(c.diff)}">${fmtNum(c.diff)}</td>
      <td class="grey-col">${fmtPct(c.yieldPct)}</td>
      <td class="grey-col" style="opacity:.5;font-size:11px;">${esc(c.month)}</td>
      <td><div class="action-group">
        <button class="small" data-edit-delivery="${rec.id}">Edit</button>
        <button class="small purple" data-edit-qc="${rec.id}">${pend?'Enter QC':'QC'}</button>
        <button class="small danger" data-delete="${rec.id}">Del</button>
      </div></td>
    </tr>`;
  }).join('') + '</tbody>';

  return `<table>${head}${body}</table>`;
}

/* ============ MODALS ============ */
function setupModalDirty(form){
  modalDirty = false;
  form.addEventListener('input', ()=>{ modalDirty = true; });
  form.addEventListener('change', ()=>{ modalDirty = true; });
}
function tryCloseModal(){
  if(modalDirty && !confirm('Discard unsaved changes?\nยกเลิกการเปลี่ยนแปลงที่ยังไม่ได้บันทึก?')) return;
  closeModal();
}
function openDeliveryModal(id){
  const rec = id ? state.farms[currentFarm].find(r=>r.id===id) : {id:uid(), date: todayISO()};
  const isNew = !id;
  const root = document.getElementById('modalRoot');
  root.innerHTML = `
  <div class="overlay" id="overlay">
    <div class="modal">
      <h2>${isNew?'+ New Delivery / รับสินค้าใหม่':'Edit Delivery / แก้ไขการรับสินค้า'} — ${esc(currentFarm)}</h2>
      <div class="sub">🔵 Manager fills this on arrival / ผู้จัดการกรอกเมื่อสินค้ามาถึง · Batch: <span class="batch-id" id="batchPreview">${esc(computeBatchIdPreview(rec, currentFarm))}</span></div>
      <form id="deliveryForm">
        <div class="form-grid">
          ${BLUE_COLS.map(c=>fieldHtml(c, rec[c.key] !== undefined ? rec[c.key] : (isNew && c.key==='date' ? todayISO() : ''))).join('')}
        </div>
        <div class="modal-actions">
          <button type="button" id="cancelBtn">Cancel / ยกเลิก</button>
          <button type="submit" class="primary">Save / บันทึก</button>
        </div>
      </form>
    </div>
  </div>`;
  const form = document.getElementById('deliveryForm');
  setupModalDirty(form);
  const updateBatchPreview = ()=>{
    const dateVal = (form.querySelector('[name=date]')||{}).value || '';
    const el = document.getElementById('batchPreview');
    if(el) el.textContent = computeBatchIdPreview({...rec, date: dateVal}, currentFarm);
  };
  form.querySelector('[name=date]')?.addEventListener('change', updateBatchPreview);
  form.querySelector('[name=date]')?.addEventListener('input', updateBatchPreview);
  document.getElementById('cancelBtn').onclick = tryCloseModal;
  document.getElementById('overlay').addEventListener('mousedown', (e)=>{ if(e.target.id==='overlay') tryCloseModal(); });
  form.onsubmit = (e)=>{
    e.preventDefault();
    const fd = new FormData(e.target);
    const updated = {...rec};
    BLUE_COLS.forEach(c=> updated[c.key] = fd.get(c.key) || '');
    assignBatchId(updated, currentFarm);
    if(isNew){
      PURPLE_COLS.forEach(c=> updated[c.key]='');
      state.farms[currentFarm].push(updated);
    } else {
      Object.assign(rec, updated);
    }
    onDataChanged();
    closeModal();
    if(currentView === 'allFarms') renderAllFarmsView();
    else renderFarmView();
  };
}

function updateQcPreview(form){
  const data = {};
  PURPLE_COLS.forEach(c=> data[c.key] = form.elements[c.key] ? form.elements[c.key].value : '');
  const c = computeRow(data);
  const set = (id, val, cls)=>{
    const el = document.getElementById(id);
    if(!el) return;
    el.textContent = val;
    el.parentElement.className = 'preview-item' + (cls ? ' '+cls : '');
  };
  set('pvFlower', c.totalFlower!==null ? fmtNum(c.totalFlower)+' g' : '—');
  set('pvOut', c.totalOut!==null ? fmtNum(c.totalOut)+' g' : '—');
  const dcls = diffClass(c.diff);
  set('pvDiff', c.diff!==null ? fmtNum(c.diff)+' g' : '—', dcls==='diff-bad'?'bad':dcls==='diff-warn'?'warn':'');
  set('pvYield', c.yieldPct!==null ? fmtPct(c.yieldPct) : '—');
}

function openQCModal(id){
  const rec = state.farms[currentFarm].find(r=>r.id===id);
  if(!rec) return;
  const root = document.getElementById('modalRoot');
  const purpleFields = PURPLE_COLS.map(c=>{
    if(c.key === 'startWt'){
      return `<div class="field-with-btn full">
        <div class="field" style="flex:1">${fieldHtml(c, rec[c.key]).replace('<div class="field">','').replace(/<\/div>$/,'')}</div>
        <button type="button" class="small" id="btnUseGross" style="margin-bottom:1px;">Use gross wt / ใช้น้ำหนักรวม</button>
      </div>`;
    }
    return fieldHtml(c, rec[c.key]);
  }).join('');

  root.innerHTML = `
  <div class="overlay" id="overlay">
    <div class="modal" style="max-width:700px;">
      <h2>QC Results / ผล QC — ${esc(currentFarm)}</h2>
      <div class="sub">🟣 QC staff fills this same day · <span class="batch-id">${esc(getBatchId(rec, currentFarm))}</span></div>
      <div class="ctx"><b>${esc(rec.strain||'(no strain)')}</b> · Received: ${esc(rec.date||'—')} · Gross Wt: ${fmtNum(rec.grossWt)} g · By: ${esc(rec.receivedBy||'—')}</div>
      <form id="qcForm">
        <div class="form-grid">${purpleFields}</div>
        <div class="live-preview">
          <h4>Live calculation / คำนวณสด</h4>
          <div class="preview-grid">
            <div class="preview-item"><div class="pv" id="pvFlower">—</div><div class="pl">Total Flower</div></div>
            <div class="preview-item"><div class="pv" id="pvOut">—</div><div class="pl">Total Out</div></div>
            <div class="preview-item"><div class="pv" id="pvDiff">—</div><div class="pl">Diff (g)</div></div>
            <div class="preview-item"><div class="pv" id="pvYield">—</div><div class="pl">Yield %</div></div>
          </div>
        </div>
        <div class="modal-actions">
          <button type="button" id="cancelBtn">Cancel / ยกเลิก</button>
          <button type="submit" class="purple">Save QC Result / บันทึกผล QC</button>
        </div>
      </form>
    </div>
  </div>`;
  const form = document.getElementById('qcForm');
  setupModalDirty(form);
  form.addEventListener('input', ()=> updateQcPreview(form));
  updateQcPreview(form);
  document.getElementById('btnUseGross').onclick = ()=>{
    const inp = form.elements.startWt;
    if(inp) { inp.value = rec.grossWt || ''; inp.dispatchEvent(new Event('input')); modalDirty = true; }
  };
  document.getElementById('cancelBtn').onclick = tryCloseModal;
  document.getElementById('overlay').addEventListener('mousedown', (e)=>{ if(e.target.id==='overlay') tryCloseModal(); });
  form.onsubmit = (e)=>{
    e.preventDefault();
    const fd = new FormData(e.target);
    const passFail = fd.get('passFail') || '';
    const qcBy = fd.get('qcBy') || '';
    if(!passFail || !qcBy){
      alert('Please fill Pass/Fail and QC by before saving.\nกรุณากรอก ผ่าน/ไม่ผ่าน และ QC โดย ก่อนบันทึก');
      return;
    }
    PURPLE_COLS.forEach(c=> rec[c.key] = fd.get(c.key) || '');
    onDataChanged();
    closeModal();
    if(currentView === 'allFarms') renderAllFarmsView();
    else renderFarmView();
  };
}

function fieldHtml(c, value){
  value = value===undefined||value===null ? '' : value;
  const wide = c.type==='textarea' ? ' full' : '';
  let input = '';
  if(c.type==='select'){
    input = `<select name="${c.key}"><option value=""></option>${c.options.map(o=>`<option value="${esc(o)}" ${o===value?'selected':''}>${esc(o)}</option>`).join('')}</select>`;
  } else if(c.type==='textarea'){
    input = `<textarea name="${c.key}">${esc(value)}</textarea>`;
  } else if(c.type==='number'){
    input = `<input type="number" step="any" name="${c.key}" value="${esc(value)}">`;
  } else if(c.type==='date'){
    input = `<input type="date" name="${c.key}" value="${esc(value)}">`;
  } else {
    input = `<input type="text" name="${c.key}" value="${esc(value)}">`;
  }
  return `<div class="field${wide}"><label>${esc(c.label)} <span style="font-weight:400;color:var(--muted)">${esc(c.labelTh)}</span></label>${input}</div>`;
}

function closeModal(){ modalDirty = false; document.getElementById('modalRoot').innerHTML = ''; }

function deleteRecord(id){
  const rec = state.farms[currentFarm].find(r=>r.id===id);
  if(!rec) return;
  const label = rec.strain || getBatchId(rec, currentFarm);
  const typed = prompt('Type the strain name to confirm delete: "' + label + '"\nพิมพ์ชื่อสายพันธุ์เพื่อยืนยันการลบ: "' + label + '"');
  if(typed === null) return;
  if(typed.trim().toLowerCase() !== label.trim().toLowerCase()){
    alert('Strain name did not match. Delete cancelled.\nชื่อไม่ตรงกัน ยกเลิกการลบ');
    return;
  }
  state.farms[currentFarm] = state.farms[currentFarm].filter(r=>r.id!==id);
  onDataChanged();
  if(currentView === 'allFarms') renderAllFarmsView();
  else renderFarmView();
}

/* ============ DASHBOARD RENDER ============ */
function renderCompanyPreviewTable(company, month){
  const items = recordsForMonth(month);
  if(!items.length) return `<div class="empty-state" style="padding:24px;">No batches for ${esc(month)} yet.</div>`;
  const previewCols = company.columns.slice(0, 8);
  return `<div class="table-wrap"><table><thead><tr>${previewCols.map(c=>`<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>
    ${items.slice(0,12).map(({rec,farm})=>`<tr>${previewCols.map(col=>`<td>${esc(String(exportRowValue(rec,farm,col)))}</td>`).join('')}</tr>`).join('')}
    ${items.length > 12 ? `<tr><td colspan="${previewCols.length}" style="color:var(--muted);font-size:12px;">+ ${items.length-12} more in export file…</td></tr>` : ''}
  </tbody></table></div>`;
}

function renderDashboard(){
  if(!dashMonth) dashMonth = currentMonthLabel();
  const months = allMonths();
  if(!months.includes(dashMonth)) months.push(dashMonth);
  months.sort((a,b)=>new Date('1 '+a) - new Date('1 '+b));
  const summary = computeDashboard(dashMonth);
  const monthItems = recordsForMonth(dashMonth);
  const main = document.getElementById('mainArea');
  main.innerHTML = `
    <div class="panel">
      <div class="dash-filter">
        <label style="font-size:13px;font-weight:600;">Month <span class="bi">/ เดือน</span>:</label>
        <select id="monthInput" class="dash-select">
          ${months.map(m=>`<option value="${esc(m)}" ${m===dashMonth?'selected':''}>${esc(m)}</option>`).join('')}
        </select>
        <button class="primary" id="btnExportMonth">⬇ Export ${esc(dashMonth)} (Excel)</button>
        <button id="btnViewAllFarms">🌐 View all batches</button>
      </div>
      <div class="dash-tabs">
        <button class="${dashSubTab==='overview'?'active':''}" id="dashTabOverview">Overview / ภาพรวม</button>
        <button class="${dashSubTab==='exports'?'active':''}" id="dashTabExports">Monthly Exports / ส่งออกรายเดือน</button>
      </div>
    </div>

    ${dashSubTab === 'overview' ? `
    <div class="kpi-row">
      <div class="kpi"><div class="v">${summary.total.batches}</div><div class="l">Total Batches</div></div>
      <div class="kpi"><div class="v">${fmtNum(summary.total.totalFlower)} g</div><div class="l">Total Flower</div></div>
      <div class="kpi"><div class="v">${fmtNum(summary.total.totalStart)} g</div><div class="l">Total Start Wt</div></div>
      <div class="kpi"><div class="v">${fmtPct(summary.total.avgYield)}</div><div class="l">Avg Yield %</div></div>
      <div class="kpi"><div class="v" style="color:var(--pass)">${summary.total.pass}</div><div class="l">Pass</div></div>
      <div class="kpi"><div class="v" style="color:var(--fail)">${summary.total.fail}</div><div class="l">Fail</div></div>
    </div>
    <div class="chart-row">
      <div class="chart-box"><h3>Yield % by Farm</h3>${renderYieldChart(summary.perFarm)}</div>
      <div class="chart-box"><h3>Pass / Fail / Conditional</h3>${renderPassFailChart(summary.total)}</div>
    </div>
    <div class="panel" style="margin-bottom:16px;">
      <div class="chart-box" style="border:none;box-shadow:none;padding:0;"><h3>Total Mold by Farm (g)</h3>${renderMoldChart(summary.perFarm)}</div>
    </div>
    <div class="panel">
      <h3 style="margin:0 0 12px;font-size:14px;">By Farm — ${esc(dashMonth)}</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Farm</th><th>Batches</th><th>Start (g)</th><th>Flower (g)</th><th>Yield %</th><th>Pass</th><th>Fail</th><th>Cond</th></tr></thead>
        <tbody>${summary.perFarm.map(r=>`<tr class="clickable" data-farm="${esc(r.farm)}"><td><b>${esc(r.farm)}</b></td><td>${r.batches}</td><td>${fmtNum(r.totalStart)}</td><td>${fmtNum(r.totalFlower)}</td><td>${fmtPct(r.avgYield)}</td><td style="color:var(--pass)">${r.pass}</td><td style="color:var(--fail)">${r.fail}</td><td style="color:var(--cond)">${r.cond}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td>TOTAL</td><td>${summary.total.batches}</td><td>${fmtNum(summary.total.totalStart)}</td><td>${fmtNum(summary.total.totalFlower)}</td><td>${fmtPct(summary.total.avgYield)}</td><td>${summary.total.pass}</td><td>${summary.total.fail}</td><td>${summary.total.cond}</td></tr></tfoot>
      </table></div>
    </div>` : `
    <div class="export-grid">
      <div class="export-card">
        <h3>📦 Full Month Package</h3>
        <p>Excel with Summary + All Farms + company sheets for <b>${esc(dashMonth)}</b> (${monthItems.length} batches).</p>
        <div class="actions"><button class="primary" id="btnExportMonthCard">Download ${esc(dashMonth)}.xlsx</button></div>
      </div>
      ${EXPORT_COMPANIES.map(company=>`<div class="export-card">
        <h3>${esc(company.name)} Export <span class="company-badge">${esc(dashMonth)}</span></h3>
        <p>${esc(company.description)}</p>
        <div class="actions"><button class="primary" data-export-company="${company.id}">⬇ Export for ${esc(company.name)}</button></div>
      </div>`).join('')}
    </div>
    ${EXPORT_COMPANIES.map(company=>`<div class="panel"><h3 style="margin:0 0 8px;font-size:14px;">${esc(company.label)} — ${esc(dashMonth)}</h3>${renderCompanyPreviewTable(company, dashMonth)}</div>`).join('')}`}
  `;
  document.getElementById('monthInput').onchange = (e)=>{ dashMonth = e.target.value; renderDashboard(); };
  document.getElementById('dashTabOverview').onclick = ()=>{ dashSubTab='overview'; renderDashboard(); };
  document.getElementById('dashTabExports').onclick = ()=>{ dashSubTab='exports'; renderDashboard(); };
  document.getElementById('btnExportMonth').onclick = ()=> exportMonthExcel(dashMonth);
  if(document.getElementById('btnExportMonthCard')) document.getElementById('btnExportMonthCard').onclick = ()=> exportMonthExcel(dashMonth);
  document.getElementById('btnViewAllFarms').onclick = ()=>{ currentView='allFarms'; farmMonthFilter=dashMonth; render(); };
  main.querySelectorAll('[data-export-company]').forEach(btn=> btn.onclick = ()=> exportCompanyExcel(btn.dataset.exportCompany, dashMonth));
  main.querySelectorAll('tr.clickable[data-farm]').forEach(row=>{ row.onclick = ()=> goToFarmMonth(row.dataset.farm, dashMonth); });
}

async function loadRemoteConfig(){
  try{
    const res = await fetch('/config.json?ts=' + Date.now());
    if(!res.ok) return;
    const cfg = await res.json();
    if(cfg.appsScriptUrl && cfg.appsScriptUrl.includes('script.google.com')){
      appsScriptUrl = cfg.appsScriptUrl.trim();
      localStorage.setItem(APPS_SCRIPT_URL_KEY, appsScriptUrl);
    }
    if(cfg.sheetViewUrl && cfg.sheetViewUrl.includes('spreadsheets/d/')){
      sheetViewUrl = cfg.sheetViewUrl.trim();
      localStorage.setItem(SHEET_VIEW_URL_KEY, sheetViewUrl);
    }
  }catch(e){ /* no config.json — manual connect still works */ }
}
async function testSheetConnection(){
  if(!appsScriptUrl) throw new Error('No Web App URL set');
  const url = appsScriptUrl + (appsScriptUrl.includes('?') ? '&' : '?') + 'action=read&_=' + Date.now();
  const res = await fetch(url, { mode: 'cors', redirect: 'follow' });
  const text = await res.text();
  if(!res.ok) throw new Error(parseAppsScriptError(text, res.status) + ' (HTTP ' + res.status + ')');
  let data;
  try { data = JSON.parse(text); }
  catch(e){ throw new Error(parseAppsScriptError(text, res.status)); }
  if(!data.ok) throw new Error(data.error || 'Connection failed');
  return data;
}

/* ============ INIT ============ */
async function init(){
  state = loadLocal() || defaultState();
  ensureStateShape();
  await hydrateDocumentsFromIdb();
  await loadRemoteConfig();

  document.getElementById('btnLinkSheet').onclick = ()=> appsScriptUrl ? openLinkSheetModal() : openSheetSetupGuide();
  document.getElementById('btnSetupGuide').onclick = ()=>{ toggleMoreMenu(false); openSheetSetupGuide(); };
  document.getElementById('btnManageFarms').onclick = ()=>{ toggleMoreMenu(false); openManageFarmsModal(); };
  document.getElementById('btnOpenSheet').onclick = openGoogleSheetInBrowser;
  document.getElementById('btnReconnect').onclick = reconnectFile;
  document.getElementById('btnReload').onclick = ()=>{
    if(appsScriptUrl) pullFromGoogleSheet(false);
    else reloadFromFile(false);
  };
  document.getElementById('btnSaveFile').onclick = ()=>{
    if(appsScriptUrl) pushToGoogleSheet(false);
    else saveDataFile();
  };
  document.getElementById('btnExportJSON').onclick = exportJSON;
  document.getElementById('btnImportJSON').onclick = ()=> document.getElementById('fileImportInput').click();
  document.getElementById('fileImportInput').onchange = importJSONFile;
  document.getElementById('btnExportExcel').onclick = exportExcel;
  document.getElementById('btnOpenFileMob').onclick = ()=>{ toggleMoreMenu(false); openDataFile(); };
  document.getElementById('btnMore').onclick = (e)=>{ e.stopPropagation(); toggleMoreMenu(); };
  document.getElementById('docUploadInput').onchange = handleDocUploadInput;
  document.addEventListener('click', (e)=>{
    const menu = document.getElementById('moreMenu');
    if(menu && !menu.contains(e.target)) toggleMoreMenu(false);
  });

  // auto-refresh when staff switch back to this tab/window
  document.addEventListener('visibilitychange', ()=>{
    if(!document.hidden){
      if(appsScriptUrl) pullFromGoogleSheet(true);
      else if(fileHandle) reloadFromFile(true);
    }
  });
  window.addEventListener('focus', ()=>{
    if(appsScriptUrl) pullFromGoogleSheet(true);
    else if(fileHandle) reloadFromFile(true);
  });

  window.addEventListener('beforeunload', (e)=>{
    if(saveInFlight || sheetSaveInFlight){ e.preventDefault(); e.returnValue = ''; return ''; }
  });

  render();
  updateConnPill();
  if(appsScriptUrl){
    startSheetPolling();
    pullFromGoogleSheet(true).then(()=>{
      if(localDirty) pushToGoogleSheet(true);
    });
  } else {
    await tryAutoReconnect();
  }
}
init();
