/* shared.js — 纯函数工具（content.js / options.js / Node 测试共用，无浏览器 API 依赖）
 * 节次码格式（站点约定）：周-星期-节组，如 3-1-2 = 第3周 周一 节组2
 * 对「实验」：节组 N = 实验中心官方《物理实验上课时间》中的「第 N 场」（2学时共5场、4学时共3场）
 * 对「理论课」：节组 = 理论课大节（1=1-2节 … 5=晚9节起）。两套时间不完全一致（尤其晚场，
 *   实验17:45开课 vs 理论18:30开课），因此冲突检测一律按真实时间段重叠计算，不按节组编号比对。
 */
const SLOT_GROUP_NAMES = { 1: '1-2节', 2: '3-4节', 3: '5-6节', 4: '7-8节', 5: '晚9节起' };
const DAY_NAMES = { 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 7: '周日' };

/* 物理实验官方上课时间（实验中心《课程安排与注意事项》）：
 * 2学时5场 / 4学时3场。节次码的节组 N 对应 2学时「第 N 场」；4学时按起始节组对应第 1/2/3 场 */
const LAB_SESSIONS_2H = {
  1: ['08:20', '09:50'], 2: ['10:20', '11:50'], 3: ['14:00', '15:30'],
  4: ['16:00', '17:30'], 5: ['17:45', '19:15']
};
const LAB_SESSIONS_4H = {
  1: ['08:20', '11:20'], 2: ['14:00', '17:00'], 3: ['17:45', '20:45']
};
/* 实验筛选 chip 短标签 / 悬停完整时间 */
const LAB_GROUP_SHORT = { 1: '第1场 08:20', 2: '第2场 10:20', 3: '第3场 14:00', 4: '第4场 16:00', 5: '第5场 17:45' };
const LAB_GROUP_FULL = {
  1: '第1场 08:20–09:50', 2: '第2场 10:20–11:50', 3: '第3场 14:00–15:30',
  4: '第4场 16:00–17:30', 5: '第5场 17:45–19:15'
};

/* 理论课节次时间（12节制，来自课表 App）与大节时间段（冲突检测用） */
const THEORY_SLOT_TIMES = {
  1: ['08:20', '09:05'], 2: ['09:10', '09:55'], 3: ['10:20', '11:05'], 4: ['11:10', '11:55'],
  5: ['14:00', '14:45'], 6: ['14:50', '15:35'], 7: ['16:00', '16:45'], 8: ['16:50', '17:35'],
  9: ['18:30', '19:15'], 10: ['19:20', '20:05'], 11: ['20:30', '21:20'], 12: ['21:25', '22:00']
};
const THEORY_GROUP_TIMES = {
  1: ['08:20', '09:55'], 2: ['10:20', '11:55'], 3: ['14:00', '15:35'],
  4: ['16:00', '17:35'], 5: ['18:30', '22:00']
};

/* "3-1-2" -> {week:3, day:1, slotGroup:2}；非法返回 null */
function parseSlotCode(code) {
  const m = /^\s*(\d+)\s*-\s*(\d+)\s*-\s*(\d+)\s*$/.exec(String(code == null ? '' : code));
  if (!m) return null;
  return { week: +m[1], day: +m[2], slotGroup: +m[3] };
}

/* 实验占用几个节组：2学时=1个，4学时=连续2个 */
function slotGroupsFor(hours, startGroup) {
  const span = Math.max(1, Math.round((Number(hours) || 2) / 2));
  const groups = [];
  for (let i = 0; i < span; i++) groups.push(startGroup + i);
  return groups;
}

/* 学时+起始节组 -> 官方场次文本，如 "第3场 14:00–15:30"（4学时整段为一场） */
function labSessionText(hours, startGroup) {
  const tab = ((Number(hours) || 2) >= 4 ? LAB_SESSIONS_4H : LAB_SESSIONS_2H)[startGroup];
  if (tab) return '第' + startGroup + '场 ' + tab[0] + '–' + tab[1];
  /* 罕见组合（如4学时从第2/4节组起）：按2学时场次逐场拼接 */
  return slotGroupsFor(hours, startGroup)
    .map(g => LAB_SESSIONS_2H[g] ? '第' + g + '场 ' + LAB_SESSIONS_2H[g][0] + '–' + LAB_SESSIONS_2H[g][1] : (g + '节组'))
    .join('、');
}

/* "3-1-2" + 学时 -> "第3周 周一 第2场 10:20–11:50"（按官方实验上课时间） */
function humanizeSlotCode(code, hours) {
  const p = parseSlotCode(code);
  if (!p) return '';
  return '第' + p.week + '周 ' + (DAY_NAMES[p.day] || p.day) + ' ' + labSessionText(hours, p.slotGroup);
}

/* 周次文本 -> 区间数组。"1-12" -> [[1,12]]；"6-8,10" -> [[6,8],[10,10]]；"1" -> [[1,1]] */
function parseWeeksText(text) {
  const out = [];
  const s = String(text == null ? '' : text).replace(/周/g, ' ');
  const re = /(\d+)\s*(?:[-–—~]\s*(\d+))?/g;
  let m;
  while ((m = re.exec(s))) {
    const a = +m[1];
    const b = m[2] ? +m[2] : a;
    if (a >= 1 && b >= a && b <= 30) out.push([a, b]);
  }
  return out;
}

