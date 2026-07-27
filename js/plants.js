/**
 * CANA QC Tracker — Plant Registry (potting IDs + Zebra barcodes)
 * One batch ID per plant at potting; room moves update room only.
 */
let plantSearchText = '';
let plantStatusFilter = '';
let plantRoomFilter = '';
let plantSelectedIds = new Set();

const PLANT_STATUS_OPTIONS = [
  'Active / กำลังเลี้ยง',
  'In flower / ออกดอก',
  'Harvested / เก็บเกี่ยวแล้ว',
  'Dead / ตาย',
  'Discarded / ทิ้ง'
];

const PLANT_BATCH_PREFIX = 'CA-P-';
const PLANT_LOT_PREFIX = 'CA-L-';

function normalizePlant(rec){
  if(!rec) return rec;
  if(!rec.id) rec.id = uid();
  if(!rec.batchId) rec.batchId = '';
  if(!rec.lotId) rec.lotId = '';
  if(!rec.strain) rec.strain = '';
  if(!rec.potDate) rec.potDate = '';
  if(!rec.room) rec.room = '';
  if(!rec.roomHistory) rec.roomHistory = '';
  if(!rec.status) rec.status = PLANT_STATUS_OPTIONS[0];
  if(!rec.sourceFarm) rec.sourceFarm = 'Cana';
  if(!rec.harvestDate) rec.harvestDate = '';
  if(!rec.linkedTrimId) rec.linkedTrimId = '';
  if(!rec.transferBatchRef) rec.transferBatchRef = '';
  if(!rec.notes) rec.notes = '';
  if(!rec.createdBy) rec.createdBy = '';
  if(!rec.createdAt) rec.createdAt = '';
  if(!rec.lotId && rec.transferBatchRef && /^CA-L-/i.test(String(rec.transferBatchRef))) rec.lotId = rec.transferBatchRef;
  if(rec.lotId && !rec.transferBatchRef) rec.transferBatchRef = rec.lotId;
  return rec;
}

function parsePlantBatchSeq(batchId){
  const m = String(batchId || '').match(/^CA-P-(\d+)$/i);
  return m ? parseInt(m[1], 10) : 0;
}

function parsePlantLotSeq(lotId){
  const m = String(lotId || '').match(/^CA-L-(\d+)$/i);
  return m ? parseInt(m[1], 10) : 0;
}

function nextPotLotId(){
  let max = 0;
  (state.plants || []).forEach(p=>{
    max = Math.max(max, parsePlantLotSeq(p.lotId), parsePlantLotSeq(p.transferBatchRef));
  });
  return PLANT_LOT_PREFIX + String(max + 1).padStart(6, '0');
}

function getPlantsByLotId(lotId){
  const code = parsePlantLotScanCode(lotId);
  if(!code) return [];
  return (state.plants || []).map(normalizePlant).filter(p=>{
    const lid = parsePlantLotScanCode(p.lotId) || parsePlantLotScanCode(p.transferBatchRef);
    return lid === code;
  }).sort((a, b)=> (a.batchId || '').localeCompare(b.batchId || ''));
}

function nextPlantBatchId(){
  let max = 0;
  (state.plants || []).forEach(p=>{
    max = Math.max(max, parsePlantBatchSeq(p.batchId));
  });
  return PLANT_BATCH_PREFIX + String(max + 1).padStart(6, '0');
}

function allocatePlantBatchIds(count){
  let max = 0;
  (state.plants || []).forEach(p=>{
    max = Math.max(max, parsePlantBatchSeq(p.batchId));
  });
  const ids = [];
  for(let i = 0; i < count; i++){
    max++;
    ids.push(PLANT_BATCH_PREFIX + String(max).padStart(6, '0'));
  }
  return ids;
}

function getPlantByBatchId(batchId){
  const code = parsePlantScanCode(batchId);
  if(!code) return null;
  return (state.plants || []).find(p=> parsePlantScanCode(p.batchId) === code) || null;
}

function getPlantById(id){
  return (state.plants || []).find(p=> p.id === id) || null;
}

function appendRoomHistory(plant, newRoom){
  const r = String(newRoom || '').trim();
  if(!r) return;
  const cur = String(plant.room || '').trim();
  if(cur === r) return;
  const hist = String(plant.roomHistory || '').trim();
  const entry = (cur ? cur + ' → ' : '') + r;
  plant.roomHistory = hist ? hist + ' · ' + entry : entry;
  plant.room = r;
}

function mergePlantsFromRemote(remotePlants){
  if(!Array.isArray(remotePlants)) return;
  const remote = remotePlants.map(normalizePlant);
  if(!localDirty){
    if(!remote.length && (state.plants || []).length){
      localDirty = true;
      debouncedPushToSheet();
      return;
    }
    state.plants = remote;
    return;
  }
  const local = (state.plants || []).map(normalizePlant);
  const remoteIds = new Set(remote.map(p=> p.id));
  const pending = local.filter(p=> !remoteIds.has(p.id));
  const localById = Object.fromEntries(local.map(p=> [p.id, p]));
  state.plants = remote.map(p=> localById[p.id] || p).concat(pending);
}

function getFilteredPlants(){
  const q = searchQuery(plantSearchText);
  return (state.plants || []).map(normalizePlant).filter(p=>{
    if(plantStatusFilter && p.status !== plantStatusFilter) return false;
    if(plantRoomFilter && String(p.room || '').toLowerCase() !== plantRoomFilter.toLowerCase()) return false;
    if(q){
      const hay = [p.batchId, p.lotId, p.transferBatchRef, p.strain, p.room, p.status, p.sourceFarm, p.notes, p.createdBy].join(' ').toLowerCase();
      if(!hay.includes(q)) return false;
    }
    return true;
  }).sort((a, b)=> (b.potDate || '').localeCompare(a.potDate || '') || (a.batchId || '').localeCompare(b.batchId || ''));
}

function getPlantRoomOptions(){
  const rooms = new Set();
  (state.plants || []).forEach(p=>{ if(p.room) rooms.add(p.room); });
  return [...rooms].sort();
}

function plantStatusShort(status){
  return String(status || '').split(' / ')[0];
}

