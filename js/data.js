/**
 * CANA QC Tracker — Data & configuration
 * Default farms (used until you add more via Manage Farms in the app).
 */
const DEFAULT_FARMS = ["Kenny","BB Farm","VT Farm","Extra Cannabis","ZaZa","Yang","Cana"];
/** @deprecated use getFarmList() in app.js */
const FARMS = DEFAULT_FARMS;

const DEFAULT_FARM_CODES = {
  'BB Farm':'BB','VT Farm':'VT','Extra Cannabis':'EC',
  'Kenny':'KN','ZaZa':'ZZ','Yang':'YG','Cana':'CA'
};

const EXPORT_COMPANY_TEMPLATES = {
  bls: {
    id: 'bls',
    name: 'BLS',
    label: 'BLS Monthly Report',
    labelTh: 'รายงานรายเดือน BLS',
    description: 'Monthly report for BLS — manager sets export kg per strain.',
    columns: [
      {key:'batchId', label:'Batch ID'},
      {key:'farm', label:'Farm'},
      {key:'date', label:'Delivery Date'},
      {key:'strain', label:'Strain'},
      {key:'exportKg', label:'Export (kg)', num:true, exportField:true},
      {key:'qcFlowerKg', label:'QC Flower (kg)', num:true, exportField:true},
      {key:'grossWt', label:'Gross Wt (g)', num:true},
      {key:'startWt', label:'Start Wt (g)', num:true},
      {key:'passFail', label:'Pass/Fail'},
      {key:'condition', label:'Physical Condition'},
      {key:'eurofinsTest', label:'Eurofins Test'},
      {key:'tnrTest', label:'TNR Test'},
      {key:'qcBy', label:'QC by'},
      {key:'invoice', label:'Invoice'},
      {key:'notes', label:'Notes'},
    ]
  }
};
/** @deprecated use getExportCompanies() in app.js */
const EXPORT_COMPANIES = [EXPORT_COMPANY_TEMPLATES.bls];
const LAB_TEST_OPTIONS = [
  'Pending / รอผล',
  'Pass / ผ่าน',
  'Fail / ไม่ผ่าน',
  'Conditional Pass / ผ่านแบบมีเงื่อนไข',
  'Not tested / ยังไม่ทดสอบ'
];

const BLUE_COLS = [
  {key:'date', label:'Date', labelTh:'วันที่รับสินค้า', type:'date'},
  {key:'strain', label:'Strain', labelTh:'สายพันธุ์', type:'text'},
  {key:'bigsCount', label:'Bigs (count)', labelTh:'ดอกใหญ่ (จำนวน)', type:'number'},
  {key:'popsCount', label:'Pops (count)', labelTh:'ดอกเล็ก (จำนวน)', type:'number'},
  {key:'grossWt', label:'Gross Wt (g)', labelTh:'น้ำหนักรวม (กรัม)', type:'number'},
  {key:'condition', label:'Physical Condition', labelTh:'สภาพสินค้า (ภายนอก)', type:'select', options:['Good / ดี','Minor Issues / มีปัญหาเล็กน้อย','Damaged / เสียหาย']},
  {key:'eurofinsTest', label:'Eurofins Test', labelTh:'ทดสอบ Eurofins', type:'select', options: LAB_TEST_OPTIONS},
  {key:'tnrTest', label:'TNR Test', labelTh:'ทดสอบ TNR', type:'select', options: LAB_TEST_OPTIONS},
  {key:'invoice', label:'Invoice', labelTh:'ใบเสร็จ', type:'text'},
  {key:'receivedBy', label:'Received by', labelTh:'รับโดย', type:'text'},
  {key:'notes', label:'Notes', labelTh:'หมายเหตุการรับ', type:'textarea'},
];

