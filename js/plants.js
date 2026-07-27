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
  const q = String(batchId || '').trim().toUpperCase();
  if(!q) return null;
  return (state.plants || []).find(p=> String(p.batchId || '').toUpperCase() === q) || null;
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
  bindPlantActions(main);
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
  const code = String(raw || '').trim().toUpperCase();
  if(!code) return;
  const plant = getPlantByBatchId(code);
  if(!plant){
    alert('Plant not found: ' + code + '\nไม่พบรหัสนี้');
    return;
  }
  if(!plantSelectedIds.has(plant.id)) plantSelectedIds.add(plant.id);
  openPlantTraceModal(plant.batchId);
  if(currentView === 'plants') updatePlantToolbarState();
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

function buildZplLabel(batchId, strain, room){
  const safe = (s)=> String(s || '').replace(/[^\x20-\x7E]/g, '');
  // 2" x 1" tear-off gap labels @ 203 dpi — NOT A4
  // ^MMT = tear-off mode  ^MNY = gap/mark media  ^PW/^LL = label size
  return '^XA^MMT^MNY^PW406^LL203^LH0,0\n'
    + '^FO12,8^BY1.5^BCN,52,Y,N,N^FD' + safe(batchId) + '^FS\n'
    + '^FO12,72^A0N,22,22^FD' + safe(batchId) + '^FS\n'
    + '^FO12,98^A0N,18,18^FD' + safe(strain) + '  ' + safe(room) + '^FS\n'
    + '^PQ1,0,1,Y^XZ\n';
}