function renderPlantsView(){
  if(!requireLogin()) return;
  const rows = getFilteredPlants();
  const rooms = getPlantRoomOptions();
  const activeCount = (state.plants || []).filter(p=> p.status === PLANT_STATUS_OPTIONS[0] || p.status === PLANT_STATUS_OPTIONS[1]).length;
  const main = document.getElementById('mainArea');
  main.innerHTML = `
    <div class="cana-header plant-header">
      <div>
        <h2>🌱 Plant Registry — potting IDs & barcodes</h2>
        <p class="sub">One plant ID per sticker · shared lot ID per potting run · scan to trace<br><span class="bi">หนึ่งรหัสต่อหนึ่งต้น · lot เดียวกันเมื่อ pot พร้อมกัน</span></p>
      </div>
      <div class="plant-kpi-mini">${(state.plants || []).length} plants · ${activeCount} active</div>
    </div>
    <div class="row-actions plant-toolbar">
      <button class="primary" id="btnPotBatch">+ Potting batch <span class="bi">/ สร้างรหัส pot</span></button>
      <button id="btnMoveRoom" ${plantSelectedIds.size ? '' : 'disabled'}>Move room <span class="bi">/ ย้ายห้อง</span></button>
      <button id="btnHarvestPlants" ${plantSelectedIds.size ? '' : 'disabled'}>Harvest <span class="bi">/ เก็บเกี่ยว</span></button>
      <button id="btnPrintLabels" ${plantSelectedIds.size ? '' : 'disabled'}>🖨 Print labels <span class="bi">/ พิมพ์</span></button>
      <button class="danger admin-only" id="btnDeletePlants" ${plantSelectedIds.size ? '' : 'disabled'}>Delete selected <span class="bi">/ ลบ</span></button>
      <select id="plantStatusFilter">
        <option value="">All status</option>
        ${PLANT_STATUS_OPTIONS.map(o=>`<option value="${esc(o)}" ${plantStatusFilter===o?'selected':''}>${esc(plantStatusShort(o))}</option>`).join('')}
      </select>
      <select id="plantRoomFilter">
        <option value="">All rooms</option>
        ${rooms.map(r=>`<option value="${esc(r)}" ${plantRoomFilter===r?'selected':''}>${esc(r)}</option>`).join('')}
      </select>
    </div>
    <div class="plant-scan-row">
      <label class="plant-scan-label">🔍 Scan barcode <span class="bi">/ สแกน</span></label>
      <input class="search-box plant-scan-input" id="plantScanInput" placeholder="Scan CA-P-… or CA-L-… then Enter" autocomplete="off">
      <button type="button" class="primary" id="btnPlantCamera">📷 Camera <span class="bi">/ กล้อง</span></button>
      <button type="button" class="ghost" id="btnPlantTrace">Trace ID</button>
    </div>
    <input class="search-box" id="plantSearchBox" placeholder="Search strain, room, batch ID…" value="${esc(plantSearchText)}" style="margin-bottom:12px;width:100%;max-width:420px;">
    <div class="mob-section-label mobile-only">Plants</div>
    <div id="plantResultsWrap">${renderPlantsTable(rows)}</div>
  `;
  document.getElementById('btnPotBatch').onclick = ()=> openPottingBatchModal();
  document.getElementById('btnMoveRoom').onclick = ()=> openMoveRoomModal([...plantSelectedIds]);
  document.getElementById('btnHarvestPlants').onclick = ()=> openHarvestPlantsModal([...plantSelectedIds]);
  document.getElementById('btnPrintLabels').onclick = ()=> openPrintPlantLabels([...plantSelectedIds]);
  document.getElementById('btnDeletePlants').onclick = ()=> deleteSelectedPlants();
  document.getElementById('plantStatusFilter').onchange = (e)=>{ plantStatusFilter = e.target.value; renderPlantsView(); };
  document.getElementById('plantRoomFilter').onchange = (e)=>{ plantRoomFilter = e.target.value; renderPlantsView(); };
  document.getElementById('plantSearchBox').oninput = (e)=>{ plantSearchText = e.target.value; updatePlantResults(); };
  const scanInput = document.getElementById('plantScanInput');
  scanInput.focus();
  scanInput.onkeydown = (e)=>{
    if(e.key !== 'Enter') return;
    e.preventDefault();
    handlePlantScan(scanInput.value);
    scanInput.value = '';
  };
  document.getElementById('btnPlantTrace').onclick = ()=>{
    const id = scanInput.value.trim() || prompt('Enter plant batch ID (CA-P-…):', '');
    if(id) openPlantTraceModal(id);
  };
  document.getElementById('btnPlantCamera').onclick = ()=> openPlantCameraScanModal();
  bindPlantActions(main);
}

function parsePlantLotScanCode(raw){
  let s = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
  let m = s.match(/CA-L-(\d+)/);
  if(m) return PLANT_LOT_PREFIX + String(parseInt(m[1], 10)).padStart(6, '0');
  m = s.match(/^L-?(\d{1,6})$/);
  if(m) return PLANT_LOT_PREFIX + String(parseInt(m[1], 10)).padStart(6, '0');
  return '';
}

function parsePlantScanCode(raw){
  let s = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
  const lot = parsePlantLotScanCode(s);
  if(lot) return lot;
  let m = s.match(/CA-P-(\d+)/);
  if(m) return PLANT_BATCH_PREFIX + String(parseInt(m[1], 10)).padStart(6, '0');
  m = s.match(/^(\d{1,6})$/);
  if(m) return PLANT_BATCH_PREFIX + String(parseInt(m[1], 10)).padStart(6, '0');
  return s;
}

function isPlantLotCode(code){
  return /^CA-L-\d+$/.test(String(code || ''));
}

function isPlantBatchCode(code){
  return /^CA-P-\d+$/.test(String(code || ''));
}

let plantCameraScanner = null;
let plantScanLock = false;

function finishCameraScan(code, statusEl){
  if(plantScanLock) return;
  plantScanLock = true;
  if(statusEl) statusEl.textContent = 'Found ' + code + ' — opening…';
  stopPlantCameraScanner().finally(()=>{
    plantScanLock = false;
    modalDirty = false;
    handlePlantScan(code);
  });
}

async function stopPlantCameraScanner(){
  if(!plantCameraScanner) return;
  try {
    await plantCameraScanner.stop();
  } catch(e){}
  try {
    plantCameraScanner.clear();
  } catch(e){}
  plantCameraScanner = null;
}