const PURPLE_COLS = [
  {key:'qcStart', label:'QC Start', labelTh:'เวลาเริ่ม QC', type:'date'},
  {key:'qcEnd', label:'QC End', labelTh:'เวลาสิ้นสุด QC', type:'date'},
  {key:'startWt', label:'Start Wt (g)', labelTh:'น้ำหนักก่อน QC (กรัม)', type:'number'},
  {key:'bigsG', label:'Bigs (g)', labelTh:'ดอกใหญ่ (กรัม)', type:'number'},
  {key:'popsG', label:'Pops (g)', labelTh:'ดอกเล็ก (กรัม)', type:'number'},
  {key:'scrapsG', label:'Scraps (g)', labelTh:'เศษดอก/ทริม (กรัม)', type:'number'},
  {key:'seedsG', label:'Seeds (g)', labelTh:'เมล็ด (กรัม)', type:'number'},
  {key:'moldG', label:'Mold (g)', labelTh:'เชื้อรา (กรัม)', type:'number'},
  {key:'wasteG', label:'Waste (g)', labelTh:'เศษเหลือ (กรัม)', type:'number'},
  {key:'passFail', label:'Pass/Fail', labelTh:'ผ่าน/ไม่ผ่าน', type:'select', options:['Pass / ผ่าน','Fail / ไม่ผ่าน','Conditional Pass / ผ่านแบบมีเงื่อนไข']},
  {key:'qcBy', label:'QC by', labelTh:'QC โดย', type:'text'},
];

const GREY_COLS = [
  {key:'totalFlower', label:'Total Flower (g)', labelTh:'ดอกรวม (กรัม)'},
  {key:'totalOut', label:'Total Out (g)', labelTh:'รวมออกทั้งหมด (กรัม)'},
  {key:'diff', label:'Diff (g)', labelTh:'ผลต่าง (กรัม)'},
  {key:'yieldPct', label:'Yield %', labelTh:'เปอร์เซ็นต์ผลผลิต'},
  {key:'month', label:'Month', labelTh:'(helper)'},
];

const STORAGE_KEY = 'cana_qc_tracker_v1';
const APPS_SCRIPT_URL_KEY = 'cana_qc_apps_script_url';
const SHEET_VIEW_URL_KEY = 'cana_qc_sheet_view_url';
const AUTH_SESSION_KEY = 'cana_qc_auth_session';
const AUTH_SESSION_MS = 8 * 60 * 60 * 1000; // 8 hours
const ADMIN_SESSION_KEY = 'cana_qc_admin_session'; // legacy — migrated on load
const ADMIN_SESSION_MS = AUTH_SESSION_MS;
const SHEET_POLL_MS = 6000;

function defaultState(){
  const farms = {};
  DEFAULT_FARMS.forEach(f=>farms[f]=[]);
  // seed with the existing BB Farm records from CANA QC Tracker v4.xlsx so nothing is lost
  farms['BB Farm'] = [
    {id:uid(), date:'2026-07-10', strain:'MAC 1', bigsCount:'', popsCount:'', grossWt:'50000', condition:'Minor Issues / มีปัญหาเล็กน้อย', invoice:'', receivedBy:'May,Montry', notes:'',
     qcStart:'2026-07-11', qcEnd:'2026-07-13', startWt:'50000', bigsG:'', popsG:'', scrapsG:'0.87', seedsG:'5', moldG:'0.77', wasteG:'', passFail:'Conditional Pass / ผ่านแบบมีเงื่อนไข', qcBy:'CANA team'},
    {id:uid(), date:'', strain:'', bigsCount:'', popsCount:'', grossWt:'10000', condition:'Minor Issues / มีปัญหาเล็กน้อย', invoice:'', receivedBy:'', notes:'',
     qcStart:'', qcEnd:'', startWt:'', bigsG:'', popsG:'', scrapsG:'', seedsG:'0', moldG:'50', wasteG:'', passFail:'Conditional Pass / ผ่านแบบมีเงื่อนไข', qcBy:'CANA team'},
    {id:uid(), date:'', strain:'', bigsCount:'', popsCount:'', grossWt:'8000', condition:'', invoice:'', receivedBy:'', notes:'',
     qcStart:'', qcEnd:'', startWt:'', bigsG:'', popsG:'', scrapsG:'', seedsG:'', moldG:'', wasteG:'', passFail:'', qcBy:''},
  ];
  const documents = {};
  DEFAULT_FARMS.forEach(f=>documents[f]=[]);
  return {
    farmList: DEFAULT_FARMS.slice(),
    farmCodes: {...DEFAULT_FARM_CODES},
    farmDriveFolders: {},
    driveParentFolderId: '',
    farms,
    documents,
    trimming: [],
    curingSessions: [],
    cureLog: [],
    canaStock: [],
    exportLog: [],
    exportCompanies: [{ id:'bls', name:'BLS', templateId:'bls' }]
  };
}

