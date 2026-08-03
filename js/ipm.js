/**
 * CANA QC Tracker — IPM / Insect scouting
 * Rooms: Clone, Veg, Flower 1–4. Flower rooms also track grow cycles.
 */
let ipmSubTab = 'scout'; // 'scout' | 'cycles'
let ipmMonth = '';
let ipmRoomFilter = '';
let ipmSearchText = '';
let ipmSeverityFilter = '';

function normalizeInsectScout(rec){
  if(!rec) return rec;
  if(!rec.id) rec.id = uid();
  if(!rec.date) rec.date = '';
  if(!rec.time) rec.time = '';
  if(!rec.room) rec.room = '';
  if(!rec.cycleId) rec.cycleId = '';
  if(!rec.cycleName) rec.cycleName = '';
  if(!rec.pest) rec.pest = '';
  if(!rec.severity) rec.severity = '';
  if(rec.count === undefined || rec.count === null) rec.count = '';
  if(!rec.action) rec.action = '';
  if(!rec.product) rec.product = '';
  if(!rec.notes) rec.notes = '';
  if(!rec.scoutedBy) rec.scoutedBy = '';
  if(!rec.createdAt) rec.createdAt = '';
  return rec;
}
function isIpmSprayAction(action){
  return /spray|พ่น/i.test(String(action || ''));
}
function normalizeFlowerCycle(rec){
  if(!rec) return rec;
  if(!rec.id) rec.id = uid();
  if(!rec.room) rec.room = '';
  if(!rec.name) rec.name = '';
  if(!rec.startDate) rec.startDate = '';
  if(!rec.endDate) rec.endDate = '';
  if(!rec.status) rec.status = FLOWER_CYCLE_STATUS_OPTIONS[0];
  if(!rec.strain) rec.strain = '';
  if(!rec.notes) rec.notes = '';
  if(!rec.createdBy) rec.createdBy = '';
  if(!rec.createdAt) rec.createdAt = '';
  return rec;
}
function isFlowerCycleActive(c){
  return String((c && c.status) || '').indexOf('Active') >= 0;
}
function growRoomsEqual(a, b){
  const ca = typeof canonicalizeGrowRoom === 'function' ? canonicalizeGrowRoom(a) : String(a || '').trim();
  const cb = typeof canonicalizeGrowRoom === 'function' ? canonicalizeGrowRoom(b) : String(b || '').trim();
  return ca.toLowerCase() === cb.toLowerCase();
}
function getActiveCycleForRoom(room){
  return (state.flowerCycles || []).map(normalizeFlowerCycle)
    .find(c=> growRoomsEqual(c.room, room) && isFlowerCycleActive(c)) || null;
}
function getCyclesForRoom(room){
  return (state.flowerCycles || []).map(normalizeFlowerCycle)
    .filter(c=> !room || growRoomsEqual(c.room, room))
    .slice()
    .sort((a,b)=> (b.startDate || '').localeCompare(a.startDate || ''));
}
function countPlantsForCycle(cycleId){
  if(!cycleId) return 0;
  return (state.plants || []).filter(p=> String(p.cycleId || '') === String(cycleId)).length;
}
function nextFlowerCycleName(room){
  const m = String(room || '').match(/Flower room\s*([1-4])/i);
  const n = m ? m[1] : '?';
  const count = getCyclesForRoom(room).length + 1;
  return 'FR' + n + '-C' + String(count).padStart(2, '0');
}
function ipmSeverityClass(sev){
  const s = String(sev || '');
  if(s.indexOf('High') >= 0) return 'fail';
  if(s.indexOf('Medium') >= 0) return 'pending';
  if(s.indexOf('Low') >= 0) return 'pass';
  return '';
}
function allIpmMonths(){
  const set = new Set();
  (state.insectScouts || []).forEach(r=>{
    const m = r.date ? formatMonth(r.date) : '';
    if(m) set.add(m);
  });
  (state.flowerCycles || []).forEach(c=>{
    const m = c.startDate ? formatMonth(c.startDate) : '';
    if(m) set.add(m);
  });
  if(!set.size) set.add(currentMonthLabel());
  return [...set];
}
function getFilteredInsectScouts(){
  const month = ipmMonth || currentMonthLabel();
  const q = ipmSearchText.trim().toLowerCase();
  return (state.insectScouts || []).map(normalizeInsectScout).filter(r=>{
    if(month && r.date && formatMonth(r.date) !== month) return false;
    if(ipmRoomFilter && r.room !== ipmRoomFilter) return false;
    if(ipmSeverityFilter && r.severity !== ipmSeverityFilter) return false;
    if(!q) return true;
    const hay = [r.room, r.cycleName, r.pest, r.severity, r.action, r.product, r.notes, r.scoutedBy, r.count].join(' ').toLowerCase();
    return hay.includes(q);
  }).slice().sort((a,b)=> ((b.date||'') + ' ' + (b.time||'')).localeCompare((a.date||'') + ' ' + (a.time||'')));
}
function roomsMissingScoutToday(){
  const today = todayISO();
  const scouted = new Set(
    (state.insectScouts || []).filter(r=> r.date === today).map(r=> r.room)
  );
  return CANA_GROW_ROOMS.filter(r=> !scouted.has(r));
}
function mergeInsectScoutsFromRemote(remote){
  if(!Array.isArray(remote)) return;
  const rem = remote.map(normalizeInsectScout);
  const local = (state.insectScouts || []).map(normalizeInsectScout);
  if(!localDirty){
    if(!rem.length && local.length) return;
    state.insectScouts = rem;
    return;
  }
  const remoteIds = new Set(rem.map(r=> r.id));
  const pending = local.filter(r=> !remoteIds.has(r.id));
  const localById = Object.fromEntries(local.map(r=> [r.id, r]));
  state.insectScouts = rem.map(r=> localById[r.id] || r).concat(pending);
}
function mergeFlowerCyclesFromRemote(remote){
  if(!Array.isArray(remote)) return;
  const rem = remote.map(normalizeFlowerCycle);
  const local = (state.flowerCycles || []).map(normalizeFlowerCycle);
  if(!localDirty){
    if(!rem.length && local.length) return;
    state.flowerCycles = rem;
    return;
  }
  const remoteIds = new Set(rem.map(r=> r.id));
  const pending = local.filter(r=> !remoteIds.has(r.id));
  const localById = Object.fromEntries(local.map(r=> [r.id, r]));
  state.flowerCycles = rem.map(r=> localById[r.id] || r).concat(pending);
}