async function openPlantCameraScanModal(){
  if(!requireLogin()) return;
  plantScanLock = false;
  modalDirty = true;
  const root = document.getElementById('modalRoot');
  root.innerHTML = `
  <div class="overlay" id="overlay">
    <div class="modal plant-camera-modal">
      <h2>📷 Scan barcode</h2>
      <p class="sub">Point phone at sticker <code>CA-P-…</code> · allow camera<br><span class="bi">เล็งกล้องที่สติ๊กเกอร์ · อนุญาตใช้กล้อง</span></p>
      <div id="plantCameraReader" class="plant-camera-reader"></div>
      <p class="sub" id="plantCameraStatus">Starting camera…</p>
      <div class="modal-actions">
        <button type="button" class="ghost" id="btnCameraClose">Close</button>
      </div>
    </div>
  </div>`;
  const close = async ()=>{
    await stopPlantCameraScanner();
    modalDirty = false;
    closeModal();
  };
  root.querySelector('#btnCameraClose').onclick = close;
  root.querySelector('#overlay').onclick = (e)=>{ if(e.target.id==='overlay') close(); };

  const statusEl = document.getElementById('plantCameraStatus');
  if(typeof Html5Qrcode === 'undefined'){
    statusEl.textContent = 'Scanner not loaded — hard refresh the page.';
    return;
  }

  const formats = (typeof Html5QrcodeSupportedFormats !== 'undefined')
    ? [Html5QrcodeSupportedFormats.CODE_128, Html5QrcodeSupportedFormats.CODE_39]
    : undefined;
  const boxW = Math.min(320, Math.max(240, window.innerWidth - 56));
  plantCameraScanner = new Html5Qrcode('plantCameraReader');
  const config = {
    fps: 12,
    qrbox: { width: boxW, height: Math.round(boxW * 0.35) },
    aspectRatio: 1.777
  };
  if(formats) config.formatsToSupport = formats;

  try {
    await plantCameraScanner.start(
      { facingMode: 'environment' },
      config,
      (decodedText)=>{
        const code = parsePlantScanCode(decodedText);
        if(!isPlantBatchCode(code)){
          statusEl.textContent = 'Read: ' + decodedText + ' — need CA-P-000001';
          return;
        }
        finishCameraScan(code, statusEl);
      },
      ()=>{}
    );
    statusEl.textContent = 'Ready — hold barcode steady in the box';
  } catch(err){
    statusEl.textContent = 'Camera blocked — allow camera in Safari/Chrome settings, or type ID manually.';
    console.warn('Camera scan failed', err);
  }
}

function updatePlantResults(){
  const wrap = document.getElementById('plantResultsWrap');
  if(!wrap || currentView !== 'plants') return;
  wrap.innerHTML = renderPlantsTable(getFilteredPlants());
  bindPlantActions(document.getElementById('mainArea'));
}

function renderPlantsCardList(rows){
  return rows.map(p=>{
    const sel = plantSelectedIds.has(p.id);
    return `<div class="batch-card mob-card ${sel ? 'mob-card-selected' : ''}">
      <div class="card-top">
        <label class="mob-card-check"><input type="checkbox" data-plant-select="${esc(p.id)}" ${sel ? 'checked' : ''}></label>
        <div class="card-head-text">
          <code class="batch-id">${esc(p.batchId)}</code>
          <div class="card-title">${esc(p.strain||'—')}</div>
          <div class="card-subtitle">${esc(p.room||'—')} · Lot ${esc(p.lotId || p.transferBatchRef || '—')}</div>
        </div>
        <span class="pill plant-status">${esc(plantStatusShort(p.status))}</span>
      </div>
      <div class="card-meta"><span>Pot ${esc(p.potDate || '—')}</span>${(p.lotId || p.transferBatchRef) ? `<span><button type="button" class="ghost small" data-plant-lot="${esc(p.lotId || p.transferBatchRef)}" style="padding:0;border:0;background:transparent;color:var(--blue-700);font-weight:700;">Lot ${esc(p.lotId || p.transferBatchRef)}</button></span>` : ''}<span>Harvest ${esc(p.harvestDate||'—')}</span></div>
      <div class="action-group">
        <button type="button" class="small" data-plant-barcode="${esc(p.id)}">Barcode</button>
        <button type="button" class="small" data-plant-trace="${esc(p.batchId)}">Trace</button>
        <button type="button" class="small purple" data-plant-edit="${esc(p.id)}">Edit</button>
        <button type="button" class="small danger admin-only" data-delete-plant="${esc(p.id)}">Del</button>
      </div>
    </div>`;
  }).join('');
}

function renderPlantsTable(rows){
  if(!rows.length){
    return `<div class="panel empty-state"><b>No plants yet.</b> Use <b>+ Potting batch</b> after rooting to generate IDs and print Zebra labels.<br><span class="bi">ยังไม่มีข้อมูล — กด Potting batch หลัง pot</span></div>`;
  }
  const body = rows.map(p=>{
    const sel = plantSelectedIds.has(p.id);
    return `<tr class="${sel ? 'plant-row-selected' : ''}">
      <td><input type="checkbox" data-plant-select="${esc(p.id)}" ${sel ? 'checked' : ''}></td>
      <td><code class="batch-id">${esc(p.batchId)}</code></td>
      <td><code class="batch-id">${esc(p.lotId || p.transferBatchRef || '—')}</code>${(p.lotId || p.transferBatchRef) ? `<br><button type="button" class="ghost sm" data-plant-lot="${esc(p.lotId || p.transferBatchRef)}">View lot</button>` : ''}</td>
      <td>${esc(p.strain)}</td>
      <td>${esc(p.potDate || '—')}</td>
      <td>${esc(p.room || '—')}</td>
      <td><span class="pill plant-status">${esc(plantStatusShort(p.status))}</span></td>
      <td>${esc(p.harvestDate || '—')}</td>
      <td class="plant-actions">
        <button type="button" class="ghost sm" data-plant-barcode="${esc(p.id)}">Barcode</button>
        <button type="button" class="ghost sm" data-plant-trace="${esc(p.batchId)}">Trace</button>
        <button type="button" class="ghost sm" data-plant-edit="${esc(p.id)}">Edit</button>
        <button type="button" class="ghost sm danger admin-only" data-delete-plant="${esc(p.id)}">Del</button>
      </td>
    </tr>`;
  }).join('');
  return `<div class="table-wrap desktop-table"><table class="compact-table plant-table">
    <thead><tr>
      <th style="width:36px"><input type="checkbox" id="plantSelectAll" title="Select all visible"></th>
      <th>Batch ID</th><th>Lot ID</th><th>Strain</th><th>Pot date</th><th>Room</th><th>Status</th><th>Harvest</th><th></th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table></div>
  <div class="card-list">${renderPlantsCardList(rows)}</div>`;
}

