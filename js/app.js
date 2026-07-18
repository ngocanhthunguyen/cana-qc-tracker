/**
 * CANA QC Tracker — Application logic
 * UI, sync, exports, and rendering.
 */
/* ============ STATE ============ */
let state = null;
let currentFarm = '';
let currentView = 'dashboard'; // 'dashboard' | 'allFarms' | 'farm' | 'trimming'
let dashSubTab = 'overview'; // 'overview' | 'exports'
let trimSubTab = 'rework'; // 'rework' | 'cana'
let trimSearchText = '';
let trimMonth = '';
let exportSelection = {};
let exportSelectionMonth = '';
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
let farmNavOpen = false;

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

function computeTrimRow(rec){
  const inputWt = num(rec.inputWt);
  const bigs = num(rec.outputBigsG), pops = num(rec.outputPopsG);
  const mold = num(rec.moldG)||0, seeds = num(rec.seedsG)||0, stems = num(rec.stemsG)||0, waste = num(rec.wasteG)||0;
  let totalFlower = null, totalOut = null, diff = null, yieldPct = null;
  if(bigs !== null) totalFlower = bigs + (pops||0);
  if(bigs !== null || pops !== null || mold || seeds || stems || waste){
    totalOut = (bigs||0) + (pops||0) + mold + seeds + stems + waste;
  }
  if(inputWt !== null && totalOut !== null) diff = inputWt - totalOut;
  if(inputWt && totalFlower !== null) yieldPct = totalFlower / inputWt;
  return { totalFlower, totalOut, diff, yieldPct };
}