/* 某周是否落在周次区间数组内 */
function weeksContain(weeks, w) {
  return (weeks || []).some(r => w >= r[0] && w <= r[1]);
}

/* 清洗课程名（去掉上一单元格遗留的 学分:3.5 / 上午 / 数字 等前缀垃圾） */
function cleanCourseName(raw) {
  let s = String(raw == null ? '' : raw).replace(/[\r\n]+/g, '');
  let idx;
  while ((idx = Math.max(s.lastIndexOf('/'), s.lastIndexOf('：'), s.lastIndexOf(':'))) >= 0) {
    s = s.slice(idx + 1);
  }
  s = s.replace(/^[\s\d.、,，;；]*(?:上午|下午|晚上)?[\s\d.、,，;；]*/, '');
  s = s.trim();
  if (s.length < 2 || s.length > 40) return '';
  if (/[\/\\]/.test(s)) return '';
  if (/(校区|场地|教师|教学班|学分|学时|考核|备注|打印|学号|学期|时间段|节次|星期|选定)/.test(s)) return '';
  if (!/[\u4e00-\u9fa5A-Za-z]/.test(s)) return '';
  return s;
}

/* 解析课表 PDF 复制文本 -> 课程条目数组
 * 条目形如：课程名(3-4节)1-12周/校区:.../教师:...
 * 星期在纯文本中不可得 -> day 置 null，由用户在设置页补选
 * 返回元素：{name, day, slots:[1..5], slotSpan:[原始起止节], weeks:[[a,b],...], raw}
 */
function parseScheduleText(text) {
  const t = String(text == null ? '' : text).replace(/\r/g, '');
  const re = /[(（]\s*(\d+)\s*[-–—]\s*(\d+)\s*节\s*[)）]/g;
  const marks = [];
  let m;
  while ((m = re.exec(t))) marks.push({ start: m.index, end: re.lastIndex, s: +m[1], e: +m[2] });
  const items = [];
  let prevEnd = 0;
  for (const mk of marks) {
    let wkEnd = t.indexOf('/', mk.end);
    if (wkEnd < 0) wkEnd = Math.min(t.length, mk.end + 24);
    // 课程名提取：片段含结构字段(:/：)或长数字(学号/学年表头)时，
    // 只取最后一个空白分隔 token，避免教师名/表头信息黏进课程名
    let np = t.slice(prevEnd, mk.start);
    if (/[:：]/.test(np) || /\d{9,}/.test(np)) {
      const toks = np.split(/[\s\u3000]+/).filter(Boolean);
      np = toks.length ? toks[toks.length - 1] : '';
    }
    const name = cleanCourseName(np);
    const weeks = parseWeeksText(t.slice(mk.end, wkEnd));
    const gStart = Math.min(5, Math.ceil(mk.s / 2));
    const gEnd = Math.min(5, Math.ceil(mk.e / 2));
    const slots = [];
    for (let g = gStart; g <= gEnd; g++) slots.push(g);
    if (name && weeks.length) {
      items.push({ name: name, day: null, slots: slots, slotSpan: [mk.s, mk.e], weeks: weeks, raw: t.slice(mk.start, wkEnd).trim().slice(0, 80) });
    }
    prevEnd = wkEnd;
  }
  return items;
}

/* "08:20" -> 分钟数；非法返回 null */
function hhmmToMin(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s == null ? '' : s));
  return m ? (+m[1]) * 60 + (+m[2]) : null;
}

/* 实验实际占用时间段 [[起,止]...]（分钟），按官方物理实验上课时间表 */
function expTimeRanges(hours, startGroup) {
  if ((Number(hours) || 2) >= 4 && LAB_SESSIONS_4H[startGroup]) return [LAB_SESSIONS_4H[startGroup]];
  const out = [];
  for (const g of slotGroupsFor(hours, startGroup)) {
    out.push(LAB_SESSIONS_2H[g] || ['18:30', '22:00']);
  }
  return out;
}

/* 课程条目 -> 理论课时间段 [[起,止]...]；晚场(节组5)尽量用原始节次范围(slotSpan)精确化 */
function courseTimeRanges(c) {
  const out = [];
  const span = (c && c.slotSpan && THEORY_SLOT_TIMES[c.slotSpan[0]] && THEORY_SLOT_TIMES[c.slotSpan[1]]) ? c.slotSpan : null;
  for (const g of (c && c.slots) || []) {
    if (g === 5 && span) out.push([THEORY_SLOT_TIMES[span[0]][0], THEORY_SLOT_TIMES[span[1]][1]]);
    else if (THEORY_GROUP_TIMES[g]) out.push(THEORY_GROUP_TIMES[g]);
  }
  return out;
}

/* 冲突检测：实验 {week, day, slotGroup, hours} vs 课程数组 -> 冲突课程名列表（去重）
 * 按真实上课时间重叠判定：实验=官方场次表，课程=理论节次表；重叠 >=10 分钟才计冲突 */