function bindPlantActions(root){
  if(!root) return;
  root.querySelectorAll('[data-plant-select]').forEach(el=>{
    el.onchange = ()=>{
      const id = el.dataset.plantSelect;
      if(el.checked) plantSelectedIds.add(id);
      else plantSelectedIds.delete(id);
      updatePlantToolbarState();
      el.closest('tr')?.classList.toggle('plant-row-selected', el.checked);
    };
  });
  const selectAll = root.querySelector('#plantSelectAll');
  if(selectAll){
    selectAll.onchange = ()=>{
      getFilteredPlants().forEach(p=>{
        if(selectAll.checked) plantSelectedIds.add(p.id);
        else plantSelectedIds.delete(p.id);
      });
      updatePlantResults();
      updatePlantToolbarState();
    };
  }
  root.querySelectorAll('[data-plant-barcode]').forEach(el=> el.onclick = ()=> openPrintPlantLabels([el.dataset.plantBarcode]));
  root.querySelectorAll('[data-plant-trace]').forEach(el=> el.onclick = ()=> openPlantTraceModal(el.dataset.plantTrace));
  root.querySelectorAll('[data-plant-lot]').forEach(el=> el.onclick = ()=> openPlantLotTraceModal(el.dataset.plantLot));
  root.querySelectorAll('[data-plant-edit]').forEach(el=> el.onclick = ()=> openPlantEditModal(el.dataset.plantEdit));
  root.querySelectorAll('[data-delete-plant]').forEach(el=> el.onclick = ()=> deletePlantRecord(el.dataset.deletePlant));
  updateAdminUI();
}

function deletePlantRecords(ids){
  ids = [...new Set((ids || []).filter(Boolean))];
  if(!ids.length) return;
  const idSet = new Set(ids);
  state.plants = (state.plants || []).filter(p=> !idSet.has(p.id));
  ids.forEach(id=> plantSelectedIds.delete(id));
  modalDirty = false;
  closeModal();
  onDataChanged();
  if(appsScriptUrl){
    clearTimeout(sheetSaveTimer);
    pushToGoogleSheet(true);
  }
  renderPlantsView();
  showDocToast('Deleted ' + ids.length + ' plant(s) ✓');
}

function deletePlantRecord(id){
  if(!requireAdmin('delete plant record', ()=> deletePlantRecord(id))) return;
  const plant = getPlantById(id);
  if(!plant) return;
  if(!confirm('Delete plant ' + plant.batchId + '?\nลบรายการนี้?')) return;
  deletePlantRecords([id]);
}

function deleteSelectedPlants(){
  if(!requireAdmin('delete plant records', ()=> deleteSelectedPlants())) return;
  const ids = [...plantSelectedIds];
  if(!ids.length){ alert('Select plants first'); return; }
  const label = ids.length === 1 ? getPlantById(ids[0])?.batchId || '1 plant' : ids.length + ' plants';
  if(!confirm('Delete ' + label + '?\nลบรายการที่เลือก?')) return;
  deletePlantRecords(ids);
}

function deletePlantLot(lotIdOrRaw){
  if(!requireAdmin('delete plant lot', ()=> deletePlantLot(lotIdOrRaw))) return;
  const lotCode = parsePlantLotScanCode(lotIdOrRaw);
  const plants = getPlantsByLotId(lotCode);
  if(!plants.length){ alert('Lot not found'); return; }
  if(!confirm('Delete entire lot ' + lotCode + ' (' + plants.length + ' plant(s))?\nThis cannot be undone.\nลบ lot ทั้งชุด?')) return;
  deletePlantRecords(plants.map(p=> p.id));
}

function updatePlantToolbarState(){
  ['btnMoveRoom', 'btnHarvestPlants', 'btnPrintLabels', 'btnDeletePlants'].forEach(id=>{
    const btn = document.getElementById(id);
    if(btn) btn.disabled = !plantSelectedIds.size;
  });
}

function handlePlantScan(raw){
  const code = parsePlantScanCode(raw);
  if(!code) return;
  if(isPlantLotCode(code)){
    const lotPlants = getPlantsByLotId(code);
    if(!lotPlants.length){
      openPlantScanNotFoundModal(code);
      return;
    }
    openPlantLotTraceModal(code);
    showDocToast('Lot: ' + code + ' · ' + lotPlants.length + ' plant(s) ✓');
    return;
  }
  const plant = getPlantByBatchId(code);
  if(!plant){
    openPlantScanNotFoundModal(code);
    return;
  }
  if(!plantSelectedIds.has(plant.id)) plantSelectedIds.add(plant.id);
  openPlantTraceModal(plant.batchId);
  showDocToast('Trace: ' + plant.batchId + ' ✓');
  if(currentView === 'plants') updatePlantToolbarState();
}

function openPlantScanNotFoundModal(code){
  modalDirty = false;
  const root = document.getElementById('modalRoot');
  root.innerHTML = `
  <div class="overlay" id="overlay">
    <div class="modal" style="max-width:420px">
      <h2>ID not found</h2>
      <p class="sub">Scanned <code class="batch-id">${esc(code)}</code> — not in Plant Registry on this device.<br><span class="bi">ไม่พบรหัสนี้ในระบบ</span></p>
      <div class="helpbox" style="font-size:12px;margin-bottom:12px;">
        Tap <b>Reload</b> (top bar) to sync from Google Sheet, then scan again.<br>
        Or check the sticker matches a plant created in <b>Plants → Potting batch</b>.
      </div>
      <div class="modal-actions">
        <button type="button" class="primary" id="btnScanAgain">Scan again</button>
        <button type="button" class="ghost" id="btnNotFoundClose">Close</button>
      </div>
    </div>
  </div>`;
  root.querySelector('#btnNotFoundClose').onclick = closeModal;
  root.querySelector('#btnScanAgain').onclick = ()=> openPlantCameraScanModal();
  root.querySelector('#overlay').onclick = (e)=>{ if(e.target.id==='overlay') closeModal(); };
}