function buildPrintLabelDocument(labelsInnerHtml){
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Plant labels</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  html,body{background:#fff;}
  body.print-labels-body{padding:0;}
  .zebra-label-sheet{display:block;}
  .zebra-label{
    width:2in;height:1in;padding:0.04in 0.06in;
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    text-align:center;background:#fff;overflow:hidden;
    page-break-after:always;break-after:page;
  }
  .zebra-label:last-child{page-break-after:auto;}
  .zebra-barcode svg{width:1.75in;max-width:1.75in;height:0.38in;}
  .zebra-label-id{font-family:Courier New,monospace;font-size:8pt;font-weight:700;line-height:1.1;}
  .zebra-label-meta{font-size:6.5pt;line-height:1.1;margin-top:0.02in;max-width:1.85in;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .zebra-label-date{font-size:6pt;color:#333;}
  @page{size:2in 1in;margin:0;}
  @media print{
    html,body{width:2in;height:1in;}
    .zebra-label{width:2in;height:1in;margin:0;border:0;}
  }
</style></head><body class="print-labels-body">
<div class="zebra-label-sheet">${labelsInnerHtml}</div>
<script>
window.onload=function(){
  setTimeout(function(){
    window.print();
  }, 300);
};
<\/script></body></html>`;
}

function buildZplForPlants(plants){
  return plants.map(p=> buildZplLabel(p.batchId, p.strain, p.room)).join('');
}

async function zebraBrowserPrintFetch(path, options){
  const bases = [
    'http://127.0.0.1:9100',
    'http://localhost:9100',
    'https://127.0.0.1:9101',
    'https://localhost:9101'
  ];
  let lastErr;
  for(const base of bases){
    try {
      const res = await fetch(base + path, { ...options, mode: 'cors' });
      return { res, base };
    } catch(e){ lastErr = e; }
  }
  throw lastErr || new Error('Zebra Browser Print is not running on this computer.');
}

async function getZebraPrinterDevices(){
  const { res } = await zebraBrowserPrintFetch('/available', { method: 'GET' });
  const data = await res.json();
  return data.printer || data.printerList || data.printers || [];
}

function pickZebraPrinterDevice(devices, ip){
  if(!devices || !devices.length) return null;
  ip = String(ip || '').trim();
  if(ip){
    const byIp = devices.find(d=>{
      const blob = JSON.stringify(d).toLowerCase();
      return blob.includes(ip.toLowerCase());
    });
    if(byIp) return byIp;
  }
  const savedUid = localStorage.getItem('cana_zebra_uid');
  if(savedUid){
    const byUid = devices.find(d=> d.uid === savedUid);
    if(byUid) return byUid;
  }
  return devices.find(d=> /z-label|zebra|ztc/i.test(String(d.name || ''))) || devices[0];
}

async function sendZplToZebraPrinter(zpl, ip){
  const devices = await getZebraPrinterDevices();
  const device = pickZebraPrinterDevice(devices, ip);
  if(!device || !device.uid) throw new Error('No Zebra printer found. Add Z-LABEL in Zebra Browser Print.');
  localStorage.setItem('cana_zebra_uid', device.uid);
  const { res } = await zebraBrowserPrintFetch('/write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device: { uid: device.uid }, data: zpl })
  });
  if(!res.ok) throw new Error('Zebra print failed (HTTP ' + res.status + ').');
  return device;
}

function openBrowserLabelPrint(labelsInnerHtml){
  const w = window.open('', '_blank', 'width=520,height=640');
  if(!w){ alert('Allow pop-ups to print labels'); return false; }
  w.document.write(buildPrintLabelDocument(labelsInnerHtml));
  w.document.close();
  return true;
}

async function printPlantsNow(plants, ip){
  ip = String(ip || localStorage.getItem('cana_zebra_ip') || '192.168.1.151').trim();
  localStorage.setItem('cana_zebra_ip', ip);
  const zpl = buildZplForPlants(plants);
  try {
    const device = await sendZplToZebraPrinter(zpl, ip);
    showDocToast('Printed on ' + (device.name || 'Zebra') + ' ✓');
    return { ok: true, method: 'zebra' };
  } catch(e){
    console.warn('Direct Zebra print failed', e);
    return { ok: false, error: e.message || String(e) };
  }
}

function showZebraSetupHint(extra){
  alert(
    'Sticker labels need Zebra direct print — NOT Mac A4 paper.\n\n'
    + 'ONE-TIME SETUP:\n'
    + '1. Install Zebra Browser Print on this Mac (zebra.com → Browser Print)\n'
    + '2. In Browser Print → add network printer Z-LABEL at '
    + (localStorage.getItem('cana_zebra_ip') || '192.168.1.151') + '\n'
    + '3. On the printer app: Media Settings → 2×1 in, Gap/Tear-off → Calibrate Media\n'
    + '4. Allow this website when Browser Print asks\n'
    + '5. Chrome → Settings → Privacy → Local network access → allow this site\n\n'
    + (extra ? extra + '\n\n' : '')
    + 'Then click Print now again (sends 2×1 sticker ZPL, not A4).'
  );
}

async function copyZplToClipboard(plants){
  const zpl = buildZplForPlants(plants);
  try {
    await navigator.clipboard.writeText(zpl);
    showDocToast('ZPL copied — paste in Zebra Setup Utilities → Send');
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
  const labelsHtml = plants.map(p=>`
    <div class="zebra-label" data-batch="${esc(p.batchId)}">
      <div class="zebra-barcode">${renderBarcodeSvg(p.batchId, { height: 40, width: 1.6 })}</div>
      <div class="zebra-label-id">${esc(p.batchId)}</div>
      <div class="zebra-label-meta">${esc(p.strain)} · ${esc(p.room || '—')}</div>
      <div class="zebra-label-date">${esc(p.potDate || '')}</div>
    </div>`).join('');
  const savedIp = localStorage.getItem('cana_zebra_ip') || '192.168.1.151';
  root.innerHTML = `
  <div class="overlay" id="overlay">
    <div class="modal modal-wide plant-print-modal">
      <h2>🖨 Print labels — ${plants.length} plant(s)</h2>
      <div class="helpbox plant-print-help" style="margin-bottom:12px;font-size:12px;">
        <b>Sticker roll (2×1 in tear-off)</b> — use <b>Print now</b> (Zebra direct).<br>
        <span style="color:#b45309;">⚠ Do NOT use Mac “Print” on A4 — that will not feed sticker labels correctly.</span><br>
        Needs <b>Zebra Browser Print</b> on this Mac (one-time install).
      </div>
      <div class="field" style="margin-bottom:10px;max-width:280px;">
        <label>Zebra Wi-Fi IP</label>
        <input id="zebraIpInput" value="${esc(savedIp)}" placeholder="192.168.1.151">
      </div>
      <div class="row-actions" style="margin-bottom:12px">
        <button type="button" class="primary" id="btnPrintNow">Print now → Z-LABEL</button>
        <button type="button" class="ghost" id="btnCopyZpl">Copy ZPL</button>
        <button type="button" class="ghost" id="btnClosePrint">Close</button>
      </div>
      <p class="sub" id="printStatusLine" style="font-size:11px;margin:0 0 8px;color:var(--muted);"></p>
      <div class="zebra-label-sheet" id="zebraLabelSheet">${labelsHtml}</div>
    </div>
  </div>`;
  const setStatus = (msg)=>{ const el = document.getElementById('printStatusLine'); if(el) el.textContent = msg; };
  root.querySelector('#btnClosePrint').onclick = ()=>{ modalDirty = false; closeModal(); };
  root.querySelector('#overlay').onclick = (e)=>{ if(e.target.id==='overlay'){ modalDirty = false; closeModal(); } };
  root.querySelector('#btnCopyZpl').onclick = async ()=>{
    if(await copyZplToClipboard(plants)) return;
    alert('Could not copy. Select text manually or use Print now with Browser Print.');
  };
  root.querySelector('#btnPrintNow').onclick = async ()=>{
    const btn = root.querySelector('#btnPrintNow');
    const ip = (document.getElementById('zebraIpInput')||{}).value || savedIp;
    btn.disabled = true;
    setStatus('Sending 2×1 sticker ZPL to Z-LABEL…');
    const result = await printPlantsNow(plants, ip);
    btn.disabled = false;
    if(result.ok){
      setStatus('Sent to Z-LABEL — check printer ✓');
      return;
    }
    setStatus('Could not reach Z-LABEL — see setup steps');
    showZebraSetupHint(result.error);
  };
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