const DOCUMENT_CATEGORIES = ['Invoice / ใบเสร็จ','COA / Lab Report / ใบรายงานแล็บ','Photos / รูปภาพ','Contract / สัญญา','QC Report / รายงาน QC','Other / อื่นๆ'];
const MAX_DOC_BYTES = 8 * 1024 * 1024;

const TRIM_TYPES = ['Trimming record', 'Cana flower'];
const TRIM_STATUS_OPTIONS = ['In progress / กำลังทำ', 'Complete / เสร็จ'];
const TRIMMING_COLS = [
  {key:'date', label:'Date', labelTh:'วันที่', type:'date'},
  {key:'harvestDate', label:'Harvest date', labelTh:'วันที่เก็บเกี่ยว', type:'date'},
  {key:'sourceFarm', label:'Source farm', labelTh:'ฟาร์มต้นทาง', type:'text'},
  {key:'room', label:'Room', labelTh:'ห้อง', type:'text'},
  {key:'batchId', label:'Batch ID', labelTh:'Batch ID', type:'text'},
  {key:'strain', label:'Strain', labelTh:'สายพันธุ์', type:'text'},
  {key:'inputWt', label:'Input Wt (g)', labelTh:'น้ำหนักเข้า (กรัม)', type:'number'},
  {key:'finishedFlowerG', label:'Total finished flower (g)', labelTh:'ดอกสำเร็จริปรวม (กรัม)', type:'number'},
  {key:'outputBigsG', label:'Out Bigs (g)', labelTh:'ดอกใหญ่ (กรัม)', type:'number'},
  {key:'outputPopsG', label:'Out Pops (g)', labelTh:'ดอกเล็ก (กรัม)', type:'number'},
  {key:'moldG', label:'Mold removed (g)', labelTh:'รา (กรัม)', type:'number'},
  {key:'seedsG', label:'Seeds removed (g)', labelTh:'เมล็ด (กรัม)', type:'number'},
  {key:'stemsG', label:'Stems / scraps (g)', labelTh:'ก้าน/เศษ (กรัม)', type:'number'},
  {key:'wasteG', label:'Waste (g)', labelTh:'ของเสีย (กรัม)', type:'number'},
  {key:'hoursWorked', label:'Hours worked', labelTh:'ชั่วโมงทำงาน', type:'number'},
  {key:'trimmedBy', label:'Trimmed by', labelTh:'ทำโดย', type:'text'},
  {key:'status', label:'Status', labelTh:'สถานะ', type:'select', options: TRIM_STATUS_OPTIONS},
  {key:'notes', label:'Notes', labelTh:'หมายเหตุ', type:'textarea'},
];
const TRIM_SAVE_KEYS = ['date','harvestDate','sourceFarm','room','batchId','strain','inputWt','finishedFlowerG','outputBigsG','outputPopsG','moldG','seedsG','stemsG','wasteG','hoursWorked','trimmedBy','status','notes'];
const TRIMMING_GREY = [
  {key:'totalFlower', label:'Total flower out (g)', labelTh:'ดอกรวม (กรัม)'},
  {key:'totalOut', label:'Total out (g)', labelTh:'รวมออก (กรัม)'},
  {key:'diff', label:'Diff (g)', labelTh:'ผลต่าง (กรัม)'},
  {key:'yieldPct', label:'Yield %', labelTh:'Yield %'},
];

/** Cana flower only — curing after trim */
const CURE_STATUS_OPTIONS = ['In progress / กำลัง cure', 'Complete / เสร็จ', 'On hold / พัก'];
const CURE_ACTION_OPTIONS = [
  'Burp / เปิดถุง',
  'Flip / rotate / กลับถุง',
  'Weigh check / ชั่ง',
  'Repack / แพ็คใหม่',
  'Quality check / ตรวจคุณภาพ',
  'Other / อื่นๆ'
];
const STOCK_STATUS_OPTIONS = ['On hand / คงคลัง', 'In cure / กำลัง cure', 'Reserved / จอง', 'Shipped / ส่งแล้ว'];