function openPottingBatchModal(){
  if(!requireLogin()) return;
  modalDirty = true;
  const previewLot = nextPotLotId();
  const root = document.getElementById('modalRoot');
  root.innerHTML = `
  <div class="overlay" id="overlay">
    <div class="modal" style="max-width:520px">
      <h2>+ Potting batch</h2>
      <p class="sub">Creates one plant ID per sticker + one shared lot ID for the whole run<br><span class="bi">รหัสต่อต้น · lot เดียวกันทั้งชุด</span></p>
      <div class="helpbox" style="font-size:12px;margin-bottom:12px;padding:10px 12px;">
        <b>Lot ID:</b> <code class="batch-id">${esc(previewLot)}</code> — all plants in this batch share this lot (shown on every sticker).
      </div>
      <form id="potBatchForm" class="form-grid">
        <div class="field"><label>Strain <span class="bi">/ สายพันธุ์</span></label><input name="strain" required placeholder="MAC 1"></div>
        <div class="field"><label>Pot date</label><input type="date" name="potDate" value="${todayISO()}" required></div>
        <div class="field"><label>Starting room</label><input name="room" required placeholder="Veg 1"></div>
        <div class="field"><label>Source</label><input name="sourceFarm" value="Cana" placeholder="Cana"></div>
        <div class="field"><label>Number of plants</label><input type="number" name="qty" min="1" max="500" value="1" required></div>
        <div class="field full"><label>Notes</label><textarea name="notes" rows="2"></textarea></div>
        <div class="field full">
          <label class="checkbox-label"><input type="checkbox" name="printAfter" checked> Open print labels after create</label>
        </div>
        <div class="modal-actions full">
          <button type="button" class="ghost" id="btnCancelPot">Cancel</button>
          <button type="submit" class="primary">Generate IDs</button>
        </div>
      </form>
    </div>
  </div>`;
  const close = ()=>{ modalDirty = false; closeModal(); };
  root.querySelector('#btnCancelPot').onclick = close;
  root.querySelector('#overlay').onclick = (e)=>{ if(e.target.id==='overlay') close(); };
  root.querySelector('#potBatchForm').onsubmit = (e)=>{
    e.preventDefault();
    const fd = new FormData(e.target);
    const qty = Math.min(500, Math.max(1, parseInt(fd.get('qty'), 10) || 1));
    const strain = String(fd.get('strain') || '').trim();
    const potDate = String(fd.get('potDate') || '').trim();
    const room = String(fd.get('room') || '').trim();
    if(!strain || !room){ alert('Strain and room required'); return; }
    const lotId = nextPotLotId();
    const batchIds = allocatePlantBatchIds(qty);
    const newIds = [];
    if(!state.plants) state.plants = [];
    batchIds.forEach((batchId)=>{
      const plant = normalizePlant({
        id: uid(),
        batchId,
        lotId,
        strain,
        potDate,
        room,
        roomHistory: room,
        status: PLANT_STATUS_OPTIONS[0],
        sourceFarm: String(fd.get('sourceFarm') || 'Cana').trim(),
        transferBatchRef: lotId,
        notes: String(fd.get('notes') || '').trim(),
        createdBy: getCurrentUserName(),
        createdAt: new Date().toISOString()
      });
      state.plants.push(plant);
      newIds.push(plant.id);
    });
    modalDirty = false;
    onDataChanged();
    close();
    renderPlantsView();
    showDocToast('Created ' + qty + ' plant(s) · Lot ' + lotId + ' ✓');
    if(fd.get('printAfter')) openPrintPlantLabels(newIds);
  };
}

