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

const EXPORT_COMPANIES = [
  {
    id: 'bls',
    name: 'BLS',
    label: 'BLS Monthly Report',
    labelTh: 'รายงานรายเดือน BLS',
    description: 'Monthly batch summary for BLS — all farms combined for the selected month.',
    columns: [
      {key:'batchId', label:'Batch ID'},
      {key:'farm', label:'Farm'},
      {key:'date', label:'Delivery Date'},
      {key:'strain', label:'Strain'},
      {key:'grossWt', label:'Gross Wt (g)', num:true},
      {key:'startWt', label:'Start Wt (g)', num:true},
      {key:'totalFlower', label:'Total Flower (g)', num:true, computed:true},
      {key:'totalOut', label:'Total Out (g)', num:true, computed:true},
      {key:'diff', label:'Diff (g)', num:true, computed:true},
      {key:'yieldPct', label:'Yield %', pct:true, computed:true},
      {key:'condition', label:'Physical Condition'},
      {key:'eurofinsTest', label:'Eurofins Test'},
      {key:'tnrTest', label:'TNR Test'},
      {key:'passFail', label:'Pass/Fail'},
      {key:'qcBy', label:'QC by'},
      {key:'qcStart', label:'QC Start'},
      {key:'qcEnd', label:'QC End'},
      {key:'invoice', label:'Invoice'},
      {key:'notes', label:'Notes'},
    ]
  }
];
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
const ADMIN_SESSION_KEY = 'cana_qc_admin_session';
const ADMIN_SESSION_MS = 8 * 60 * 60 * 1000; // 8 hours
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
    documents
  };
}

const DOCUMENT_CATEGORIES = ['Invoice / ใบเสร็จ','COA / Lab Report / ใบรายงานแล็บ','Photos / รูปภาพ','Contract / สัญญา','QC Report / รายงาน QC','Other / อื่นๆ'];
const MAX_DOC_BYTES = 8 * 1024 * 1024;

function uid(){ return 'r'+Date.now().toString(36)+Math.random().toString(36).slice(2,8); }

const ALL_COLS = [...BLUE_COLS, ...PURPLE_COLS];
const XLSX_HEADER = ALL_COLS.map(c=>c.label).concat(['Total Flower (g)','Total Out (g)','Diff (g)','Yield %','Month']);
