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

function normalizePlant(rec){
  if(!rec) return rec;
  if(!rec.id) rec.id = uid();
  if(!rec.batchId) rec.batchId = '';
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
  return rec;
}

function parsePlantBatchSeq(batchId){
  const m = String(batchId || '').match(/^CA-P-(\d+)$/i);
  return m ? parseInt(m[1], 10) : 0;
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
      const hay = [p.batchId, p.strain, p.room, p.status, p.sourceFarm, p.transferBatchRef, p.notes, p.createdBy].join(' ').toLowerCase();
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
        <p class="sub">One ID per plant at potting · scan with Zebra · same ID through harvest → trim → stock<br><span class="bi">หนึ่งรหัสต่อหนึ่งต้นเมื่อ pot · ย้ายห้องไม่เปลี่ยนรหัส</span></p>
      </div>
      <div class="plant-kpi-mini">${(state.plants || []).length} plants · ${activeCount} active</div>
    </div>
    <div class="row-actions plant-toolbar">
      <button class="primary" id="btnPotBatch">+ Potting batch <span class="bi">/ สร้างรหัส pot</span></button>
      <button id="btnMoveRoom" ${plantSelectedIds.size ? '' : 'disabled'}>Move room <span class="bi">/ ย้ายห้อง</span></button>
      <button id="btnHarvestPlants" ${plantSelectedIds.size ? '' : 'disabled'}>Harvest <span class="bi">/ เก็บเกี่ยว</span></button>
      <button id="btnPrintLabels" ${plantSelectedIds.size ? '' : 'disabled'}>🖨 Print labels <span class="bi">/ พิมพ์</span></button>
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
      <input class="search-box plant-scan-input" id="plantScanInput" placeholder="Scan or type CA-P-000001 then Enter" autocomplete="off">
      <button type="button" class="primary" id="btnPlantCamera">📷 Camera <span class="bi">/ กล้อง</span></button>
      <button type="button" class="ghost" id="btnPlantTrace">Trace ID</button>
    </div>
    <input class="search-box" id="plantSearchBox" placeholder="Search strain, room, batch ID…" value="${esc(plantSearchText)}" style="margin-bottom:12px;width:100%;max-width:420px;">
    <div id="plantResultsWrap">${renderPlantsTable(rows)}</div>
  `;
  document.getElementById('btnPotBatch').onclick = ()=> openPottingBatchModal();
  document.getElementById('btnMoveRoom').onclick = ()=> openMoveRoomModal([...plantSelectedIds]);
  document.getElementById('btnHarvestPlants').onclick = ()=> openHarvestPlantsModal([...plantSelectedIds]);
  document.getElementById('btnPrintLabels').onclick = ()=> openPrintPlantLabels([...plantSelectedIds]);
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

function parsePlantScanCode(raw){
  let s = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
  let m = s.match(/CA-P-(\d+)/);
  if(m) return PLANT_BATCH_PREFIX + String(parseInt(m[1], 10)).padStart(6, '0');
  m = s.match(/^(\d{1,6})$/);
  if(m) return PLANT_BATCH_PREFIX + String(parseInt(m[1], 10)).padStart(6, '0');
  return s;
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

function renderPlantsTable(rows){
  if(!rows.length){
    return `<div class="panel empty-state"><b>No plants yet.</b> Use <b>+ Potting batch</b> after rooting to generate IDs and print Zebra labels.<br><span class="bi">ยังไม่มีข้อมูล — กด Potting batch หลัง pot</span></div>`;
  }
  const body = rows.map(p=>{
    const sel = plantSelectedIds.has(p.id);
    return `<tr class="${sel ? 'plant-row-selected' : ''}">
      <td><input type="checkbox" data-plant-select="${esc(p.id)}" ${sel ? 'checked' : ''}></td>
      <td><code class="batch-id">${esc(p.batchId)}</code></td>
      <td>${esc(p.strain)}</td>
      <td>${esc(p.potDate || '—')}</td>
      <td>${esc(p.room || '—')}</td>
      <td><span class="pill plant-status">${esc(plantStatusShort(p.status))}</span></td>
      <td>${esc(p.harvestDate || '—')}</td>
      <td class="plant-actions">
        <button type="button" class="ghost sm" data-plant-barcode="${esc(p.id)}">Barcode</button>
        <button type="button" class="ghost sm" data-plant-trace="${esc(p.batchId)}">Trace</button>
        <button type="button" class="ghost sm" data-plant-edit="${esc(p.id)}">Edit</button>
      </td>
    </tr>`;
  }).join('');
  return `<div class="table-wrap desktop-table"><table class="compact-table plant-table">
    <thead><tr>
      <th style="width:36px"><input type="checkbox" id="plantSelectAll" title="Select all visible"></th>
      <th>Batch ID</th><th>Strain</th><th>Pot date</th><th>Room</th><th>Status</th><th>Harvest</th><th></th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table></div>`;
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
  root.querySelectorAll('[data-plant-edit]').forEach(el=> el.onclick = ()=> openPlantEditModal(el.dataset.plantEdit));
}

function updatePlantToolbarState(){
  ['btnMoveRoom', 'btnHarvestPlants', 'btnPrintLabels'].forEach(id=>{
    const btn = document.getElementById(id);
    if(btn) btn.disabled = !plantSelectedIds.size;
  });
}

function handlePlantScan(raw){
  const code = parsePlantScanCode(raw);
  if(!code) return;
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
  const root = document.getElementById('modalRoot');
  root.innerHTML = `
  <div class="overlay" id="overlay">
    <div class="modal" style="max-width:520px">
      <h2>+ Potting batch</h2>
      <p class="sub">Creates one permanent ID + barcode per plant<br><span class="bi">สร้างรหัสถาวรและบาร์โค้ดต่อหนึ่งต้น</span></p>
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
    const transferBatchRef = 'TB-' + potDate.replace(/-/g,'') + '-' + room.replace(/\s+/g,'');
    const batchIds = allocatePlantBatchIds(qty);
    const newIds = [];
    if(!state.plants) state.plants = [];
    batchIds.forEach((batchId, i)=>{
      const plant = normalizePlant({
        id: uid(),
        batchId,
        strain,
        potDate,
        room,
        roomHistory: room,
        status: PLANT_STATUS_OPTIONS[0],
        sourceFarm: String(fd.get('sourceFarm') || 'Cana').trim(),
        transferBatchRef,
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
    showDocToast('Created ' + qty + ' plant ID(s) ✓');
    if(fd.get('printAfter')){
      printPlantsNow(newIds.map(getPlantById).filter(Boolean)).then(r=>{
        if(!r.ok) openPrintPlantLabels(newIds);
      });
    }
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
          <button type="submit" class="primary">Save</button>
        </div>
      </form>
    </div>
  </div>`;
  const close = ()=>{ modalDirty = false; closeModal(); };
  root.querySelector('#btnCancelPlantEdit').onclick = close;
  root.querySelector('#overlay').onclick = (e)=>{ if(e.target.id==='overlay') close(); };
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

function buildZplLabel(batchId, strain, room){
  const safe = (s)=> String(s || '').replace(/[^\x20-\x7E]/g, '').slice(0, 28);
  const id = safe(batchId);
  const meta = [safe(strain), safe(room)].filter(Boolean).join(' - ').slice(0, 28);
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
  const bh = Math.round(ll * 0.52);
  const by = Math.round(ll * 0.10);
  const bx = Math.max(4, Math.round((pw - barW) / 2));
  const idFs = Math.max(18, Math.round(ll * 0.14));
  const metaFs = Math.max(14, Math.round(ll * 0.11));
  const idY = by + bh + Math.round(ll * 0.03);
  const metaY = idY + idFs + Math.round(ll * 0.02);
  let zpl = '^XA^MMT^MNY^PW' + pw + '^LL' + ll + '^LH0,0\n';
  zpl += '^FO' + bx + ',' + by + '^BY' + moduleW + ',' + barRatio + ',' + bh + '^BCN,' + bh + ',N,N,N^FD' + id + '^FS\n';
  zpl += '^FO0,' + idY + '^A0N,' + idFs + ',' + idFs + '^FB' + pw + ',1,0,C^FD' + id + '^FS\n';
  if(meta) zpl += '^FO0,' + metaY + '^A0N,' + metaFs + ',' + metaFs + '^FB' + pw + ',1,0,C^FD' + meta + '^FS\n';
  zpl += '^PQ1^XZ\n';
  return zpl;
}

function buildLabelsPreviewHtml(plants){
  return plants.map(p=>`
    <div class="zebra-label" data-batch="${esc(p.batchId)}">
      <div class="zebra-barcode">${renderBarcodeSvg(p.batchId, { height: 52, width: 2.2 })}</div>
      <div class="zebra-label-id">${esc(p.batchId)}</div>
      <div class="zebra-label-meta">${esc(p.strain)} - ${esc(p.room || '—')}</div>
    </div>`).join('');
}

function buildZplForPlants(plants){
  return plants.map(p=> buildZplLabel(p.batchId, p.strain, p.room)).join('');
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

function openPlantTraceModal(batchIdOrRaw){
  const plant = getPlantByBatchId(batchIdOrRaw);
  if(!plant){ alert('Plant not found: ' + batchIdOrRaw); return; }
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
}