const CURE_SESSION_COLS = [
  {key:'room', label:'Room / location', labelTh:'ห้อง', type:'text'},
  {key:'strains', label:'Strains in cure', labelTh:'สายพันธุ์ (คั่นด้วย comma)', type:'textarea'},
  {key:'linkedTrimIds', label:'Linked trim IDs', labelTh:'อ้างอิง Trim Cana (optional)', type:'text'},
  {key:'startDate', label:'Start date', labelTh:'วันเริ่ม cure', type:'date'},
  {key:'targetDays', label:'Target days', labelTh:'เป้าหมาย (วัน)', type:'number'},
  {key:'endDate', label:'End date', labelTh:'วันจบ (เมื่อเสร็จ)', type:'date'},
  {key:'assignedTo', label:'Assigned staff', labelTh:'พนักงานดูแล', type:'text'},
  {key:'status', label:'Status', labelTh:'สถานะ', type:'select', options: CURE_STATUS_OPTIONS},
  {key:'processSummary', label:'Process summary', labelTh:'สรุปกระบวนการ', type:'textarea'},
  {key:'notes', label:'Notes', labelTh:'หมายเหตุ', type:'textarea'},
];
const CURE_SESSION_KEYS = ['room','strains','linkedTrimIds','startDate','targetDays','endDate','assignedTo','status','processSummary','notes'];

const CURE_LOG_COLS = [
  {key:'sessionId', label:'Cure session', labelTh:'รอบ cure', type:'select', options:[]},
  {key:'date', label:'Date', labelTh:'วันที่', type:'date'},
  {key:'time', label:'Time', labelTh:'เวลา', type:'text'},
  {key:'room', label:'Room', labelTh:'ห้อง', type:'text'},
  {key:'action', label:'Action', labelTh:'การทำ', type:'select', options: CURE_ACTION_OPTIONS},
  {key:'hours', label:'Hours', labelTh:'ชั่วโมง', type:'number'},
  {key:'description', label:'What exactly', labelTh:'รายละเอียด', type:'textarea'},
  {key:'doneBy', label:'Done by', labelTh:'ทำโดย', type:'text'},
  {key:'strainsTouched', label:'Strains touched', labelTh:'สายพันธุ์ที่ทำ', type:'text'},
];
const CURE_LOG_KEYS = ['sessionId','date','time','room','action','hours','description','doneBy','strainsTouched'];

const CANA_STOCK_COLS = [
  {key:'strain', label:'Strain', labelTh:'สายพันธุ์', type:'text'},
  {key:'room', label:'Room / location', labelTh:'ห้อง', type:'text'},
  {key:'qtyG', label:'Qty (g)', labelTh:'น้ำหนัก (กรัม)', type:'number'},
  {key:'status', label:'Status', labelTh:'สถานะ', type:'select', options: STOCK_STATUS_OPTIONS},
  {key:'harvestDate', label:'Harvest date', labelTh:'วันเก็บเกี่ยว', type:'date'},
  {key:'trimDate', label:'Trim date', labelTh:'วันทริม', type:'date'},
  {key:'linkedTrimId', label:'Linked trim ID', labelTh:'อ้างอิง Trim Cana', type:'text'},
  {key:'notes', label:'Notes', labelTh:'หมายเหตุ', type:'text'},
  {key:'updatedAt', label:'Updated', labelTh:'อัปเดต', type:'date'},
  {key:'updatedBy', label:'Updated by', labelTh:'โดย', type:'text'},
];
const CANA_STOCK_KEYS = ['strain','room','qtyG','status','harvestDate','trimDate','linkedTrimId','notes','updatedAt','updatedBy'];

function uid(){ return 'r'+Date.now().toString(36)+Math.random().toString(36).slice(2,8); }

const ALL_COLS = [...BLUE_COLS, ...PURPLE_COLS];
const XLSX_HEADER = ALL_COLS.map(c=>c.label).concat(['Total Flower (g)','Total Out (g)','Diff (g)','Yield %','Month']);