function findConflicts(exp, courses) {
  if (!exp || !courses || !courses.length) return [];
  const expRanges = expTimeRanges(exp.hours, exp.slotGroup)
    .map(r => [hhmmToMin(r[0]), hhmmToMin(r[1])]);
  const hits = [];
  for (const c of courses) {
    if (!c.day || c.day !== exp.day) continue;
    if (!weeksContain(c.weeks, exp.week)) continue;
    const cr = courseTimeRanges(c).map(r => [hhmmToMin(r[0]), hhmmToMin(r[1])]);
    const overlap = expRanges.some(a => cr.some(b => Math.min(a[1], b[1]) - Math.max(a[0], b[0]) >= 10));
    if (overlap) hits.push(c.name || '(未命名课程)');
  }
  const seen = {};
  return hits.filter(h => (seen[h] ? false : (seen[h] = true)));
}

/* ===== 实验课程元数据（来自物理实验理论课 PDF 2026-2027-1）=====
 * 12 种实验，2 种必做：分光计(4学时)、虚拟仿真(2学时)
 * 物理实验AI：共9个 = 1个4学时必做(分光计) + 1个2学时必做(虚拟仿真) + 7个2学时选做
 * 物理实验BI：共6个 = 1个4学时必做(分光计) + 1个2学时必做(虚拟仿真) + 4个2学时选做
 * 12种实验：霍尔元件/示波器/模拟静电场/电桥/转动惯量/杨氏模量/PN结/理想气体/
 *           显微系统/牛顿环/分光计(4学时)/虚拟仿真
 * 每周可预约2个实验，第二周开始选课，第三周开始上课 */
const EXPERIMENT_META = {
  mandatory: ['分光计', '虚拟仿真'],          // 必做实验关键词
  totalAI: 9, totalBI: 6,                      // AI/BI 各需完成总数
  optionalAI: 7, optionalBI: 4,                // 从10个非必做2学时中选的数量
  types: 12,                                   // 实验种类总数
  perWeek: 2                                   // 每周可预约数
};

/* 判断实验名是否为必做 */
function isMandatoryExperiment(name) {
  return EXPERIMENT_META.mandatory.some(k => String(name || '').indexOf(k) >= 0);
}

/* 归一化实验名：去掉 "-X学时" 后缀，用于同类去重比较 */
function normalizeExpName(name) {
  return String(name || '').replace(/-\s*\d+\s*学时.*$/, '').trim();
}

/* 实验间冲突检测：实验 A vs 已预约实验数组 -> 冲突实验名列表（去重）
 * expA: {week, day, slotGroup, hours}；expList: [{slot:{week,day,slotGroup}, hours, name}]
 * 按官方实验场次时间重叠 >=10 分钟判定 */
function findExpConflicts(expA, expList) {
  if (!expA || !expList || !expList.length) return [];
  const aRanges = expTimeRanges(expA.hours, expA.slotGroup)
    .map(r => [hhmmToMin(r[0]), hhmmToMin(r[1])]);
  const hits = [];
  for (const b of expList) {
    if (!b.slot || b.slot.week !== expA.week || b.slot.day !== expA.day) continue;
    const bRanges = expTimeRanges(b.hours, b.slot.slotGroup)
      .map(r => [hhmmToMin(r[0]), hhmmToMin(r[1])]);
    const overlap = aRanges.some(a => bRanges.some(b2 => Math.min(a[1], b2[1]) - Math.max(a[0], b2[0]) >= 10));
    if (overlap) hits.push(b.name || '(未命名实验)');
  }
  const seen2 = {};
  return hits.filter(h => (seen2[h] ? false : (seen2[h] = true)));
}

/* 兼容 Node 测试导出；浏览器内容脚本环境无 module，自动跳过 */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SLOT_GROUP_NAMES: SLOT_GROUP_NAMES,
    DAY_NAMES: DAY_NAMES,
    LAB_SESSIONS_2H: LAB_SESSIONS_2H,
    LAB_SESSIONS_4H: LAB_SESSIONS_4H,
    LAB_GROUP_SHORT: LAB_GROUP_SHORT,
    LAB_GROUP_FULL: LAB_GROUP_FULL,
    THEORY_SLOT_TIMES: THEORY_SLOT_TIMES,
    THEORY_GROUP_TIMES: THEORY_GROUP_TIMES,
    parseSlotCode: parseSlotCode,
    slotGroupsFor: slotGroupsFor,
    labSessionText: labSessionText,
    humanizeSlotCode: humanizeSlotCode,
    parseWeeksText: parseWeeksText,
    weeksContain: weeksContain,
    cleanCourseName: cleanCourseName,
    parseScheduleText: parseScheduleText,
    hhmmToMin: hhmmToMin,
    expTimeRanges: expTimeRanges,
    courseTimeRanges: courseTimeRanges,
    findConflicts: findConflicts,
    findExpConflicts: findExpConflicts,
    EXPERIMENT_META: EXPERIMENT_META,
    isMandatoryExperiment: isMandatoryExperiment,
    normalizeExpName: normalizeExpName
  };
}