function openPlantEditModal(id){
  if(!requireLogin()) return;
  const rec = normalizePlant({...getPlantById(id)});
  if(!rec) return;
  modalDirty = true;
  const root = document.getElementById('modalRoot');
  root.innerHTML = `
  <div class="overlay" id="overlay">
    <div class="modal" style="max-width:520px">
      <h2>Edit plant — <code class="batch-id">${esc(rec.batchId)}</code></h2>
      <form id="plantEditForm" class="form-grid">
        <div class="field"><label>Lot ID</label><input value="${esc(rec.lotId || rec.transferBatchRef || '—')}" readonly class="readonly"></div>
        <div class="field"><label>Strain</label><input name="strain" value="${esc(rec.strain)}" required></div>
        <div class="field"><label>Current room</label><input name="room" value="${esc(rec.room)}" required></div>
        <div class="field"><label>Status</label>
          <select name="status">${PLANT_STATUS_OPTIONS.map(o=>`<option value="${esc(o)}" ${rec.status===o?'selected':''}>${esc(o)}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Pot date</label><input type="date" name="potDate" value="${esc(rec.potDate)}"></div>
        <div class="field"><label>Harvest date</label><input type="date" name="harvestDate" value="${esc(rec.harvestDate)}"></div>
        <div class="field full"><label>Room history</label><input name="roomHistory" value="${esc(rec.roomHistory)}" readonly class="readonly"></div>
        <div class="field full"><label>Notes</label><textarea name="notes" rows="2">${esc(rec.notes)}</textarea></div>
        <div class="modal-actions full">
          <button type="button" class="ghost" id="btnCancelPlantEdit">Cancel</button>
          <button type="button" class="danger admin-only" id="btnDeletePlantEdit">Delete</button>
          <button type="submit" class="primary">Save</button>
        </div>
      </form>
    </div>
  </div>`;
  const close = ()=>{ modalDirty = false; closeModal(); };
  root.querySelector('#btnCancelPlantEdit').onclick = close;
  root.querySelector('#overlay').onclick = (e)=>{ if(e.target.id==='overlay') close(); };
  const delBtn = root.querySelector('#btnDeletePlantEdit');
  if(delBtn) delBtn.onclick = ()=> deletePlantRecord(rec.id);
  root.querySelector('#plantEditForm').onsubmit = (e)=>{
    e.preventDefault();
    const fd = new FormData(e.target);
    const newRoom = String(fd.get('room') || '').trim();
    if(newRoom !== rec.room) appendRoomHistory(rec, newRoom);
    else rec.room = newRoom;
    rec.strain = String(fd.get('strain') || '').trim();
    rec.status = String(fd.get('status') || PLANT_STATUS_OPTIONS[0]);
    rec.potDate = String(fd.get('potDate') || '').trim();
    rec.harvestDate = String(fd.get('harvestDate') || '').trim();
    rec.notes = String(fd.get('notes') || '').trim();
    const i = (state.plants || []).findIndex(p=> p.id === rec.id);
    if(i >= 0) state.plants[i] = rec;
    modalDirty = false;
    onDataChanged();
    close();
    renderPlantsView();
    showDocToast('Plant updated ✓');
  };
}

function openMoveRoomModal(plantIds){
  if(!plantIds.length){ alert('Select plants first'); return; }
  modalDirty = true;
  const root = document.getElementById('modalRoot');
  root.innerHTML = `
  <div class="overlay" id="overlay">
    <div class="modal" style="max-width:420px">
      <h2>Move room — ${plantIds.length} plant(s)</h2>
      <p class="sub">Batch IDs stay the same<br><span class="bi">รหัสไม่เปลี่ยน แค่ย้ายห้อง</span></p>
      <form id="moveRoomForm">
        <div class="field"><label>New room</label><input name="room" required placeholder="Veg 2 / Flower 1" autofocus></div>
        <div class="field"><label>Status (optional)</label>
          <select name="status">
            <option value="">— keep current —</option>
            ${PLANT_STATUS_OPTIONS.map(o=>`<option value="${esc(o)}">${esc(plantStatusShort(o))}</option>`).join('')}
          </select>
        </div>
        <div class="modal-actions">
          <button type="button" class="ghost" id="btnCancelMove">Cancel</button>
          <button type="submit" class="primary">Move</button>
        </div>
      </form>
    </div>
  </div>`;
  const close = ()=>{ modalDirty = false; closeModal(); };
  root.querySelector('#btnCancelMove').onclick = close;
  root.querySelector('#overlay').onclick = (e)=>{ if(e.target.id==='overlay') close(); };
  root.querySelector('#moveRoomForm').onsubmit = (e)=>{
    e.preventDefault();
    const fd = new FormData(e.target);
    const room = String(fd.get('room') || '').trim();
    const status = String(fd.get('status') || '').trim();
    plantIds.forEach(id=>{
      const p = getPlantById(id);
      if(!p) return;
      appendRoomHistory(p, room);
      if(status) p.status = status;
      else if(p.status === PLANT_STATUS_OPTIONS[0] && /flower/i.test(room)) p.status = PLANT_STATUS_OPTIONS[1];
    });
    modalDirty = false;
    plantSelectedIds.clear();
    onDataChanged();
    close();
    renderPlantsView();
    showDocToast('Room updated ✓');
  };
}

function openHarvestPlantsModal(plantIds){
  if(!plantIds.length){ alert('Select plants first'); return; }
  const plants = plantIds.map(getPlantById).filter(Boolean);
  modalDirty = true;
  const root = document.getElementById('modalRoot');
  root.innerHTML = `
  <div class="overlay" id="overlay">
    <div class="modal" style="max-width:480px">
      <h2>Harvest — ${plants.length} plant(s)</h2>
      <form id="harvestForm">
        <div class="field"><label>Harvest date</label><input type="date" name="harvestDate" value="${todayISO()}" required></div>
        <div class="field full">
          <label class="checkbox-label"><input type="checkbox" name="createTrim" checked> Create Trim Cana draft (links plant IDs)</label>
        </div>
        <p class="sub" style="font-size:11px;">Plant IDs: ${plants.map(p=> esc(p.batchId)).join(', ')}</p>
        <div class="modal-actions">
          <button type="button" class="ghost" id="btnCancelHarvest">Cancel</button>
          <button type="submit" class="primary">Confirm harvest</button>
        </div>
      </form>
    </div>
  </div>`;
  const close = ()=>{ modalDirty = false; closeModal(); };
  root.querySelector('#btnCancelHarvest').onclick = close;
  root.querySelector('#overlay').onclick = (e)=>{ if(e.target.id==='overlay') close(); };
  root.querySelector('#harvestForm').onsubmit = (e)=>{
    e.preventDefault();
    const fd = new FormData(e.target);
    const harvestDate = String(fd.get('harvestDate') || '').trim();
    const createTrim = !!fd.get('createTrim');
    const batchIds = [];
    const strains = new Set();
    let room = '';
    plants.forEach(p=>{
      p.status = PLANT_STATUS_OPTIONS[2];
      p.harvestDate = harvestDate;
      batchIds.push(p.batchId);
      if(p.strain) strains.add(p.strain);
      if(p.room) room = p.room;
    });
    let trimId = '';
    if(createTrim){
      trimId = uid();
      const strainLabel = [...strains].join(', ') || plants[0]?.strain || '';
      const trimRec = normalizeTrimRecord({
        id: trimId,
        type: 'Cana flower',
        date: todayISO(),
        harvestDate,
        sourceFarm: 'Cana',
        room: room || plants[0]?.room || '',
        strain: strainLabel,
        linkedPlantBatchIds: batchIds.join(', '),
        finishedFlowerG: '', outputBigsG: '', outputPopsG: '',
        moldG: '', seedsG: '', stemsG: '', wasteG: '',
        hoursWorked: '', trimmedBy: getCurrentUserName(),
        status: TRIM_STATUS_OPTIONS[0],
        notes: 'Harvest batch · ' + batchIds.length + ' plant(s): ' + batchIds.slice(0, 5).join(', ') + (batchIds.length > 5 ? '…' : '')
      });
      if(!state.trimming) state.trimming = [];
      state.trimming.push(trimRec);
      plants.forEach(p=>{ p.linkedTrimId = trimId; });
    }
    modalDirty = false;
    plantSelectedIds.clear();
    onDataChanged();
    close();
    if(createTrim){
      currentView = 'trimming';
      trimSubTab = 'cana';
      render();
      showDocToast('Harvested · Trim Cana draft created ✓');
    } else {
      renderPlantsView();
      showDocToast('Harvest recorded ✓');
    }
  };
}

function renderBarcodeSvg(batchId, opts){
  opts = opts || {};
  const h = opts.height || 50;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  if(typeof JsBarcode === 'undefined'){
    svg.innerHTML = '<text x="0" y="20">JsBarcode not loaded</text>';
    return svg.outerHTML;
  }
  try {
    JsBarcode(svg, String(batchId), {
      format: 'CODE128',
      width: opts.width || 2,
      height: h,
      displayValue: false,
      margin: 4
    });
  } catch(err){
    svg.innerHTML = '<text x="0" y="20">Invalid barcode</text>';
  }
  return svg.outerHTML;
}

function getZebraDpi(){
  const d = Number(localStorage.getItem('cana_zebra_dpi'));
  return (d === 300) ? 300 : 203;
}

function getLabelSizeIn(){
  const w = Number(localStorage.getItem('cana_label_w_in'));
  const h = Number(localStorage.getItem('cana_label_h_in'));
  return { w: (w > 0 ? w : 2), h: (h > 0 ? h : 1) };
}

function inchesToDots(inches, dpi){
  return Math.round(Number(inches) * dpi);
}

function estimateCode128Dots(charCount, moduleW){
  return (11 * charCount + 35) * moduleW;
}

function buildZplLabel(batchId, strain, room, lotId){
  const safe = (s)=> String(s || '').replace(/[^\x20-\x7E]/g, '').slice(0, 28);
  const id = safe(batchId);
  const strainLine = safe(strain).slice(0, 24);
  const lotLine = lotId ? ('Lot ' + safe(lotId)).slice(0, 24) : safe(room).slice(0, 24);
  const dpi = getZebraDpi();
  const { w, h } = getLabelSizeIn();
  const pw = inchesToDots(w, dpi);
  const ll = inchesToDots(h, dpi);
  let moduleW = 2;
  let barW = estimateCode128Dots(id.length, moduleW);
  if(barW > pw - 8){
    moduleW = 1;
    barW = estimateCode128Dots(id.length, moduleW);
  }
  const barRatio = 3;
  const bh = Math.round(ll * 0.42);
  const by = Math.round(ll * 0.08);
  const bx = Math.max(4, Math.round((pw - barW) / 2));
  const idFs = Math.max(16, Math.round(ll * 0.12));
  const strainFs = Math.max(13, Math.round(ll * 0.095));
  const lotFs = Math.max(12, Math.round(ll * 0.085));
  const idY = by + bh + Math.round(ll * 0.025);
  const strainY = idY + idFs + Math.round(ll * 0.015);
  const lotY = strainY + strainFs + Math.round(ll * 0.012);
  let zpl = '^XA^MMT^MNY^PW' + pw + '^LL' + ll + '^LH0,0\n';
  zpl += '^FO' + bx + ',' + by + '^BY' + moduleW + ',' + barRatio + ',' + bh + '^BCN,' + bh + ',N,N,N^FD' + id + '^FS\n';
  zpl += '^FO0,' + idY + '^A0N,' + idFs + ',' + idFs + '^FB' + pw + ',1,0,C^FD' + id + '^FS\n';
  if(strainLine) zpl += '^FO0,' + strainY + '^A0N,' + strainFs + ',' + strainFs + '^FB' + pw + ',1,0,C^FD' + strainLine + '^FS\n';
  if(lotLine) zpl += '^FO0,' + lotY + '^A0N,' + lotFs + ',' + lotFs + '^FB' + pw + ',1,0,C^FD' + lotLine + '^FS\n';
  zpl += '^PQ1^XZ\n';
  return zpl;
}

function buildLabelsPreviewHtml(plants){
  return plants.map(p=>{
    const lot = p.lotId || p.transferBatchRef || '';
    return `
    <div class="zebra-label" data-batch="${esc(p.batchId)}">
      <div class="zebra-barcode">${renderBarcodeSvg(p.batchId, { height: 48, width: 2.2 })}</div>
      <div class="zebra-label-id">${esc(p.batchId)}</div>
      <div class="zebra-label-meta">${esc(p.strain)}</div>
      <div class="zebra-label-lot">${lot ? 'Lot ' + esc(lot) : esc(p.room || '—')}</div>
    </div>`;
  }).join('');
}

function buildZplForPlants(plants){
  return plants.map(p=> buildZplLabel(p.batchId, p.strain, p.room, p.lotId || p.transferBatchRef)).join('');
}

function downloadZplFile(plants){
  const zpl = buildZplForPlants(plants);
  const id = (plants[0] && plants[0].batchId) ? plants[0].batchId.replace(/[^\w-]/g, '') : 'labels';
  const filename = id + (plants.length > 1 ? '-batch' : '') + '.zpl';
  const blob = new Blob([zpl], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  showDocToast('ZPL downloaded ✓');
  return filename;
}

async function copyZplToClipboard(plants){
  const zpl = buildZplForPlants(plants);
  try {
    await navigator.clipboard.writeText(zpl);
    showDocToast('ZPL copied ✓');
    return true;
  } catch(e){
    return false;
  }
}

function openPrintPlantLabels(plantIds){
  const plants = plantIds.map(getPlantById).filter(Boolean);
  if(!plants.length){ alert('No plants selected'); return; }
  modalDirty = true;
  const root = document.getElementById('modalRoot');
  const labelsHtml = buildLabelsPreviewHtml(plants);
  const savedIp = localStorage.getItem('cana_zebra_ip') || '192.168.1.151';
  const savedDpi = getZebraDpi();
  const labelSize = getLabelSizeIn();
  root.innerHTML = `
  <div class="overlay" id="overlay">
    <div class="modal modal-wide plant-print-modal">
      <h2>🖨 Print labels — ${plants.length} plant(s)</h2>
      <div class="plant-print-help">
        <p>Download or copy ZPL, then send to the printer in Terminal:<br>
        <code>nc ${esc(savedIp)} 9100 &lt; ~/Downloads/CA-P-….zpl</code> or <code>pbpaste | nc ${esc(savedIp)} 9100</code></p>
      </div>
      <div class="form-grid">
        <div class="field"><label>Printer IP</label>
          <input id="zebraIpInput" value="${esc(savedIp)}" placeholder="192.168.1.151"></div>
        <div class="field"><label>Printer DPI</label>
          <select id="zebraDpiInput">
            <option value="203" ${savedDpi===203?'selected':''}>203 dpi</option>
            <option value="300" ${savedDpi===300?'selected':''}>300 dpi</option>
          </select></div>
        <div class="field"><label>Label width (in)</label>
          <input id="labelWIn" type="number" step="0.1" min="0.5" max="4" value="${labelSize.w}"></div>
        <div class="field"><label>Label height (in)</label>
          <input id="labelHIn" type="number" step="0.1" min="0.5" max="4" value="${labelSize.h}"></div>
      </div>
      <div class="row-actions">
        <button type="button" class="primary" id="btnDownloadZpl">Download ZPL</button>
        <button type="button" class="ghost" id="btnCopyZpl">Copy ZPL</button>
        <button type="button" class="ghost" id="btnClosePrint">Close</button>
      </div>
      <p class="sub" id="printStatusLine"></p>
      <div class="zebra-label-sheet" id="zebraLabelSheet">${labelsHtml}</div>
    </div>
  </div>`;
  const setStatus = (msg)=>{ const el = document.getElementById('printStatusLine'); if(el) el.textContent = msg; };
  const getIp = ()=> (document.getElementById('zebraIpInput')||{}).value || savedIp;
  root.querySelector('#btnClosePrint').onclick = ()=>{ modalDirty = false; closeModal(); };
  root.querySelector('#overlay').onclick = (e)=>{ if(e.target.id==='overlay'){ modalDirty = false; closeModal(); } };
  root.querySelector('#btnCopyZpl').onclick = async ()=>{
    saveLabelPrintSettings();
    if(await copyZplToClipboard(plants)){
      setStatus('Copied — run in Terminal: pbpaste | nc ' + getIp() + ' 9100');
    } else setStatus('Copy failed — try Download ZPL');
  };
  root.querySelector('#btnDownloadZpl').onclick = ()=>{
    saveLabelPrintSettings();
    const fn = downloadZplFile(plants);
    setStatus('Saved to Downloads/' + fn + ' — run: nc ' + getIp() + ' 9100 < ~/Downloads/' + fn);
  };
}

function saveLabelPrintSettings(){
  const ip = document.getElementById('zebraIpInput');
  const dpi = document.getElementById('zebraDpiInput');
  const w = document.getElementById('labelWIn');
  const h = document.getElementById('labelHIn');
  if(ip) localStorage.setItem('cana_zebra_ip', String(ip.value || '').trim());
  if(dpi) localStorage.setItem('cana_zebra_dpi', dpi.value === '300' ? '300' : '203');
  if(w) localStorage.setItem('cana_label_w_in', String(Number(w.value) || 2));
  if(h) localStorage.setItem('cana_label_h_in', String(Number(h.value) || 1));
}

function openPlantLotTraceModal(lotIdOrRaw){
  const lotCode = parsePlantLotScanCode(lotIdOrRaw);
  const plants = getPlantsByLotId(lotCode);
  if(!plants.length){ alert('Lot not found: ' + lotIdOrRaw); return; }
  const sample = plants[0];
  const active = plants.filter(p=> p.status === PLANT_STATUS_OPTIONS[0] || p.status === PLANT_STATUS_OPTIONS[1]).length;
  const harvested = plants.filter(p=> p.status === PLANT_STATUS_OPTIONS[2]).length;
  modalDirty = false;
  const root = document.getElementById('modalRoot');
  const listHtml = plants.map(p=>`
    <button type="button" class="lot-plant-row" data-lot-plant-trace="${esc(p.batchId)}">
      <code class="batch-id">${esc(p.batchId)}</code>
      <span>${esc(plantStatusShort(p.status))}</span>
      <span class="muted">${esc(p.room || '—')}</span>
    </button>`).join('');
  root.innerHTML = `
  <div class="overlay" id="overlay">
    <div class="modal" style="max-width:560px">
      <h2>Lot — <code class="batch-id">${esc(lotCode)}</code></h2>
      <div class="trace-timeline">
        <div class="trace-step"><b>Strain</b> ${esc(sample.strain)} · ${esc(sample.sourceFarm || 'Cana')}</div>
        <div class="trace-step"><b>Potting</b> ${esc(sample.potDate)} · Room: ${esc(sample.roomHistory || sample.room)}</div>
        <div class="trace-step"><b>Plants in lot</b> ${plants.length} total · ${active} active · ${harvested} harvested</div>
        ${sample.notes ? '<div class="trace-step"><b>Notes</b> ' + esc(sample.notes) + '</div>' : ''}
      </div>
      <div class="lot-plant-list">${listHtml}</div>
      <div class="modal-actions">
        <button type="button" class="primary" id="btnLotPrintAll">Print all labels</button>
        <button type="button" class="danger admin-only" id="btnLotDelete">Delete entire lot</button>
        <button type="button" class="ghost" id="btnLotClose">Close</button>
      </div>
    </div>
  </div>`;
  root.querySelector('#btnLotClose').onclick = closeModal;
  root.querySelector('#overlay').onclick = (e)=>{ if(e.target.id==='overlay') closeModal(); };
  root.querySelector('#btnLotPrintAll').onclick = ()=> openPrintPlantLabels(plants.map(p=> p.id));
  const lotDel = root.querySelector('#btnLotDelete');
  if(lotDel) lotDel.onclick = ()=> deletePlantLot(lotCode);
  root.querySelectorAll('[data-lot-plant-trace]').forEach(el=>{
    el.onclick = ()=> openPlantTraceModal(el.dataset.lotPlantTrace);
  });
}

function openPlantTraceModal(batchIdOrRaw){
  const plant = getPlantByBatchId(batchIdOrRaw);
  if(!plant){ alert('Plant not found: ' + batchIdOrRaw); return; }
  const lotId = plant.lotId || plant.transferBatchRef || '';
  const lotMates = lotId ? getPlantsByLotId(lotId) : [];
  const trim = plant.linkedTrimId ? (state.trimming || []).find(t=> t.id === plant.linkedTrimId) : null;
  const stockLines = (state.canaStock || []).filter(s=>{
    if(trim && s.linkedTrimId === trim.id) return true;
    const ids = String(s.linkedPlantBatchIds || '').split(/[,\s]+/).map(x=> x.trim().toUpperCase());
    return ids.includes(String(plant.batchId).toUpperCase());
  });
  const cureSessions = trim ? (state.curingSessions || []).filter(cs=>{
    const tids = String(cs.linkedTrimIds || '').split(/[,\s]+/);
    return tids.includes(trim.id);
  }) : [];
  modalDirty = false;
  const root = document.getElementById('modalRoot');
  root.innerHTML = `
  <div class="overlay" id="overlay">
    <div class="modal" style="max-width:560px">
      <h2>Trace — <code class="batch-id">${esc(plant.batchId)}</code></h2>
      <div class="trace-timeline">
        <div class="trace-step"><b>Lot</b> ${lotId ? '<code class="batch-id">' + esc(lotId) + '</code> · ' + lotMates.length + ' plant(s) · <button type="button" class="ghost small" id="btnTraceLot">View lot</button>' : '—'}</div>
        <div class="trace-step"><b>Potting</b> ${esc(plant.potDate)} · ${esc(plant.strain)} · ${esc(plant.sourceFarm)}<br>Room: ${esc(plant.roomHistory || plant.room)}</div>
        <div class="trace-step"><b>Status</b> ${esc(plant.status)}${plant.harvestDate ? '<br>Harvest: ' + esc(plant.harvestDate) : ''}</div>
        <div class="trace-step"><b>Trim Cana</b> ${trim ? esc(trim.date) + ' · ' + esc(trim.room) + ' · ' + esc(trim.strain) + (trim.finishedFlowerG ? ' · ' + fmtWeight(trim.finishedFlowerG) : '') : '— not linked yet —'}</div>
        <div class="trace-step"><b>Cure</b> ${cureSessions.length ? cureSessions.map(c=> esc(c.room) + ' (' + esc(plantStatusShort(c.status)) + ')').join('<br>') : '—'}</div>
        <div class="trace-step"><b>Stock</b> ${stockLines.length ? stockLines.map(s=> esc(s.strain) + ' · ' + fmtWeight(stockLineTotalG(s)) + ' · ' + esc(plantStatusShort(s.status))).join('<br>') : '—'}</div>
      </div>
      <div class="zebra-barcode trace-barcode">${renderBarcodeSvg(plant.batchId)}</div>
      <div class="modal-actions">
        <button type="button" class="primary" id="btnTracePrint">Print label</button>
        <button type="button" class="ghost" id="btnTraceClose">Close</button>
      </div>
    </div>
  </div>`;
  root.querySelector('#btnTraceClose').onclick = closeModal;
  root.querySelector('#overlay').onclick = (e)=>{ if(e.target.id==='overlay') closeModal(); };
  root.querySelector('#btnTracePrint').onclick = ()=> openPrintPlantLabels([plant.id]);
  const lotBtn = root.querySelector('#btnTraceLot');
  if(lotBtn) lotBtn.onclick = ()=> openPlantLotTraceModal(lotId);
}
