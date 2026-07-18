/**
 * CANA QC Tracker — Google Sheets Backend (Professional Theme)
 * Run setupSheets or redesignSheets after pasting this file.
 */

const SPREADSHEET_ID = '1VRsMR7TyNXW4sSjRhsfKoK0R4DMyC9ZCrmrWvUJdoc4';

const DEFAULT_FARMS = ['Kenny', 'BB Farm', 'VT Farm', 'Extra Cannabis', 'ZaZa', 'Yang', 'Cana'];

const META_KEYS = ['batchId'];
const BLUE_KEYS = ['date','strain','bigsCount','popsCount','grossWt','condition','eurofinsTest','tnrTest','invoice','receivedBy','notes'];
const PURPLE_KEYS = ['qcStart','qcEnd','startWt','bigsG','popsG','scrapsG','seedsG','moldG','wasteG','passFail','qcBy'];
const DATA_KEYS = META_KEYS.concat(BLUE_KEYS).concat(PURPLE_KEYS);

const HEADERS = ['_id', 'Batch ID']
  .concat(['Date','Strain','Bigs (count)','Pops (count)','Gross Wt (g)','Physical Condition','Eurofins Test','TNR Test','Invoice','Received by','Notes'])
  .concat(['QC Start','QC End','Start Wt (g)','Bigs (g)','Pops (g)','Scraps (g)','Seeds (g)','Mold (g)','Waste (g)','Pass/Fail','QC by'])
  .concat(['Total Flower (g)','Total Out (g)','Diff (g)','Yield %','Month']);

const NUM_COLS = HEADERS.length;
const HEADER_ROW = 3;
const DATA_START_ROW = 4;
const PASS_FAIL_COL = 24; // 1-based column index for Pass/Fail

// Documents table — sits to the RIGHT of the QC table on each farm tab
const DOC_SPACER_COL = NUM_COLS + 1;
const FARM_DOC_START_COL = NUM_COLS + 2;
const FARM_DOC_HEADERS = ['_id', 'Title', 'Category', 'File Name', 'External URL', 'Notes', 'Uploaded By', 'Uploaded At', 'Size', 'MIME Type', 'Has local file'];
const FARM_DOC_NUM_COLS = FARM_DOC_HEADERS.length;

const THEME = {
  greenDark: '#14532d',
  greenMid: '#166534',
  greenBand: '#15803d',
  greenLight: '#dcfce7',
  greenPale: '#f0fdf4',
  blueHeader: '#1d4ed8',
  blueBg: '#dbeafe',
  bluePale: '#eff6ff',
  purpleHeader: '#6d28d9',
  purpleBg: '#ede9fe',
  purplePale: '#f5f3ff',
  greyHeader: '#334155',
  greyBg: '#f1f5f9',
  greyPale: '#f8fafc',
  pass: '#16a34a',
  passBg: '#dcfce7',
  fail: '#dc2626',
  failBg: '#fee2e2',
  cond: '#d97706',
  condBg: '#fef3c7',
  white: '#ffffff',
  ink: '#0f172a',
  muted: '#64748b'
};

/* ---------- Web App ---------- */

function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'read') {
    return jsonOut(readAllFarms());
  }
  if (e && e.parameter && e.parameter.action === 'write' && e.parameter.payload) {
    return jsonOut(handleWriteRequest(String(e.parameter.payload)));
  }
  if (e && e.parameter && e.parameter.action === 'setDriveConfig' && e.parameter.payload) {
    return jsonOut(handleDriveConfigRequest(String(e.parameter.payload)));
  }
  if (e && e.parameter && e.parameter.action === 'adminStatus') {
    return jsonOut(getLoginStatus());
  }
  if (e && e.parameter && e.parameter.action === 'loginStatus') {
    return jsonOut(getLoginStatus());
  }
  if (e && e.parameter && e.parameter.action === 'verifyAdmin' && e.parameter.pin) {
    return jsonOut(verifyLoginPin('manager', String(e.parameter.pin)));
  }
  if (e && e.parameter && e.parameter.action === 'verifyLogin' && e.parameter.pin) {
    return jsonOut(verifyLoginPin(String(e.parameter.role || 'staff'), String(e.parameter.pin)));
  }
  return jsonOut({ ok: true, message: 'CANA QC Tracker API' });
}

/** Run once in Apps Script: setAdminPin('your-secret-pin') */
function setAdminPin(pin) {
  pin = String(pin || '').trim();
  if (!pin) throw new Error('No PIN provided. Run setAdminPinOnce() instead (see bottom of this file).');
  if (pin.length < 4) throw new Error('PIN must be at least 4 characters (you sent ' + pin.length + ')');
  PropertiesService.getScriptProperties().setProperty('ADMIN_PIN_HASH', hashAdminPin(pin));
  Logger.log('Admin PIN set. Share only with managers.');
}

/** ← Run once — manager PIN (full access). Change the PIN below first. */
function setManagerPinOnce() {
  setAdminPin('blck'); // manager PIN — change before running
}

/** Alias for older docs */
function setAdminPinOnce() {
  setManagerPinOnce();
}

/** ← Run once — staff PIN (QC + document upload only). Change the PIN below first. */
function setStaffPinOnce() {
  setStaffPin('2026'); // staff PIN — change before running
}

function setStaffPin(pin) {
  pin = String(pin || '').trim();
  if (!pin) throw new Error('No PIN provided. Run setStaffPinOnce() instead.');
  if (pin.length < 4) throw new Error('PIN must be at least 4 characters.');
  PropertiesService.getScriptProperties().setProperty('STAFF_PIN_HASH', hashAdminPin(pin));
  Logger.log('Staff PIN set. Share only with QC / operations staff.');
}

function getAdminPinHash() {
  return PropertiesService.getScriptProperties().getProperty('ADMIN_PIN_HASH');
}

function getStaffPinHash() {
  return PropertiesService.getScriptProperties().getProperty('STAFF_PIN_HASH');
}

function hashAdminPin(pin) {
  return Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(pin))
  );
}

function getLoginStatus() {
  return {
    ok: true,
    hasPin: !!getAdminPinHash(),
    hasManagerPin: !!getAdminPinHash(),
    hasStaffPin: !!getStaffPinHash()
  };
}

function verifyLoginPin(role, pin) {
  role = String(role || 'staff').toLowerCase();
  pin = String(pin || '').trim();
  if (!pin) return { ok: false, error: 'Enter your PIN.' };
  var hash = hashAdminPin(pin);
  if (role === 'manager') {
    var managerHash = getAdminPinHash();
    if (!managerHash) return { ok: false, error: 'Manager PIN not configured. Run setManagerPinOnce in Apps Script.' };
    if (hash === managerHash) return { ok: true, role: 'manager' };
    return { ok: false, error: 'Incorrect manager PIN.' };
  }
  if (role === 'staff') {
    var staffHash = getStaffPinHash();
    if (!staffHash) return { ok: false, error: 'Staff PIN not configured. Run setStaffPinOnce in Apps Script.' };
    if (hash === staffHash) return { ok: true, role: 'staff' };
    return { ok: false, error: 'Incorrect staff PIN.' };
  }
  return { ok: false, error: 'Invalid role.' };
}

function verifyAdminPin(pin) {
  return verifyLoginPin('manager', pin);
}

function handleWriteRequest(payloadB64) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { ok: false, error: 'Server busy, try again' };
  try {
    var json = Utilities.newBlob(Utilities.base64Decode(payloadB64)).getDataAsString();
    var data = JSON.parse(json);
    if (data.action === 'write') {
      writeAllFarms(data.state);
      return { ok: true, updatedAt: new Date().toISOString() };
    }
    return { ok: false, error: 'Unknown action' };
  } catch (err) {
    return { ok: false, error: String(err) };
  } finally {
    lock.releaseLock();
  }
}