function trimTypeForSubTab(tab){
  return tab === 'cana' ? 'Cana flower' : 'Rework flower';
}
function trimBadgeClass(type){
  return String(type||'').indexOf('Cana') >= 0 ? 'cana' : 'rework';
}
function getAllQcBatchOptions(){
  const opts = [];
  getFarmList().forEach(farm=>{
    (state.farms[farm]||[]).forEach(rec=>{
      if(!rec.date && !rec.strain && !rec.grossWt) return;
      opts.push({
        farm,
        recordId: rec.id,
        batchId: getBatchId(rec, farm),
        strain: rec.strain || '',
        label: getBatchId(rec, farm) + ' · ' + farm + (rec.strain ? ' · ' + rec.strain : '')
      });
    });
  });
  return opts.sort((a,b)=> String(b.batchId).localeCompare(String(a.batchId)));
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
function fmtWeight(g, dec){
  const n = num(g);
  if(n === null) return '—';
  if(Math.abs(n) >= 1000) return fmtNum(n / 1000, dec === undefined ? 2 : dec) + ' kg';
  return fmtNum(n, dec) + ' g';
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
  if(!requireAdmin('reset sheet connection')) return;
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
function searchQuery(text){
  return String(text == null ? searchText : text).trim().toLowerCase();
}
function recordSearchHaystack(r, farm){
  const farmName = farm || currentFarm;
  return [
    farmName,
    r.batchId,
    getBatchId(r, farmName),
    r.date,
    r.strain,
    r.invoice,
    r.receivedBy,
    r.notes,
    r.qcBy,
    r.passFail,
    r.condition,
    r.eurofinsTest,
    r.tnrTest,
    r.grossWt,
    r.startWt
  ].join(' ').toLowerCase();
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
  const q = searchQuery();
  if(q && !recordSearchHaystack(r, farmForBatch).includes(q)) return false;
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
  if(openBtn) openBtn.style.display = (appsScriptUrl && isAdmin()) ? '' : 'none';
  updateAdminUI();
}
function migrateLegacyAdminSession(){
  try{
    const raw = sessionStorage.getItem(ADMIN_SESSION_KEY);
    if(!raw || getAuthSession()) return;
    const exp = Number(raw);
    if(exp && Date.now() < exp) setAuthSession('manager', exp);
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
  }catch(e){}
}
function getAuthSession(){
  try{
    const raw = sessionStorage.getItem(AUTH_SESSION_KEY);
    if(!raw) return null;
    const data = JSON.parse(raw);
    if(!data || !data.role || !data.exp || Date.now() > data.exp) {
      sessionStorage.removeItem(AUTH_SESSION_KEY);
      return null;
    }
    return data;
  }catch(e){
    sessionStorage.removeItem(AUTH_SESSION_KEY);
    return null;
  }
}
function setAuthSession(role, expMs){
  const exp = expMs || (Date.now() + AUTH_SESSION_MS);
  sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({ role, exp }));
  updateAuthUI();
}
function clearAuthSession(){
  sessionStorage.removeItem(AUTH_SESSION_KEY);
  updateAuthUI();
}
function getUserRole(){
  const s = getAuthSession();
  return s ? s.role : null;
}
function isLoggedIn(){
  return !!getAuthSession();
}
function isManager(){
  return getUserRole() === 'manager';
}
function isStaff(){
  return getUserRole() === 'staff';
}
function isAdmin(){
  return isManager();
}
function updateAuthUI(){
  const loggedIn = isLoggedIn();
  const gate = document.getElementById('authGate');
  if(gate) gate.hidden = loggedIn;
  document.body.classList.toggle('auth-locked', !loggedIn);
  document.body.classList.toggle('admin-mode', isManager());
  document.body.classList.toggle('manager-mode', isManager());
  document.body.classList.toggle('staff-mode', isStaff());
  const rolePill = document.getElementById('rolePill');
  if(rolePill){
    if(loggedIn){
      rolePill.hidden = false;
      rolePill.textContent = isManager() ? 'Manager' : 'Staff';
      rolePill.title = isManager() ? 'Full access' : 'QC & documents only';
    } else rolePill.hidden = true;
  }
  const btn = document.getElementById('btnAdmin');
  if(btn){
    btn.textContent = 'Log out';
    btn.title = 'Sign out';
    btn.style.display = loggedIn ? '' : 'none';
  }
  document.querySelectorAll('.admin-only').forEach(el=>{
    el.style.display = isManager() ? '' : 'none';
  });
  const openBtn = document.getElementById('btnOpenSheet');
  if(openBtn) openBtn.style.display = (appsScriptUrl && isManager()) ? '' : 'none';
}
function updateAdminUI(){
  updateAuthUI();
}
function requireLogin(){
  if(isLoggedIn()) return true;
  showAuthGate();
  return false;
}
/** Returns true if manager; false if blocked (may open manager PIN modal). */
function requireAdmin(reason, onSuccess){
  return requireManager(reason, onSuccess);
}
function requireManager(reason, onSuccess){
  if(isManager()) return true;
  if(!isLoggedIn()){
    showAuthGate(onSuccess, reason, 'manager');
    return false;
  }
  openManagerUnlockModal(onSuccess, reason);
  return false;
}
async function verifyLoginRemote(role, pin){
  if(!appsScriptUrl) throw new Error('App not connected to Google Sheet backend yet.');
  const url = appsScriptUrl + (appsScriptUrl.includes('?') ? '&' : '?')
    + 'action=verifyLogin&role=' + encodeURIComponent(role)
    + '&pin=' + encodeURIComponent(pin) + '&_=' + Date.now();
  const res = await fetch(url, { mode: 'cors', redirect: 'follow' });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); }
  catch(e){ throw new Error('Could not verify PIN — paste latest CANA_QC_GoogleAppsScript.gs and redeploy.'); }
  if(!data.ok) throw new Error(data.error || 'Incorrect PIN');
  return data.role || role;
}
async function verifyAdminPinRemote(pin){
  return verifyLoginRemote('manager', pin);
}
async function checkLoginPinsConfigured(){
  if(!appsScriptUrl) return { staff: false, manager: false };
  try{
    const url = appsScriptUrl + (appsScriptUrl.includes('?') ? '&' : '?') + 'action=loginStatus&_=' + Date.now();
    const res = await fetch(url, { mode: 'cors', redirect: 'follow' });
    const data = JSON.parse(await res.text());
    return {
      staff: !!(data.ok && data.hasStaffPin),
      manager: !!(data.ok && (data.hasManagerPin || data.hasPin))
    };
  }catch(e){ return { staff: false, manager: false }; }
}
let authGateRole = 'staff';
let authGateSuccessCallback = null;
function showAuthGate(onSuccess, reason, preferredRole){
  authGateSuccessCallback = typeof onSuccess === 'function' ? onSuccess : null;
  authGateRole = preferredRole || 'staff';
  const gate = document.getElementById('authGate');
  if(!gate){ openManagerUnlockModal(onSuccess, reason); return; }
  gate.hidden = false;
  document.body.classList.add('auth-locked');
  setAuthGateRole(authGateRole);
  const pinInput = gate.querySelector('[name=pin]');
  if(pinInput){ pinInput.value = ''; pinInput.focus(); }
}
function setAuthGateRole(role){
  authGateRole = role === 'manager' ? 'manager' : 'staff';
  const gate = document.getElementById('authGate');
  if(!gate) return;
  gate.querySelectorAll('.auth-role-tab').forEach(tab=>{
    const active = tab.dataset.role === authGateRole;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  const desc = document.getElementById('authRoleDesc');
  const pinLabel = document.getElementById('authPinLabel');
  if(authGateRole === 'manager'){
    if(desc) desc.innerHTML = '<b>Manager</b> — Full access: deliveries, farms, settings, delete records.<br><span class="bi">จัดการทั้งหมด · ตั้งค่า · ลบข้อมูล</span>';
    if(pinLabel) pinLabel.textContent = 'manager PIN';
  } else {
    if(desc) desc.innerHTML = '<b>Staff</b> — Enter QC results, view records, upload documents.<br><span class="bi">กรอก QC · ดูข้อมูล · อัปโหลดเอกสาร</span>';
    if(pinLabel) pinLabel.textContent = 'staff PIN';
  }
}
function bindAuthGate(){
  const gate = document.getElementById('authGate');
  if(!gate || gate.dataset.bound === '1') return;
  gate.dataset.bound = '1';
  const errEl = document.getElementById('authError');
  const showErr = (msg)=>{
    if(!errEl) return;
    errEl.textContent = msg || '';
    errEl.hidden = !msg;
  };
  gate.querySelectorAll('.auth-role-tab').forEach(tab=>{
    tab.onclick = ()=>{
      setAuthGateRole(tab.dataset.role);
      showErr('');
      gate.querySelector('[name=pin]')?.focus();
    };
  });
  gate.querySelector('#authLoginForm').onsubmit = async (e)=>{
    e.preventDefault();
    showErr('');
    const pin = gate.querySelector('[name=pin]').value;
    const btn = gate.querySelector('.auth-submit');
    const prev = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try{
      const role = await verifyLoginRemote(authGateRole, pin);
      setAuthSession(role);
      gate.hidden = true;
      document.body.classList.remove('auth-locked');
      startAppAfterLogin();
      const cb = authGateSuccessCallback;
      authGateSuccessCallback = null;
      if(typeof cb === 'function') cb();
    }catch(err){
      showErr(err.message || 'Sign in failed.');
      gate.querySelector('[name=pin]')?.focus();
    }finally{
      btn.disabled = false;
      btn.textContent = prev;
    }
  };
}
function openManagerUnlockModal(onSuccess, reason){
  modalDirty = true;
  const root = document.getElementById('modalRoot');
  const why = reason
    ? `<div class="admin-login-reason">Manager access required for: <b>${esc(reason)}</b></div>`
    : '';
  root.innerHTML = `
  <div class="overlay" id="overlay">
    <div class="modal admin-login-modal">
      <div class="admin-login-brand">
        <div class="admin-login-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>
        </div>
        <h2>Manager Access</h2>
        <p class="admin-login-sub">Enter manager PIN to continue<br><span class="bi">ใส่รหัสผู้จัดการเพื่อดำเนินการต่อ</span></p>
      </div>
      ${why}
      <form id="adminPinForm">
        <div class="field">
          <label>PIN <span>รหัสผู้จัดการ</span></label>
          <input type="password" name="pin" inputmode="numeric" autocomplete="off" required minlength="4" placeholder="Enter PIN" autofocus>
        </div>
        <div class="admin-login-error" id="adminPinError" hidden></div>
        <div class="modal-actions admin-login-actions">
          <button type="button" class="ghost" id="btnCancelAdmin">Cancel</button>
          <button type="submit" class="primary">Unlock</button>
        </div>
      </form>
    </div>
  </div>`;
  const close = ()=>{ modalDirty = false; closeModal(); };
  const pinInput = root.querySelector('[name=pin]');
  const errEl = root.querySelector('#adminPinError');
  const showPinError = (msg)=>{
    if(!errEl) return;
    errEl.textContent = msg;
    errEl.hidden = !msg;
  };
  pinInput.oninput = ()=> showPinError('');
  root.querySelector('#btnCancelAdmin').onclick = close;
  root.querySelector('#overlay').onclick = (e)=>{ if(e.target.id==='overlay') close(); };
  root.querySelector('#adminPinForm').onsubmit = async (e)=>{
    e.preventDefault();
    showPinError('');
    const pin = pinInput.value;
    try{
      await verifyLoginRemote('manager', pin);
      setAuthSession('manager');
      close();
      render();
      if(typeof onSuccess === 'function') onSuccess();
      else showDocToast('Manager access granted');
    }catch(err){
      showPinError(err.message || 'Incorrect PIN. Please try again.');
      pinInput.focus();
      pinInput.select();
    }
  };
}
function openAdminUnlockModal(onSuccess, reason){
  openManagerUnlockModal(onSuccess, reason);
}
async function checkAdminPinConfigured(){
  const s = await checkLoginPinsConfigured();
  return s.manager;
}
function logoutUser(){
  const msg = isManager()
    ? 'Sign out of manager session?\nออกจากระบบผู้จัดการ?'
    : 'Sign out?\nออกจากระบบ?';
  if(!confirm(msg)) return;
  clearAuthSession();
  stopSheetPolling();
  showAuthGate();
}
function toggleAdminSession(){
  logoutUser();
}
function startAppAfterLogin(){
  render();
  updateConnPill();
  if(appsScriptUrl){
    startSheetPolling();
    pullFromGoogleSheet(true).then(()=>{
      if(localDirty) pushToGoogleSheet(true);
    });
  }
}
function toggleMoreMenu(open){
  const menu = document.getElementById('moreMenu');
  if(!menu) return;
  menu.classList.toggle('open', open !== undefined ? open : !menu.classList.contains('open'));
  if(menu.classList.contains('open')) farmNavOpen = false;
}
function closeFarmNav(){
  farmNavOpen = false;
  const picker = document.querySelector('.farm-picker');
  if(picker) picker.classList.remove('open');
}
function ensureStateShape(){
  if(!state.farms) state.farms = {};
  if(!state.documents) state.documents = {};
  if(!state.trimming) state.trimming = [];
  if(!state.exportLog) state.exportLog = [];
  if(!state.farmList || !state.farmList.length) state.farmList = DEFAULT_FARMS.slice();
  if(!state.farmCodes) state.farmCodes = {...DEFAULT_FARM_CODES};
  if(!state.farmDriveFolders) state.farmDriveFolders = {};
  if(state.driveParentFolderId === undefined) state.driveParentFolderId = '';
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
  const driveOk = hasDriveUploadForFarm(currentFarm);
  return `<div class="farm-subtabs">
    <button type="button" class="${currentFarmTab==='qc'?'active':''}" id="btnFarmQc">📋 QC Records <span class="bi">/ บันทึก QC</span></button>
    <button type="button" class="${currentFarmTab==='documents'?'active':''}" id="btnFarmDocs">📁 Documents <span class="bi">/ เอกสาร</span>${docCount ? ' (' + docCount + ')' : ''}</button>
  </div>${driveOk ? '' : '<p class="doc-staff-hint">📁 Admin: <b>More → Drive Folders</b> → paste <b>Cana Documents</b> parent folder link once.</p>'}`;
}
function bindFarmSubtabs(root){
  const qc = root.querySelector('#btnFarmQc');
  const docs = root.querySelector('#btnFarmDocs');
  if(qc) qc.onclick = ()=>{ currentFarmTab='qc'; render(); };
  if(docs) docs.onclick = ()=>{ currentFarmTab='documents'; render(); };
}
function extractDriveFolderId(url){
  const s = String(url || '').trim();
  if(!s) return '';
  let m = s.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if(m) return m[1];
  m = s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return m ? m[1] : '';
}
function normalizeDriveFolderId(raw){
  let id = String(raw || '').trim();
  if(!id) return '';
  if(/^https?:\/\//i.test(id)) return extractDriveFolderId(id);
  return id.replace(/[^a-zA-Z0-9_-]/g, '');
}
function getFarmDriveFolderId(farm){
  return normalizeDriveFolderId((state.farmDriveFolders && state.farmDriveFolders[farm]) || '');
}
function getDriveParentFolderId(){
  return normalizeDriveFolderId(state.driveParentFolderId || '');
}
function hasDriveUploadForFarm(farm){
  return !!(appsScriptUrl && (getDriveParentFolderId() || getFarmDriveFolderId(farm)));
}
async function uploadFileToFarmDrive(file, farm){
  if(!appsScriptUrl) throw new Error('Google Sheet not connected');
  if(!hasDriveUploadForFarm(farm)) throw new Error('Drive not configured for ' + farm + ' — admin: More → Drive Folders → paste Cana Documents parent folder');
  const data = await readFileAsBase64(file);
  const payload = {
    action: 'uploadDoc',
    farm,
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    data
  };
  const res = await gasPostXHR(appsScriptUrl, JSON.stringify(payload));
  if(!res.ok) throw new Error(res.error || 'Upload failed');
  return res;
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
      openExternalDocUrl(doc.url);
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
      openExternalDocUrl(doc.url);
    } else {
      alert('File is only on the device that uploaded it. Add a Google Drive URL for team access.\nไฟล์อยู่เฉพาะเครื่องที่อัปโหลด — ใส่ลิงก์ Google Drive สำหรับทีม');
    }
  });
}
function isValidExternalUrl(raw){
  const url = normalizeExternalUrl(raw);
  return !!url && /^https?:\/\//i.test(url);
}
function extractDriveFileId(url){
  const s = String(url || '').trim();
  let m = s.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if(m) return m[1];
  m = s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if(m) return m[1];
  return '';
}
function normalizeExternalUrl(raw){
  let url = String(raw || '').trim();
  if(!url) return '';
  if(/^open link/i.test(url)) return '';
  if(!/^https?:\/\//i.test(url)){
    if(/^(drive\.google\.com|docs\.google\.com|www\.)/i.test(url)) url = 'https://' + url;
    else if(url.includes('drive.google.com') || url.includes('docs.google.com')) url = 'https://' + url.replace(/^\/+/, '');
  }
  url = url.replace(/\/u\/\d+\//g, '/');
  if(isDriveFolderUrl(url)) return url;
  const fileId = extractDriveFileId(url);
  if(fileId) return 'https://drive.google.com/file/d/' + fileId + '/view';
  return url;
}
function isDriveFolderUrl(url){
  return /drive\.google\.com\/(?:drive\/)?folders\//i.test(String(url || ''));
}
function openExternalLink(url){
  url = normalizeExternalUrl(url);
  if(!url) return false;
  if(isDriveFolderUrl(url)){
    alert('This is a Google Drive FOLDER link — it cannot open a photo/PDF directly.\n\n1. Open the folder in Drive\n2. Right-click the FILE → Share → Copy link\n3. Paste that file link in External URL\n\nนี่เป็นลิงก์ folder — ต้อง copy link ของไฟล์ ไม่ใช่ folder');
  }
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  a.remove();
  return true;
}
function openExternalDocUrl(url){
  if(!isValidExternalUrl(url)){
    alert('This document has no valid link.\n\nEdit the document and paste the full Google Drive FILE link:\nhttps://drive.google.com/file/d/...../view\n\nลิงก์ไม่ถูกต้อง — แก้ไขเอกสารแล้วใส่ลิงก์ไฟล์ Google Drive');
    return false;
  }
  return openExternalLink(url);
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
  const q = searchQuery(docSearchText);
  if(q){
    const hay = [doc.title,doc.fileName,doc.notes,doc.category,doc.uploadedBy,doc.url,doc.mimeType].join(' ').toLowerCase();
    if(!hay.includes(q)) return false;
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
      let doc = {...rd};
      if(!isValidExternalUrl(doc.url) && localDoc && isValidExternalUrl(localDoc.url)){
        doc.url = localDoc.url;
      } else if(!isValidExternalUrl(doc.url)){
        doc.url = '';
      }
      if(localDoc && (localDoc.data || localDoc._fileInIdb)){
        doc = {...doc, _fileInIdb: true, data: localDoc.data || ''};
      }
      return doc;
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
    farmCodes: state.farmCodes || {},
    farmDriveFolders: state.farmDriveFolders || {},
    driveParentFolderId: state.driveParentFolderId || '',
    trimming: state.trimming || [],
    exportLog: state.exportLog || []
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
  if(payload.action === 'write' || payload.action === 'setDriveConfig'){
    const encoded = utf8ToBase64(body);
    if(encoded.length > 180000) throw new Error('Data too large to sync in one request');
    const url = appsScriptUrl
      + (appsScriptUrl.includes('?') ? '&' : '?')
      + 'action=' + encodeURIComponent(payload.action)
      + '&payload=' + encodeURIComponent(encoded)
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
      farmCodes: data.farmCodes || {},
      farmDriveFolders: data.farmDriveFolders || {},
      driveParentFolderId: data.driveParentFolderId || '',
      trimming: data.trimming || [],
      exportLog: data.exportLog || []
    });
    if(fp === lastRemoteJson) return;
    state.farms = data.farms;
    if(data.farmList && data.farmList.length) state.farmList = data.farmList;
    if(data.farmCodes) state.farmCodes = {...(state.farmCodes||{}), ...data.farmCodes};
    if(data.farmDriveFolders) state.farmDriveFolders = {...(state.farmDriveFolders||{}), ...data.farmDriveFolders};
    if(data.driveParentFolderId) state.driveParentFolderId = data.driveParentFolderId;
    if(Array.isArray(data.trimming)) state.trimming = data.trimming.slice();
    if(Array.isArray(data.exportLog)) state.exportLog = data.exportLog.slice();
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
async function pushDriveConfigToSheet(silent){
  if(!appsScriptUrl) throw new Error('Google Sheet not connected');
  const payload = {
    action: 'setDriveConfig',
    driveParentFolderId: state.driveParentFolderId || '',
    farmDriveFolders: state.farmDriveFolders || {}
  };
  const data = await callAppsScript(payload);
  if(!data.ok) throw new Error(data.error || 'Could not save Drive folder to Sheet');
  if(!data.updatedAt) throw new Error('Backend outdated — paste latest CANA_QC_GoogleAppsScript.gs, redeploy, then Save again.');
  lastRemoteJson = stateFingerprint();
  lastSyncTime = new Date().toLocaleTimeString();
  sheetSyncOk = true;
  updateConnPill();
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
        farmCodes: state.farmCodes || {},
        farmDriveFolders: state.farmDriveFolders || {},
        driveParentFolderId: state.driveParentFolderId || '',
        trimming: state.trimming || [],
        exportLog: state.exportLog || []
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
function removeFarm(farm, opts){
  opts = opts || {};
  if(!requireAdmin('remove farm')) return 'blocked';
  if(getFarmList().length <= 1) return 'Cannot remove the last farm / ลบฟาร์มสุดท้ายไม่ได้';
  const recs = (state.farms[farm]||[]).length;
  const docs = (state.documents[farm]||[]).length;
  if((recs || docs) && !opts.force){
    return 'Use Delete farm and confirm — this farm still has ' + recs + ' QC and ' + docs + ' document(s).';
  }
  if(opts.force && (recs || docs)){
    (state.documents[farm]||[]).forEach(doc=>{
      if(doc && doc.id) idbDeleteDocData(doc.id);
    });
  }
  state.farmList = getFarmList().filter(f=>f!==farm);
  delete state.farms[farm];
  delete state.documents[farm];
  if(state.farmCodes) delete state.farmCodes[farm];
  if(state.farmDriveFolders) delete state.farmDriveFolders[farm];
  if(currentFarm === farm){
    currentFarm = getFarmList()[0] || '';
    currentView = currentFarm ? 'farm' : 'dashboard';
  }
  onDataChanged();
  return '';
}
function confirmRemoveFarm(farm, onDone){
  if(!requireAdmin('delete farm', ()=> confirmRemoveFarm(farm, onDone))) return;
  if(getFarmList().length <= 1){
    alert('Cannot remove the last farm / ลบฟาร์มสุดท้ายไม่ได้');
    return;
  }
  const recs = (state.farms[farm]||[]).length;
  const docs = (state.documents[farm]||[]).length;
  const hasData = recs || docs;
  if(hasData){
    const msg = 'Delete farm "' + farm + '" and ALL ' + recs + ' QC record(s) + ' + docs + ' document(s)?\nThis cannot be undone.\n\nType the farm name to confirm:\nพิมพ์ชื่อฟาร์มเพื่อยืนยัน: "' + farm + '"';
    const typed = prompt(msg, '');
    if(typed !== farm) return;
  } else if(!confirm('Delete farm "' + farm + '"?\nลบฟาร์ม "' + farm + '"?')) {
    return;
  }
  const err = removeFarm(farm, { force: hasData });
  if(err === 'blocked') return;
  if(err){ alert(err); return; }
  if(typeof onDone === 'function') onDone();
  else render();
}
function openManageFarmsModal(){
  if(!requireAdmin('manage farms', ()=> openManageFarmsModal())) return;
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
          const canDelete = list.length > 1;
          return `<div class="farm-manage-row">
            <div>
              <strong>${esc(f)}</strong>
              <span class="farm-manage-meta">Batch code: ${esc(farmCode(f))} · ${n} QC · ${d} docs</span>
            </div>
            ${canDelete ? `<button type="button" class="small danger admin-only" data-remove-farm="${esc(f)}" title="${n||d ? 'Deletes all QC & docs for this farm' : 'Remove empty farm'}">Delete</button>` : ''}
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
      confirmRemoveFarm(farm, ()=>{ close(); render(); });
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

function openDriveFoldersModal(){
  if(!requireAdmin('Drive folder setup', ()=> openDriveFoldersModal())) return;
  modalDirty = true;
  if(!state.farmDriveFolders) state.farmDriveFolders = {};
  const parentId = getDriveParentFolderId();
  const parentPreview = parentId ? ('https://drive.google.com/drive/folders/' + parentId) : '';
  const root = document.getElementById('modalRoot');
  root.innerHTML = `
  <div class="overlay" id="overlay">
    <div class="modal" style="max-width:640px">
      <h2>📁 Drive Folders / โฟลเดอร์ Google Drive</h2>
      <div class="sub">Paste the <b>Cana Documents</b> parent folder once. Uploads go to the matching subfolder (Kenny, BB Farm, …) automatically.</div>
      <form id="driveFoldersForm">
        <div class="field full">
          <label>Cana Documents <span>parent folder link</span></label>
          <input type="url" name="parentFolder" value="${esc(parentPreview)}" placeholder="https://drive.google.com/drive/folders/..." required>
        </div>
        <p class="farm-add-hint">Subfolders inside must match farm names, e.g. <b>Kenny</b>, <b>BB farm</b>, <b>VT farm</b>. Share <b>Cana Documents</b> with team as Editor.<br>Clear old per-farm links — only the parent link is needed now.</p>
        <div class="modal-actions">
          <button type="button" class="ghost" id="btnCloseDriveFolders">Cancel</button>
          <button type="submit" class="primary">Save</button>
        </div>
      </form>
    </div>
  </div>`;
  const close = ()=>{ modalDirty = false; closeModal(); };
  root.querySelector('#btnCloseDriveFolders').onclick = close;
  root.querySelector('#overlay').onclick = (e)=>{ if(e.target.id==='overlay') close(); };
  root.querySelector('#driveFoldersForm').onsubmit = async (e)=>{
    e.preventDefault();
    const raw = String(new FormData(e.target).get('parentFolder') || '').trim();
    const parent = normalizeDriveFolderId(raw);
    if(!parent || parent.length < 20){
      alert('Paste the full Cana Documents folder URL from Drive.');
      return;
    }
    state.driveParentFolderId = parent;
    state.farmDriveFolders = {};
    saveLocal();
    const btn = e.target.querySelector('button[type="submit"]');
    const prevLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try{
      await pushDriveConfigToSheet(false);
      localDirty = true;
      debouncedPushToSheet();
      close();
      render();
      showDocToast('Saved to Google Sheet ✓');
    }catch(err){
      alert('Could not save Drive folder to Google Sheet:\n\n' + err.message + '\n\nFix: Apps Script → paste latest CANA_QC_GoogleAppsScript.gs → Save → Deploy new version → Save here again.');
      btn.disabled = false;
      btn.textContent = prevLabel;
    }
  };
}

function openSheetSetupGuide(){
  if(!requireAdmin('Google Sheet setup', ()=> openSheetSetupGuide())) return;
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
  if(!requireAdmin('Google Sheet connection', ()=> openLinkSheetModal())) return;
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
  if(!requireAdmin('open Google Sheet', openGoogleSheetInBrowser)) return;
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
  const skipSheets = new Set(['Dashboard', 'README', 'Documents', 'Export Log', 'Trim Rework', 'Trim Cana', 'Trimming', '_Meta']);
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

/* ============ EXPORT BUILDER ============ */
function exportBatchKey({rec, farm}){ return farm + '::' + rec.id; }
function monthFileTag(month){ return String(month || '').replace(/ /g, '_'); }
function getExportActorLabel(){ return isManager() ? 'Manager' : 'Staff'; }
function ensureExportSelection(month){
  if(exportSelectionMonth !== month){
    exportSelectionMonth = month;
    exportSelection = {};
    recordsForMonth(month).forEach(item=>{ exportSelection[exportBatchKey(item)] = true; });
  }
}
function getSelectedExportItems(month){
  ensureExportSelection(month);
  return recordsForMonth(month).filter(item=> exportSelection[exportBatchKey(item)]);
}
function setAllExportSelection(month, selected){
  ensureExportSelection(month);
  recordsForMonth(month).forEach(item=>{ exportSelection[exportBatchKey(item)] = !!selected; });
}
function computeSummaryFromItems(items){
  const byFarm = {};
  const total = { batches:0, totalStart:0, totalBigs:0, totalPops:0, totalFlower:0, totalMold:0, pass:0, fail:0, cond:0 };
  items.forEach(({rec, farm})=>{
    if(!byFarm[farm]){
      byFarm[farm] = { farm, batches:0, totalStart:0, totalBigs:0, totalPops:0, totalFlower:0, totalMold:0, pass:0, fail:0, cond:0 };
    }
    const r = byFarm[farm];
    r.batches++;
    r.totalStart += num(rec.startWt)||0;
    r.totalBigs += num(rec.bigsG)||0;
    r.totalPops += num(rec.popsG)||0;
    r.totalMold += num(rec.moldG)||0;
    r.totalFlower = r.totalBigs + r.totalPops;
    if((rec.passFail||'').startsWith('Pass')) r.pass++;
    else if((rec.passFail||'').startsWith('Fail')) r.fail++;
    else if((rec.passFail||'').startsWith('Conditional')) r.cond++;
    total.batches++;
    total.totalStart += num(rec.startWt)||0;
    total.totalBigs += num(rec.bigsG)||0;
    total.totalPops += num(rec.popsG)||0;
    total.totalMold += num(rec.moldG)||0;
    total.totalFlower = total.totalBigs + total.totalPops;
    if((rec.passFail||'').startsWith('Pass')) total.pass++;
    else if((rec.passFail||'').startsWith('Fail')) total.fail++;
    else if((rec.passFail||'').startsWith('Conditional')) total.cond++;
  });
  const perFarm = Object.keys(byFarm).sort().map(f=>{
    const r = byFarm[f];
    r.avgYield = r.totalStart ? r.totalFlower / r.totalStart : null;
    return r;
  });
  total.avgYield = total.totalStart ? total.totalFlower / total.totalStart : null;
  return { perFarm, total };
}
function appendExportLog(entry){
  if(!state.exportLog) state.exportLog = [];
  state.exportLog.unshift(entry);
  if(state.exportLog.length > 200) state.exportLog.length = 200;
  onDataChanged();
  if(currentView === 'dashboard' && dashSubTab === 'exports') renderDashboard();
}
function buildExportLogEntry({ month, exportType, company, items, fileName }){
  const batchIds = items.map(({rec,farm})=> getBatchId(rec, farm)).sort();
  return {
    id: uid(),
    month,
    exportType,
    company: company || '',
    batchCount: items.length,
    batchIds: batchIds.join(', '),
    fileName,
    exportedAt: new Date().toISOString(),
    exportedBy: getExportActorLabel()
  };
}
function exportLogsForMonth(month){
  return (state.exportLog||[]).filter(e=> e.month === month).slice(0, 30);
}
function requireExportSelection(month){
  const items = getSelectedExportItems(month);
  if(!items.length){
    alert('Select at least one batch to export.\nเลือกอย่างน้อย 1 batch ก่อนส่งออก');
    return null;
  }
  return items;
}
function sortExportItems(items){
  return items.slice().sort((a,b)=>(a.rec.date||'').localeCompare(b.rec.date||'') || a.farm.localeCompare(b.farm));
}
function buildSummarySheetRows(month, summary){
  const dashHeader = ['Farm','Batches','Total Start (g)','Total Bigs (g)','Total Pops (g)','Total Flower (g)','Avg Yield %','Total Mold (g)','Pass','Fail','Conditional'];
  const dashRows = [['CANA QC Tracker — Month:', month], ['Selected batches only'], [], dashHeader];
  summary.perFarm.forEach(r=>{
    dashRows.push([r.farm, r.batches, r.totalStart, r.totalBigs, r.totalPops, r.totalFlower, r.avgYield===null?'':Number((r.avgYield*100).toFixed(2)), r.totalMold, r.pass, r.fail, r.cond]);
  });
  dashRows.push(['TOTAL', summary.total.batches, summary.total.totalStart, summary.total.totalBigs, summary.total.totalPops, summary.total.totalFlower, summary.total.avgYield===null?'':Number((summary.total.avgYield*100).toFixed(2)), summary.total.totalMold, summary.total.pass, summary.total.fail, summary.total.cond]);
  return dashRows;
}
function buildAllFarmsSheetRows(items){
  const allHeader = ['Batch ID','Farm','Date','Strain','Gross Wt (g)','Physical Condition','Eurofins','TNR','Start Wt (g)','Total Flower (g)','Diff (g)','Yield %','Pass/Fail','QC by','Invoice'];
  const allRows = [allHeader];
  sortExportItems(items).forEach(({rec,farm})=>{
    const c = computeRow(rec);
    allRows.push([
      getBatchId(rec,farm), farm, rec.date||'', rec.strain||'', numOrBlank(rec.grossWt), rec.condition||'', rec.eurofinsTest||'', rec.tnrTest||'',
      numOrBlank(rec.startWt), c.totalFlower===null?'':c.totalFlower, c.diff===null?'':c.diff, c.yieldPct===null?'':Number((c.yieldPct*100).toFixed(2)),
      rec.passFail||'', rec.qcBy||'', rec.invoice||''
    ]);
  });
  return allRows;
}
function exportTotalExcel(month, items){
  const m = month || dashMonth || currentMonthLabel();
  const selected = items || requireExportSelection(m);
  if(!selected) return;
  const summary = computeSummaryFromItems(selected);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(buildSummarySheetRows(m, summary)), 'Total Summary');
  const fileName = 'CANA_Total_' + monthFileTag(m) + '.xlsx';
  XLSX.writeFile(wb, fileName);
  appendExportLog(buildExportLogEntry({ month: m, exportType: 'total', items: selected, fileName }));
  showDocToast('Exported ' + fileName);
}
function exportMonthExcel(month, items){
  const m = month || dashMonth || currentMonthLabel();
  const selected = items || requireExportSelection(m);
  if(!selected) return;
  const summary = computeSummaryFromItems(selected);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(buildSummarySheetRows(m, summary)), 'Summary');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(buildAllFarmsSheetRows(selected)), 'All Farms');
  EXPORT_COMPANIES.forEach(company=>{
    const rows = [company.columns.map(c=>c.label)];
    sortExportItems(selected).forEach(({rec,farm})=>{
      rows.push(company.columns.map(col=> exportRowValue(rec, farm, col)));
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), company.name.slice(0,31));
  });
  const fileName = 'CANA_' + monthFileTag(m) + '.xlsx';
  XLSX.writeFile(wb, fileName);
  appendExportLog(buildExportLogEntry({ month: m, exportType: 'full', items: selected, fileName }));
  showDocToast('Exported ' + fileName);
}
function exportCompanyExcel(companyId, month, items){
  const company = EXPORT_COMPANIES.find(c=>c.id === companyId);
  if(!company) return;
  const m = month || dashMonth || currentMonthLabel();
  const selected = items || requireExportSelection(m);
  if(!selected) return;
  const wb = XLSX.utils.book_new();
  const rows = [['Report for:', company.name], ['Month:', m], ['Batches selected:', selected.length], [], company.columns.map(c=>c.label)];
  sortExportItems(selected).forEach(({rec,farm})=>{
    rows.push(company.columns.map(col=> exportRowValue(rec, farm, col)));
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), company.name.slice(0,31));
  const fileName = 'CANA_' + company.name + '_' + monthFileTag(m) + '.xlsx';
  XLSX.writeFile(wb, fileName);
  appendExportLog(buildExportLogEntry({ month: m, exportType: 'company', company: company.name, items: selected, fileName }));
  showDocToast('Exported ' + fileName);
}
function renderExportBatchPicker(month){
  ensureExportSelection(month);
  const monthItems = recordsForMonth(month);
  if(!monthItems.length){
    return `<div class="panel empty-state">No batches with delivery date in <b>${esc(month)}</b>. Add QC records first or pick another month.</div>`;
  }
  const selectedCount = getSelectedExportItems(month).length;
  const farmsWithData = getFarmList().filter(f=> monthItems.some(({farm})=> farm === f));
  const groups = farmsWithData.map(farm=>{
    const items = monthItems.filter(({farm})=> farm === f);
    const rows = items.map(({rec,farm})=>{
      const key = exportBatchKey({rec,farm});
      const c = computeRow(rec);
      const checked = exportSelection[key] ? 'checked' : '';
      const pf = passFailBadgeClass(rec);
      return `<label class="export-batch-row">
        <input type="checkbox" class="export-batch-cb" data-export-key="${esc(key)}" ${checked}>
        <span class="batch-id">${esc(getBatchId(rec,farm))}</span>
        <span>${esc(rec.strain||'—')}</span>
        <span class="muted">${esc(rec.date||'—')}</span>
        <span>${fmtNum(rec.startWt)||'—'} g</span>
        <span class="status-chip ${pf||'pending'}">${esc((rec.passFail||'—').split(' / ')[0])}</span>
        <span>${fmtPct(c.yieldPct)||'—'}</span>
      </label>`;
    }).join('');
    return `<div class="export-farm-group">
      <div class="export-farm-head"><b>${esc(farm)}</b> <span class="muted">${items.length} batch${items.length===1?'':'es'}</span></div>
      <div class="export-batch-list">${rows}</div>
    </div>`;
  }).join('');
  return `
    <div class="panel export-batch-picker">
      <div class="export-picker-head">
        <div>
          <h3 style="margin:0 0 4px;font-size:15px;">Step 2 — Select batches <span class="bi">/ เลือก batch</span></h3>
          <p class="sub" style="margin:0;font-size:12px;color:var(--muted);">${monthItems.length} in month · <b id="exportSelectedCount">${selectedCount}</b> selected for export</p>
        </div>
        <div class="export-picker-actions">
          <button type="button" class="small" id="btnExportSelectAll">Select all</button>
          <button type="button" class="small ghost" id="btnExportClearAll">Clear</button>
        </div>
      </div>
      ${groups}
    </div>`;
}
function formatExportType(t){
  if(t === 'company') return 'Company';
  if(t === 'total') return 'Total';
  if(t === 'full') return 'Full package';
  return t || '—';
}
function formatExportLogTime(iso){
  if(!iso) return '—';
  const d = new Date(iso);
  if(isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(undefined, { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
}
function truncateText(s, max){
  const t = String(s||'');
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}
function renderExportLogPanel(month){
  const logs = exportLogsForMonth(month);
  if(!logs.length){
    return `<div class="panel export-log-panel"><h3 style="margin:0 0 8px;font-size:14px;">Export log — ${esc(month)}</h3><p class="sub" style="margin:0;font-size:12px;color:var(--muted);">No exports logged for this month yet. Each download is recorded here and synced to the <b>Export Log</b> sheet tab.</p></div>`;
  }
  const rows = logs.map(log=>`<tr>
    <td>${esc(formatExportLogTime(log.exportedAt))}</td>
    <td><span class="export-type-chip ${esc(log.exportType)}">${esc(formatExportType(log.exportType))}</span>${log.company ? ' · ' + esc(log.company) : ''}</td>
    <td>${log.batchCount}</td>
    <td class="export-log-batches" title="${esc(log.batchIds||'')}">${esc(truncateText(log.batchIds, 48))}</td>
    <td>${esc(log.fileName||'—')}</td>
    <td>${esc(log.exportedBy||'—')}</td>
  </tr>`).join('');
  return `<div class="panel export-log-panel">
    <h3 style="margin:0 0 8px;font-size:14px;">Export log — ${esc(month)} <span class="bi">/ บันทึกการส่งออก</span></h3>
    <p class="sub" style="margin:0 0 12px;font-size:12px;color:var(--muted);">Trace back which batches were sent — synced to Google Sheet tab <b>Export Log</b>.</p>
    <div class="table-wrap"><table class="compact-table export-log-table">
      <thead><tr><th>When</th><th>Type</th><th>Batches</th><th>Batch IDs</th><th>File</th><th>By</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div>`;
}
function renderExportBuilderPanel(month){
  const selected = getSelectedExportItems(month);
  const summary = computeSummaryFromItems(selected);
  const previewCompany = EXPORT_COMPANIES[0];
  return `
    <div class="panel export-builder-intro">
      <p style="margin:0 0 6px;font-size:13px;"><b>Step 1 — Month</b> is set above. All exports use batches from <b>${esc(month)}</b> only.</p>
      <p style="margin:0;font-size:12px;color:var(--muted);">${recordsForMonth(month).length} batches in month · ${selected.length} selected · ${summary.total.pass} pass · ${summary.total.fail} fail</p>
    </div>
    ${renderExportBatchPicker(month)}
    <div class="panel" style="margin-bottom:16px;">
      <h3 style="margin:0 0 12px;font-size:15px;">Step 3 — Download <span class="bi">/ ส่งออก</span></h3>
      <div class="export-grid">
        <div class="export-card">
          <h3>📊 Total export</h3>
          <p>Summary only — per farm subtotals + grand total. <b>${selected.length}</b> batch${selected.length===1?'':'es'}.</p>
          <div class="actions"><button class="primary" id="btnExportTotal">⬇ Total — ${esc(month)}</button></div>
        </div>
        ${EXPORT_COMPANIES.map(company=>`<div class="export-card">
          <h3>${esc(company.name)} detail</h3>
          <p>${esc(company.description)} Selected: <b>${selected.length}</b> batches.</p>
          <div class="actions"><button class="primary" data-export-company="${company.id}">⬇ ${esc(company.name)} — ${esc(month)}</button></div>
        </div>`).join('')}
        <div class="export-card">
          <h3>📦 Full month package</h3>
          <p>Summary + All Farms + company sheets. <b>${selected.length}</b> selected batches.</p>
          <div class="actions"><button class="primary" id="btnExportMonthCard">⬇ Full package — ${esc(month)}</button></div>
        </div>
      </div>
    </div>
    ${previewCompany ? `<div class="panel"><h3 style="margin:0 0 8px;font-size:14px;">Preview — ${esc(previewCompany.label)} (${selected.length} selected)</h3>${renderCompanyPreviewTable(previewCompany, month, selected)}</div>` : ''}
    ${renderExportLogPanel(month)}`;
}
function bindExportBuilderEvents(main, month){
  const refreshExportUi = ()=>{
    const sel = getSelectedExportItems(month).length;
    const countEl = document.getElementById('exportSelectedCount');
    if(countEl) countEl.textContent = String(sel);
    const intro = main.querySelector('.export-builder-intro p:last-child');
    if(intro){
      const s = computeSummaryFromItems(getSelectedExportItems(month));
      intro.innerHTML = `${recordsForMonth(month).length} batches in month · ${sel} selected · ${s.total.pass} pass · ${s.total.fail} fail`;
    }
  };
  main.querySelectorAll('.export-batch-cb').forEach(cb=>{
    cb.onchange = ()=>{
      exportSelection[cb.dataset.exportKey] = cb.checked;
      refreshExportUi();
    };
  });
  const selAll = main.querySelector('#btnExportSelectAll');
  const clrAll = main.querySelector('#btnExportClearAll');
  if(selAll) selAll.onclick = ()=>{ setAllExportSelection(month, true); renderDashboard(); };
  if(clrAll) clrAll.onclick = ()=>{ setAllExportSelection(month, false); renderDashboard(); };
  const btnTotal = main.querySelector('#btnExportTotal');
  if(btnTotal) btnTotal.onclick = ()=> exportTotalExcel(month);
  const btnFull = main.querySelector('#btnExportMonthCard');
  if(btnFull) btnFull.onclick = ()=> exportMonthExcel(month);
  main.querySelectorAll('[data-export-company]').forEach(btn=> btn.onclick = ()=> exportCompanyExcel(btn.dataset.exportCompany, month));
}

/* ============ DASHBOARD COMPUTE ============ */
function allMonths(){
  const set = new Set();
  getFarmList().forEach(f=>(state.farms[f]||[]).forEach(r=>{ const m = r.date?formatMonth(r.date):''; if(m) set.add(m); }));
  return Array.from(set).sort((a,b)=>new Date('1 '+a) - new Date('1 '+b));
}
function allTrimMonths(){
  const set = new Set(allMonths());
  (state.trimming||[]).forEach(r=>{ const m = r.date?formatMonth(r.date):''; if(m) set.add(m); });
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
  if(!isLoggedIn()) return;
  renderTabs();
  if(currentView==='dashboard') renderDashboard();
  else if(currentView==='allFarms') renderAllFarmsView();
  else if(currentView==='trimming') renderTrimmingView();
  else if(currentFarmTab==='documents') renderFarmDocuments();
  else renderFarmView();
  updateAdminUI();
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

  function navBtn(label, active, onClick){
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = label;
    b.className = active ? 'active' : '';
    b.onclick = ()=>{ farmNavOpen = false; onClick(); };
    return b;
  }

  nav.appendChild(navBtn('📊 Dashboard', currentView === 'dashboard', ()=>{ currentView = 'dashboard'; render(); }));
  nav.appendChild(navBtn('🌐 All Farms', currentView === 'allFarms', ()=>{ currentView = 'allFarms'; render(); }));
  nav.appendChild(navBtn('✂️ Trimming', currentView === 'trimming', ()=>{ currentView = 'trimming'; render(); }));

  const divider = document.createElement('span');
  divider.className = 'nav-divider';
  divider.setAttribute('aria-hidden', 'true');
  nav.appendChild(divider);

  const farms = getFarmList();
  const farmPendingTotal = farms.reduce((n, f)=> n + countPendingFarm(f), 0);
  const triggerLabel = currentView === 'farm' ? currentFarm : 'Select farm';
  const picker = document.createElement('div');
  picker.className = 'farm-picker' + (farmNavOpen ? ' open' : '');
  picker.innerHTML = `
    <button type="button" class="farm-picker-trigger ${currentView === 'farm' ? 'active' : ''}" id="farmPickerTrigger" aria-haspopup="listbox" aria-expanded="${farmNavOpen}">
      <span class="farm-picker-icon" aria-hidden="true">🏡</span>
      <span class="farm-picker-label">${esc(triggerLabel)}</span>
      ${farmPendingTotal ? `<span class="tab-badge">${farmPendingTotal}</span>` : ''}
      <span class="farm-picker-chevron" aria-hidden="true">▾</span>
    </button>
    <div class="farm-picker-menu" role="listbox">
      ${farms.map(farm=>{
        const pending = countPendingFarm(farm);
        const selected = currentView === 'farm' && currentFarm === farm;
        return `<button type="button" class="farm-picker-item ${selected ? 'selected' : ''}" data-farm="${esc(farm)}" role="option" aria-selected="${selected}">
          <span class="farm-picker-check">${selected ? '✓' : ''}</span>
          <span class="farm-picker-name">${esc(farm)}</span>
          ${pending ? `<span class="tab-badge">${pending}</span>` : ''}
        </button>`;
      }).join('')}
      <div class="farm-picker-footer admin-only">
        <button type="button" class="farm-picker-manage" id="btnManageFarmsNav">⚙ Manage farms</button>
      </div>
    </div>`;
  nav.appendChild(picker);

  const spacer = document.createElement('span');
  spacer.className = 'nav-spacer';
  nav.appendChild(spacer);

  if(totalPending > 0){
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'nav-pending-pill';
    pill.innerHTML = `<span class="nav-pending-dot"></span>${totalPending} pending QC`;
    pill.onclick = ()=>{ currentView = 'allFarms'; pendingOnly = true; farmNavOpen = false; render(); };
    nav.appendChild(pill);
  }

  const trigger = picker.querySelector('#farmPickerTrigger');
  if(trigger){
    trigger.onclick = (e)=>{
      e.stopPropagation();
      farmNavOpen = !farmNavOpen;
      picker.classList.toggle('open', farmNavOpen);
      trigger.setAttribute('aria-expanded', farmNavOpen);
    };
  }
  picker.querySelectorAll('[data-farm]').forEach(btn=>{
    btn.onclick = (e)=>{
      e.stopPropagation();
      farmNavOpen = false;
      currentView = 'farm';
      currentFarm = btn.dataset.farm;
      currentFarmTab = 'qc';
      render();
    };
  });
  const manageNav = picker.querySelector('#btnManageFarmsNav');
  if(manageNav){
    manageNav.onclick = (e)=>{
      e.stopPropagation();
      farmNavOpen = false;
      openManageFarmsModal();
    };
  }
}

/* ============ RENDER: FARM VIEW ============ */
function getFilteredFarmRecords(){
  const records = state.farms[currentFarm]||[];
  return sortRecords(records.filter(matchesRecordFilters));
}
function farmResultsMarkup(filtered, records){
  return {
    table: filtered.length
      ? (viewMode==='full' ? renderFullTable(filtered) : renderCompactTable(filtered))
      : `<div class="empty-state">${records.length? 'No records match your filters.' : `<b>No records yet for ${esc(currentFarm)}.</b><br>Click "+ New Delivery" to add the first batch.`}</div>`,
    cards: filtered.length ? renderCardList(filtered) : '',
    count: `${filtered.length} of ${records.length} record(s) — ${currentFarm}`
  };
}
function updateFarmViewResults(){
  const main = document.getElementById('mainArea');
  if(!main || currentView !== 'farm' || currentFarmTab !== 'qc') return;
  const records = state.farms[currentFarm]||[];
  const filtered = getFilteredFarmRecords();
  const parts = farmResultsMarkup(filtered, records);
  const tableWrap = document.getElementById('farmTableWrap');
  const cardList = document.getElementById('farmCardList');
  const countEl = document.getElementById('farmRecordCount');
  if(tableWrap) tableWrap.innerHTML = parts.table;
  if(cardList) cardList.innerHTML = parts.cards;
  if(countEl) countEl.textContent = parts.count;
  bindRowActions(main);
  updateAdminUI();
}
function renderFarmView(){
  const main = document.getElementById('mainArea');
  const records = state.farms[currentFarm]||[];
  const filtered = getFilteredFarmRecords();
  const parts = farmResultsMarkup(filtered, records);
  const farmPending = countPendingFarm(currentFarm);

  main.innerHTML = `
    ${farmSubtabsHtml()}

    ${isStaff() ? `<p class="staff-hint"><b>Staff mode</b> — You can enter QC and upload documents. Delivery edits and deletes require a manager.<br><span class="bi">โหมดพนักงาน — กรอก QC และอัปโหลดเอกสารได้ · แก้ไขการรับสินค้าต้องใช้ผู้จัดการ</span></p>` : ''}

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
        <button class="primary admin-only" id="btnNewDelivery">+ New Delivery <span class="bi">/ รับสินค้าใหม่</span></button>
        <input class="search-box" id="searchBox" placeholder="Search strain, invoice, QC by…" value="${esc(searchText)}">
        <label class="chk"><input type="checkbox" id="chkPending" ${pendingOnly?'checked':''}> Pending QC only</label>
        <div class="view-toggle">
          <button class="${viewMode==='compact'?'active':''}" id="btnViewCompact">Compact / กระทัดรัด</button>
          <button class="${viewMode==='full'?'active':''}" id="btnViewFull">Full table / ตารางเต็ม</button>
        </div>
        ${getFarmList().length > 1 ? `<button type="button" class="small danger admin-only" id="btnDeleteCurrentFarm" title="Remove this farm (admin PIN)">🗑 Delete farm</button>` : ''}
      </div>
      <div style="font-size:12.5px;color:var(--muted);" id="farmRecordCount">${parts.count}</div>
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

    <div class="table-wrap desktop-table" id="farmTableWrap">
      ${parts.table}
    </div>
    <div class="card-list" id="farmCardList">
      ${parts.cards}
    </div>
  `;

  bindFarmSubtabs(main);
  const btnNewDel = document.getElementById('btnNewDelivery');
  if(btnNewDel) btnNewDel.onclick = () => openDeliveryModal(null);
  document.getElementById('searchBox').oninput = (e)=>{ searchText = e.target.value; updateFarmViewResults(); };
  document.getElementById('chkPending').onchange = (e)=>{ pendingOnly = e.target.checked; updateFarmViewResults(); };
  document.getElementById('btnViewCompact').onclick = ()=>{ viewMode='compact'; renderFarmView(); };
  document.getElementById('btnViewFull').onclick = ()=>{ viewMode='full'; renderFarmView(); };
  document.getElementById('filterStatus').onchange = (e)=>{ filterStatus = e.target.value; updateFarmViewResults(); };
  document.getElementById('filterDateFrom').onchange = (e)=>{ filterDateFrom = e.target.value; updateFarmViewResults(); };
  document.getElementById('filterDateTo').onchange = (e)=>{ filterDateTo = e.target.value; updateFarmViewResults(); };
  if(document.getElementById('btnShowPending')) document.getElementById('btnShowPending').onclick = ()=>{ pendingOnly=true; updateFarmViewResults(); };
  if(document.getElementById('btnClearMonth')) document.getElementById('btnClearMonth').onclick = ()=>{ farmMonthFilter=''; updateFarmViewResults(); };
  const btnDelFarm = document.getElementById('btnDeleteCurrentFarm');
  if(btnDelFarm) btnDelFarm.onclick = ()=> confirmRemoveFarm(currentFarm);
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
        <button class="small admin-only" data-farm="${esc(farm)}" data-edit-delivery="${rec.id}">Edit</button>
        <button class="small purple" data-farm="${esc(farm)}" data-edit-qc="${rec.id}">${pend?'Enter QC':'QC'}</button>
      </div></td>
    </tr>${expanded ? renderExpandedDetail(rec) : ''}`;
  }).join('') + '</tbody>';
  return `<table class="compact-table">${head}${body}</table>`;
}

function getFilteredAllFarmItems(){
  return getAllFarmRecords().filter(({rec,farm})=> matchesRecordFilters(rec, farm))
    .sort((a,b)=>{
      const ap = isPending(a.rec)?1:0, bp = isPending(b.rec)?1:0;
      if(ap !== bp) return bp - ap;
      return (b.rec.date||'').localeCompare(a.rec.date||'');
    });
}
function updateAllFarmsViewResults(){
  const main = document.getElementById('mainArea');
  if(!main || currentView !== 'allFarms') return;
  const allItems = getAllFarmRecords();
  const sortedItems = getFilteredAllFarmItems();
  const tableWrap = document.getElementById('allFarmsTableWrap');
  const countEl = document.getElementById('allFarmsRecordCount');
  if(tableWrap){
    tableWrap.innerHTML = sortedItems.length
      ? renderAllFarmsCompactTable(sortedItems)
      : `<div class="empty-state"><b>No batches match your filters.</b><br>Try clearing filters or add deliveries from a farm tab.</div>`;
  }
  if(countEl) countEl.textContent = `${sortedItems.length} of ${allItems.length} batch(es) across all farms`;
  bindRowActions(main, 'allFarms');
}
function renderAllFarmsView(){
  const main = document.getElementById('mainArea');
  const allItems = getAllFarmRecords();
  const sortedItems = getFilteredAllFarmItems();

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
      <div style="font-size:12.5px;color:var(--muted);" id="allFarmsRecordCount">${sortedItems.length} of ${allItems.length} batch(es) across all farms</div>
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

    <div class="table-wrap desktop-table" id="allFarmsTableWrap">
      ${sortedItems.length ? renderAllFarmsCompactTable(sortedItems) : `<div class="empty-state"><b>No batches match your filters.</b><br>Try clearing filters or add deliveries from a farm tab.</div>`}
    </div>
  `;

  document.getElementById('searchBox').oninput = (e)=>{ searchText = e.target.value; updateAllFarmsViewResults(); };
  document.getElementById('chkPending').onchange = (e)=>{ pendingOnly = e.target.checked; updateAllFarmsViewResults(); };
  document.getElementById('filterStatus').onchange = (e)=>{ filterStatus = e.target.value; updateAllFarmsViewResults(); };
  document.getElementById('allFarmsMonth').onchange = (e)=>{ farmMonthFilter = e.target.value; updateAllFarmsViewResults(); };
  document.getElementById('filterDateFrom').onchange = (e)=>{ filterDateFrom = e.target.value; updateAllFarmsViewResults(); };
  document.getElementById('filterDateTo').onchange = (e)=>{ filterDateTo = e.target.value; updateAllFarmsViewResults(); };
  if(document.getElementById('btnClearMonth')) document.getElementById('btnClearMonth').onclick = ()=>{ farmMonthFilter=''; updateAllFarmsViewResults(); };
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

/* ============ RENDER: TRIMMING ============ */
function getFilteredTrimmingRecords(){
  const type = trimTypeForSubTab(trimSubTab);
  const month = trimMonth || currentMonthLabel();
  const q = trimSearchText.trim().toLowerCase();
  return (state.trimming||[]).filter(rec=>{
    if(rec.type !== type) return false;
    if((rec.date ? formatMonth(rec.date) : '') !== month) return false;
    if(!q) return true;
    const hay = [rec.batchId, rec.sourceFarm, rec.strain, rec.trimmedBy, rec.notes].join(' ').toLowerCase();
    return hay.includes(q);
  }).slice().sort((a,b)=>(b.date||'').localeCompare(a.date||''));
}
function renderTrimStats(records){
  let input = 0, flower = 0, mold = 0, seeds = 0, stems = 0, waste = 0, n = 0;
  records.forEach(rec=>{
    const c = computeTrimRow(rec);
    if(num(rec.inputWt) !== null) input += num(rec.inputWt);
    if(c.totalFlower !== null) flower += c.totalFlower;
    if(num(rec.moldG) !== null) mold += num(rec.moldG);
    if(num(rec.seedsG) !== null) seeds += num(rec.seedsG);
    if(num(rec.stemsG) !== null) stems += num(rec.stemsG);
    if(num(rec.wasteG) !== null) waste += num(rec.wasteG);
    n++;
  });
  const avgYield = input ? flower / input : null;
  return { count: n, input, flower, mold, seeds, stems, waste, avgYield };
}
function renderTrimStatsMeta(stats){
  return `
    <span class="doc-badge">${stats.count} session${stats.count===1?'':'s'}</span>
    <span class="doc-badge">${fmtWeight(stats.input)} in</span>
    <span class="doc-badge">${fmtWeight(stats.flower)} flower</span>
    <span class="doc-badge">${fmtWeight(stats.mold)} mold</span>
    <span class="doc-badge">${fmtWeight(stats.seeds)} seeds</span>
    <span class="doc-badge">${fmtPct(stats.avgYield)||'—'} yield</span>`;
}
function renderTrimStatsKpi(stats){
  return `<div class="trim-kpi-row">
    <div class="kpi"><span>Sessions</span><b>${stats.count}</b></div>
    <div class="kpi"><span>Input</span><b>${fmtWeight(stats.input)}</b></div>
    <div class="kpi"><span>Flower out</span><b>${fmtWeight(stats.flower)}</b></div>
    <div class="kpi"><span>Mold removed</span><b>${fmtWeight(stats.mold)}</b></div>
    <div class="kpi"><span>Seeds removed</span><b>${fmtWeight(stats.seeds)}</b></div>
    <div class="kpi"><span>Stems / waste</span><b>${fmtWeight(stats.stems + stats.waste)}</b></div>
    <div class="kpi"><span>Avg yield</span><b>${fmtPct(stats.avgYield)||'—'}</b></div>
  </div>`;
}
function renderTrimmingTable(records){
  if(!records.length){
    return `<div class="panel empty-state"><b>No trimming records for this month.</b><br>Click <b>+ New session</b> to log ${esc(trimTypeForSubTab(trimSubTab))} weights (strain, input, mold, seeds, etc.).</div>`;
  }
  const head = `<thead><tr>
    <th>Date</th><th>Strain</th><th>Batch / Farm</th><th>Input</th><th>Flower out</th><th>Mold</th><th>Seeds</th><th>Stems</th><th>Waste</th><th>Yield</th><th>By</th><th>Status</th><th>Actions</th>
  </tr></thead>`;
  const body = records.map(rec=>{
    const c = computeTrimRow(rec);
    return `<tr>
      <td>${esc(rec.date||'—')}</td>
      <td><b>${esc(rec.strain||'—')}</b></td>
      <td><span class="batch-id">${esc(rec.batchId||'—')}</span><br><span style="font-size:11px;color:var(--muted)">${esc(rec.sourceFarm||'—')}</span></td>
      <td>${fmtWeight(rec.inputWt)}</td>
      <td>${fmtWeight(c.totalFlower)}</td>
      <td>${fmtWeight(rec.moldG)}</td>
      <td>${fmtWeight(rec.seedsG)}</td>
      <td>${fmtWeight(rec.stemsG)}</td>
      <td>${fmtWeight(rec.wasteG)}</td>
      <td>${fmtPct(c.yieldPct)||'—'}</td>
      <td>${esc(rec.trimmedBy||'—')}</td>
      <td><span class="status-chip ${(rec.status||'').indexOf('Complete')>=0?'pass':'pending'}">${esc((rec.status||'—').split(' / ')[0])}</span></td>
      <td><div class="action-group">
        <button class="small purple" data-edit-trim="${rec.id}">Edit</button>
        <button class="small danger admin-only" data-delete-trim="${rec.id}">Del</button>
      </div></td>
    </tr>`;
  }).join('');
  return `<div class="table-wrap desktop-table"><table class="compact-table trim-table">${head}<tbody>${body}</tbody></table></div>`;
}
function renderTrimmingView(){
  if(!requireLogin()) return;
  if(!trimMonth) trimMonth = currentMonthLabel();
  const months = allTrimMonths();
  if(!months.includes(trimMonth)) months.push(trimMonth);
  months.sort((a,b)=>new Date('1 '+a) - new Date('1 '+b));
  const main = document.getElementById('mainArea');
  const records = getFilteredTrimmingRecords();
  const stats = renderTrimStats(records);
  const isRework = trimSubTab === 'rework';
  const sheetTab = isRework ? 'Trim Rework' : 'Trim Cana';
  main.innerHTML = `
    <div class="trim-header">
      <div>
        <h2>✂️ Trimming — ${esc(isRework ? 'Rework flower' : 'Cana flower')}</h2>
        <p class="sub">${isRework ? 'Track each rework session: strain, input weight, flower out, mold, seeds, stems' : 'Track each Cana trim session: strain, weights in/out, mold, seeds'} · Syncs to Google Sheet tab <b>${esc(sheetTab)}</b> · <span class="bi">${isRework ? 'ทำความสะอาดดอกจากฟาร์มอื่น' : 'ดอก Cana ปลูกเอง'}</span></p>
      </div>
      <div class="trim-header-meta" id="trimStatsMeta">${renderTrimStatsMeta(stats)}</div>
    </div>

    <div class="trim-subtabs">
      <button type="button" class="${trimSubTab==='rework'?'active':''}" id="btnTrimRework">🔄 Rework flower <span class="bi">/ รีเวิร์ค</span></button>
      <button type="button" class="${trimSubTab==='cana'?'active':''}" id="btnTrimCana">🌿 Cana flower <span class="bi">/ Cana</span></button>
    </div>

    <div class="row-actions trim-toolbar">
      <button class="primary" id="btnNewTrim">+ New session <span class="bi">/ เพิ่มรายการ</span></button>
      <label class="month-filter">Month:
        <select id="trimMonthInput">
          ${months.map(m=>`<option value="${esc(m)}" ${m===trimMonth?'selected':''}>${esc(m)}</option>`).join('')}
        </select>
      </label>
      <input class="search-box" id="trimSearchBox" placeholder="Search batch, strain, name…" value="${esc(trimSearchText)}">
    </div>

    ${renderTrimStatsKpi(stats)}

    <div id="trimResultsWrap">${renderTrimmingTable(records)}</div>
  `;
  document.getElementById('btnTrimRework').onclick = ()=>{ trimSubTab='rework'; renderTrimmingView(); };
  document.getElementById('btnTrimCana').onclick = ()=>{ trimSubTab='cana'; renderTrimmingView(); };
  document.getElementById('btnNewTrim').onclick = ()=> openTrimmingModal(null);
  document.getElementById('trimMonthInput').onchange = (e)=>{ trimMonth = e.target.value; renderTrimmingView(); };
  document.getElementById('trimSearchBox').oninput = (e)=>{ trimSearchText = e.target.value; updateTrimViewResults(); };
  bindTrimActions(main);
}
function updateTrimViewResults(){
  const main = document.getElementById('mainArea');
  if(!main || currentView !== 'trimming') return;
  const records = getFilteredTrimmingRecords();
  const stats = renderTrimStats(records);
  const meta = document.getElementById('trimStatsMeta');
  if(meta) meta.innerHTML = renderTrimStatsMeta(stats);
  const kpi = main.querySelector('.trim-kpi-row');
  if(kpi) kpi.outerHTML = renderTrimStatsKpi(stats);
  const wrap = document.getElementById('trimResultsWrap');
  if(wrap) wrap.innerHTML = renderTrimmingTable(records);
  bindTrimActions(main);
}
function bindTrimActions(root){
  root.querySelectorAll('[data-edit-trim]').forEach(el=> el.onclick = ()=> openTrimmingModal(el.dataset.editTrim));
  root.querySelectorAll('[data-delete-trim]').forEach(el=> el.onclick = ()=> deleteTrimmingRecord(el.dataset.deleteTrim));
  updateAdminUI();
}
function openTrimmingModal(id){
  if(!requireLogin()) return;
  const type = trimTypeForSubTab(trimSubTab);
  const rec = id ? (state.trimming||[]).find(r=>r.id===id) : {
    id: uid(), type, date: todayISO(), sourceFarm: type === 'Cana flower' ? 'Cana' : '',
    batchId:'', linkedRecordId:'', strain:'', inputWt:'', outputBigsG:'', outputPopsG:'',
    moldG:'', seedsG:'', stemsG:'', wasteG:'', trimmedBy:'', status: TRIM_STATUS_OPTIONS[0], notes:''
  };
  if(!rec) return;
  const isNew = !id;
  const batchOpts = getAllQcBatchOptions();
  const batchSelect = trimSubTab === 'rework' ? `
    <div class="field full">
      <label>Link QC batch <span>optional — auto-fills farm & strain</span></label>
      <select name="linkedBatch" id="trimBatchSelect">
        <option value="">— Select batch —</option>
        ${batchOpts.map(o=>`<option value="${esc(o.recordId)}" data-farm="${esc(o.farm)}" data-batch="${esc(o.batchId)}" data-strain="${esc(o.strain)}" ${rec.linkedRecordId===o.recordId?'selected':''}>${esc(o.label)}</option>`).join('')}
      </select>
    </div>` : '';
  const fields = TRIMMING_COLS.filter(c=> !(trimSubTab === 'cana' && c.key === 'sourceFarm'))
    .map(c=> fieldHtml(c, rec[c.key])).join('');
  const c = computeTrimRow(rec);
  modalDirty = !isNew;
  const root = document.getElementById('modalRoot');
  root.innerHTML = `
  <div class="overlay" id="overlay">
    <div class="modal" style="max-width:720px">
      <h2>${isNew?'+ New':'Edit'} trimming — ${esc(type)}</h2>
      <form id="trimForm" class="form-grid">
        <input type="hidden" name="type" value="${esc(type)}">
        ${batchSelect}
        ${fields}
        <div class="live-preview full">
          <div class="preview-grid trim-preview">
            <div><span>Input</span><b id="tpInput">${fmtWeight(rec.inputWt)}</b></div>
            <div><span>Flower out</span><b id="tpFlower">${fmtWeight(c.totalFlower)}</b></div>
            <div><span>Mold</span><b id="tpMold">${fmtWeight(rec.moldG)}</b></div>
            <div><span>Seeds</span><b id="tpSeeds">${fmtWeight(rec.seedsG)}</b></div>
            <div><span>Stems</span><b id="tpStems">${fmtWeight(rec.stemsG)}</b></div>
            <div><span>Waste</span><b id="tpWaste">${fmtWeight(rec.wasteG)}</b></div>
            <div><span>Total out</span><b id="tpOut">${fmtWeight(c.totalOut)}</b></div>
            <div><span>Diff</span><b id="tpDiff">${c.diff!==null?fmtWeight(c.diff):'—'}</b></div>
            <div><span>Yield</span><b id="tpYield">${fmtPct(c.yieldPct)||'—'}</b></div>
          </div>
        </div>
        <div class="modal-actions full">
          <button type="button" class="ghost" id="btnCancelTrim">Cancel</button>
          <button type="submit" class="primary">Save</button>
        </div>
      </form>
    </div>
  </div>`;
  const close = ()=>{ if(modalDirty && !confirm('Discard unsaved changes?')) return; modalDirty=false; closeModal(); };
  root.querySelector('#btnCancelTrim').onclick = close;
  root.querySelector('#overlay').onclick = (e)=>{ if(e.target.id==='overlay') close(); };
  const form = root.querySelector('#trimForm');
  const batchSel = root.querySelector('#trimBatchSelect');
  if(batchSel){
    batchSel.onchange = ()=>{
      const opt = batchSel.selectedOptions[0];
      if(!opt || !opt.value) return;
      const farmIn = form.querySelector('[name=sourceFarm]');
      const strainIn = form.querySelector('[name=strain]');
      const batchIn = form.querySelector('[name=batchId]');
      if(farmIn) farmIn.value = opt.dataset.farm || '';
      if(strainIn) strainIn.value = opt.dataset.strain || '';
      if(batchIn) batchIn.value = opt.dataset.batch || '';
      modalDirty = true;
      updateTrimPreview(form);
    };
  }
  form.addEventListener('input', ()=>{ modalDirty = true; updateTrimPreview(form); });
  form.addEventListener('change', ()=>{ modalDirty = true; updateTrimPreview(form); });
  form.onsubmit = (e)=>{
    e.preventDefault();
    const fd = new FormData(form);
    const updated = { ...rec };
    updated.type = type;
    TRIMMING_COLS.forEach(col=>{
      updated[col.key] = String(fd.get(col.key) ?? '').trim();
    });
    updated.linkedRecordId = batchSel ? String(fd.get('linkedBatch')||'') : (rec.linkedRecordId||'');
    if(trimSubTab === 'rework' && batchSel && updated.linkedRecordId){
      const opt = batchSel.selectedOptions[0];
      if(opt){
        updated.sourceFarm = opt.dataset.farm || updated.sourceFarm;
        updated.batchId = opt.dataset.batch || updated.batchId;
        updated.strain = opt.dataset.strain || updated.strain;
      }
    }
    if(trimSubTab === 'cana') updated.sourceFarm = 'Cana';
    if(!state.trimming) state.trimming = [];
    if(isNew) state.trimming.push(updated);
    else {
      const i = state.trimming.findIndex(r=>r.id===rec.id);
      if(i >= 0) state.trimming[i] = updated;
    }
    modalDirty = false;
    onDataChanged();
    closeModal();
    renderTrimmingView();
    showDocToast('Trimming record saved');
  };
}
function updateTrimPreview(form){
  const rec = {};
  TRIMMING_COLS.forEach(col=>{ rec[col.key] = form.querySelector(`[name=${col.key}]`)?.value || ''; });
  const c = computeTrimRow(rec);
  const set = (id, val)=>{ const el = document.getElementById(id); if(el) el.textContent = val; };
  set('tpInput', fmtWeight(rec.inputWt));
  set('tpFlower', fmtWeight(c.totalFlower));
  set('tpMold', fmtWeight(rec.moldG));
  set('tpSeeds', fmtWeight(rec.seedsG));
  set('tpStems', fmtWeight(rec.stemsG));
  set('tpWaste', fmtWeight(rec.wasteG));
  set('tpOut', fmtWeight(c.totalOut));
  set('tpDiff', c.diff!==null ? fmtWeight(c.diff) : '—');
  set('tpYield', fmtPct(c.yieldPct)||'—');
}
function deleteTrimmingRecord(id){
  if(!requireAdmin('delete trimming record', ()=> deleteTrimmingRecord(id))) return;
  const rec = (state.trimming||[]).find(r=>r.id===id);
  if(!rec) return;
  if(!confirm('Delete this trimming record?\nลบรายการทริมนี้?')) return;
  state.trimming = (state.trimming||[]).filter(r=>r.id!==id);
  onDataChanged();
  if(appsScriptUrl){
    clearTimeout(sheetSaveTimer);
    pushToGoogleSheet(true);
  }
  renderTrimmingView();
}

/* ============ RENDER: FARM DOCUMENTS ============ */
function getFilteredFarmDocuments(){
  return (state.documents[currentFarm]||[]).filter(matchesDocFilters)
    .slice().sort((a,b)=>(b.uploadedAt||'').localeCompare(a.uploadedAt||''));
}
function bindDocGridActions(main){
  main.querySelectorAll('[data-edit-doc]').forEach(el=> el.onclick = ()=> openDocumentModal(el.dataset.editDoc));
  main.querySelectorAll('[data-download-doc]').forEach(el=> el.onclick = ()=>{
    const doc = state.documents[currentFarm].find(d=>d.id===el.dataset.downloadDoc);
    if(doc) downloadDocument(doc);
  });
  main.querySelectorAll('[data-open-doc]').forEach(el=> el.onclick = ()=>{
    const doc = state.documents[currentFarm].find(d=>d.id===el.dataset.openDoc);
    if(doc) openDocument(doc);
  });
  main.querySelectorAll('[data-open-doc-link]').forEach(el=> el.onclick = (e)=>{
    e.preventDefault();
    const doc = state.documents[currentFarm].find(d=>d.id===el.dataset.openDocLink);
    if(doc && doc.url) openExternalDocUrl(doc.url);
    else if(el.href) openExternalLink(el.getAttribute('href'));
  });
  main.querySelectorAll('[data-delete-doc]').forEach(el=> el.onclick = ()=> deleteDocument(el.dataset.deleteDoc));
  updateAdminUI();
}
function updateDocViewResults(){
  const main = document.getElementById('mainArea');
  if(!main || currentView !== 'farm' || currentFarmTab !== 'documents') return;
  const docs = getFilteredFarmDocuments();
  const linkedCount = docs.filter(d=>d.url).length;
  const grid = document.getElementById('docResultsWrap');
  const countBadge = document.getElementById('docCountBadge');
  const linkBadge = document.getElementById('docLinkBadge');
  if(grid){
    grid.innerHTML = docs.length ? `<div class="doc-grid">${docs.map(renderDocCard).join('')}</div>` : `
      <div class="panel empty-state">
        <b>${docSearchText || docCategoryFilter ? 'No documents match your search.' : `No documents yet for ${esc(currentFarm)}.`}</b><br>
        ${docSearchText || docCategoryFilter ? 'Try a different keyword or category.' : 'Follow the 3 steps above — recommended: Google Drive link for team access.<div class="upload-hint">Quick upload (this device only): Upload File · max 8 MB</div>'}
      </div>`;
  }
  if(countBadge) countBadge.textContent = `${docs.length} document${docs.length===1?'':'s'}`;
  if(linkBadge) linkBadge.textContent = `${linkedCount} team link${linkedCount===1?'':'s'}`;
  bindDocGridActions(main);
}
function renderFarmDocuments(){
  const main = document.getElementById('mainArea');
  const docs = getFilteredFarmDocuments();
  const linkedCount = docs.filter(d=> isValidExternalUrl(d.url)).length;
  const driveReady = hasDriveUploadForFarm(currentFarm);

  main.innerHTML = `
    ${farmSubtabsHtml()}

    <div class="doc-header">
      <h3>📁 Document Library — ${esc(currentFarm)}</h3>
      <div class="doc-header-meta">
        <span class="doc-badge" id="docCountBadge">${docs.length} document${docs.length===1?'':'s'}</span>
        <span class="doc-badge" id="docLinkBadge">${linkedCount} on Drive</span>
        <span class="doc-badge">${driveReady ? '☁️ Upload → Cana Documents/' + esc(currentFarm) : '⚠️ Link Drive folder (admin)'}</span>
      </div>
    </div>

    <div class="doc-steps">
      <div class="doc-step"><div class="doc-step-num">1</div><b>Upload in app</b><span>Click <b>Upload File</b> — saves to shared Drive folder for this farm.</span></div>
      <div class="doc-step"><div class="doc-step-num">2</div><b>Auto team access</b><span>Everyone sees the document after sync (~6 sec).</span></div>
      <div class="doc-step"><div class="doc-step-num">3</div><b>Open anytime</b><span>Click Open — file opens from Google Drive.</span></div>
    </div>

    <div class="doc-toolbar">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
        <button class="primary" id="btnUploadDoc">📎 Upload File <span class="bi">/ อัปโหลดไฟล์</span></button>
        ${isAdmin() ? `<button id="btnAddDoc">+ Add link <span class="bi">/ เพิ่มลิงก์</span></button>` : ''}
        <input class="search-box" id="docSearchBox" placeholder="Search documents… / ค้นหาเอกสาร…" value="${esc(docSearchText)}">
        <select id="docCategoryFilter">
          <option value="">All categories / ทุกหมวด</option>
          ${DOCUMENT_CATEGORIES.map(c=>`<option value="${esc(c)}" ${docCategoryFilter===c?'selected':''}>${esc(c)}</option>`).join('')}
        </select>
      </div>
    </div>

    <div id="docResultsWrap">
    ${docs.length ? `<div class="doc-grid">${docs.map(renderDocCard).join('')}</div>` : `
      <div class="panel empty-state">
        <b>No documents yet for ${esc(currentFarm)}. / ยังไม่มีเอกสาร</b><br>
        Follow the 3 steps above — recommended: Google Drive link for team access.
        <div class="upload-hint">Quick upload (this device only): Upload File · max 8 MB</div>
      </div>`}
    </div>
  `;

  bindFarmSubtabs(main);
  document.getElementById('btnUploadDoc').onclick = ()=>{
    if(!hasDriveUploadForFarm(currentFarm)){
      alert('Drive not configured for ' + currentFarm + '.\n\nAdmin: Log in → More → Drive Folders → paste the Cana Documents parent folder link.\n\nยังไม่ได้ตั้งค่าโฟลเดอร์ Drive');
      return;
    }
    document.getElementById('docUploadInput').click();
  };
  const btnAdd = document.getElementById('btnAddDoc');
  if(btnAdd) btnAdd.onclick = ()=> openDocumentModal(null);
  document.getElementById('docSearchBox').oninput = (e)=>{ docSearchText = e.target.value; updateDocViewResults(); };
  document.getElementById('docCategoryFilter').onchange = (e)=>{ docCategoryFilter = e.target.value; updateDocViewResults(); };
  bindDocGridActions(main);
}

function renderDocCard(doc){
  const icon = docFileIcon(doc);
  const hasFile = !!(doc.data || doc.url || doc._fileInIdb || doc.hasLocalFile);
  const hasLink = isValidExternalUrl(doc.url);
  const cardClass = hasLink ? 'has-link' : ((doc._fileInIdb || doc.data || doc.hasLocalFile) ? 'local-only' : '');
  const syncTag = hasLink
    ? '<span class="doc-sync-tag synced">On Google Drive · team access ✓</span>'
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
    ${hasLink ? `<div class="doc-link-row"><a href="${esc(normalizeExternalUrl(doc.url))}" target="_blank" rel="noopener" data-open-doc-link="${doc.id}">Open in Google Drive ↗</a></div>` : (doc.url ? `<div class="doc-link-row doc-link-broken">Link needs update — edit document and paste full Drive file URL</div>` : '')}
    ${doc.notes ? `<div class="doc-notes">${esc(doc.notes)}</div>` : ''}
    <div class="doc-actions">
      ${hasLink ? `<button class="small primary" data-open-doc="${doc.id}">Open / เปิด</button>` : ''}
      ${hasFile && !hasLink ? `<button class="small" data-open-doc="${doc.id}">Open / เปิด</button><button class="small" data-download-doc="${doc.id}">Download / ดาวน์โหลด</button>` : ''}
      ${hasFile && hasLink ? `<button class="small" data-download-doc="${doc.id}">Download / ดาวน์โหลด</button>` : ''}
      ${isAdmin() ? `<button class="small admin-only" data-edit-doc="${doc.id}">Edit / แก้ไข</button>` : ''}
      ${isAdmin() ? `<button class="small danger admin-only" data-delete-doc="${doc.id}">Delete / ลบ</button>` : ''}
    </div>
  </div>`;
}

function openDocumentModal(id, prefill){
  if(!requireAdmin('manage documents', ()=> openDocumentModal(id, prefill))) return;
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
      url: normalizeExternalUrl(fd.get('url') || ''),
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
  if(!hasDriveUploadForFarm(currentFarm)){
    alert('Drive not configured for ' + currentFarm + '.\n\nAdmin: Log in → More → Drive Folders → paste the Cana Documents parent folder link.\n\nยังไม่ได้ตั้งค่าโฟลเดอร์ Drive');
    return;
  }
  let ok = 0, fail = 0;
  for(const file of files){
    if(file.size > MAX_DOC_BYTES){
      alert('Skipped "' + file.name + '" — too large (max 8 MB).');
      fail++;
      continue;
    }
    try{
      showDocToast('Uploading ' + file.name + ' to Drive…');
      const res = await uploadFileToFarmDrive(file, currentFarm);
      state.documents[currentFarm].push({
        id: uid(),
        title: file.name.replace(/\.[^.]+$/,''),
        category: DOCUMENT_CATEGORIES[DOCUMENT_CATEGORIES.length - 1],
        fileName: res.fileName || file.name,
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
        notes: '',
        uploadedBy: '',
        uploadedAt: new Date().toISOString().slice(0,10),
        url: res.url || '',
        data: ''
      });
      ok++;
    }catch(e){
      alert('Upload failed for "' + file.name + '":\n' + e.message);
      fail++;
    }
  }
  if(ok){
    onDataChanged();
    currentFarmTab = 'documents';
    render();
    showDocToast(ok + ' file(s) uploaded to Cana Documents/' + currentFarm);
  }
}

function deleteDocument(id){
  if(!requireAdmin('delete document', ()=> deleteDocument(id))) return;
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
        <button class="small admin-only" data-edit-delivery="${rec.id}">Edit</button>
        <button class="small purple" data-edit-qc="${rec.id}">${pend?'Enter QC':'QC'}</button>
        <button class="small danger admin-only" data-delete="${rec.id}">Del</button>
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
        <button class="small admin-only" data-edit-delivery="${rec.id}">Edit Delivery</button>
        <button class="small purple" data-edit-qc="${rec.id}">${pend?'Enter QC':'Edit QC'}</button>
        <button class="small danger admin-only" data-delete="${rec.id}">Delete</button>
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
        <button class="small admin-only" data-edit-delivery="${rec.id}">Edit</button>
        <button class="small purple" data-edit-qc="${rec.id}">${pend?'Enter QC':'QC'}</button>
        <button class="small danger admin-only" data-delete="${rec.id}">Del</button>
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
  if(!requireManager('delivery records')) return;
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
  if(!requireLogin()) return;
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
  if(!requireAdmin('delete QC record', ()=> deleteRecord(id))) return;
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
  if(appsScriptUrl){
    clearTimeout(sheetSaveTimer);
    pushToGoogleSheet(true);
  }
  if(currentView === 'allFarms') renderAllFarmsView();
  else renderFarmView();
}

/* ============ DASHBOARD RENDER ============ */
function renderCompanyPreviewTable(company, month, items){
  const monthItems = items || recordsForMonth(month);
  if(!monthItems.length) return `<div class="empty-state" style="padding:24px;">No batches selected for ${esc(month)}.</div>`;
  const previewCols = company.columns.slice(0, 8);
  return `<div class="table-wrap"><table><thead><tr>${previewCols.map(c=>`<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>
    ${monthItems.slice(0,12).map(({rec,farm})=>`<tr>${previewCols.map(col=>`<td>${esc(String(exportRowValue(rec,farm,col)))}</td>`).join('')}</tr>`).join('')}
    ${monthItems.length > 12 ? `<tr><td colspan="${previewCols.length}" style="color:var(--muted);font-size:12px;">+ ${monthItems.length-12} more in export file…</td></tr>` : ''}
  </tbody></table></div>`;
}

function renderDashboard(){
  if(!dashMonth) dashMonth = currentMonthLabel();
  const months = allMonths();
  if(!months.includes(dashMonth)) months.push(dashMonth);
  months.sort((a,b)=>new Date('1 '+a) - new Date('1 '+b));
  const summary = computeDashboard(dashMonth);
  const main = document.getElementById('mainArea');
  main.innerHTML = `
    <div class="panel">
      <div class="dash-filter">
        <label style="font-size:13px;font-weight:600;">Month <span class="bi">/ เดือน</span>:</label>
        <select id="monthInput" class="dash-select">
          ${months.map(m=>`<option value="${esc(m)}" ${m===dashMonth?'selected':''}>${esc(m)}</option>`).join('')}
        </select>
        <button class="primary" id="btnExportMonth">⬇ Quick full export</button>
        <button id="btnViewAllFarms">🌐 View all batches</button>
      </div>
      <div class="dash-tabs">
        <button class="${dashSubTab==='overview'?'active':''}" id="dashTabOverview">Overview / ภาพรวม</button>
        <button class="${dashSubTab==='exports'?'active':''}" id="dashTabExports">Export Builder / ส่งออกรายเดือน</button>
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
    </div>` : renderExportBuilderPanel(dashMonth)}
  `;
  document.getElementById('monthInput').onchange = (e)=>{ dashMonth = e.target.value; exportSelectionMonth = ''; renderDashboard(); };
  document.getElementById('dashTabOverview').onclick = ()=>{ dashSubTab='overview'; renderDashboard(); };
  document.getElementById('dashTabExports').onclick = ()=>{ dashSubTab='exports'; renderDashboard(); };
  document.getElementById('btnExportMonth').onclick = ()=> exportMonthExcel(dashMonth);
  document.getElementById('btnViewAllFarms').onclick = ()=>{ currentView='allFarms'; farmMonthFilter=dashMonth; render(); };
  if(dashSubTab === 'exports') bindExportBuilderEvents(main, dashMonth);
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
  migrateLegacyAdminSession();
  await hydrateDocumentsFromIdb();
  await loadRemoteConfig();
  bindAuthGate();

  document.getElementById('btnLinkSheet').onclick = ()=>{
    if(!requireAdmin('Google Sheet', ()=>{
      if(!appsScriptUrl) openSheetSetupGuide();
      else openLinkSheetModal();
    })) return;
    if(!appsScriptUrl) openSheetSetupGuide();
    else openLinkSheetModal();
  };
  document.getElementById('btnAdmin').onclick = toggleAdminSession;
  document.getElementById('btnSetupGuide').onclick = ()=>{ toggleMoreMenu(false); openSheetSetupGuide(); };
  document.getElementById('btnManageFarms').onclick = ()=>{ toggleMoreMenu(false); openManageFarmsModal(); };
  document.getElementById('btnDriveFolders').onclick = ()=>{ toggleMoreMenu(false); openDriveFoldersModal(); };
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
  document.getElementById('btnImportJSON').onclick = ()=>{
    toggleMoreMenu(false);
    if(!requireAdmin('import JSON', ()=> document.getElementById('fileImportInput').click())) return;
    document.getElementById('fileImportInput').click();
  };
  document.getElementById('fileImportInput').onchange = importJSONFile;
  document.getElementById('btnExportExcel').onclick = exportExcel;
  document.getElementById('btnOpenFileMob').onclick = ()=>{
    toggleMoreMenu(false);
    if(!requireAdmin('link Excel file', openDataFile)) return;
    openDataFile();
  };
  document.getElementById('btnMore').onclick = (e)=>{ e.stopPropagation(); toggleMoreMenu(); };
  document.getElementById('docUploadInput').onchange = handleDocUploadInput;
  document.addEventListener('click', (e)=>{
    const menu = document.getElementById('moreMenu');
    if(menu && !menu.contains(e.target)) toggleMoreMenu(false);
    const picker = document.querySelector('.farm-picker');
    if(picker && !picker.contains(e.target)) closeFarmNav();
  });

  // auto-refresh when staff switch back to this tab/window
  document.addEventListener('visibilitychange', ()=>{
    if(!document.hidden && isLoggedIn()){
      if(appsScriptUrl) pullFromGoogleSheet(true);
      else if(fileHandle) reloadFromFile(true);
    }
  });
  window.addEventListener('focus', ()=>{
    if(!isLoggedIn()) return;
    if(appsScriptUrl) pullFromGoogleSheet(true);
    else if(fileHandle) reloadFromFile(true);
  });

  window.addEventListener('beforeunload', (e)=>{
    if(saveInFlight || sheetSaveInFlight){ e.preventDefault(); e.returnValue = ''; return ''; }
  });

  updateConnPill();
  if(isLoggedIn()){
    startAppAfterLogin();
  } else {
    showAuthGate();
    if(!appsScriptUrl) await tryAutoReconnect();
  }
}
init();