function renderIpmView(){
  if(!requireLogin()) return;
  if(!ipmMonth) ipmMonth = currentMonthLabel();
  const months = allIpmMonths();
  if(!months.includes(ipmMonth)) months.push(ipmMonth);
  months.sort((a,b)=> new Date('1 '+a) - new Date('1 '+b));
  const missing = roomsMissingScoutToday();
  const highCount = (state.insectScouts || []).filter(r=>
    r.date && formatMonth(r.date) === ipmMonth && String(r.severity || '').indexOf('High') >= 0
  ).length;
  const activeCycles = (state.flowerCycles || []).filter(isFlowerCycleActive).length;
  const main = document.getElementById('mainArea');
  const isScout = ipmSubTab === 'scout';
  main.innerHTML = `
    <div class="cana-header">
      <div>
        <h2>🐛 IPM — Insect scouting</h2>
        <p class="sub">One form for all rooms · Clone · Veg · Flower 1–4 · Flower rooms track <b>grow cycles</b><br>
        <span class="bi">ตรวจแมลงแยกห้อง · Flower room ผูกกับรอบปลูก (cycle)</span></p>
      </div>
      <div class="cana-header-meta">
        <span class="doc-badge">${activeCycles} active cycle${activeCycles===1?'':'s'}</span>
        <span class="doc-badge">${highCount} High this month</span>
        ${missing.length ? `<span class="doc-badge" style="background:#ffedd5;color:#9a3412;">${missing.length} room(s) not scouted today</span>` : `<span class="doc-badge">All rooms scouted today ✓</span>`}
      </div>
    </div>
    <div class="cana-subtabs">
      <button type="button" class="${isScout?'active':''}" id="btnIpmScout">🔍 Scout log <span class="bi">/ บันทึกตรวจ</span></button>
      <button type="button" class="${!isScout?'active':''}" id="btnIpmCycles">🌸 Flower cycles <span class="bi">/ รอบปลูก</span></button>
    </div>
    ${isScout ? renderIpmScoutPanel(months) : renderIpmCyclesPanel()}
  `;
  document.getElementById('btnIpmScout').onclick = ()=>{ ipmSubTab = 'scout'; renderIpmView(); };
  document.getElementById('btnIpmCycles').onclick = ()=>{ ipmSubTab = 'cycles'; renderIpmView(); };
  if(isScout) bindIpmScoutPanel();
  else bindIpmCyclesPanel();
}
function renderIpmScoutPanel(months){
  const rows = getFilteredInsectScouts();
  return `
    <div class="row-actions cana-toolbar">
      <button class="primary" id="btnNewIpmScout">+ New scout <span class="bi">/ ตรวจแมลง</span></button>
      <label class="month-filter">Month:
        <select id="ipmMonthInput">${months.map(m=>`<option value="${esc(m)}" ${m===ipmMonth?'selected':''}>${esc(m)}</option>`).join('')}</select>
      </label>
      <select id="ipmRoomFilter">
        <option value="">All rooms</option>
        ${CANA_GROW_ROOMS.map(r=>`<option value="${esc(r)}" ${ipmRoomFilter===r?'selected':''}>${esc(r)}</option>`).join('')}
      </select>
      <select id="ipmSeverityFilter">
        <option value="">All severity</option>
        ${IPM_SEVERITY_OPTIONS.map(o=>`<option value="${esc(o)}" ${ipmSeverityFilter===o?'selected':''}>${esc(o.split(' / ')[0])}</option>`).join('')}
      </select>
      <input class="search-box" id="ipmSearchBox" placeholder="Search pest, cycle, notes…" value="${esc(ipmSearchText)}">
    </div>
    <div class="ipm-room-strip">
      ${CANA_GROW_ROOMS.map(r=>{
        const active = getActiveCycleForRoom(r);
        const today = (state.insectScouts || []).some(s=> s.room === r && s.date === todayISO());
        return `<button type="button" class="ipm-room-chip ${ipmRoomFilter===r?'active':''}" data-ipm-room="${esc(r)}">
          <b>${esc(r)}</b>
          <span>${isFlowerGrowRoom(r) ? (active ? esc(active.name) : 'No active cycle') : '—'}</span>
          <span class="ipm-room-dot ${today?'ok':'miss'}" title="${today?'Scouted today':'Not scouted today'}"></span>
        </button>`;
      }).join('')}
    </div>
    <div id="ipmResultsWrap">${renderIpmScoutTable(rows)}</div>`;
}
function renderIpmScoutTable(rows){
  if(!rows.length){
    return `<div class="panel empty-state"><b>No scout logs this month.</b><br>Click <b>+ New scout</b> after walking a room.<br><span class="bi">ยังไม่มีบันทึกตรวจแมลง</span></div>`;
  }
  const body = rows.map(r=>{
    const sc = ipmSeverityClass(r.severity);
    return `<tr>
      <td>${esc(r.date||'—')}</td>
      <td>${esc(r.time||'—')}</td>
      <td><b>${esc(r.room||'—')}</b></td>
      <td>${esc(r.cycleName || (isFlowerGrowRoom(r.room) ? '—' : 'n/a'))}</td>
      <td>${esc((r.pest||'—').split(' / ')[0])}</td>
      <td><span class="status-chip ${sc}">${esc((r.severity||'—').split(' / ')[0])}</span></td>
      <td>${esc(r.count || '—')}</td>
      <td>${esc((r.action||'—').split(' / ')[0])}${r.product ? '<br><span class="muted" style="font-size:11px;">'+esc(r.product)+'</span>' : ''}</td>
      <td>${esc(r.scoutedBy||'—')}</td>
      <td><div class="action-group">
        <button type="button" class="small" data-edit-ipm="${esc(r.id)}">Edit</button>
        <button type="button" class="small danger admin-only" data-delete-ipm="${esc(r.id)}">Del</button>
      </div></td>
    </tr>`;
  }).join('');
  const cards = rows.map(r=>{
    const sc = ipmSeverityClass(r.severity);
    return `<div class="batch-card mob-card">
      <div class="card-top">
        <div class="card-head-text">
          <div class="card-title">${esc(r.room||'—')}</div>
          <div class="card-subtitle">${esc(r.date||'—')} ${esc(r.time||'')} · ${esc(r.cycleName || '')}</div>
        </div>
        <span class="status-chip ${sc}">${esc((r.severity||'—').split(' / ')[0])}</span>
      </div>
      <div class="card-meta">
        <span>${esc((r.pest||'—').split(' / ')[0])}</span>
        <span>${esc((r.action||'—').split(' / ')[0])}${r.product ? ' · ' + esc(r.product) : ''}</span>
        <span>${esc(r.scoutedBy||'—')}</span>
      </div>
      <div class="action-group">
        <button type="button" class="small" data-edit-ipm="${esc(r.id)}">Edit</button>
        <button type="button" class="small danger admin-only" data-delete-ipm="${esc(r.id)}">Del</button>
      </div>
    </div>`;
  }).join('');
  return `<div class="table-wrap desktop-table"><table class="compact-table">
    <thead><tr><th>Date</th><th>Time</th><th>Room</th><th>Cycle</th><th>Pest</th><th>Severity</th><th>Count</th><th>Action / product</th><th>By</th><th></th></tr></thead>
    <tbody>${body}</tbody>
  </table></div>
  <div class="card-list">${cards}</div>`;
}
function bindIpmScoutPanel(){
  const main = document.getElementById('mainArea');
  document.getElementById('btnNewIpmScout').onclick = ()=> openInsectScoutModal(null);
  document.getElementById('ipmMonthInput').onchange = (e)=>{ ipmMonth = e.target.value; renderIpmView(); };
  document.getElementById('ipmRoomFilter').onchange = (e)=>{ ipmRoomFilter = e.target.value; updateIpmScoutResults(); };
  document.getElementById('ipmSeverityFilter').onchange = (e)=>{ ipmSeverityFilter = e.target.value; updateIpmScoutResults(); };
  document.getElementById('ipmSearchBox').oninput = (e)=>{ ipmSearchText = e.target.value; updateIpmScoutResults(); };
  main.querySelectorAll('[data-ipm-room]').forEach(btn=>{
    btn.onclick = ()=>{
      ipmRoomFilter = ipmRoomFilter === btn.dataset.ipmRoom ? '' : btn.dataset.ipmRoom;
      renderIpmView();
    };
  });
  bindIpmScoutActions(main);
}
function updateIpmScoutResults(){
  const wrap = document.getElementById('ipmResultsWrap');
  if(!wrap || currentView !== 'ipm') return;
  wrap.innerHTML = renderIpmScoutTable(getFilteredInsectScouts());
  bindIpmScoutActions(document.getElementById('mainArea'));
}
function bindIpmScoutActions(root){
  if(!root) return;
  root.querySelectorAll('[data-edit-ipm]').forEach(btn=> btn.onclick = ()=> openInsectScoutModal(btn.dataset.editIpm));
  root.querySelectorAll('[data-delete-ipm]').forEach(btn=> btn.onclick = ()=> deleteInsectScout(btn.dataset.deleteIpm));
  updateAdminUI();
}
function openInsectScoutModal(id){
  if(!requireLogin()) return;
  const rec = id
    ? normalizeInsectScout({...(state.insectScouts || []).find(r=> r.id === id)})
    : normalizeInsectScout({
        id: uid(),
        date: todayISO(),
        time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }),
        room: ipmRoomFilter || CANA_GROW_ROOMS[0],
        pest: IPM_PEST_OPTIONS[0],
        severity: IPM_SEVERITY_OPTIONS[0],
        action: IPM_ACTION_OPTIONS[0],
        scoutedBy: getCurrentUserName(),
        createdAt: new Date().toISOString()
      });
  if(!rec || !rec.id){ alert('Scout not found'); return; }
  const isNew = !id;
  const active = getActiveCycleForRoom(rec.room);
  if(isNew && active){
    rec.cycleId = active.id;
    rec.cycleName = active.name;
  }
  modalDirty = !isNew;
  const root = document.getElementById('modalRoot');
  const cycleOptions = ()=>{
    if(!isFlowerGrowRoom(rec.room)) return `<option value="">n/a (not a flower room)</option>`;
    const cycles = getCyclesForRoom(rec.room);
    if(!cycles.length) return `<option value="">— no cycles yet — start one in Flower cycles tab —</option>`;
    return `<option value="">— none / prep —</option>` + cycles.map(c=>
      `<option value="${esc(c.id)}" ${c.id===rec.cycleId?'selected':''}>${esc(c.name)} (${esc((c.status||'').split(' / ')[0])}${c.startDate ? ' · ' + c.startDate : ''})</option>`
    ).join('');
  };
  root.innerHTML = `
  <div class="overlay" id="overlay">
    <div class="modal" style="max-width:560px">
      <h2>${isNew ? '+ Insect scout' : 'Edit scout'} <span class="bi">/ ตรวจแมลง</span></h2>
      <p class="sub">Pick the room you walked. Flower rooms should link to the current <b>cycle</b>.</p>
      <form id="ipmScoutForm" class="form-grid">
        <div class="field"><label>Date</label><input type="date" name="date" value="${esc(rec.date)}" required></div>
        <div class="field"><label>Time</label><input type="text" name="time" value="${esc(rec.time)}" placeholder="14:30"></div>
        <div class="field"><label>Room</label>
          <select name="room" id="ipmScoutRoom" required>
            ${CANA_GROW_ROOMS.map(r=>`<option value="${esc(r)}" ${r===rec.room?'selected':''}>${esc(r)}</option>`).join('')}
          </select>
        </div>
        <div class="field" id="ipmCycleField" style="${isFlowerGrowRoom(rec.room)?'':'display:none;'}">
          <label>Flower cycle <span class="bi">/ รอบปลูก</span></label>
          <select name="cycleId" id="ipmScoutCycle">${cycleOptions()}</select>
          <p class="sub" style="margin:4px 0 0;font-size:11px;" id="ipmCycleHint">${active && isFlowerGrowRoom(rec.room) ? 'Active now: <b>'+esc(active.name)+'</b>' : (isFlowerGrowRoom(rec.room) ? 'No active cycle — start one under Flower cycles if this room is flowering.' : '')}</p>
        </div>
        <div class="field"><label>Pest / insect</label>
          <select name="pest">${IPM_PEST_OPTIONS.map(o=>`<option value="${esc(o)}" ${o===rec.pest?'selected':''}>${esc(o)}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Severity</label>
          <select name="severity">${IPM_SEVERITY_OPTIONS.map(o=>`<option value="${esc(o)}" ${o===rec.severity?'selected':''}>${esc(o)}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Count (optional)</label>
          <input type="text" name="count" value="${esc(rec.count)}" placeholder="e.g. 3 on sticky / 2 leaves">
        </div>
        <div class="field"><label>Action</label>
          <select name="action" id="ipmScoutAction">${IPM_ACTION_OPTIONS.map(o=>`<option value="${esc(o)}" ${o===rec.action?'selected':''}>${esc(o)}</option>`).join('')}</select>
        </div>
        <div class="field" id="ipmProductField">
          <label>Spray / product <span class="bi">/ ยาที่พ่น</span></label>
          <input type="text" name="product" value="${esc(rec.product)}" placeholder="e.g. Neem, Spinosad, sticky traps…">
          <p class="sub" style="margin:4px 0 0;font-size:11px;">Fill when you spray — shows on the printable room report.</p>
        </div>
        <div class="field"><label>Scouted by</label>
          <input type="text" name="scoutedBy" value="${esc(rec.scoutedBy || getCurrentUserName())}">
        </div>
        <div class="field full"><label>Notes</label>
          <textarea name="notes" rows="3">${esc(rec.notes)}</textarea>
        </div>
        <div class="modal-actions full">
          <button type="button" class="ghost" id="btnCancelIpmScout">Cancel</button>
          <button type="submit" class="primary">Save scout</button>
        </div>
      </form>
    </div>
  </div>`;
  const close = ()=>{ if(modalDirty && !confirm('Discard unsaved changes?')) return; modalDirty = false; closeModal(); };
  root.querySelector('#btnCancelIpmScout').onclick = close;
  root.querySelector('#overlay').onclick = (e)=>{ if(e.target.id==='overlay') close(); };
  const form = root.querySelector('#ipmScoutForm');
  form.addEventListener('input', ()=>{ modalDirty = true; });
  const roomSel = root.querySelector('#ipmScoutRoom');
  const refreshCycleUi = ()=>{
    const room = roomSel.value;
    const field = root.querySelector('#ipmCycleField');
    const cycleSel = root.querySelector('#ipmScoutCycle');
    const hint = root.querySelector('#ipmCycleHint');
    const flower = isFlowerGrowRoom(room);
    field.style.display = flower ? '' : 'none';
    const act = getActiveCycleForRoom(room);
    const cycles = getCyclesForRoom(room);
    if(!flower){
      cycleSel.innerHTML = `<option value="">n/a (not a flower room)</option>`;
      hint.innerHTML = '';
      return;
    }
    cycleSel.innerHTML = (!cycles.length
      ? `<option value="">— no cycles yet —</option>`
      : `<option value="">— none / prep —</option>` + cycles.map(c=>
          `<option value="${esc(c.id)}" ${act && c.id===act.id?'selected':''}>${esc(c.name)} (${esc((c.status||'').split(' / ')[0])})</option>`
        ).join(''));
    hint.innerHTML = act
      ? 'Active now: <b>' + esc(act.name) + '</b>'
      : 'No active cycle — start one under <b>Flower cycles</b> if this room is flowering.';
  };
  roomSel.onchange = ()=>{ modalDirty = true; refreshCycleUi(); };
  form.onsubmit = (e)=>{
    e.preventDefault();
    const fd = new FormData(form);
    const updated = normalizeInsectScout({ ...rec });
    updated.date = String(fd.get('date') || '').trim();
    updated.time = String(fd.get('time') || '').trim();
    updated.room = String(fd.get('room') || '').trim();
    updated.cycleId = String(fd.get('cycleId') || '').trim();
    const cyc = (state.flowerCycles || []).find(c=> c.id === updated.cycleId);
    updated.cycleName = cyc ? cyc.name : '';
    if(!isFlowerGrowRoom(updated.room)){
      updated.cycleId = '';
      updated.cycleName = '';
    }
    updated.pest = String(fd.get('pest') || '').trim();
    updated.severity = String(fd.get('severity') || '').trim();
    updated.count = String(fd.get('count') || '').trim();
    updated.action = String(fd.get('action') || '').trim();
    updated.product = String(fd.get('product') || '').trim();
    updated.scoutedBy = String(fd.get('scoutedBy') || '').trim() || getCurrentUserName();
    updated.notes = String(fd.get('notes') || '').trim();
    if(!updated.date || !updated.room){ alert('Date and room required'); return; }
    if(!state.insectScouts) state.insectScouts = [];
    if(isNew) state.insectScouts.push(updated);
    else {
      const i = state.insectScouts.findIndex(r=> r.id === rec.id);
      if(i >= 0) state.insectScouts[i] = updated;
    }
    modalDirty = false;
    onDataChanged();
    if(appsScriptUrl){ clearTimeout(sheetSaveTimer); pushToGoogleSheet(true); }
    closeModal();
    ipmSubTab = 'scout';
    renderIpmView();
    showDocToast('Scout saved · ' + updated.room + (updated.cycleName ? ' · ' + updated.cycleName : ''));
  };
}
function deleteInsectScout(id){
  if(!requireAdmin('delete insect scout', ()=> deleteInsectScout(id))) return;
  if(!confirm('Delete this scout log?')) return;
  state.insectScouts = (state.insectScouts || []).filter(r=> r.id !== id);
  onDataChanged();
  if(appsScriptUrl){ clearTimeout(sheetSaveTimer); pushToGoogleSheet(true); }
  renderIpmView();
}

function renderIpmCyclesPanel(){
  const cycles = (state.flowerCycles || []).map(normalizeFlowerCycle)
    .slice().sort((a,b)=> (b.startDate||'').localeCompare(a.startDate||''));
  const flowerRooms = CANA_GROW_ROOMS.filter(isFlowerGrowRoom);
  const cards = flowerRooms.map(room=>{
    const active = getActiveCycleForRoom(room);
    const past = getCyclesForRoom(room).filter(c=> !isFlowerCycleActive(c)).slice(0, 3);
    return `<div class="panel ipm-cycle-card">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;flex-wrap:wrap;">
        <div>
          <h3 style="margin:0 0 4px;font-size:15px;">${esc(room)}</h3>
          ${active
            ? `<p style="margin:0;font-size:13px;"><span class="status-chip pass">Active</span> <b>${esc(active.name)}</b><br><span class="muted">Started ${esc(active.startDate||'—')}${active.strain ? ' · ' + esc(active.strain) : ''} · ${countPlantsForCycle(active.id)} plant(s)</span></p>`
            : `<p class="sub" style="margin:0;">No active cycle</p>`}
        </div>
        <div class="action-group">
          ${active
            ? `<button type="button" class="small" data-edit-cycle="${esc(active.id)}">Edit</button>
               <button type="button" class="small" data-ipm-report="${esc(active.id)}">📄 Report</button>
               <button type="button" class="small purple" data-end-cycle="${esc(active.id)}">End cycle</button>`
            : `<button type="button" class="small primary" data-start-cycle="${esc(room)}">+ Start cycle</button>`}
        </div>
      </div>
      ${past.length ? `<p class="sub" style="margin:10px 0 0;">Recent: ${past.map(c=> `<code>${esc(c.name)}</code>`).join(' · ')}</p>` : ''}
    </div>`;
  }).join('');
  const table = cycles.length ? `<div class="table-wrap desktop-table" style="margin-top:12px;"><table class="compact-table">
    <thead><tr><th>Cycle</th><th>Room</th><th>Status</th><th>Start</th><th>End</th><th>Strain</th><th>Plants</th><th>By</th><th></th></tr></thead>
    <tbody>${cycles.map(c=>`<tr>
      <td><b>${esc(c.name)}</b></td>
      <td>${esc(c.room)}</td>
      <td><span class="status-chip ${isFlowerCycleActive(c)?'pass':''}">${esc((c.status||'').split(' / ')[0])}</span></td>
      <td>${esc(c.startDate||'—')}</td>
      <td>${esc(c.endDate||'—')}</td>
      <td>${esc(c.strain||'—')}</td>
      <td>${countPlantsForCycle(c.id)}</td>
      <td>${esc(c.createdBy||'—')}</td>
      <td><div class="action-group">
        <button type="button" class="small" data-edit-cycle="${esc(c.id)}">Edit</button>
        <button type="button" class="small" data-ipm-report="${esc(c.id)}">📄 Report</button>
        ${isFlowerCycleActive(c) ? `<button type="button" class="small purple" data-end-cycle="${esc(c.id)}">End</button>` : ''}
        <button type="button" class="small danger admin-only" data-delete-cycle="${esc(c.id)}">Del</button>
      </div></td>
    </tr>`).join('')}</tbody>
  </table></div>` : '';
  return `
    <div class="row-actions cana-toolbar">
      <button class="primary" id="btnNewFlowerCycle">+ Start flower cycle</button>
      <span class="muted" style="font-size:12px;">One <b>Active</b> cycle per flower room · Plants in that room auto-link · Scout logs keep cycle history.</span>
    </div>
    <div class="ipm-cycle-grid">${cards}</div>
    ${table}`;
}
function bindIpmCyclesPanel(){
  const main = document.getElementById('mainArea');
  document.getElementById('btnNewFlowerCycle').onclick = ()=> openFlowerCycleModal(null, 'Flower room 1');
  main.querySelectorAll('[data-start-cycle]').forEach(btn=> btn.onclick = ()=> openFlowerCycleModal(null, btn.dataset.startCycle));
  main.querySelectorAll('[data-edit-cycle]').forEach(btn=> btn.onclick = ()=> openFlowerCycleModal(btn.dataset.editCycle));
  main.querySelectorAll('[data-ipm-report]').forEach(btn=> btn.onclick = ()=> openIpmGrowReport({ cycleId: btn.dataset.ipmReport }));
  main.querySelectorAll('[data-end-cycle]').forEach(btn=> btn.onclick = ()=> endFlowerCycle(btn.dataset.endCycle));
  main.querySelectorAll('[data-delete-cycle]').forEach(btn=> btn.onclick = ()=> deleteFlowerCycle(btn.dataset.deleteCycle));
  updateAdminUI();
}
function openFlowerCycleModal(id, presetRoom){
  if(!requireLogin()) return;
  const flowerRooms = CANA_GROW_ROOMS.filter(isFlowerGrowRoom);
  const rec = id
    ? normalizeFlowerCycle({...(state.flowerCycles || []).find(c=> c.id === id)})
    : normalizeFlowerCycle({
        id: uid(),
        room: presetRoom || flowerRooms[0],
        name: nextFlowerCycleName(presetRoom || flowerRooms[0]),
        startDate: todayISO(),
        status: FLOWER_CYCLE_STATUS_OPTIONS[0],
        createdBy: getCurrentUserName(),
        createdAt: new Date().toISOString()
      });
  if(!rec || !rec.id){ alert('Cycle not found'); return; }
  const isNew = !id;
  modalDirty = !isNew;
  const root = document.getElementById('modalRoot');
  root.innerHTML = `
  <div class="overlay" id="overlay">
    <div class="modal" style="max-width:520px">
      <h2>${isNew ? '+ Start flower cycle' : 'Edit flower cycle'}</h2>
      <p class="sub">Track each flowering round in Flower room 1–4. Insect scouts for that room can link to this cycle.</p>
      <form id="flowerCycleForm" class="form-grid">
        <div class="field"><label>Flower room</label>
          <select name="room" id="fcRoom" ${isNew?'':'disabled'}>
            ${flowerRooms.map(r=>`<option value="${esc(r)}" ${r===rec.room?'selected':''}>${esc(r)}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Cycle name</label>
          <input name="name" id="fcName" value="${esc(rec.name)}" required placeholder="e.g. FR1-C03">
        </div>
        <div class="field"><label>Start date</label><input type="date" name="startDate" value="${esc(rec.startDate)}" required></div>
        <div class="field"><label>End date</label><input type="date" name="endDate" value="${esc(rec.endDate)}"></div>
        <div class="field"><label>Status</label>
          <select name="status">${FLOWER_CYCLE_STATUS_OPTIONS.map(o=>`<option value="${esc(o)}" ${o===rec.status?'selected':''}>${esc(o)}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Main strain(s)</label>
          <input name="strain" value="${esc(rec.strain)}" placeholder="e.g. MAC 1, Gelato">
        </div>
        <div class="field full"><label>Notes</label><textarea name="notes" rows="2">${esc(rec.notes)}</textarea></div>
        <div class="modal-actions full">
          <button type="button" class="ghost" id="btnCancelCycle">Cancel</button>
          <button type="submit" class="primary">Save cycle</button>
        </div>
      </form>
    </div>
  </div>`;
  const close = ()=>{ if(modalDirty && !confirm('Discard unsaved changes?')) return; modalDirty = false; closeModal(); };
  root.querySelector('#btnCancelCycle').onclick = close;
  root.querySelector('#overlay').onclick = (e)=>{ if(e.target.id==='overlay') close(); };
  const form = root.querySelector('#flowerCycleForm');
  form.addEventListener('input', ()=>{ modalDirty = true; });
  const roomSel = root.querySelector('#fcRoom');
  if(isNew && roomSel){
    roomSel.onchange = ()=>{
      const nameEl = root.querySelector('#fcName');
      if(nameEl && (!nameEl.dataset.touched || nameEl.value === rec.name || /^FR[1-4]-C\d+$/i.test(nameEl.value))){
        nameEl.value = nextFlowerCycleName(roomSel.value);
        rec.name = nameEl.value;
      }
    };
    root.querySelector('#fcName').oninput = (e)=>{ e.target.dataset.touched = '1'; };
  }
  form.onsubmit = (e)=>{
    e.preventDefault();
    const fd = new FormData(form);
    const updated = normalizeFlowerCycle({ ...rec });
    updated.room = isNew ? String(fd.get('room') || '').trim() : rec.room;
    updated.name = String(fd.get('name') || '').trim();
    updated.startDate = String(fd.get('startDate') || '').trim();
    updated.endDate = String(fd.get('endDate') || '').trim();
    updated.status = String(fd.get('status') || '').trim();
    updated.strain = String(fd.get('strain') || '').trim();
    updated.notes = String(fd.get('notes') || '').trim();
    if(!updated.room || !updated.name || !updated.startDate){ alert('Room, name, and start date required'); return; }
    if(!isFlowerGrowRoom(updated.room)){ alert('Cycles are only for Flower room 1–4'); return; }
    if(isFlowerCycleActive(updated)){
      const clash = (state.flowerCycles || []).find(c=>
        c.id !== updated.id && c.room === updated.room && isFlowerCycleActive(c)
      );
      if(clash){
        alert('Room already has active cycle "' + clash.name + '". End that cycle first.');
        return;
      }
    }
    if(!state.flowerCycles) state.flowerCycles = [];
    if(isNew) state.flowerCycles.push(updated);
    else {
      const i = state.flowerCycles.findIndex(c=> c.id === rec.id);
      if(i >= 0) state.flowerCycles[i] = updated;
    }
    let linkedPlants = 0;
    if(isFlowerCycleActive(updated)){
      (state.plants || []).forEach(p=>{
        normalizePlant(p);
        if(!growRoomsEqual(p.room, updated.room)) return;
        if(p.cycleId) return; // keep prior cycle tag until Move / Link cycle
        p.cycleId = updated.id;
        p.cycleName = updated.name;
        linkedPlants += 1;
      });
    }
    modalDirty = false;
    onDataChanged();
    if(appsScriptUrl){ clearTimeout(sheetSaveTimer); pushToGoogleSheet(true); }
    closeModal();
    ipmSubTab = 'cycles';
    renderIpmView();
    showDocToast('Cycle saved · ' + updated.name + (linkedPlants ? ' · linked ' + linkedPlants + ' plant(s)' : ''));
  };
}
function endFlowerCycle(id){
  const c = (state.flowerCycles || []).find(x=> x.id === id);
  if(!c) return;
  const nPlants = countPlantsForCycle(id);
  if(!confirm('End cycle "' + c.name + '" in ' + c.room + '?\n' + nPlants + ' plant(s) keep this cycle tag for history.\nScout history stays linked.')) return;
  c.status = FLOWER_CYCLE_STATUS_OPTIONS[1];
  if(!c.endDate) c.endDate = todayISO();
  onDataChanged();
  if(appsScriptUrl){ clearTimeout(sheetSaveTimer); pushToGoogleSheet(true); }
  renderIpmView();
  showDocToast('Cycle ended · ' + c.name);
}
function deleteFlowerCycle(id){
  if(!requireAdmin('delete flower cycle', ()=> deleteFlowerCycle(id))) return;
  const c = (state.flowerCycles || []).find(x=> x.id === id);
  if(!c) return;
  const linked = (state.insectScouts || []).filter(s=> s.cycleId === id).length;
  if(!confirm('Delete cycle "' + c.name + '"' + (linked ? ' (' + linked + ' scout log(s) linked — cycle name stays on those rows)' : '') + '?')) return;
  state.flowerCycles = (state.flowerCycles || []).filter(x=> x.id !== id);
  onDataChanged();
  if(appsScriptUrl){ clearTimeout(sheetSaveTimer); pushToGoogleSheet(true); }
  renderIpmView();
}

/* ---------- Printable grow / IPM report (room + cycle + spray log) ---------- */
function getScoutsForCycleReport(cycle){
  if(!cycle) return [];
  const start = cycle.startDate || '';
  const end = cycle.endDate || '9999-12-31';
  return (state.insectScouts || []).map(normalizeInsectScout).filter(s=>{
    if(s.cycleId && s.cycleId === cycle.id) return true;
    // Fallback: same room during cycle dates (older logs before cycle link)
    if(growRoomsEqual(s.room, cycle.room) && s.date){
      if(start && s.date < start) return false;
      if(cycle.endDate && s.date > end) return false;
      if(!s.cycleId) return true;
    }
    return false;
  }).sort((a,b)=> (a.date||'').localeCompare(b.date||'') || (a.time||'').localeCompare(b.time||''));
}
function getPlantsForCycleReport(cycle, strainFilter){
  if(!cycle) return [];
  const q = String(strainFilter || '').trim().toLowerCase();
  return (state.plants || []).map(normalizePlant).filter(p=>{
    const onCycle = p.cycleId === cycle.id || (growRoomsEqual(p.room, cycle.room) && !p.cycleId);
    if(!onCycle) return false;
    if(!q) return true;
    return String(p.strain || '').toLowerCase().includes(q);
  }).sort((a,b)=> (a.strain||'').localeCompare(b.strain||'') || (a.batchId||'').localeCompare(b.batchId||''));
}
function splitCycleStrains(cycle){
  return String((cycle && cycle.strain) || '')
    .split(/[,;/|]+/)
    .map(s=> s.trim())
    .filter(Boolean);
}
function buildIpmGrowReportHtml(cycle, strainFilter){
  const scouts = getScoutsForCycleReport(cycle);
  const plants = getPlantsForCycleReport(cycle, strainFilter);
  const sprays = scouts.filter(s=> isIpmSprayAction(s.action) || s.product);
  const strainCounts = {};
  plants.forEach(p=>{
    const k = p.strain || '—';
    strainCounts[k] = (strainCounts[k] || 0) + 1;
  });
  const strainSummary = Object.keys(strainCounts).sort().map(k=> `${esc(k)} (${strainCounts[k]})`).join(' · ') || '—';
  const printed = new Date().toLocaleString();
  const titleStrain = strainFilter ? strainFilter : (cycle.strain || 'All strains in room');
  const sprayRows = sprays.length ? sprays.map(s=>`<tr class="spray-row">
      <td>${esc(s.date||'—')}</td>
      <td>${esc(s.time||'—')}</td>
      <td><b>${esc(s.product || (s.action||'').split(' / ')[0] || '—')}</b></td>
      <td>${esc((s.pest||'—').split(' / ')[0])}</td>
      <td>${esc((s.severity||'—').split(' / ')[0])}</td>
      <td>${esc(s.notes||'—')}</td>
      <td>${esc(s.scoutedBy||'—')}</td>
    </tr>`).join('') : `<tr><td colspan="7" class="muted">No spray / product entries yet — log Action = Spray and fill product name.</td></tr>`;
  const activityRows = scouts.length ? scouts.map(s=>{
    const spray = isIpmSprayAction(s.action) || s.product;
    return `<tr class="${spray ? 'spray-row' : ''}">
      <td>${esc(s.date||'—')}</td>
      <td>${esc(s.time||'—')}</td>
      <td>${esc((s.pest||'—').split(' / ')[0])}</td>
      <td>${esc((s.severity||'—').split(' / ')[0])}</td>
      <td>${esc((s.action||'—').split(' / ')[0])}${s.product ? ' · <b>'+esc(s.product)+'</b>' : ''}</td>
      <td>${esc(s.count||'—')}</td>
      <td>${esc(s.notes||'—')}</td>
      <td>${esc(s.scoutedBy||'—')}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="8" class="muted">No scout / IPM activity linked to this cycle yet.</td></tr>`;
  const plantRows = plants.length ? plants.slice(0, 80).map(p=>`<tr>
      <td><code>${esc(p.batchId)}</code></td>
      <td>${esc(p.strain||'—')}</td>
      <td>${esc(p.potDate||'—')}</td>
      <td>${esc((p.status||'').split(' / ')[0]||'—')}</td>
      <td>${esc(p.harvestDate||'—')}</td>
    </tr>`).join('') + (plants.length > 80 ? `<tr><td colspan="5" class="muted">… and ${plants.length - 80} more plants</td></tr>` : '')
    : `<tr><td colspan="5" class="muted">No plants linked to this cycle yet.</td></tr>`;

  return `
  <div class="ipm-report">
    <div class="ipm-report-head">
      <div>
        <div class="ipm-report-brand">Cana Australasia · QC Tracker</div>
        <h1>Grow / IPM report</h1>
        <p class="ipm-report-sub">Room activity · sprays · scout log for one flower cycle</p>
      </div>
      <div class="ipm-report-meta">
        <div><b>Room</b> ${esc(cycle.room)}</div>
        <div><b>Cycle</b> ${esc(cycle.name)}</div>
        <div><b>Status</b> ${esc((cycle.status||'').split(' / ')[0])}</div>
        <div><b>Dates</b> ${esc(cycle.startDate||'—')} → ${esc(cycle.endDate||'ongoing')}</div>
        <div><b>Focus</b> ${esc(titleStrain)}</div>
        <div><b>Printed</b> ${esc(printed)}</div>
      </div>
    </div>

    <section>
      <h2>1. Crop summary</h2>
      <p><b>Cycle strains:</b> ${esc(cycle.strain || '—')}</p>
      <p><b>Plants in report:</b> ${plants.length} · ${strainSummary}</p>
      ${cycle.notes ? `<p><b>Cycle notes:</b> ${esc(cycle.notes)}</p>` : ''}
      <p class="muted" style="font-size:12px;">IPM scouts are logged per <b>room / cycle</b> (not per single plant). Strain filter only narrows the plant list below.</p>
    </section>

    <section>
      <h2>2. Spray log — what was sprayed &amp; when</h2>
      <table>
        <thead><tr><th>Date</th><th>Time</th><th>Product / spray</th><th>Pest</th><th>Severity</th><th>Notes</th><th>By</th></tr></thead>
        <tbody>${sprayRows}</tbody>
      </table>
    </section>

    <section>
      <h2>3. All room activities (scout timeline)</h2>
      <table>
        <thead><tr><th>Date</th><th>Time</th><th>Pest</th><th>Severity</th><th>Action</th><th>Count</th><th>Notes</th><th>By</th></tr></thead>
        <tbody>${activityRows}</tbody>
      </table>
    </section>

    <section>
      <h2>4. Plants ${strainFilter ? '— ' + esc(strainFilter) : ''}</h2>
      <table>
        <thead><tr><th>Batch ID</th><th>Strain</th><th>Pot date</th><th>Status</th><th>Harvest</th></tr></thead>
        <tbody>${plantRows}</tbody>
      </table>
    </section>

    <p class="ipm-report-foot">Source: Insect Scout + Flower Cycles + Plant Registry · Cana QC Tracker</p>
  </div>`;
}
function openIpmGrowReport(opts){
  if(!requireLogin()) return;
  const cycleId = opts && opts.cycleId;
  let cycle = (state.flowerCycles || []).map(normalizeFlowerCycle).find(c=> c.id === cycleId);
  if(!cycle && opts && opts.room){
    cycle = getActiveCycleForRoom(opts.room);
  }
  if(!cycle){
    alert('No flower cycle found for this room.\nStart one under IPM → Flower cycles first.');
    return;
  }
  const strainOpts = splitCycleStrains(cycle);
  const plantStrains = [...new Set(getPlantsForCycleReport(cycle, '').map(p=> p.strain).filter(Boolean))].sort();
  const allStrains = [...new Set(strainOpts.concat(plantStrains))];
  let strainFilter = String((opts && opts.strain) || '').trim();
  modalDirty = false;
  const root = document.getElementById('modalRoot');
  const renderBody = ()=>{
    const body = root.querySelector('#ipmReportBody');
    if(body) body.innerHTML = buildIpmGrowReportHtml(cycle, strainFilter);
  };
  root.innerHTML = `
  <div class="overlay" id="overlay">
    <div class="modal modal-wide ipm-report-modal">
      <h2>📄 Grow / IPM report — ${esc(cycle.name)}</h2>
      <p class="sub">${esc(cycle.room)} · sprays, scout activity &amp; plant list · ready to print<br>
      <span class="bi">รายงานห้อง · ยาที่พ่น · กิจกรรม · พิมพ์ได้</span></p>
      <div class="row-actions" style="margin-bottom:10px;">
        <label class="month-filter">Strain focus:
          <select id="ipmReportStrain">
            <option value="">All strains in cycle / room</option>
            ${allStrains.map(s=>`<option value="${esc(s)}" ${s===strainFilter?'selected':''}>${esc(s)}</option>`).join('')}
          </select>
        </label>
        <button type="button" class="primary" id="btnPrintIpmReport">🖨 Print / Save PDF</button>
        <button type="button" class="ghost" id="btnCloseIpmReport">Close</button>
      </div>
      <div id="ipmReportBody" class="ipm-report-scroll">${buildIpmGrowReportHtml(cycle, strainFilter)}</div>
    </div>
  </div>`;
  const close = ()=>{ modalDirty = false; closeModal(); };
  root.querySelector('#btnCloseIpmReport').onclick = close;
  root.querySelector('#overlay').onclick = (e)=>{ if(e.target.id==='overlay') close(); };
  root.querySelector('#ipmReportStrain').onchange = (e)=>{
    strainFilter = e.target.value;
    renderBody();
  };
  root.querySelector('#btnPrintIpmReport').onclick = ()=> printIpmGrowReport(cycle, strainFilter);
}
function printIpmGrowReport(cycle, strainFilter){
  const html = buildIpmGrowReportHtml(cycle, strainFilter);
  const w = window.open('', '_blank', 'noopener,noreferrer,width=900,height=1000');
  if(!w){
    alert('Pop-up blocked — allow pop-ups to print the report.');
    return;
  }
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(cycle.name)} IPM report</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#0f172a;margin:24px;font-size:12px;line-height:1.4;}
    h1{margin:0 0 4px;font-size:22px;}
    h2{margin:18px 0 8px;font-size:14px;border-bottom:1px solid #cbd5e1;padding-bottom:4px;}
    .ipm-report-brand{font-size:11px;color:#166534;font-weight:700;text-transform:uppercase;letter-spacing:.04em;}
    .ipm-report-sub{margin:0;color:#64748b;}
    .ipm-report-head{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:12px;}
    .ipm-report-meta{font-size:12px;min-width:220px;}
    .ipm-report-meta div{margin:2px 0;}
    table{width:100%;border-collapse:collapse;margin:6px 0 12px;}
    th,td{border:1px solid #cbd5e1;padding:5px 7px;text-align:left;vertical-align:top;}
    th{background:#f1f5f9;font-size:11px;}
    tr.spray-row{background:#fff7ed;}
    .muted{color:#64748b;}
    .ipm-report-foot{margin-top:20px;font-size:10px;color:#94a3b8;}
    code{font-family:ui-monospace,Menlo,monospace;}
    @media print{body{margin:12mm;} h2{break-after:avoid;} table{break-inside:auto;} tr{break-inside:avoid;}}
  </style></head><body>${html}
  <script>window.onload=function(){setTimeout(function(){window.print();},200);}<\\/script>
  </body></html>`);
  w.document.close();
}