function handleDriveConfigRequest(payloadB64) {
  try {
    var json = Utilities.newBlob(Utilities.base64Decode(payloadB64)).getDataAsString();
    var data = JSON.parse(json);
    if (data.action !== 'setDriveConfig') return { ok: false, error: 'Invalid action' };
    return applyDriveConfig(data);
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function applyDriveConfig(data) {
  var parentId = normalizeDriveFolderId(data.driveParentFolderId);
  if (!parentId || parentId.length < 20) {
    return { ok: false, error: 'Parent folder ID missing or too short — paste the full Cana Documents URL.' };
  }
  var ss = getSpreadsheet();
  writeDriveParentFolder(ss, parentId);
  writeFarmDriveFolders(ss, data.farmDriveFolders || {});
  updateMeta(ss);
  return { ok: true, driveParentFolderId: parentId, updatedAt: new Date().toISOString() };
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return jsonOut({ ok: false, error: 'Server busy, try again' });
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonOut({ ok: false, error: 'Empty POST body — use GET write or redeploy web app' });
    }
    var data = JSON.parse(e.postData.contents);
    if (data.action === 'read') return jsonOut(readAllFarms());
    if (data.action === 'write') {
      writeAllFarms(data.state);
      return jsonOut({ ok: true, updatedAt: new Date().toISOString() });
    }
    if (data.action === 'setDriveConfig') {
      return jsonOut(applyDriveConfig(data));
    }
    if (data.action === 'uploadDoc') {
      return jsonOut(uploadDocumentToFarm(data.farm, data.fileName, data.mimeType, data.data));
    }
    return jsonOut({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function testConnection() {
  var ss = getSpreadsheet();
  Logger.log('OK: ' + ss.getName() + ' | ' + ss.getId());
}

function getSpreadsheet() {
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  var id = String(SPREADSHEET_ID || '').trim();
  if (!id || id.indexOf('PASTE_YOUR') === 0) {
    throw new Error('Open Apps Script from your Google Sheet (Extensions → Apps Script).');
  }
  if (id.indexOf('http') >= 0) throw new Error('Use Sheet ID only, not full URL.');
  return SpreadsheetApp.openById(id);
}

/** Farm list stored in hidden _Meta sheet — editable from web app */
function readFarmListFromMeta(ss) {
  var meta = ss.getSheetByName('_Meta');
  if (!meta) return null;
  var raw = meta.getRange('B4').getValue();
  if (!raw) return null;
  try {
    var list = JSON.parse(String(raw));
    if (Array.isArray(list) && list.length) {
      return list.filter(function(n) { return String(n || '').trim(); }).map(String);
    }
  } catch (e) {}
  return null;
}

function readFarmCodesFromMeta(ss) {
  var meta = ss.getSheetByName('_Meta');
  if (!meta) return {};
  var raw = meta.getRange('B5').getValue();
  if (!raw) return {};
  try {
    var obj = JSON.parse(String(raw));
    return (obj && typeof obj === 'object') ? obj : {};
  } catch (e) {}
  return {};
}

function getFarmList(ss) {
  return readFarmListFromMeta(ss) || DEFAULT_FARMS.slice();
}

function writeFarmConfig(ss, farmList, farmCodes) {
  var meta = ss.getSheetByName('_Meta');
  if (!meta) {
    meta = ss.insertSheet('_Meta');
    meta.hideSheet();
    meta.getRange('A1').setValue('CANA QC Tracker — do not delete');
  }
  if (farmList && farmList.length) {
    meta.getRange('A4').setValue('farmList');
    meta.getRange('B4').setValue(JSON.stringify(farmList));
  }
  if (farmCodes && typeof farmCodes === 'object') {
    meta.getRange('A5').setValue('farmCodes');
    meta.getRange('B5').setValue(JSON.stringify(farmCodes));
  }
}

function readFarmDriveFoldersFromMeta(ss) {
  var meta = ss.getSheetByName('_Meta');
  if (!meta) return {};
  var raw = meta.getRange('B6').getValue();
  if (!raw) return {};
  try {
    var obj = JSON.parse(String(raw));
    return (obj && typeof obj === 'object') ? obj : {};
  } catch (e) {}
  return {};
}

function writeFarmDriveFolders(ss, folders) {
  var meta = ss.getSheetByName('_Meta');
  if (!meta) {
    meta = ss.insertSheet('_Meta');
    meta.hideSheet();
    meta.getRange('A1').setValue('CANA QC Tracker — do not delete');
  }
  meta.getRange('A6').setValue('farmDriveFolders');
  meta.getRange('B6').setValue(JSON.stringify(folders || {}));
}

function readDriveParentFolderFromMeta(ss) {
  var meta = ss.getSheetByName('_Meta');
  if (!meta) return '';
  return normalizeDriveFolderId(meta.getRange('B7').getValue());
}

function writeDriveParentFolder(ss, parentId) {
  var meta = ss.getSheetByName('_Meta');
  if (!meta) {
    meta = ss.insertSheet('_Meta');
    meta.hideSheet();
    meta.getRange('A1').setValue('CANA QC Tracker — do not delete');
  }
  meta.getRange('A7').setValue('driveParentFolderId');
  meta.getRange('B7').setValue(normalizeDriveFolderId(parentId) || String(parentId || '').trim());
}

function normalizeFolderMatchName(name) {
  return String(name || '').trim().toLowerCase().replace(/\sfarm$/i, '').replace(/\s+/g, '');
}

function findFarmFolderInParent(parentFolder, farmName) {
  var target = String(farmName || '').trim().toLowerCase();
  var targetCore = normalizeFolderMatchName(farmName);
  var it = parentFolder.getFolders();
  var fuzzy = null;
  while (it.hasNext()) {
    var f = it.next();
    var n = String(f.getName()).trim();
    var nl = n.toLowerCase();
    if (nl === target) return f;
    if (normalizeFolderMatchName(n) === targetCore) return f;
    if (nl.replace(/\s+/g, '') === target.replace(/\s+/g, '')) return f;
    if (nl.indexOf(targetCore) >= 0 || targetCore.indexOf(normalizeFolderMatchName(n)) >= 0) fuzzy = f;
  }
  return fuzzy;
}

function extractDriveFolderId(url) {
  var s = String(url || '').trim();
  if (!s) return '';
  var m = s.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  m = s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return m ? m[1] : '';
}

function normalizeDriveFolderId(id) {
  id = String(id || '').trim();
  if (!id) return '';
  if (/^https?:\/\//i.test(id)) return extractDriveFolderId(id);
  return id.replace(/[^a-zA-Z0-9_-]/g, '');
}

function getDriveFolderForFarm(farm) {
  var ss = getSpreadsheet();
  var folders = readFarmDriveFoldersFromMeta(ss);
  var folderId = normalizeDriveFolderId(folders[farm]);
  if (folderId && folderId.length >= 20) {
    try {
      var direct = DriveApp.getFolderById(folderId);
      return { ok: true, folder: direct, folderId: folderId, source: 'override' };
    } catch (e) { /* try parent lookup below */ }
  }
  var parentId = readDriveParentFolderFromMeta(ss);
  if (!parentId) {
    return {
      ok: false,
      error: 'Drive not configured for "' + farm + '". Admin: More → Drive Folders → paste the Cana Documents parent folder link.'
    };
  }
  if (parentId.length < 20) {
    return { ok: false, error: 'Cana Documents parent folder link looks incomplete — paste the full URL again.' };
  }
  try {
    var parent = DriveApp.getFolderById(parentId);
    var sub = findFarmFolderInParent(parent, farm);
    if (!sub) {
      return {
        ok: false,
        error: 'No subfolder for "' + farm + '" inside Cana Documents. Create a folder named "' + farm + '" (or similar, e.g. Kenny) in Drive.'
      };
    }
    return { ok: true, folder: sub, folderId: sub.getId(), source: 'parent', parentId: parentId };
  } catch (e) {
    var who = '';
    try { who = Session.getEffectiveUser().getEmail(); } catch (err) {}
    return {
      ok: false,
      error: 'Cannot open Cana Documents folder (ID: ' + parentId + '). '
        + 'Apps Script account: ' + (who || 'deploy owner') + '. '
        + 'Open that folder link while logged in as that account, then paste it again in More → Drive Folders.'
    };
  }
}

/** Run in Apps Script to test folder access — check Execution log */
function verifyDriveFolders() {
  var ss = getSpreadsheet();
  var farmList = getFarmList(ss);
  var who = Session.getEffectiveUser().getEmail();
  var parentId = readDriveParentFolderFromMeta(ss);
  Logger.log('Apps Script account: ' + who);
  Logger.log('Cana Documents parent ID: ' + (parentId || '(not set)'));
  if (parentId) {
    try {
      var p = DriveApp.getFolderById(parentId);
      Logger.log('Parent folder OK: ' + p.getName());
    } catch (e) {
      Logger.log('Parent folder FAIL — cannot open ID ' + parentId);
    }
  }
  farmList.forEach(function(farm) {
    var res = getDriveFolderForFarm(farm);
    if (res.ok) {
      Logger.log(farm + ': OK — ' + res.folder.getName() + ' (' + res.folderId + ') via ' + (res.source || '?'));
    } else {
      Logger.log(farm + ': FAIL — ' + res.error);
    }
  });
}

function uploadDocumentToFarm(farm, fileName, mimeType, dataB64) {
  farm = String(farm || '').trim();
  if (!farm) return { ok: false, error: 'Farm name required' };
  if (!dataB64) return { ok: false, error: 'No file data' };
  var folderRes = getDriveFolderForFarm(farm);
  if (!folderRes.ok) return folderRes;
  var folder = folderRes.folder;
  var bytes;
  try {
    bytes = Utilities.base64Decode(String(dataB64));
  } catch (e) {
    return { ok: false, error: 'Invalid file data' };
  }
  if (bytes.length > 8 * 1024 * 1024) {
    return { ok: false, error: 'File too large (max 8 MB)' };
  }
  var blob = Utilities.newBlob(bytes, mimeType || 'application/octet-stream', fileName || 'document');
  var file;
  try {
    file = folder.createFile(blob);
  } catch (e) {
    var msg = String(e);
    if (/do not have permission to call DriveApp|Required permissions.*drive/i.test(msg)) {
      return {
        ok: false,
        error: 'Drive upload not authorized for the web app. '
          + 'Apps Script owner: run authorizeDriveUploadOnce() → Allow → Deploy → Manage deployments → New version → Deploy.'
      };
    }
    return { ok: false, error: msg };
  }
  var fileId = file.getId();
  return {
    ok: true,
    url: 'https://drive.google.com/file/d/' + fileId + '/view',
    fileId: fileId,
    fileName: file.getName()
  };
}

function deleteOrphanFarmSheet(ss, farmName, farmList) {
  if (farmList.indexOf(farmName) >= 0) return;
  var sheet = ss.getSheetByName(farmName);
  if (!sheet) return;
  ss.deleteSheet(sheet);
}

/* ---------- Setup / Redesign ---------- */

function setupSheets() {
  var ss = getSpreadsheet();
  var existing = ss.getSheets().map(function(s) { return s.getName(); });
  writeFarmConfig(ss, DEFAULT_FARMS.slice(), {});
  var farmList = getFarmList(ss);
  setupReadmeTab(ss);
  setupMetaTab(ss, existing);
  farmList.forEach(function(farm) {
    if (existing.indexOf(farm) === -1) ss.insertSheet(farm);
    writeFarmSheet(ss.getSheetByName(farm), [], []);
  });
  if (existing.indexOf('Dashboard') === -1) ss.insertSheet('Dashboard');
  setupDocumentsTab(ss);
  updateDashboard(ss);
  orderTabs(ss);
  SpreadsheetApp.flush();
  Logger.log('Professional setup complete.');
}

/** Run this to apply the new design without losing data */
function redesignSheets() {
  upgradeSheetHeaders();
}

function migrateV4Sheets() { redesignSheets(); }

function upgradeSheetHeaders() {
  var ss = getSpreadsheet();
  var farmList = getFarmList(ss);
  var allDocs = readDocuments(ss, farmList);
  farmList.forEach(function(farm) {
    var sheet = ss.getSheetByName(farm);
    if (!sheet) return;
    var records = readFarmSheet(sheet);
    var docs = allDocs[farm] || [];
    writeFarmSheet(sheet, records, docs);
    Logger.log(farm + ': ' + records.length + ' QC + ' + docs.length + ' doc(s)');
  });
  setupReadmeTab(ss);
  if (allDocs) writeDocuments(ss, allDocs, farmList);
  updateDashboard(ss);
  orderTabs(ss);
  SpreadsheetApp.flush();
  Logger.log('Redesign complete.');
}

function orderTabs(ss) {
  var order = ['README', 'Dashboard', 'Documents', 'Trimming'].concat(getFarmList(ss));
  for (var i = order.length - 1; i >= 0; i--) {
    var sh = ss.getSheetByName(order[i]);
    if (sh) {
      ss.setActiveSheet(sh);
      ss.moveActiveSheet(1);
    }
  }
}

function setupReadmeTab(ss) {
  var sheet = ss.getSheetByName('README') || ss.insertSheet('README');
  sheet.clear();
  sheet.setTabColor(THEME.greenMid);

  sheet.getRange(1, 1, 1, 6).merge()
    .setValue('CANA QC TRACKER')
    .setBackground(THEME.greenDark).setFontColor(THEME.white)
    .setFontSize(22).setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  sheet.setRowHeight(1, 52);

  sheet.getRange(2, 1, 1, 6).merge()
    .setValue('Google Sheet Backend · Syncs with web app every ~6 seconds')
    .setBackground(THEME.greenBand).setFontColor(THEME.white)
    .setFontSize(11).setHorizontalAlignment('center');
  sheet.setRowHeight(2, 28);

  var steps = [
    ['Step', 'Action', 'Who'],
    ['1', 'Extensions → Apps Script → paste CANA_QC_GoogleAppsScript.gs', 'Admin'],
    ['2', 'Run → setupSheets (first time) or upgradeFarmDocumentTables (docs beside QC)', 'Admin'],
    ['2b', 'More → Manage Farms in web app to add new supplier farms (syncs to sheet)', 'Admin'],
    ['3', 'Run setAdminPin("your-pin") once in Apps Script — protects settings from accidental clicks', 'Admin'],
    ['4', 'Deploy → Web app → Execute as Me → Who has access: Anyone → copy /exec URL', 'Admin'],
    ['5', 'Paste URL in Vercel config.json + app Connect modal', 'Admin'],
    ['6', 'Share this sheet with all staff as Editor', 'Admin'],
    ['7', 'Staff: daily QC in web app · Managers: click Admin + PIN for farms/settings', 'All team'],
    ['8', 'Documents: upload files to Google Drive → paste link in app → syncs to Documents tab', 'All team']
  ];
  sheet.getRange(4, 1, steps.length, 3).setValues(steps);
  sheet.getRange(4, 1, 1, 3).setBackground(THEME.blueHeader).setFontColor(THEME.white).setFontWeight('bold');
  sheet.getRange(5, 1, steps.length - 1, 3).setBackground(THEME.bluePale);
  sheet.setColumnWidth(1, 50);
  sheet.setColumnWidth(2, 420);
  sheet.setColumnWidth(3, 80);

  sheet.getRange(12, 1).setValue('COLOR LEGEND').setFontWeight('bold').setFontColor(THEME.greenDark);
  var legend = [
    ['Blue', 'Manager — goods received on arrival'],
    ['Purple', 'QC staff — same-day QC results'],
    ['Grey', 'Auto-calculated — do not edit manually']
  ];
  sheet.getRange(13, 1, legend.length, 2).setValues(legend);
  sheet.getRange(13, 1, 1, 1).setBackground(THEME.blueBg);
  sheet.getRange(14, 1, 1, 1).setBackground(THEME.purpleBg);
  sheet.getRange(15, 1, 1, 1).setBackground(THEME.greyBg);

  sheet.getRange(17, 1).setValue('Last design run: ' + new Date().toLocaleString()).setFontColor(THEME.muted).setFontSize(10);
}

function setupMetaTab(ss, existing) {
  if (existing.indexOf('_Meta') === -1) {
    var meta = ss.insertSheet('_Meta');
    meta.hideSheet();
    meta.getRange('A1').setValue('CANA QC Tracker — do not delete');
  }
}

/* ---------- Farm sheet layout ---------- */

function findHeaderRowIndex(sheet) {
  var max = Math.min(sheet.getLastRow(), 15);
  if (max < 1) return HEADER_ROW;
  var values = sheet.getRange(1, 1, max, 3).getValues();
  for (var r = 0; r < values.length; r++) {
    if (String(values[r][0] || '') === '_id') return r + 1;
    if (String(values[r][0] || '') === 'Date' || String(values[r][2] || '') === 'Strain') return r + 1;
  }
  return HEADER_ROW;
}

/** Google Sheets default to 26 columns — document table starts at col 32 */
function ensureFarmSheetWidth(sheet) {
  if (!sheet) return;
  var needed = FARM_DOC_START_COL + FARM_DOC_NUM_COLS - 1;
  var current = sheet.getMaxColumns();
  if (current < needed) {
    sheet.insertColumnsAfter(current, needed - current);
  }
}

function writeFarmSheet(sheet, records, docRecords) {
  if (!sheet) return;
  var farmName = sheet.getName();
  docRecords = docRecords || [];

  ensureFarmSheetWidth(sheet);
  sheet.getCharts().forEach(function(c) { sheet.removeChart(c); });
  sheet.clearConditionalFormatRules();

  // Row 1 — QC title (left) + Documents title (right)
  sheet.getRange(1, 1, 1, NUM_COLS).merge()
    .setValue('CANA QC TRACKER  ·  ' + farmName)
    .setBackground(THEME.greenDark).setFontColor(THEME.white)
    .setFontSize(15).setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  sheet.getRange(1, FARM_DOC_START_COL, 1, FARM_DOC_NUM_COLS).merge()
    .setValue('DOCUMENT LIBRARY  ·  ' + farmName)
    .setBackground('#1e3a8a').setFontColor(THEME.white)
    .setFontSize(13).setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  sheet.setRowHeight(1, 46);

  // Row 2 — Section bands (QC left, Documents right)
  styleSectionBand(sheet, 2, 1, 2, 'RECORD ID', THEME.greenBand);
  styleSectionBand(sheet, 2, 3, 11, 'SECTION 1 — GOODS RECEIVED  (Manager)', THEME.blueHeader);
  styleSectionBand(sheet, 2, 14, 11, 'SECTION 2 — QC RESULTS  (QC Staff)', THEME.purpleHeader);
  styleSectionBand(sheet, 2, 25, 5, 'AUTO CALCULATED', THEME.greyHeader);
  styleSectionBand(sheet, 2, FARM_DOC_START_COL, FARM_DOC_NUM_COLS, 'DOCUMENTS — synced from web app · paste Google Drive links', '#2563eb');
  sheet.getRange(2, DOC_SPACER_COL, 2, 1).setBackground('#e2e8f0');
  sheet.setRowHeight(2, 30);

  // Row 3 — Column headers
  sheet.getRange(HEADER_ROW, 1, 1, NUM_COLS).setValues([HEADERS])
    .setFontWeight('bold').setFontSize(9).setWrap(true)
    .setVerticalAlignment('middle').setHorizontalAlignment('center');
  sheet.getRange(HEADER_ROW, 1, 1, 2).setBackground(THEME.greenLight).setFontColor(THEME.greenDark);
  sheet.getRange(HEADER_ROW, 3, 1, 11).setBackground(THEME.blueBg).setFontColor('#1e40af');
  sheet.getRange(HEADER_ROW, 14, 1, 11).setBackground(THEME.purpleBg).setFontColor('#5b21b6');
  sheet.getRange(HEADER_ROW, 25, 1, 5).setBackground(THEME.greyBg).setFontColor(THEME.greyHeader);
  sheet.setRowHeight(HEADER_ROW, 42);

  if (records.length) {
    var rows = records.map(function(rec) { return recordToRow(rec); });
    sheet.getRange(DATA_START_ROW, 1, rows.length, NUM_COLS).setValues(rows);
  }

  writeFarmDocumentsSection(sheet, docRecords);
  formatFarmSheet(sheet);
  formatFarmDocumentsSection(sheet, docRecords.length);
}

function styleSectionBand(sheet, row, col, numCols, label, bg) {
  sheet.getRange(row, col, 1, numCols).merge()
    .setValue(label)
    .setBackground(bg).setFontColor(THEME.white)
    .setFontWeight('bold').setFontSize(10)
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
}

function formatFarmSheet(sheet) {
  if (!sheet) return;
  sheet.setTabColor(THEME.greenMid);
  sheet.setFrozenRows(HEADER_ROW);
  // Cannot freeze columns — row 1 is merged across all columns

  var widths = [72, 108, 92, 118, 68, 68, 82, 128, 98, 98, 88, 88, 132, 92, 92, 82, 68, 68, 68, 68, 62, 62, 62, 118, 88, 82, 82, 62, 72, 78];
  for (var c = 0; c < widths.length && c < NUM_COLS; c++) {
    sheet.setColumnWidth(c + 1, widths[c]);
  }

  var lastRow = Math.max(sheet.getLastRow(), DATA_START_ROW + 20);
  var dataRows = lastRow - DATA_START_ROW + 1;

  // Data area tints
  if (dataRows > 0) {
    sheet.getRange(DATA_START_ROW, 3, dataRows, 11).setBackground(THEME.bluePale);
    sheet.getRange(DATA_START_ROW, 14, dataRows, 11).setBackground(THEME.purplePale);
    sheet.getRange(DATA_START_ROW, 25, dataRows, 5).setBackground(THEME.greyPale);
    sheet.getRange(DATA_START_ROW, 1, dataRows, 2).setBackground(THEME.greenPale);
  }

  // Borders around header block
  sheet.getRange(1, 1, HEADER_ROW, NUM_COLS)
    .setBorder(true, true, true, true, true, true, THEME.greenDark, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);

  // Number formats — weight columns
  [6, 7, 16, 17, 18, 19, 20, 21, 22, 23, 25, 26, 27].forEach(function(col) {
    if (lastRow >= DATA_START_ROW) {
      sheet.getRange(DATA_START_ROW, col, dataRows, 1).setNumberFormat('#,##0.00');
    }
  });
  if (lastRow >= DATA_START_ROW) {
    sheet.getRange(DATA_START_ROW, 28, dataRows, 1).setNumberFormat('0.0"%"');
  }

  // Hide internal _id columns
  sheet.hideColumns(1);
  sheet.hideColumns(FARM_DOC_START_COL);

  sheet.setColumnWidth(DOC_SPACER_COL, 14);
  var docWidths = [72, 150, 110, 130, 200, 160, 88, 92, 52, 90, 72];
  docWidths.forEach(function(w, i) { sheet.setColumnWidth(FARM_DOC_START_COL + i, w); });

  // Conditional formatting — Pass/Fail
  if (lastRow >= DATA_START_ROW) {
    var pfRange = sheet.getRange(DATA_START_ROW, PASS_FAIL_COL, dataRows, 1);
    var rules = [
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextStartsWith('Pass').setBackground(THEME.passBg).setFontColor(THEME.pass).setRanges([pfRange]).build(),
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextStartsWith('Fail').setBackground(THEME.failBg).setFontColor(THEME.fail).setRanges([pfRange]).build(),
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextStartsWith('Conditional').setBackground(THEME.condBg).setFontColor(THEME.cond).setRanges([pfRange]).build()
    ];
    sheet.setConditionalFormatRules(rules);

    // Alternating row stripe on strain column for readability
    var stripeRange = sheet.getRange(DATA_START_ROW, 1, dataRows, NUM_COLS);
    rules = sheet.getConditionalFormatRules();
    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=AND(MOD(ROW(),2)=0,ROW()>=' + DATA_START_ROW + ')')
        .setBackground('#ffffff').setRanges([stripeRange]).build()
    );
    sheet.setConditionalFormatRules(rules);
  }
}

/* ---------- Read / Write data ---------- */

function readAllFarms() {
  var ss = getSpreadsheet();
  var farmList = getFarmList(ss);
  var farms = {};
  farmList.forEach(function(farm) {
    farms[farm] = readFarmSheet(ss.getSheetByName(farm));
  });
  return {
    ok: true,
    farms: farms,
    documents: readDocuments(ss, farmList),
    trimming: readTrimming(ss),
    farmList: farmList,
    farmCodes: readFarmCodesFromMeta(ss),
    farmDriveFolders: readFarmDriveFoldersFromMeta(ss),
    driveParentFolderId: readDriveParentFolderFromMeta(ss),
    readAt: new Date().toISOString()
  };
}

function readFarmSheet(sheet) {
  if (!sheet) return [];
  var headerRow = findHeaderRowIndex(sheet);
  var lastRow = sheet.getLastRow();
  if (lastRow <= headerRow) return [];
  var firstHeader = String(sheet.getRange(headerRow, 1).getValue() || '');
  var hasIdCol = firstHeader === '_id';
  var numRows = lastRow - headerRow;
  var numCols = Math.max(sheet.getLastColumn(), NUM_COLS);
  var values = sheet.getRange(headerRow + 1, 1, numRows, numCols).getValues();
  var records = [];
  values.forEach(function(row) {
    if (isEmptyDataRow(row, hasIdCol)) return;
    var rec = { id: hasIdCol ? (String(row[0] || '') || newId()) : newId() };
    DATA_KEYS.forEach(function(key, i) {
      var col = hasIdCol ? i + 1 : i;
      var v = row[col];
      if (v instanceof Date) {
        rec[key] = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      } else {
        rec[key] = v === '' || v === null || v === undefined ? '' : String(v);
      }
    });
    if (!rec.id) rec.id = newId();
    records.push(rec);
  });
  return records;
}

function isEmptyDataRow(row, hasIdCol) {
  var start = hasIdCol ? 1 : 0;
  for (var i = start; i < start + DATA_KEYS.length; i++) {
    if (row[i] !== '' && row[i] !== null && row[i] !== undefined) return false;
  }
  return true;
}

function writeAllFarms(state) {
  var ss = getSpreadsheet();
  var farmList = (state.farmList && state.farmList.length) ? state.farmList : getFarmList(ss);
  if (state.farmList && state.farmList.length) {
    writeFarmConfig(ss, state.farmList, state.farmCodes || {});
  }
  if (state.farmDriveFolders && typeof state.farmDriveFolders === 'object') {
    writeFarmDriveFolders(ss, state.farmDriveFolders);
  }
  if (state.driveParentFolderId) {
    writeDriveParentFolder(ss, state.driveParentFolderId);
  }
  farmList.forEach(function(farm) {
    var records = (state.farms && state.farms[farm]) ? state.farms[farm] : [];
    var docs = (state.documents && state.documents[farm]) ? state.documents[farm] : [];
    var sheet = ss.getSheetByName(farm) || ss.insertSheet(farm);
    writeFarmSheet(sheet, records, docs);
  });
  ss.getSheets().map(function(sh) { return sh.getName(); }).forEach(function(name) {
    if (['README', 'Dashboard', 'Documents', 'Trimming', '_Meta'].indexOf(name) >= 0) return;
    deleteOrphanFarmSheet(ss, name, farmList);
  });
  if (state.documents) writeDocuments(ss, state.documents, farmList);
  if (state.trimming) writeTrimming(ss, state.trimming);
  updateMeta(ss);
  updateDashboard(ss);
  orderTabs(ss);
}

/* ---------- Per-farm document table (right of QC table) ---------- */

function writeFarmDocumentsSection(sheet, docRecords) {
  sheet.getRange(HEADER_ROW, FARM_DOC_START_COL, 1, FARM_DOC_NUM_COLS).setValues([FARM_DOC_HEADERS])
    .setFontWeight('bold').setFontSize(9).setWrap(true)
    .setVerticalAlignment('middle').setHorizontalAlignment('center');
  sheet.getRange(HEADER_ROW, FARM_DOC_START_COL, 1, 1).setBackground(THEME.greenLight).setFontColor(THEME.greenDark);
  sheet.getRange(HEADER_ROW, FARM_DOC_START_COL + 1, 1, 4).setBackground(THEME.blueBg).setFontColor('#1e40af');
  sheet.getRange(HEADER_ROW, FARM_DOC_START_COL + 5, 1, 3).setBackground(THEME.purpleBg).setFontColor('#5b21b6');
  sheet.getRange(HEADER_ROW, FARM_DOC_START_COL + 8, 1, 3).setBackground(THEME.greyBg).setFontColor(THEME.greyHeader);

  var clearRows = Math.max(sheet.getLastRow() - HEADER_ROW, 50);
  sheet.getRange(DATA_START_ROW, FARM_DOC_START_COL, clearRows, FARM_DOC_NUM_COLS).clearContent();

  if (!docRecords.length) return;
  var rows = docRecords.map(function(doc) {
    return [
      doc.id || newId(),
      doc.title || '',
      doc.category || '',
      doc.fileName || '',
      doc.url || '',
      doc.notes || '',
      doc.uploadedBy || '',
      doc.uploadedAt || '',
      doc.size || 0,
      doc.mimeType || '',
      doc.hasLocalFile ? 'Yes' : ''
    ];
  });
  sheet.getRange(DATA_START_ROW, FARM_DOC_START_COL, rows.length, FARM_DOC_NUM_COLS).setValues(rows);
}

function formatFarmDocumentsSection(sheet, numRows) {
  if (!sheet || numRows < 1) return;
  for (var r = 0; r < numRows; r++) {
    var rowNum = DATA_START_ROW + r;
    var bg = r % 2 === 0 ? '#f0f9ff' : THEME.white;
    sheet.getRange(rowNum, FARM_DOC_START_COL, 1, FARM_DOC_NUM_COLS).setBackground(bg).setFontSize(10).setWrap(true);
    var urlCol = FARM_DOC_START_COL + 4;
    var url = String(sheet.getRange(rowNum, urlCol).getValue() || '');
    if (url.indexOf('http') === 0) {
      sheet.getRange(rowNum, urlCol).setFormula('=HYPERLINK("' + url.replace(/"/g, '""') + '","Open link ↗")')
        .setFontColor('#1d4ed8').setFontWeight('bold');
    }
    var localCol = FARM_DOC_START_COL + FARM_DOC_NUM_COLS - 1;
    var local = String(sheet.getRange(rowNum, localCol).getValue() || '').toLowerCase();
    if (local === 'yes') {
      sheet.getRange(rowNum, localCol).setBackground(THEME.condBg).setFontColor(THEME.cond).setFontWeight('bold');
    } else {
      sheet.getRange(rowNum, localCol).setBackground(THEME.passBg).setFontColor(THEME.pass);
    }
  }
  sheet.getRange(DATA_START_ROW, FARM_DOC_START_COL + 8, numRows, 1).setNumberFormat('#,##0');
}

function hasFarmDocSection(sheet) {
  if (!sheet) return false;
  return String(sheet.getRange(HEADER_ROW, FARM_DOC_START_COL + 1).getValue() || '') === 'Title';
}

function getCellUrl(range) {
  if (!range) return '';
  try {
    var rt = range.getRichTextValue();
    if (rt) {
      var runs = rt.getRuns();
      for (var i = 0; i < runs.length; i++) {
        var link = runs[i].getLinkUrl();
        if (link && String(link).indexOf('http') === 0) return String(link);
      }
    }
  } catch (e) {}
  var formula = String(range.getFormula() || '');
  if (formula.indexOf('HYPERLINK') >= 0) {
    var m = formula.match(/HYPERLINK\s*\(\s*"([^"]+)"/i);
    if (m) return m[1];
  }
  var val = String(range.getDisplayValue() || range.getValue() || '');
  if (val.indexOf('http') === 0) return val;
  return '';
}

function parseDocRow(row, urlOverride) {
  if (!row[0] && !row[1]) return null;
  var urlVal = urlOverride != null ? String(urlOverride) : String(row[4] || '');
  if (urlVal.indexOf('HYPERLINK') >= 0) {
    var m = urlVal.match(/HYPERLINK\s*\(\s*"([^"]+)"/i);
    if (m) urlVal = m[1];
  }
  if (/^open link/i.test(urlVal)) urlVal = '';
  return {
    id: String(row[0] || newId()),
    title: String(row[1] || ''),
    category: String(row[2] || ''),
    fileName: String(row[3] || ''),
    url: urlVal,
    notes: String(row[5] || ''),
    uploadedBy: String(row[6] || ''),
    uploadedAt: row[7] instanceof Date
      ? Utilities.formatDate(row[7], Session.getScriptTimeZone(), 'yyyy-MM-dd')
      : String(row[7] || ''),
    size: row[8] === '' || row[8] === null ? 0 : Number(row[8]) || 0,
    mimeType: String(row[9] || ''),
    hasLocalFile: String(row[10] || '').toLowerCase() === 'yes'
  };
}

function readFarmDocuments(sheet) {
  if (!sheet || !hasFarmDocSection(sheet)) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow <= HEADER_ROW) return [];
  var numRows = lastRow - HEADER_ROW;
  var values = sheet.getRange(DATA_START_ROW, FARM_DOC_START_COL, numRows, FARM_DOC_NUM_COLS).getValues();
  var docs = [];
  for (var i = 0; i < numRows; i++) {
    var row = values[i];
    var rowNum = DATA_START_ROW + i;
    var urlCell = sheet.getRange(rowNum, FARM_DOC_START_COL + 4);
    var doc = parseDocRow(row, getCellUrl(urlCell));
    if (doc) docs.push(doc);
  }
  return docs;
}

var DOC_HEADERS = ['_id', 'Farm', 'Title', 'Category', 'File Name', 'External URL', 'Notes', 'Uploaded By', 'Uploaded At', 'Size', 'MIME Type', 'Has local file'];
var DOC_NUM_COLS = DOC_HEADERS.length;
var DOC_HEADER_ROW = 3;
var DOC_DATA_START = 4;

function setupDocumentsTab(ss) {
  var sheet = ss.getSheetByName('Documents');
  if (!sheet) sheet = ss.insertSheet('Documents');
  sheet.clear();
  sheet.clearConditionalFormatRules();

  sheet.getRange(1, 1, 1, DOC_NUM_COLS).merge()
    .setValue('CANA QC TRACKER  ·  DOCUMENT LIBRARY')
    .setBackground(THEME.greenDark).setFontColor(THEME.white)
    .setFontSize(15).setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  sheet.setRowHeight(1, 46);

  sheet.getRange(2, 1, 1, DOC_NUM_COLS).merge()
    .setValue('Synced from web app · Links & metadata for all farms · Upload files to Google Drive and paste URL here')
    .setBackground(THEME.blueHeader).setFontColor(THEME.white)
    .setFontSize(10).setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  sheet.setRowHeight(2, 28);

  sheet.getRange(DOC_HEADER_ROW, 1, 1, DOC_NUM_COLS).setValues([DOC_HEADERS])
    .setFontWeight('bold').setFontSize(9).setWrap(true)
    .setVerticalAlignment('middle').setHorizontalAlignment('center');
  sheet.getRange(DOC_HEADER_ROW, 1, 1, 2).setBackground(THEME.greenLight).setFontColor(THEME.greenDark);
  sheet.getRange(DOC_HEADER_ROW, 3, 1, 4).setBackground(THEME.blueBg).setFontColor('#1e40af');
  sheet.getRange(DOC_HEADER_ROW, 5, 1, 3).setBackground(THEME.purpleBg).setFontColor('#5b21b6');
  sheet.getRange(DOC_HEADER_ROW, 8, 1, 5).setBackground(THEME.greyBg).setFontColor(THEME.greyHeader);
  sheet.setRowHeight(DOC_HEADER_ROW, 36);

  sheet.setTabColor('#2563eb');
  sheet.setFrozenRows(DOC_HEADER_ROW);
  sheet.hideColumns(1);

  var widths = [72, 92, 168, 118, 140, 220, 180, 92, 92, 56, 96, 72];
  widths.forEach(function(w, i) { sheet.setColumnWidth(i + 1, w); });
}

function formatDocumentsSheet(sheet, numRows) {
  if (!sheet || numRows < 1) return;
  var dataRange = sheet.getRange(DOC_DATA_START, 1, numRows, DOC_NUM_COLS);
  dataRange.setFontSize(10).setVerticalAlignment('middle').setWrap(true);
  for (var r = 0; r < numRows; r++) {
    var rowNum = DOC_DATA_START + r;
    var bg = r % 2 === 0 ? THEME.white : THEME.bluePale;
    sheet.getRange(rowNum, 1, 1, DOC_NUM_COLS).setBackground(bg);
    var url = String(sheet.getRange(rowNum, 6).getValue() || '');
    if (url.indexOf('http') === 0) {
      sheet.getRange(rowNum, 6).setFormula('=HYPERLINK("' + url.replace(/"/g, '""') + '","Open link ↗")')
        .setFontColor('#1d4ed8').setFontWeight('bold');
    }
    var farm = String(sheet.getRange(rowNum, 2).getValue() || '');
    if (farm) {
      sheet.getRange(rowNum, 2).setFontWeight('bold').setFontColor(THEME.greenDark);
    }
    var local = String(sheet.getRange(rowNum, 12).getValue() || '').toLowerCase();
    if (local === 'yes') {
      sheet.getRange(rowNum, 12).setBackground(THEME.condBg).setFontColor(THEME.cond).setFontWeight('bold');
    } else {
      sheet.getRange(rowNum, 12).setBackground(THEME.passBg).setFontColor(THEME.pass);
    }
  }
  sheet.getRange(DOC_DATA_START, 10, numRows, 1).setNumberFormat('#,##0');
}

/** Run once — adds document tables beside QC on every farm tab */
function upgradeFarmDocumentTables() {
  var ss = getSpreadsheet();
  var farmList = getFarmList(ss);
  var docs = readDocuments(ss, farmList);
  farmList.forEach(function(farm) {
    var sheet = ss.getSheetByName(farm);
    if (!sheet) return;
    var records = readFarmSheet(sheet);
    writeFarmSheet(sheet, records, docs[farm] || []);
    Logger.log(farm + ': document table added (' + (docs[farm] || []).length + ' doc(s))');
  });
  writeDocuments(ss, docs, farmList);
  orderTabs(ss);
  SpreadsheetApp.flush();
  Logger.log('Farm document tables ready.');
}

/** Run once in Apps Script to create the professional Documents tab */
function upgradeDocumentsTab() {
  upgradeFarmDocumentTables();
}

function countDocuments(documents, farmList) {
  var n = 0;
  farmList = farmList || DEFAULT_FARMS;
  farmList.forEach(function(f) { n += (documents[f] || []).length; });
  return n;
}

function readDocuments(ss, farmList) {
  farmList = farmList || getFarmList(ss);
  var documents = {};
  var fromFarmTabs = false;
  farmList.forEach(function(f) { documents[f] = []; });
  farmList.forEach(function(farm) {
    var sheet = ss.getSheetByName(farm);
    if (hasFarmDocSection(sheet)) {
      documents[farm] = readFarmDocuments(sheet);
      fromFarmTabs = true;
    }
  });
  if (fromFarmTabs) return documents;

  // Fallback — read from consolidated Documents tab
  var sheet = ss.getSheetByName('Documents');
  if (!sheet || sheet.getLastRow() < DOC_DATA_START) return documents;
  var numRows = sheet.getLastRow() - DOC_HEADER_ROW;
  var values = sheet.getRange(DOC_DATA_START, 1, numRows, DOC_NUM_COLS).getValues();
  for (var i = 0; i < numRows; i++) {
    var row = values[i];
    if (!row[0] && !row[2]) continue;
    var farm = String(row[1] || '');
    if (farmList.indexOf(farm) === -1) continue;
    var rowNum = DOC_DATA_START + i;
    var urlVal = getCellUrl(sheet.getRange(rowNum, 6));
    documents[farm].push({
      id: String(row[0] || newId()),
      title: String(row[2] || ''),
      category: String(row[3] || ''),
      fileName: String(row[4] || ''),
      url: urlVal,
      notes: String(row[6] || ''),
      uploadedBy: String(row[7] || ''),
      uploadedAt: row[8] instanceof Date
        ? Utilities.formatDate(row[8], Session.getScriptTimeZone(), 'yyyy-MM-dd')
        : String(row[8] || ''),
      size: row[9] === '' || row[9] === null ? 0 : Number(row[9]) || 0,
      mimeType: String(row[10] || ''),
      hasLocalFile: String(row[11] || '').toLowerCase() === 'yes'
    });
  }
  return documents;
}

function writeDocuments(ss, documents, farmList) {
  farmList = farmList || getFarmList(ss);
  setupDocumentsTab(ss);
  var sheet = ss.getSheetByName('Documents');
  var rows = [];
  farmList.forEach(function(farm) {
    var list = (documents && documents[farm]) ? documents[farm] : [];
    list.forEach(function(doc) {
      rows.push([
        doc.id || newId(),
        farm,
        doc.title || '',
        doc.category || '',
        doc.fileName || '',
        doc.url || '',
        doc.notes || '',
        doc.uploadedBy || '',
        doc.uploadedAt || '',
        doc.size || 0,
        doc.mimeType || '',
        doc.hasLocalFile ? 'Yes' : ''
      ]);
    });
  });
  if (sheet.getLastRow() >= DOC_DATA_START) {
    sheet.getRange(DOC_DATA_START, 1, sheet.getLastRow() - DOC_HEADER_ROW, DOC_NUM_COLS).clearContent();
  }
  if (rows.length) {
    sheet.getRange(DOC_DATA_START, 1, rows.length, DOC_NUM_COLS).setValues(rows);
    formatDocumentsSheet(sheet, rows.length);
  }
}

/* ---------- Trimming tab ---------- */

var TRIM_HEADERS = ['_id', 'Type', 'Date', 'Source Farm', 'Batch ID', 'Strain', 'Input Wt (g)', 'Out Bigs (g)', 'Out Pops (g)', 'Mold (g)', 'Seeds (g)', 'Stems (g)', 'Waste (g)', 'Total Flower (g)', 'Total Out (g)', 'Diff (g)', 'Yield %', 'Trimmed By', 'Status', 'Notes', 'Linked QC ID'];
var TRIM_NUM_COLS = TRIM_HEADERS.length;
var TRIM_HEADER_ROW = 3;
var TRIM_DATA_START = 4;

function computeTrimRow(rec) {
  function num(v) {
    if (v === '' || v === null || v === undefined) return null;
    var n = Number(v);
    return isNaN(n) ? null : n;
  }
  var inputWt = num(rec.inputWt);
  var bigs = num(rec.outputBigsG);
  var pops = num(rec.outputPopsG);
  var mold = num(rec.moldG) || 0;
  var seeds = num(rec.seedsG) || 0;
  var stems = num(rec.stemsG) || 0;
  var waste = num(rec.wasteG) || 0;
  var totalFlower = null;
  var totalOut = null;
  var diff = null;
  var yieldPct = null;
  if (bigs !== null) totalFlower = bigs + (pops || 0);
  if (bigs !== null || pops !== null || mold || seeds || stems || waste) {
    totalOut = (bigs || 0) + (pops || 0) + mold + seeds + stems + waste;
  }
  if (inputWt !== null && totalOut !== null) diff = inputWt - totalOut;
  if (inputWt && totalFlower !== null) yieldPct = Math.round(totalFlower / inputWt * 10000) / 100;
  return { totalFlower: totalFlower, totalOut: totalOut, diff: diff, yieldPct: yieldPct };
}

function setupTrimmingTab(ss) {
  var sheet = ss.getSheetByName('Trimming');
  if (!sheet) sheet = ss.insertSheet('Trimming');
  sheet.clear();
  sheet.getRange(1, 1, 1, TRIM_NUM_COLS).merge()
    .setValue('CANA QC TRACKER  ·  TRIMMING RECORDS')
    .setBackground(THEME.greenDark).setFontColor(THEME.white)
    .setFontSize(15).setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  sheet.setRowHeight(1, 46);
  sheet.getRange(2, 1, 1, TRIM_NUM_COLS).merge()
    .setValue('Rework flower (clean incoming) · Cana flower (in-house grow) · Synced from web app')
    .setBackground('#7c3aed').setFontColor(THEME.white)
    .setFontSize(10).setFontWeight('bold')
    .setHorizontalAlignment('center');
  sheet.setRowHeight(2, 28);
  sheet.getRange(TRIM_HEADER_ROW, 1, 1, TRIM_NUM_COLS).setValues([TRIM_HEADERS])
    .setFontWeight('bold').setFontSize(9).setWrap(true)
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  sheet.getRange(TRIM_HEADER_ROW, 1, 1, 6).setBackground(THEME.blueBg).setFontColor('#1e40af');
  sheet.getRange(TRIM_HEADER_ROW, 7, 1, 7).setBackground(THEME.purpleBg).setFontColor('#5b21b6');
  sheet.getRange(TRIM_HEADER_ROW, 14, 1, 4).setBackground(THEME.greyBg).setFontColor(THEME.greyHeader);
  sheet.getRange(TRIM_HEADER_ROW, 18, 1, 4).setBackground(THEME.greenLight).setFontColor(THEME.greenDark);
  sheet.setRowHeight(TRIM_HEADER_ROW, 36);
  sheet.setTabColor('#7c3aed');
  sheet.setFrozenRows(TRIM_HEADER_ROW);
  sheet.hideColumns(1);
  sheet.hideColumns(TRIM_NUM_COLS);
}

function formatTrimmingSheet(sheet, numRows) {
  if (!sheet || numRows < 1) return;
  for (var r = 0; r < numRows; r++) {
    var rowNum = TRIM_DATA_START + r;
    var bg = r % 2 === 0 ? THEME.white : THEME.purplePale;
    sheet.getRange(rowNum, 1, 1, TRIM_NUM_COLS).setBackground(bg).setFontSize(10).setWrap(true);
    var type = String(sheet.getRange(rowNum, 2).getValue() || '');
    if (type.indexOf('Rework') >= 0) {
      sheet.getRange(rowNum, 2).setBackground('#fef3c7').setFontColor('#b45309').setFontWeight('bold');
    } else if (type.indexOf('Cana') >= 0) {
      sheet.getRange(rowNum, 2).setBackground(THEME.passBg).setFontColor(THEME.pass).setFontWeight('bold');
    }
  }
  sheet.getRange(TRIM_DATA_START, 7, numRows, 11).setNumberFormat('#,##0.##');
  sheet.getRange(TRIM_DATA_START, 17, numRows, 1).setNumberFormat('0.00"%"');
}

function readTrimming(ss) {
  var sheet = ss.getSheetByName('Trimming');
  if (!sheet || sheet.getLastRow() < TRIM_DATA_START) return [];
  var numRows = sheet.getLastRow() - TRIM_HEADER_ROW;
  if (numRows < 1) return [];
  var values = sheet.getRange(TRIM_DATA_START, 1, numRows, TRIM_NUM_COLS).getValues();
  var list = [];
  values.forEach(function(row) {
    if (!row[1] && !row[3] && !row[6]) return;
    list.push({
      id: String(row[0] || '') || newId(),
      type: String(row[1] || ''),
      date: formatSheetDate(row[2]),
      sourceFarm: String(row[3] || ''),
      batchId: String(row[4] || ''),
      strain: String(row[5] || ''),
      inputWt: cellStr(row[6]),
      outputBigsG: cellStr(row[7]),
      outputPopsG: cellStr(row[8]),
      moldG: cellStr(row[9]),
      seedsG: cellStr(row[10]),
      stemsG: cellStr(row[11]),
      wasteG: cellStr(row[12]),
      trimmedBy: String(row[17] || ''),
      status: String(row[18] || ''),
      notes: String(row[19] || ''),
      linkedRecordId: String(row[20] || '')
    });
  });
  return list;
}

function cellStr(v) {
  if (v === '' || v === null || v === undefined) return '';
  return String(v);
}

function formatSheetDate(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(v || '');
}

function writeTrimming(ss, trimming) {
  setupTrimmingTab(ss);
  var sheet = ss.getSheetByName('Trimming');
  var rows = [];
  (trimming || []).forEach(function(rec) {
    var c = computeTrimRow(rec);
    rows.push([
      rec.id || newId(),
      rec.type || '',
      rec.date || '',
      rec.sourceFarm || '',
      rec.batchId || '',
      rec.strain || '',
      rec.inputWt || '',
      rec.outputBigsG || '',
      rec.outputPopsG || '',
      rec.moldG || '',
      rec.seedsG || '',
      rec.stemsG || '',
      rec.wasteG || '',
      c.totalFlower === null ? '' : c.totalFlower,
      c.totalOut === null ? '' : c.totalOut,
      c.diff === null ? '' : c.diff,
      c.yieldPct === null ? '' : c.yieldPct,
      rec.trimmedBy || '',
      rec.status || '',
      rec.notes || '',
      rec.linkedRecordId || ''
    ]);
  });
  if (sheet.getLastRow() >= TRIM_DATA_START) {
    sheet.getRange(TRIM_DATA_START, 1, sheet.getLastRow() - TRIM_HEADER_ROW, TRIM_NUM_COLS).clearContent();
  }
  if (rows.length) {
    sheet.getRange(TRIM_DATA_START, 1, rows.length, TRIM_NUM_COLS).setValues(rows);
    formatTrimmingSheet(sheet, rows.length);
  }
}

/** Run once — creates Trimming tab in Google Sheet */
function upgradeTrimmingTab() {
  var ss = getSpreadsheet();
  writeTrimming(ss, readTrimming(ss));
  orderTabs(ss);
  SpreadsheetApp.flush();
  Logger.log('Trimming tab ready.');
}

function recordToRow(rec) {
  var c = computeRow(rec);
  var row = [rec.id || newId()];
  DATA_KEYS.forEach(function(key) { row.push(rec[key] || ''); });
  row.push(c.totalFlower === null ? '' : c.totalFlower);
  row.push(c.totalOut === null ? '' : c.totalOut);
  row.push(c.diff === null ? '' : c.diff);
  row.push(c.yieldPct === null ? '' : c.yieldPct);
  row.push(c.month || '');
  return row;
}

function computeRow(rec) {
  function num(v) {
    if (v === '' || v === null || v === undefined) return null;
    var n = Number(v);
    return isNaN(n) ? null : n;
  }
  var bigsG = num(rec.bigsG), popsG = num(rec.popsG), scrapsG = num(rec.scrapsG),
      seedsG = num(rec.seedsG), moldG = num(rec.moldG), wasteG = num(rec.wasteG),
      startWt = num(rec.startWt);
  var totalFlower = null, totalOut = null, diff = null, yieldPct = null, month = '';
  if (bigsG !== null) {
    totalFlower = bigsG + (popsG || 0);
    totalOut = bigsG + (popsG || 0) + (scrapsG || 0) + (seedsG || 0) + (moldG || 0) + (wasteG || 0);
  }
  if (startWt !== null && totalOut !== null) diff = startWt - totalOut;
  if (startWt !== null && startWt !== 0 && totalFlower !== null) yieldPct = Math.round(totalFlower / startWt * 10000) / 100;
  if (rec.date) {
    var d = new Date(rec.date);
    if (!isNaN(d.getTime())) {
      var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      month = months[d.getMonth()] + ' ' + d.getFullYear();
    }
  }
  return { totalFlower: totalFlower, totalOut: totalOut, diff: diff, yieldPct: yieldPct, month: month };
}

function updateMeta(ss) {
  var meta = ss.getSheetByName('_Meta');
  if (!meta) return;
  meta.getRange('A2').setValue('Last updated');
  meta.getRange('B2').setValue(new Date().toISOString());
}

/* ---------- Dashboard (KPIs + charts) ---------- */

function collectDashboardStats(ss) {
  var rows = [];
  var totals = { batches: 0, start: 0, flower: 0, pass: 0, fail: 0, cond: 0, pending: 0 };
  getFarmList(ss).forEach(function(farm) {
    var recs = readFarmSheet(ss.getSheetByName(farm));
    var totalStart = 0, totalFlower = 0, pass = 0, fail = 0, cond = 0, pending = 0;
    recs.forEach(function(r) {
      var sw = Number(r.startWt); if (!isNaN(sw)) totalStart += sw;
      var bg = Number(r.bigsG), pg = Number(r.popsG);
      if (!isNaN(bg)) totalFlower += bg;
      if (!isNaN(pg)) totalFlower += pg;
      var pf = r.passFail || '';
      var hasDelivery = r.date || r.strain || r.grossWt;
      var hasQC = r.qcBy || r.passFail || r.bigsG || r.startWt;
      if (hasDelivery && !hasQC) pending++;
      if (pf.indexOf('Pass') === 0) pass++;
      else if (pf.indexOf('Fail') === 0) fail++;
      else if (pf.indexOf('Conditional') === 0) cond++;
    });
    var avgYield = totalStart ? Math.round(totalFlower / totalStart * 10000) / 100 : '';
    rows.push({ farm: farm, batches: recs.length, start: totalStart, flower: totalFlower, yield: avgYield, pass: pass, fail: fail, cond: cond, pending: pending });
    totals.batches += recs.length;
    totals.start += totalStart;
    totals.flower += totalFlower;
    totals.pass += pass;
    totals.fail += fail;
    totals.cond += cond;
    totals.pending += pending;
  });
  totals.yield = totals.start ? Math.round(totals.flower / totals.start * 10000) / 100 : '';
  return { rows: rows, totals: totals };
}

function updateDashboard(ss) {
  var sheet = ss.getSheetByName('Dashboard');
  if (!sheet) return;

  sheet.getCharts().forEach(function(c) { sheet.removeChart(c); });
  sheet.clear();
  sheet.setTabColor(THEME.blueHeader);

  var stats = collectDashboardStats(ss);

  // Banner
  sheet.getRange(1, 1, 2, 8).merge()
    .setValue('CANA QC TRACKER\nOperations Dashboard')
    .setBackground(THEME.greenDark).setFontColor(THEME.white)
    .setFontSize(20).setFontWeight('bold').setWrap(true)
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  sheet.setRowHeight(1, 36);
  sheet.setRowHeight(2, 36);

  sheet.getRange(3, 1, 1, 4).merge()
    .setValue('Live sync with web app · Updated ' + new Date().toLocaleString())
    .setFontColor(THEME.muted).setFontSize(10).setHorizontalAlignment('left');

  // KPI cards — row 5-6
  var kpiDefs = [
    { label: 'TOTAL BATCHES', value: stats.totals.batches, bg: THEME.blueBg, color: THEME.blueHeader },
    { label: 'TOTAL FLOWER (g)', value: stats.totals.flower, bg: THEME.greenLight, color: THEME.greenMid },
    { label: 'AVG YIELD %', value: stats.totals.yield === '' ? '—' : stats.totals.yield + '%', bg: '#fef3c7', color: THEME.cond },
    { label: 'PASS', value: stats.totals.pass, bg: THEME.passBg, color: THEME.pass },
    { label: 'FAIL', value: stats.totals.fail, bg: THEME.failBg, color: THEME.fail },
    { label: 'PENDING QC', value: stats.totals.pending, bg: THEME.condBg, color: THEME.cond }
  ];
  var col = 1;
  kpiDefs.forEach(function(kpi) {
    sheet.getRange(5, col, 1, 2).merge()
      .setValue(kpi.label)
      .setBackground(kpi.bg).setFontColor(kpi.color)
      .setFontWeight('bold').setFontSize(9)
      .setHorizontalAlignment('center').setVerticalAlignment('bottom');
    sheet.getRange(6, col, 1, 2).merge()
      .setValue(kpi.value)
      .setBackground(kpi.bg).setFontColor(kpi.color)
      .setFontSize(22).setFontWeight('bold')
      .setHorizontalAlignment('center').setVerticalAlignment('top');
    sheet.setColumnWidth(col, 95);
    sheet.setColumnWidth(col + 1, 95);
    col += 2;
  });
  sheet.setRowHeight(5, 22);
  sheet.setRowHeight(6, 44);

  // Data table — row 8+
  var tableStart = 8;
  var headers = ['Farm', 'Batches', 'Start (g)', 'Flower (g)', 'Yield %', 'Pass', 'Fail', 'Cond.', 'Pending'];
  sheet.getRange(tableStart, 1, 1, headers.length).setValues([headers])
    .setBackground(THEME.blueHeader).setFontColor(THEME.white)
    .setFontWeight('bold').setHorizontalAlignment('center');
  sheet.setRowHeight(tableStart, 32);

  var tableData = stats.rows.map(function(r) {
    return [r.farm, r.batches, r.start, r.flower, r.yield, r.pass, r.fail, r.cond, r.pending];
  });
  tableData.push(['TOTAL', stats.totals.batches, stats.totals.start, stats.totals.flower, stats.totals.yield, stats.totals.pass, stats.totals.fail, stats.totals.cond, stats.totals.pending]);

  if (tableData.length) {
    sheet.getRange(tableStart + 1, 1, tableData.length, headers.length).setValues(tableData);
    // Zebra stripes
    for (var i = 0; i < stats.rows.length; i++) {
      var bg = i % 2 === 0 ? THEME.white : THEME.greyPale;
      sheet.getRange(tableStart + 1 + i, 1, 1, headers.length).setBackground(bg);
    }
    var totalRow = tableStart + 1 + stats.rows.length;
    sheet.getRange(totalRow, 1, 1, headers.length)
      .setFontWeight('bold').setBackground(THEME.greenLight).setFontColor(THEME.greenDark);
    sheet.getRange(tableStart + 1, 3, tableData.length, 2).setNumberFormat('#,##0');
    sheet.getRange(tableStart + 1, 5, tableData.length, 1).setNumberFormat('0.0');
  }

  var tableEndRow = tableStart + tableData.length;

  // Charts (right side)
  if (stats.totals.batches > 0) {
    addDashboardCharts(sheet, tableStart, tableEndRow, stats);
  }

  sheet.setColumnWidth(1, 130);
}

function addDashboardCharts(sheet, tableStart, tableEndRow, stats) {
  var n = stats.rows.length;
  if (n < 1) return;

  // Chart 1 — Batches by farm (column)
  var batchChart = sheet.newChart()
    .setChartType(Charts.ChartType.COLUMN)
    .addRange(sheet.getRange(tableStart + 1, 1, n, 2))
    .setPosition(tableStart, 11, 0, 0)
    .setOption('title', 'Batches by Farm')
    .setOption('titleTextStyle', { color: THEME.greenDark, fontSize: 13, bold: true })
    .setOption('legend', { position: 'none' })
    .setOption('colors', [THEME.blueHeader])
    .setOption('backgroundColor', THEME.white)
    .setOption('height', 280)
    .setOption('width', 420)
    .setOption('vAxis', { title: 'Batches', minValue: 0 })
    .setOption('hAxis', { slantedText: true, slantedTextAngle: 30 })
    .build();
  sheet.insertChart(batchChart);

  // Chart 2 — QC outcomes (pie)
  if (stats.totals.pass + stats.totals.fail + stats.totals.cond > 0) {
    sheet.getRange(1, 20).setValue('Pass');
    sheet.getRange(1, 21).setValue(stats.totals.pass);
    sheet.getRange(2, 20).setValue('Fail');
    sheet.getRange(2, 21).setValue(stats.totals.fail);
    sheet.getRange(3, 20).setValue('Conditional');
    sheet.getRange(3, 21).setValue(stats.totals.cond);
    sheet.hideColumns(20, 2);

    var pieChart = sheet.newChart()
      .setChartType(Charts.ChartType.PIE)
      .addRange(sheet.getRange(1, 20, 3, 2))
      .setPosition(tableStart, 11, 0, 300)
      .setOption('title', 'QC Outcomes (All Farms)')
      .setOption('titleTextStyle', { color: THEME.greenDark, fontSize: 13, bold: true })
      .setOption('colors', [THEME.pass, THEME.fail, THEME.cond])
      .setOption('pieSliceText', 'percentage')
      .setOption('legend', { position: 'right' })
      .setOption('height', 280)
      .setOption('width', 420)
      .build();
    sheet.insertChart(pieChart);
  }

  // Chart 3 — Yield % by farm (bar)
  var hasYield = stats.rows.some(function(r) { return r.yield !== '' && r.yield !== null; });
  if (hasYield) {
    var yieldChart = sheet.newChart()
      .setChartType(Charts.ChartType.BAR)
      .addRange(sheet.getRange(tableStart + 1, 1, n, 5))
      .setPosition(tableStart + 16, 11, 0, 0)
      .setOption('title', 'Avg Yield % by Farm')
      .setOption('titleTextStyle', { color: THEME.greenDark, fontSize: 13, bold: true })
      .setOption('legend', { position: 'none' })
      .setOption('colors', [THEME.greenMid])
      .setOption('height', 280)
      .setOption('width', 420)
      .setOption('hAxis', { title: 'Yield %', minValue: 0 })
      .build();
    sheet.insertChart(yieldChart);
  }
}

function newId() {
  return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Run once in Apps Script if app save did not reach the Sheet — paste Cana Documents folder ID below */
function setCanaDocumentsParentOnce() {
  var parentId = '1H13opBTINjpHx3ztGYU1Hp4HNHdLiFFI'; // Cana Documents folder ID from Drive URL
  var res = applyDriveConfig({ action: 'setDriveConfig', driveParentFolderId: parentId, farmDriveFolders: {} });
  Logger.log(JSON.stringify(res));
  if (res.ok) Logger.log('Saved to _Meta B7. Run verifyDriveFolders next.');
  else throw new Error(res.error);
}

/** Run to diagnose Drive permission — check Execution log */
function testOpenCanaDocuments() {
  var id = readDriveParentFolderFromMeta(getSpreadsheet()) || '1H13opBTINjpHx3ztGYU1Hp4HNHdLiFFI';
  var who = Session.getEffectiveUser().getEmail();
  Logger.log('Trying folder ID: ' + id);
  Logger.log('Apps Script account: ' + who);
  Logger.log('Open this URL in Chrome as THAT account: https://drive.google.com/drive/folders/' + id);
  try {
    var f = DriveApp.getFolderById(id);
    Logger.log('OK — folder name: ' + f.getName());
    Logger.log('Owner email (if visible): ' + (f.getOwner() ? f.getOwner().getEmail() : '(shared folder)'));
    var subs = f.getFolders();
    var names = [];
    while (subs.hasNext() && names.length < 20) names.push(subs.next().getName());
    Logger.log('Subfolders: ' + (names.length ? names.join(', ') : '(none)'));
  } catch (e) {
    var msg = String(e);
    Logger.log('FAIL — ' + msg);
    if (/do not have permission to call DriveApp|Required permissions.*drive/i.test(msg)) {
      Logger.log('');
      Logger.log('>>> NOT a folder sharing problem. Apps Script needs Drive permission.');
      Logger.log('>>> Fix: Run authorizeDriveOnce() → click Review permissions → Allow Drive access.');
      Logger.log('>>> Then run verifyDriveFolders again.');
    } else {
      Logger.log('Fix: In Google Drive, share "Cana Documents" with ' + who + ' as Editor (or move folder into that account\'s My Drive).');
    }
  }
}

/** Run once — opens Google permission screen for Drive (required before upload works) */
function authorizeDriveOnce() {
  var who = Session.getEffectiveUser().getEmail();
  Logger.log('Account: ' + who);
  Logger.log('If prompted, click Review permissions → Allow (includes Google Drive).');
  var rootName = DriveApp.getRootFolder().getName();
  Logger.log('Drive read OK. Root: ' + rootName);
  var id = readDriveParentFolderFromMeta(getSpreadsheet());
  if (id) {
    var f = DriveApp.getFolderById(id);
    Logger.log('Cana Documents OK: ' + f.getName());
  }
  Logger.log('Next: Run authorizeDriveUploadOnce (tests createFile), then redeploy web app.');
}

/** Run once — tests file upload permission (createFile). Required before app upload works. */
function authorizeDriveUploadOnce() {
  var who = Session.getEffectiveUser().getEmail();
  Logger.log('Account: ' + who);
  Logger.log('If prompted, Review permissions → Allow (must include Google Drive edit access).');
  var farmList = getFarmList(getSpreadsheet());
  var farm = farmList.length ? farmList[0] : 'Kenny';
  var folderRes = getDriveFolderForFarm(farm);
  if (!folderRes.ok) throw new Error(folderRes.error);
  var test = folderRes.folder.createFile('cana-qc-upload-test.txt', 'safe to delete', MimeType.PLAIN_TEXT);
  Logger.log('createFile OK in ' + farm + ': ' + test.getName());
  test.setTrashed(true);
  Logger.log('Test file trashed.');
  Logger.log('');
  Logger.log('>>> IMPORTANT: Deploy → Manage deployments → Edit → New version → Deploy');
  Logger.log('>>> Without redeploy, the live app URL still uses the old permission set.');
}
