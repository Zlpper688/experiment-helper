// ==UserScript==
// @name         实验选课助手（油猴版）
// @namespace    sau-lab-helper-tampermonkey
// @version      1.8.0
// @description  开放实验教学管理系统（wlsy.webvpn.sau.edu.cn/lab2026）实验列表筛选增强：关键字/星期/节组/老师筛选、仅看可约、隐藏已满/课表冲突/实验间冲突/已选同类/不想选/已选、仅看已选、仅看测试通过、剩余人数排序、节次人话徽标、一键预约（fetch POST 不跳页）、自动抢课（定时刷新监控可约场次）、已预约/必做/同类已选/已做/不想选标记、每行状态徽标（✓可约/已预约/已做/已满/课表冲突/实验冲突/同类已选/不想选）、选课进度提示（AI还需X/BI还需Y/必做未选）、页面内课表设置弹层（支持直接上传课表 PDF 自动解析）、新人交接检查（列表周次显示 + 已预约/已做实验自动同步确认）。
// @match        https://wlsy.webvpn.sau.edu.cn/lab2026/index.php*
// @run-at       document-end
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      cdn.jsdelivr.net
// @connect      unpkg.com
// ==/UserScript==

/* 实验选课助手（油猴版）—— 与 Chrome 扩展版功能一致的 Tampermonkey 单文件实现
 * 结构：
 *   1. 存储层（GM_getValue/GM_setValue，降级 localStorage）
 *   2. 纯函数工具（与 extension/shared.js 保持一致，已通过 Node 回归测试）
 *   3. 注入样式（前缀 ulph-，避免与扩展版 lph- 或 layui 冲突）
 *   4. 课表设置弹层（移植 options 页：PDF 上传解析 + 粘贴解析 + 手动网格 + 条目管理 + 导入导出）
 *   5. 实验列表页增强（筛选面板 + 冲突标红）
 *   6. 我的实验页徽标
 * 安全约束：界面增强 + 用户主动触发的一键预约/自动抢课（fetch POST，不自动批量提交）
 */
(function () {
  'use strict';

  /* ================= 1. 存储层 ================= */
  const store = {
    get(k, d) {
      try {
        if (typeof GM_getValue === 'function') {
          const v = GM_getValue(k, undefined);
          return v === undefined || v === null ? d : v;
        }
      } catch (e) { /* 降级 */ }
      try {
        const v = localStorage.getItem('ulph:' + k);
        return v == null ? d : JSON.parse(v);
      } catch (e) { return d; }
    },
    set(k, v) {
      try {
        if (typeof GM_setValue === 'function') { GM_setValue(k, v); return; }
      } catch (e) { /* 降级 */ }
      try { localStorage.setItem('ulph:' + k, JSON.stringify(v)); } catch (e) { /* 忽略 */ }
    }
  };

  const KEY_COURSES = 'labHelperCourses';
  const KEY_FILTERS = 'labHelperFilters';
  const KEY_UNWANTED = 'labHelperUnwanted';

  /* 通用：不想选列表 */
  function loadUnwanted() {
    const arr = store.get(KEY_UNWANTED, []);
    return new Set(Array.isArray(arr) ? arr : []);
  }
  function saveUnwanted(set) {
    store.set(KEY_UNWANTED, [...set]);
  }

  /* 列表页设置的冲突刷新钩子（课表弹层保存后调用） */
  let refreshConflictsHook = null;

  /* ================= 2. 纯函数工具（同 shared.js） ================= */
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

  /* 周次文本 -> 区间数组。"1-12" -> [[1,12]]；"6-8,10" -> [[6,8],[10,10]] */
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

  function weeksContain(weeks, w) {
    return (weeks || []).some(r => w >= r[0] && w <= r[1]);
  }

  /* 清洗课程名（不再过滤"组成"等词，修过误杀 bug） */
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

  /* 解析课表 PDF 复制文本 -> 课程条目数组（星期需用户补选） */
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

  /* ================= 2.5 课表 PDF 直接解析（与 extension/pdf-extract.js 同算法，已回归） ================= */
  const PDFJS_CDN_BASE = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174';
  const PDFJS_CDN_FALLBACK = 'https://unpkg.com/pdfjs-dist@3.11.174';
  const PDFX_DAY_RE = /^(?:星期|周)([一二三四五六日天])$/;
  const PDFX_DAY_NUM = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7 };
  const PDFX_NAME_LINE_RE = /^(?=[\u4e00-\u9fa5A-Za-z0-9ⅠⅡⅢⅣ（）·、\-—－]+$)[\u4e00-\u9fa5A-Za-z0-9ⅠⅡⅢⅣ（）·、\-—－]*[\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z0-9ⅠⅡⅢⅣ（）·、\-—－]*$/;
  const PDFX_MARK_START_RE = /^\s*[(（]\s*\d+\s*[-–—]\s*\d+\s*节/;

  /* 跨域拉脚本文本（GM_xmlhttpRequest 不受页面 CSP 限制），首个 CDN 失败换备用 */
  function fetchScriptText(path) {
    const urls = [PDFJS_CDN_BASE + path, PDFJS_CDN_FALLBACK + path];
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'function') {
        reject(new Error('缺少 GM_xmlhttpRequest 权限，无法下载 PDF 解析引擎'));
        return;
      }
      let i = 0;
      const tryNext = () => {
        if (i >= urls.length) { reject(new Error('PDF 解析引擎下载失败（检查网络）')); return; }
        GM_xmlhttpRequest({
          method: 'GET', url: urls[i++], timeout: 30000,
          onload: r => (r.status >= 200 && r.status < 300 && r.responseText)
            ? resolve(r.responseText) : tryNext(),
          onerror: tryNext,
          ontimeout: tryNext
        });
      };
      tryNext();
    });
  }

  let pdfjsReady = null;
  function ensurePdfJs() {
    if (typeof pdfjsLib !== 'undefined' && pdfjsLib.getDocument) return Promise.resolve();
    if (pdfjsReady) return pdfjsReady;
    pdfjsReady = fetchScriptText('/build/pdf.min.js').then(code => {
      (0, eval)(code); /* 油猴沙箱内求值 -> 全局 pdfjsLib */
      if (typeof pdfjsLib === 'undefined' || !pdfjsLib.getDocument) throw new Error('pdf.js 加载失败');
    }).catch(e => { pdfjsReady = null; throw e; });
    return pdfjsReady;
  }

  /* 预置主线程 worker（fake worker），避免依赖页面 CSP 的动态 import */
  function ensurePdfWorker() {
    try {
      if (globalThis.pdfjsWorker && globalThis.pdfjsWorker.WorkerMessageHandler) return Promise.resolve();
    } catch (e) { /* 忽略 */ }
    return fetchScriptText('/build/pdf.worker.min.js').then(code => { (0, eval)(code); }).catch(() => {
      /* 失败不致命：退回 workerSrc 方式，pdf.js 自行兜底 */
      try { pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_CDN_BASE + '/build/pdf.worker.min.js'; } catch (e) { /* 忽略 */ }
    });
  }

  /* 单元格 items -> 文本行（按 vy 聚类，行内按 vx 排序，间距>2px 补空格） */
  function pdfxBuildLines(items) {
    const lines = [];
    for (const it of items) {
      let line = null;
      for (const L of lines) { if (Math.abs(L.vy - it.vy) <= 3) { line = L; break; } }
      if (!line) { line = { vy: it.vy, items: [] }; lines.push(line); }
      line.items.push(it);
    }
    lines.sort((a, b) => a.vy - b.vy);
    const out = [];
    for (const L of lines) {
      L.items.sort((a, b) => a.vx - b.vx);
      let text = '', prevEnd = null;
      for (const it of L.items) {
        if (prevEnd !== null && it.vx - prevEnd > 2) text += ' ';
        text += it.s;
        prevEnd = it.vx + it.w;
      }
      out.push({ vy: L.vy, text: text });
    }
    return out;
  }

  /* 折行课程名修复：把标记行上方连续的纯名字行并入标记行（原行移除；没等到标记行则原样放回） */
  function pdfxMergeNameLines(lines) {
    const out = [];
    let pending = [];
    for (const L of lines) {
      const t = L.text.replace(/^\s+/, '');
      if (PDFX_MARK_START_RE.test(t)) {
        out.push({ vy: L.vy, text: pending.join('') + t });
        pending = [];
      } else if (PDFX_NAME_LINE_RE.test(t) && pending.length < 3) {
        pending.push(t);
      } else {
        out.push(...pending, L);
        pending = [];
      }
    }
    out.push(...pending);
    return out;
  }

  /* 识别一页中的星期表头：同一 vy 上 >=2 个「星期X/周X」，返回列边界 */
  function pdfxFindHeader(items) {
    const heads = [];
    for (const it of items) {
      const mm = PDFX_DAY_RE.exec(it.s.replace(/\s+/g, ''));
      if (mm) heads.push({ day: PDFX_DAY_NUM[mm[1]], it: it });
    }
    if (heads.length < 2) return null;
    heads.sort((a, b) => a.it.vy - b.it.vy);
    let best = [], cur = [heads[0]];
    for (let i = 1; i < heads.length; i++) {
      if (heads[i].it.vy - cur[cur.length - 1].it.vy <= 3) cur.push(heads[i]);
      else { if (cur.length > best.length) best = cur; cur = [heads[i]]; }
    }
    if (cur.length > best.length) best = cur;
    if (best.length < 2) return null;
    best.sort((a, b) => a.it.vx - b.it.vx);
    const centers = best.map(h => h.it.vx + h.it.w / 2);
    const bounds = [centers[0] - (centers[1] - centers[0]) / 2];
    for (let i = 1; i < centers.length; i++) bounds.push((centers[i - 1] + centers[i]) / 2);
    bounds.push(centers[centers.length - 1] + (centers[centers.length - 1] - centers[centers.length - 2]) / 2);
    return { vy: best[0].it.vy, bounds: bounds, days: best.map(h => h.day) };
  }

  /* 主入口：data 为 ArrayBuffer/TypedArray；返回 {pages, text, entries} */
  async function extractScheduleFromPdf(data) {
    await ensurePdfJs();
    await ensurePdfWorker();
    const doc = await pdfjsLib.getDocument({
      data: data instanceof Uint8Array ? data : new Uint8Array(data),
      cMapUrl: PDFJS_CDN_BASE + '/cmaps/',
      cMapPacked: true
    }).promise;

    const allTextLines = [];
    const pageData = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const m = page.getViewport({ scale: 1 }).transform; /* 已含页面 /Rotate */
      const tc = await page.getTextContent();
      const items = [];
      for (const it of tc.items) {
        if (!(it.str || '').trim()) continue;
        const tx = it.transform[4], ty = it.transform[5];
        items.push({ vx: m[0] * tx + m[2] * ty + m[4], vy: m[1] * tx + m[3] * ty + m[5], w: it.width || 0, s: it.str });
      }
      for (const l of pdfxBuildLines(items)) allTextLines.push(l.text);
      pageData.push({ items: items, header: pdfxFindHeader(items) });
    }

    let entriesRaw = [];
    if (pageData.some(pd => pd.header)) {
      /* 列模式：按列×页分桶，续页继承最近表头页的列边界（跨页大表） */
      let active = null, cols = null;
      for (let pIdx = 0; pIdx < pageData.length; pIdx++) {
        const pd = pageData[pIdx];
        if (pd.header) {
          active = pd.header;
          cols = active.days.map(d => ({ day: d, pages: [] }));
          cols.forEach(c => { for (let i = 0; i < pageData.length; i++) c.pages.push([]); });
        }
        if (!active) continue;
        const minVy = pd.header ? pd.header.vy - 1 : -1;
        for (const it of pd.items) {
          if (PDFX_DAY_RE.test(it.s.replace(/\s+/g, ''))) continue;
          if (it.vy < minVy) continue;
          if (it.vx < active.bounds[0] - 6 || it.vx >= active.bounds[active.bounds.length - 1]) continue;
          let ci = 0;
          while (ci < active.bounds.length - 1 && it.vx >= active.bounds[ci + 1]) ci++;
          cols[ci].pages[pIdx].push(it);
        }
      }
      for (const col of cols) {
        const chunks = [];
        for (const pageItems of col.pages) {
          if (pageItems.length) chunks.push(pdfxMergeNameLines(pdfxBuildLines(pageItems)).map(l => l.text).join('\n'));
        }
        const chunk = chunks.join('\n');
        if (!chunk) continue;
        for (const e of parseScheduleText(chunk)) { e.day = col.day; entriesRaw.push(e); }
      }
    } else {
      /* 兜底：无星期表头 -> 整页文本模式（day 留空由用户补选） */
      for (const pd of pageData) {
        const chunk = pdfxBuildLines(pd.items).map(l => l.text).join('\n');
        entriesRaw.push(...parseScheduleText(chunk));
      }
    }

    const seen = Object.create(null);
    const entries = [];
    for (const e of entriesRaw) {
      const wk = (e.weeks || []).map(r => (r[0] === r[1] ? String(r[0]) : r[0] + '-' + r[1])).join(',');
      const key = [e.name, e.day, (e.slots || []).join(','), wk].join('|');
      if (seen[key]) continue;
      seen[key] = 1;
      e.weeksText = wk;
      entries.push(e);
    }
    return { pages: doc.numPages, text: allTextLines.join('\n'), entries: entries };
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

  /* ===== 实验课程元数据（来自物理实验理论课 PDF 2026-2027-1）=====
   * 12 种实验，2 种必做：分光计(4学时)、虚拟仿真(2学时)
   * 物理实验AI：共9个 = 1个4学时必做(分光计) + 1个2学时必做(虚拟仿真) + 7个2学时选做
   * 物理实验BI：共6个 = 1个4学时必做(分光计) + 1个2学时必做(虚拟仿真) + 4个2学时选做
   * 12种实验：霍尔元件/示波器/模拟静电场/电桥/转动惯量/杨氏模量/PN结/理想气体/
   *           显微系统/牛顿环/分光计(4学时)/虚拟仿真
   * 每周可预约2个实验，第二周开始选课，第三周开始上课 */
  const EXPERIMENT_META = {
    mandatory: ['分光计', '虚拟仿真'],
    totalAI: 9, totalBI: 6,
    optionalAI: 7, optionalBI: 4,
    types: 12,
    perWeek: 2
  };

  function isMandatoryExperiment(name) {
    return EXPERIMENT_META.mandatory.some(k => String(name || '').indexOf(k) >= 0);
  }

  function normalizeExpName(name) {
    return String(name || '').replace(/-\s*\d+\s*学时.*$/, '').trim();
  }

  /* ================= 3. 注入样式 ================= */
  const CSS = [
    /* ---- 列表面板（同扩展版 panel.css，前缀 ulph-） ---- */
    '.ulph-panel{background:#fff;border:1px solid #e6e6e6;border-radius:8px;padding:12px 14px;margin:10px 0 14px;font-size:13px;color:#333;box-shadow:0 1px 4px rgba(0,0,0,.06);line-height:1.6;font-family:"Microsoft YaHei","PingFang SC",system-ui,sans-serif;}',
    '.ulph-head{display:flex;align-items:center;gap:12px;margin-bottom:8px;}',
    '.ulph-title{font-size:15px;font-weight:600;color:#16b777;}',
    '.ulph-stats{color:#888;flex:1;}',
    '.ulph-row{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:6px 0;}',
    '.ulph-input{border:1px solid #d6d6d6;border-radius:6px;padding:5px 10px;font-size:13px;outline:none;background:#fff;color:#333;}',
    '.ulph-input:focus{border-color:#16b777;}',
    '#ulph-kw{width:260px;}',
    '.ulph-sort{width:150px;}',
    '.ulph-chip{border:1px solid #d6d6d6;background:#fafafa;border-radius:14px;padding:3px 12px;font-size:12px;cursor:pointer;color:#555;}',
    '.ulph-chip:hover{border-color:#16b777;color:#16b777;}',
    '.ulph-chip.on{background:#16b777;border-color:#16b777;color:#fff;}',
    '.ulph-chk{display:inline-flex;align-items:center;gap:4px;cursor:pointer;user-select:none;}',
    '.ulph-mini-btn{border:1px solid #16b777;background:#fff;color:#16b777;border-radius:6px;padding:3px 12px;font-size:12px;cursor:pointer;}',
    '.ulph-mini-btn:hover{background:#16b777;color:#fff;}',
    '.ulph-sched{border-top:1px dashed #eee;padding-top:6px;}',
    '.ulph-sched.warn{color:#d08800;}',
    '.ulph-sched.ok{color:#16a370;}',
    '.ulph-badge{font-size:11px;color:#1e9fff;margin-top:2px;}',
    'tr.ulph-conflict>td{background:#fff1f0 !important;}',
    '.ulph-conflict-tip{font-size:11px;color:#e02e2e;margin-top:2px;}',
    'tr.ulph-open-row>td:first-child{position:relative;}',
    /* ---- 新增样式：一键预约、余量高亮、已预约、实验冲突、自动抢课 ---- */
    '.ulph-quick-reserve{display:inline-block;border:1px solid #ff9800;background:#fff7e6;color:#d46b08;border-radius:6px;padding:3px 10px;font-size:12px;cursor:pointer;margin-left:4px;transition:all .2s;}',
    '.ulph-quick-reserve:hover{background:#ff9800;color:#fff;}',
    '.ulph-quick-reserve:disabled{cursor:default;opacity:.8;}',
    '.ulph-quick-reserve.ulph-success{border-color:#16b777;background:#16b777;color:#fff;}',
    '.ulph-seats-critical{color:#e02e2e !important;font-weight:700;}',
    '.ulph-seats-low{color:#d08800 !important;font-weight:600;}',
    'tr.ulph-reserved-row>td{background:#f0f9ff !important;}',
    'tr.ulph-reserved>td{background:#e6ffed !important;}',
    '.ulph-reserved-tag{display:inline-block;background:#1e9fff;color:#fff;border-radius:4px;padding:1px 8px;font-size:11px;margin-left:4px;}',
    'tr.ulph-exp-conflict>td{background:#fffbe6 !important;}',
    '.ulph-exp-tip{color:#d08800 !important;}',
    '.ulph-auto-btn{border-color:#ff5722;color:#ff5722;}',
    '.ulph-auto-btn:hover{background:#ff5722;color:#fff;}',
    '.ulph-auto-btn.active{background:#ff5722;color:#fff;animation:ulph-pulse 1.5s infinite;}',
    '@keyframes ulph-pulse{0%,100%{opacity:1;}50%{opacity:.7;}}',
    '.ulph-auto-status{font-size:12px;color:#888;}',
    '.ulph-mandatory-tag{display:inline-block;background:#e02e2e;color:#fff;border-radius:4px;padding:1px 8px;font-size:11px;margin-left:4px;font-weight:600;}',
    'tr.ulph-dup-row>td{background:#f5f5f5 !important;opacity:.7;}',
    '.ulph-dup-tag{display:inline-block;background:#bfbfbf;color:#fff;border-radius:4px;padding:1px 8px;font-size:11px;margin-left:4px;}',
    /* ---- 状态徽标、不想选、老师筛选 ---- */
    '.ulph-status-tag{display:inline-block;border-radius:4px;padding:1px 7px;font-size:11px;margin-right:4px;font-weight:600;white-space:nowrap;}',
    '.ulph-status-ok{background:#e6ffed;color:#16b777;}',
    '.ulph-status-reserved{background:#1e9fff;color:#fff;}',
    '.ulph-status-full{background:#f5f5f5;color:#999;}',
    '.ulph-status-conflict{background:#fff1f0;color:#e02e2e;}',
    '.ulph-status-exp{background:#fffbe6;color:#d08800;}',
    '.ulph-status-dup{background:#f0f0f0;color:#888;}',
    '.ulph-status-unwanted{background:#fff0f6;color:#c41d7f;}',
    'tr.ulph-unwanted-row>td{opacity:.5;}',
    '.ulph-unwanted-btn{display:inline-block;border:1px solid #d3adf7;background:#f9f0ff;color:#722ed1;border-radius:4px;padding:2px 8px;font-size:11px;cursor:pointer;margin-left:4px;}',
    '.ulph-unwanted-btn:hover{background:#722ed1;color:#fff;}',
    '.ulph-teacher{margin-left:8px;padding:3px 8px;border:1px solid #d9d9d9;border-radius:6px;font-size:12px;max-width:120px;}',

    /* ---- 课表设置弹层（同扩展版 options.css，作用域限定在 #ulph-overlay） ---- */
    '#ulph-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.45);z-index:2147483000;overflow:auto;font-family:"Microsoft YaHei","PingFang SC",system-ui,sans-serif;font-size:14px;color:#333;box-sizing:border-box;}',
    '#ulph-overlay *,#ulph-overlay *::before,#ulph-overlay *::after{box-sizing:border-box;}',
    '.ulph-modal{max-width:980px;margin:4vh auto;background:#f5f7fa;border-radius:12px;padding:18px 20px 24px;box-shadow:0 8px 40px rgba(0,0,0,.25);}',
    '.ulph-modal-head{display:flex;align-items:center;gap:12px;margin-bottom:12px;}',
    '.ulph-modal-head h1{font-size:18px;margin:0;flex:1;}',
    '.ulph-modal section{background:#fff;border:1px solid #e3e8ef;border-radius:10px;padding:14px 16px;margin-bottom:14px;}',
    '.ulph-modal h2{font-size:15px;margin:0 0 8px;color:#1f3a5f;}',
    '.ulph-modal .ulph-hint{color:#7a8699;font-size:12.5px;margin:4px 0 10px;}',
    '.ulph-modal .ulph-hint ol,.ulph-modal .ulph-hint li{margin:2px 0;padding-left:18px;}',
    '.ulph-modal textarea{width:100%;border:1px solid #ccd4e0;border-radius:8px;padding:8px;font-family:Consolas,monospace;font-size:12.5px;resize:vertical;background:#fff;color:#333;}',
    '.ulph-modal textarea:focus{outline:none;border-color:#3b82f6;}',
    '.ulph-btn{padding:6px 14px;border:1px solid #ccd4e0;border-radius:8px;background:#fff;cursor:pointer;font-size:13px;color:#333;}',
    '.ulph-btn:hover{background:#f0f4ff;}',
    '.ulph-btn.ulph-primary{background:#2f6fed;border-color:#2f6fed;color:#fff;}',
    '.ulph-btn.ulph-primary:hover{background:#2560d8;}',
    '.ulph-btn.ulph-danger{color:#d33;}',
    '.ulph-btn.ulph-danger:hover{background:#fee;}',
    '.ulph-btn.ulph-small{padding:2px 10px;font-size:12px;}',
    '.ulph-btn-row{margin-top:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;}',
    '.ulph-msg{color:#c60;font-size:12.5px;}',
    '.ulph-msg.ulph-ok{color:#2a2;}',
    '.ulph-save-msg{color:#2a2;font-size:12.5px;}',
    /* 周网格 */
    '#ulph-grid{border-collapse:collapse;}',
    '#ulph-grid th,#ulph-grid td{border:1px solid #dde3ec;width:86px;height:40px;text-align:center;font-size:12.5px;}',
    '#ulph-grid th{background:#f0f3f8;font-weight:600;}',
    '#ulph-grid td{cursor:pointer;color:#2f6fed;font-weight:700;user-select:none;}',
    '#ulph-grid td:hover{background:#eef4ff;}',
    '#ulph-grid td.on{background:#dcebff;}',
    /* 条目表 */
    '#ulph-entries{width:100%;border-collapse:collapse;}',
    '#ulph-entries th,#ulph-entries td{border-bottom:1px solid #edf0f5;padding:6px;text-align:left;font-size:13px;vertical-align:middle;}',
    '#ulph-entries th{color:#667;font-weight:600;background:#f8fafc;}',
    '#ulph-entries input[type="text"]{width:100%;border:1px solid #dde3ec;border-radius:6px;padding:4px 6px;font-size:13px;background:#fff;color:#333;}',
    '#ulph-entries input.ulph-weeks{width:110px;}',
    '#ulph-entries select{border:1px solid #dde3ec;border-radius:6px;padding:4px;}',
    '#ulph-entries select.ulph-need{border-color:#e6a23c;background:#fffaf0;}',
    '#ulph-entries td.ulph-src{color:#99a;font-size:12px;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '#ulph-entries td.ulph-empty{text-align:center;color:#99a;padding:18px;}',
    '.ulph-slot-chk{margin-right:8px;white-space:nowrap;font-size:12px;color:#556;}'
  ].join('\n');

  function injectStyle() {
    try {
      if (typeof GM_addStyle === 'function') { GM_addStyle(CSS); return; }
    } catch (e) { /* 降级 */ }
    const el = document.createElement('style');
    el.textContent = CSS;
    (document.head || document.documentElement).appendChild(el);
  }

  /* ================= 4. 课表设置弹层（移植 options 页） ================= */
  function openSettingsOverlay() {
    if (document.getElementById('ulph-overlay')) return;

    let state = store.get(KEY_COURSES, null);
    if (!state || !Array.isArray(state.courses)) state = { version: 1, courses: [] };

    const overlay = document.createElement('div');
    overlay.id = 'ulph-overlay';
    overlay.innerHTML =
      '<div class="ulph-modal" role="dialog" aria-label="课表设置">' +
      '<div class="ulph-modal-head">' +
      '<h1>课表设置</h1>' +
      '<span class="ulph-save-msg" id="ulph-save-msg"></span>' +
      '<button type="button" class="ulph-btn" id="ulph-close">关闭</button>' +
      '</div>' +

      '<section>' +
      '<h2>方式一：上传课表 PDF 文件（推荐）</h2>' +
      '<div class="ulph-hint">直接选中课表 PDF 文件即可，无需打开复制；自动解析全部页面（支持跨页大表），星期自动识别。首次使用会从 CDN 下载解析引擎（约 1.3MB）。</div>' +
      '<div class="ulph-btn-row">' +
      '<label class="ulph-btn ulph-primary" style="cursor:pointer">选择 PDF 文件<input type="file" id="ulph-pdf" accept="application/pdf,.pdf" style="display:none"></label>' +
      '<span class="ulph-msg" id="ulph-pdf-msg"></span>' +
      '</div>' +
      '</section>' +

      '<section>' +
      '<h2>方式二：粘贴课表文字</h2>' +
      '<div class="ulph-hint">打开课表 PDF 全选复制文字，粘贴到下面，点「解析并添加」。星期在解析后于下方列表补选。</div>' +
      '<textarea id="ulph-paste" rows="6" placeholder="粘贴课表文字……"></textarea>' +
      '<div class="ulph-btn-row">' +
      '<button type="button" class="ulph-btn ulph-primary" id="ulph-parse">解析并添加</button>' +
      '<button type="button" class="ulph-btn" id="ulph-clear-paste">清空输入</button>' +
      '<span class="ulph-msg" id="ulph-parse-msg"></span>' +
      '</div>' +
      '</section>' +

      '<section>' +
      '<h2>方式三：手动勾选网格</h2>' +
      '<div class="ulph-hint">点击格子标记有课的时段（可再点一次取消）；和条目冲突的格子会提示去列表改。</div>' +
      '<table id="ulph-grid"></table>' +
      '<div class="ulph-btn-row">' +
      '<button type="button" class="ulph-btn" id="ulph-add">添加一条（手动）</button>' +
      '</div>' +
      '</section>' +

      '<section>' +
      '<h2>课表条目</h2>' +
      '<table class="ulph-entries" id="ulph-entries-table">' +
      '<thead><tr><th style="width:24%">课程名</th><th style="width:10%">星期</th><th>节组</th><th style="width:12%">周次</th><th style="width:10%">来源</th><th style="width:7%">操作</th></tr></thead>' +
      '<tbody id="ulph-entries"></tbody>' +
      '</table>' +
      '</section>' +

      '<section>' +
      '<h2>备份 / 恢复</h2>' +
      '<textarea id="ulph-json" rows="4" placeholder="导出的 JSON 会出现在这里；粘贴 JSON 后点「导入」"></textarea>' +
      '<div class="ulph-btn-row">' +
      '<button type="button" class="ulph-btn" id="ulph-export">导出 JSON</button>' +
      '<button type="button" class="ulph-btn ulph-primary" id="ulph-import">导入 JSON</button>' +
      '<button type="button" class="ulph-btn ulph-danger" id="ulph-wipe">清空全部</button>' +
      '</div>' +
      '</section>' +
      '</div>';

    document.body.appendChild(overlay);

    const $ = id => overlay.querySelector('#' + id);
    const saveMsg = $('ulph-save-msg');

    /* ---------- 保存（防抖 + 通知列表页刷新冲突） ---------- */
    let saveTimer = null;
    function save() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        store.set(KEY_COURSES, state);
        saveMsg.textContent = '已保存 ✓';
        setTimeout(() => { saveMsg.textContent = ''; }, 1500);
        if (refreshConflictsHook) refreshConflictsHook();
      }, 250);
    }

    function close() {
      overlay.remove();
      document.removeEventListener('keydown', onEsc);
    }
    function onEsc(ev) { if (ev.key === 'Escape') close(); }

    $('ulph-close').addEventListener('click', close);
    overlay.addEventListener('click', ev => { if (ev.target === overlay) close(); });
    document.addEventListener('keydown', onEsc);

    /* ---------- PDF 文件上传解析 ---------- */
    $('ulph-pdf').addEventListener('change', async ev => {
      const file = ev.target.files && ev.target.files[0];
      ev.target.value = ''; /* 允许再次选择同一文件 */
      const msg = $('ulph-pdf-msg');
      if (!file) return;
      if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
        msg.textContent = '请选择 PDF 文件';
        return;
      }
      msg.textContent = '解析中…（首次使用需下载解析引擎，请稍候）';
      try {
        const buf = await file.arrayBuffer();
        const res = await extractScheduleFromPdf(buf);
        if (!res.entries.length) {
          msg.textContent = '没有解析出课程条目，请确认这是课表 PDF（或改用方式二粘贴文字）';
          return;
        }
        for (const it of res.entries) {
          state.courses.push({
            name: it.name, day: it.day, slots: it.slots, slotSpan: it.slotSpan || null, weeks: it.weeks,
            auto: false, src: 'PDF', raw: it.raw || ''
          });
        }
        renderEntries();
        renderGrid();
        save();
        msg.textContent = '已从「' + file.name + '」解析出 ' + res.entries.length + ' 条（共 ' + res.pages + ' 页，星期自动识别）';
      } catch (e) {
        msg.textContent = '解析失败：' + (e && e.message ? e.message : e);
      }
    });

    /* ---------- 粘贴解析 ---------- */
    $('ulph-parse').addEventListener('click', () => {
      const text = $('ulph-paste').value;
      if (!text.trim()) { $('ulph-parse-msg').textContent = '请先粘贴课表文字'; return; }
      const items = parseScheduleText(text);
      if (!items.length) {
        $('ulph-parse-msg').textContent = '没有解析出课程条目，请确认粘贴的是课表 PDF 的文字';
        return;
      }
      for (const it of items) {
        state.courses.push({
          name: it.name, day: null, slots: it.slots, slotSpan: it.slotSpan || null, weeks: it.weeks,
          auto: false, src: '粘贴', raw: it.raw || ''
        });
      }
      renderEntries();
      renderGrid();
      save();
      $('ulph-parse-msg').textContent = '解析出 ' + items.length + ' 条，请在下方列表为每条补选「星期」';
      $('ulph-paste').value = '';
    });
    $('ulph-clear-paste').addEventListener('click', () => {
      $('ulph-paste').value = '';
      $('ulph-parse-msg').textContent = '';
    });

    /* ---------- 周网格 ---------- */
    (function buildGrid() {
      const grid = $('ulph-grid');
      const thead = document.createElement('thead');
      const hr = document.createElement('tr');
      const corner = document.createElement('th');
      corner.textContent = '节组\\星期';
      hr.appendChild(corner);
      for (let d = 1; d <= 7; d++) {
        const th = document.createElement('th');
        th.textContent = DAY_NAMES[d];
        hr.appendChild(th);
      }
      thead.appendChild(hr);
      grid.appendChild(thead);
      const tbody = document.createElement('tbody');
      for (let g = 1; g <= 5; g++) {
        const tr = document.createElement('tr');
        const th = document.createElement('th');
        th.textContent = SLOT_GROUP_NAMES[g];
        tr.appendChild(th);
        for (let d = 1; d <= 7; d++) {
          const td = document.createElement('td');
          td.dataset.day = d;
          td.dataset.group = g;
          td.title = DAY_NAMES[d] + ' ' + SLOT_GROUP_NAMES[g];
          td.addEventListener('click', onGridCell);
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      grid.appendChild(tbody);
    })();

    function onGridCell(ev) {
      const td = ev.currentTarget;
      const d = +td.dataset.day;
      const g = +td.dataset.group;
      const covered = state.courses.filter(c => c.day === d && (c.slots || []).indexOf(g) >= 0);
      const isOn = covered.length > 0;
      if (!isOn) {
        state.courses.push({ name: '', day: d, slots: [g], weeks: [[1, 20]], auto: true, src: '网格' });
      } else {
        const onlyAuto = covered.filter(c => c.auto && !c.name && (c.slots || []).length === 1);
        if (onlyAuto.length) {
          state.courses = state.courses.filter(c => c !== onlyAuto[0]);
        } else {
          alert('该时段由课程条目占用，请在下方列表中修改或删除对应条目');
          return;
        }
      }
      renderEntries();
      renderGrid();
      save();
    }

    function renderGrid() {
      overlay.querySelectorAll('#ulph-grid td').forEach(td => {
        const d = +td.dataset.day;
        const g = +td.dataset.group;
        const on = state.courses.some(c => c.day === d && (c.slots || []).indexOf(g) >= 0);
        td.classList.toggle('on', on);
        td.textContent = on ? '✓' : '';
      });
    }

    /* ---------- 条目列表 ---------- */
    function weeksText(weeks) {
      return (weeks || []).map(r => (r[0] === r[1] ? String(r[0]) : r[0] + '-' + r[1])).join(',');
    }

    function renderEntries() {
      const body = $('ulph-entries');
      body.textContent = '';
      if (!state.courses.length) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 6;
        td.className = 'ulph-empty';
        td.textContent = '暂无条目：用上面的方式添加';
        tr.appendChild(td);
        body.appendChild(tr);
        return;
      }
      state.courses.forEach((c, i) => body.appendChild(entryRow(c, i)));
    }

    function entryRow(c, i) {
      const tr = document.createElement('tr');

      const tdName = document.createElement('td');
      const name = document.createElement('input');
      name.type = 'text';
      name.value = c.name || '';
      name.placeholder = '课程名（可空）';
      name.addEventListener('change', () => { c.name = name.value; save(); });
      tdName.appendChild(name);
      tr.appendChild(tdName);

      const tdDay = document.createElement('td');
      const day = document.createElement('select');
      const opt0 = document.createElement('option');
      opt0.value = '';
      opt0.textContent = '未指定';
      day.appendChild(opt0);
      for (let d = 1; d <= 7; d++) {
        const o = document.createElement('option');
        o.value = d;
        o.textContent = DAY_NAMES[d];
        day.appendChild(o);
      }
      day.value = c.day ? String(c.day) : '';
      day.addEventListener('change', () => {
        c.day = day.value ? +day.value : null;
        renderGrid();
        save();
      });
      if (!c.day) day.classList.add('ulph-need');
      tdDay.appendChild(day);
      tr.appendChild(tdDay);

      const tdSlots = document.createElement('td');
      for (let g = 1; g <= 5; g++) {
        const lb = document.createElement('label');
        lb.className = 'ulph-slot-chk';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = (c.slots || []).indexOf(g) >= 0;
        cb.addEventListener('change', () => {
          const s = new Set(c.slots || []);
          if (cb.checked) s.add(g); else s.delete(g);
          c.slots = [...s].sort((a, b) => a - b);
          renderGrid();
          save();
        });
        lb.appendChild(cb);
        lb.appendChild(document.createTextNode(SLOT_GROUP_NAMES[g]));
        tdSlots.appendChild(lb);
      }
      tr.appendChild(tdSlots);

      const tdWeeks = document.createElement('td');
      const weeks = document.createElement('input');
      weeks.type = 'text';
      weeks.className = 'ulph-weeks';
      weeks.value = weeksText(c.weeks);
      weeks.placeholder = '如 1-12 或 6-8,10';
      weeks.addEventListener('change', () => {
        c.weeks = parseWeeksText(weeks.value);
        weeks.value = weeksText(c.weeks);
        save();
      });
      tdWeeks.appendChild(weeks);
      tr.appendChild(tdWeeks);

      const tdSrc = document.createElement('td');
      tdSrc.className = 'ulph-src';
      tdSrc.textContent = c.src || '';
      if (c.raw) tdSrc.title = c.raw;
      tr.appendChild(tdSrc);

      const tdOp = document.createElement('td');
      const del = document.createElement('button');
      del.className = 'ulph-btn ulph-small ulph-danger';
      del.textContent = '删除';
      del.addEventListener('click', () => {
        state.courses.splice(i, 1);
        renderEntries();
        renderGrid();
        save();
      });
      tdOp.appendChild(del);
      tr.appendChild(tdOp);

      return tr;
    }

    $('ulph-add').addEventListener('click', () => {
      state.courses.push({ name: '', day: 1, slots: [1], weeks: [[1, 20]], auto: false, src: '手动' });
      renderEntries();
      renderGrid();
      save();
    });

    /* ---------- 备份 / 恢复 ---------- */
    $('ulph-export').addEventListener('click', () => {
      $('ulph-json').value = JSON.stringify(state, null, 1);
    });
    $('ulph-import').addEventListener('click', () => {
      try {
        const d = JSON.parse($('ulph-json').value);
        if (!d || !Array.isArray(d.courses)) throw new Error('格式不对：缺少 courses 数组');
        state = { version: 1, courses: d.courses };
        renderEntries();
        renderGrid();
        save();
      } catch (e) {
        alert('导入失败：' + e.message);
      }
    });
    $('ulph-wipe').addEventListener('click', () => {
      if (!confirm('确定清空全部课表条目？')) return;
      state = { version: 1, courses: [] };
      renderEntries();
      renderGrid();
      save();
    });

    renderEntries();
    renderGrid();
  }

  /* ================= 5. 实验列表页 ================= */
  function initListPage() {
    if (document.getElementById('ulph-panel')) return; // 防重复注入
    let tries = 0;
    (function wait() {
      const table = document.querySelector('table');
      if (table && table.rows && table.rows.length > 2) {
        buildListEnhancement(table);
      } else if (tries++ < 20) {
        setTimeout(wait, 300);
      }
    })();
  }

  function buildListEnhancement(table) {
    const rowsData = parseRows(table);
    if (!rowsData.length) return;

    const panel = buildPanel(rowsData);
    const host = table.parentNode;
    host.insertBefore(panel.root, table);

    // 节次单元格加人话徽标 + 余量高亮
    for (const r of rowsData) {
      if (r.infoCell && r.slot) {
        const badge = document.createElement('div');
        badge.className = 'ulph-badge';
        badge.textContent = humanizeSlotCode(r.code, r.hours);
        r.infoCell.appendChild(badge);
      }
      if (r.seatsCell && !r.full && r.remaining > 0) {
        if (r.remaining === 1) r.seatsCell.classList.add('ulph-seats-critical');
        else if (r.remaining <= 2) r.seatsCell.classList.add('ulph-seats-low');
      }
    }

    // 添加一键预约按钮 + 必做标记
    for (const r of rowsData) {
      if (r.canReserve && r.opCell) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ulph-quick-reserve';
        btn.textContent = '⚡一键预约';
        btn.addEventListener('click', () => quickReserve(r, btn));
        r.opCell.appendChild(document.createTextNode(' '));
        r.opCell.appendChild(btn);
      }
      if (isMandatoryExperiment(r.name)) {
        r.isMandatory = true;
        if (r.opCell) {
          const badge = document.createElement('span');
          badge.className = 'ulph-mandatory-tag';
          badge.textContent = '必做';
          r.opCell.appendChild(document.createTextNode(' '));
          r.opCell.appendChild(badge);
        }
      }
    }

    // 课表数据
    let courses = store.get(KEY_COURSES, null);
    if (!courses || !Array.isArray(courses.courses)) courses = { version: 1, courses: [] };
    const courseList = courses.courses;

    // 获取已预约实验数据（同源 fetch）后计算所有冲突
    const unwantedSet = loadUnwanted();
    // 加载提示
    const schedEl0 = panel.root.querySelector('#ulph-sched');
    if (schedEl0) schedEl0.textContent = '正在加载已预约数据…';
    fetchReservedExperiments().then(result => {
      const reservedExps = result.exps || [];
      const doneExps = result.doneExps || [];
      const fetchError = result.error;
      const reservedNorms = new Set(reservedExps.map(e => normalizeExpName(e.name)));
      const reservedSlots = new Set(reservedExps.map(e => e.slot.week + '-' + e.slot.day + '-' + e.slot.slotGroup));
      // 已做完实验的归一化名称集合（来自成绩查询页）
      const doneNorms = new Set(doneExps.map(n => normalizeExpName(n)));
      for (const r of rowsData) {
        const rNorm = normalizeExpName(r.name);
        const rSlotKey = r.slot ? (r.slot.week + '-' + r.slot.day + '-' + r.slot.slotGroup) : '';
        if (reservedNorms.has(rNorm) && reservedSlots.has(rSlotKey)) {
          r.isReserved = true;
          r.tr.classList.add('ulph-reserved-row');
        } else if (reservedNorms.has(rNorm)) {
          r.isSameType = true;
          r.tr.classList.add('ulph-dup-row');
        } else if (doneNorms.has(rNorm)) {
          r.isDone = true;
          r.tr.classList.add('ulph-dup-row');
        }
        // 不想选标记
        if (unwantedSet.has(rNorm)) {
          r.isUnwanted = true;
          r.tr.classList.add('ulph-unwanted-row');
        }
        // 不想选按钮
        if (r.opCell) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'ulph-unwanted-btn';
          btn.textContent = r.isUnwanted ? '↩想选' : '🚫不想选';
          btn.addEventListener('click', () => {
            const norm = normalizeExpName(r.name);
            const newState = !unwantedSet.has(norm);
            if (newState) unwantedSet.add(norm); else unwantedSet.delete(norm);
            saveUnwanted(unwantedSet);
            for (const r2 of rowsData) {
              if (normalizeExpName(r2.name) === norm) {
                r2.isUnwanted = newState;
                r2.tr.classList.toggle('ulph-unwanted-row', newState);
                const b2 = r2.tr.querySelector('.ulph-unwanted-btn');
                if (b2) b2.textContent = newState ? '↩想选' : '🚫不想选';
              }
            }
            panel.apply();
          });
          r.opCell.appendChild(document.createTextNode(' '));
          r.opCell.appendChild(btn);
        }
      }

      function refreshConflicts() {
        for (const r of rowsData) {
          r.courseConflicts = findConflicts(r.slot, courseList);
          r.expConflicts = r.isReserved ? [] : findExpConflicts(
            r.slot ? { week: r.slot.week, day: r.slot.day, slotGroup: r.slot.slotGroup, hours: r.hours } : null,
            reservedExps
          );
          r.conflicts = r.courseConflicts.concat(r.expConflicts);
          if (r.infoCell) {
            r.infoCell.querySelectorAll('.ulph-conflict-tip').forEach(x => x.remove());
          }
          r.tr.classList.toggle('ulph-conflict', !!(r.courseConflicts && r.courseConflicts.length));
          r.tr.classList.toggle('ulph-exp-conflict', !!(r.expConflicts && r.expConflicts.length));
          if (r.courseConflicts && r.courseConflicts.length && r.infoCell) {
            const tip = document.createElement('div');
            tip.className = 'ulph-conflict-tip';
            tip.textContent = '与课表冲突：' + r.courseConflicts.join('、');
            r.infoCell.appendChild(tip);
          }
          if (r.expConflicts && r.expConflicts.length && r.infoCell) {
            const tip2 = document.createElement('div');
            tip2.className = 'ulph-conflict-tip ulph-exp-tip';
            tip2.textContent = '与已预约实验冲突：' + r.expConflicts.join('、');
            r.infoCell.appendChild(tip2);
          }
          // 状态徽标：在 opCell 最前面插入
          if (r.opCell) {
            const old = r.tr.querySelector('.ulph-status-tag');
            if (old) old.remove();
            let text, cls;
            if (r.isReserved) { text = '已预约'; cls = 'ulph-status-reserved'; }
            else if (r.isUnwanted) { text = '不想选'; cls = 'ulph-status-unwanted'; }
            else if (r.full) { text = '已满'; cls = 'ulph-status-full'; }
            else if (r.testFailed) { text = '测试未过'; cls = 'ulph-status-full'; }
            else if (r.testNotTaken) { text = '未测试'; cls = 'ulph-status-dup'; }
            else if (r.courseConflicts && r.courseConflicts.length) { text = '课表冲突'; cls = 'ulph-status-conflict'; }
            else if (r.expConflicts && r.expConflicts.length) { text = '实验冲突'; cls = 'ulph-status-exp'; }
            else if (r.isDone) { text = '已做'; cls = 'ulph-status-dup'; }
            else if (r.isSameType) { text = '同类已选'; cls = 'ulph-status-dup'; }
            else if (r.canReserve) { text = '✓可约'; cls = 'ulph-status-ok'; }
            if (text) {
              const badge = document.createElement('span');
              badge.className = 'ulph-status-tag ' + cls;
              badge.textContent = text;
              r.opCell.insertBefore(badge, r.opCell.firstChild);
            }
          }
        }
        const reservedTypes = new Set(reservedExps.map(e => normalizeExpName(e.name)));
        const mandatoryMissing = EXPERIMENT_META.mandatory.filter(k =>
          !reservedExps.some(e => e.name.indexOf(k) >= 0)
        );
        // 交接信息：当前可预约周次（列表场次推导）+ 已预约实验明细（悬停状态栏查看）
        const listWeek = rowsData.reduce((mx, r) => Math.max(mx, r.slot ? r.slot.week : 0), 0) || undefined;
        const reservedDetail = reservedExps.map(e =>
          '- ' + e.name + '：' + humanizeSlotCode(e.slot.week + '-' + e.slot.day + '-' + e.slot.slotGroup, e.hours)
        );
        panel.setScheduleInfo(courseList.length, reservedExps.length, {
          reservedTypes: reservedTypes.size,
          mandatoryMissing: mandatoryMissing,
          fetchError: fetchError,
          listWeek: listWeek,
          reservedDetail: reservedDetail,
          doneCount: doneExps.length
        });
        panel.apply();
      }
      refreshConflictsHook = refreshConflicts;
      refreshConflicts();
    });

    // 恢复上次的筛选条件
    const f = store.get(KEY_FILTERS, null);
    if (f) panel.restore(f);
    panel.apply();
  }

  /* 获取已预约实验列表（同源 fetch myExperiments 页面 + scoreQuery 页面） */
  async function fetchReservedExperiments() {
    try {
      const url = new URL(location.href);
      url.searchParams.set('action', 'myExperiments');
      const resp = await fetch(url.toString(), { credentials: 'same-origin' });
      if (!resp.ok) return { error: 'HTTP ' + resp.status, exps: [], doneExps: [] };
      const html = await resp.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      // 检查是否被重定向到登录页
      if (doc.querySelector('input[name="username"]') || /登录|login/i.test(doc.title || '')) {
        return { error: '会话已过期，请重新登录', exps: [], doneExps: [] };
      }
      const exps = [];
      for (const tr of doc.querySelectorAll('table tr')) {
        const c = tr.cells;
        if (!c || c.length < 4 || c[0].tagName === 'TH') continue;
        for (const td of c) {
          const code = (td.textContent || '').trim();
          const slot = parseSlotCode(code);
          if (slot) {
            const name = (c[0].textContent || '').trim();
            const hoursM = /(\d+)\s*学时/.exec(name);
            exps.push({ name, slot, hours: hoursM ? +hoursM[1] : 2 });
            break;
          }
        }
      }
      // 同时请求成绩查询页，获取已做完的实验（有成绩记录的）
      const doneExps = [];
      try {
        const scoreUrl = new URL(location.href);
        scoreUrl.searchParams.set('action', 'scoreQuery');
        const scoreResp = await fetch(scoreUrl.toString(), { credentials: 'same-origin' });
        if (scoreResp.ok) {
          const scoreHtml = await scoreResp.text();
          const scoreDoc = new DOMParser().parseFromString(scoreHtml, 'text/html');
          if (!scoreDoc.querySelector('input[name="username"]') && !/登录|login/i.test(scoreDoc.title || '')) {
            for (const tr of scoreDoc.querySelectorAll('table tr')) {
              const c = tr.cells;
              if (!c || c.length < 2 || c[0].tagName === 'TH') continue;
              const name = (c[0].textContent || '').trim();
              if (name) doneExps.push(name);
            }
          }
        }
      } catch (e2) { /* scoreQuery 获取失败不影响主流程 */ }
      return { error: null, exps: exps, doneExps: doneExps };
    } catch (e) { return { error: (e.message || e), exps: [], doneExps: [] }; }
  }

  /* 一键预约：fetch POST 不跳页 */
  async function quickReserve(r, btn) {
    const timeStr = humanizeSlotCode(r.code, r.hours);
    if (!confirm('确定预约「' + r.name + '」？\n时间：' + timeStr + '\n地点：' + r.room + '\n教师：' + r.teacher)) return;
    btn.disabled = true;
    btn.textContent = '预约中…';
    try {
      const formData = new FormData();
      formData.append('csrf_token', r.csrfToken);
      formData.append('controller', 'student');
      formData.append('action', 'reserve');
      formData.append('flowNum', r.flowNum);
      const resp = await fetch('index.php', {
        method: 'POST',
        body: formData,
        credentials: 'same-origin',
        redirect: 'follow'
      });
      // 检查响应：成功通常 302 跳转 myExperiments，或返回含"成功"的页面
      const respText = await resp.text().catch(() => '');
      const ok = resp.ok && (
        /myExperiments/i.test(resp.url) ||
        /成功|预约成功|已预约/.test(respText) ||
        !/失败|错误|已满|已预约|未通过|冲突/.test(respText)
      );
      if (!ok) {
        throw new Error('服务器返回异常，可能预约未成功（座位已被抢/CSRF过期/未通过测试）');
      }
      btn.textContent = '✓ 已预约';
      btn.classList.add('ulph-success');
      r.tr.classList.add('ulph-reserved');
      r.tr.classList.remove('ulph-open-row');
      setTimeout(() => location.reload(), 1200);
    } catch (e) {
      btn.disabled = false;
      btn.textContent = '⚡一键预约';
      alert('预约失败：' + (e.message || e) + '\n请手动点击预约按钮。');
    }
  }

  function parseRows(table) {
    const rows = [];
    for (const tr of table.rows) {
      const c = tr.cells;
      if (!c || c.length < 7 || c[0].tagName === 'TH') continue;
      const name = (c[0].textContent || '').trim();
      const room = (c[1].textContent || '').trim();
      const teacher = (c[2].textContent || '').trim();
      const remaining = parseInt((c[3].textContent || '').replace(/[^\d-]/g, ''), 10);
      const code = (c[4].textContent || '').trim();
      const status = (c[5].textContent || '').trim();
      const op = (c[6].textContent || '').trim();
      const hoursM = /(\d+)\s*学时/.exec(name);
      const hours = hoursM ? +hoursM[1] : 2;
      const flowInput = tr.querySelector('input[name="flowNum"]');
      const reserveForm = tr.querySelector('form[action="index.php"]');
      const csrfInput = tr.querySelector('input[name="csrf_token"]');
      const testPassed = status.indexOf('已通过') >= 0;
      const testNotTaken = status.indexOf('未测试') >= 0;
      const testFailed = !testPassed && !testNotTaken && status.length > 0;
      const full = op.indexOf('已满') >= 0 || (!isNaN(remaining) && remaining <= 0);
      rows.push({
        tr: tr,
        infoCell: c[4],
        opCell: c[6],
        seatsCell: c[3],
        name: name,
        room: room,
        teacher: teacher,
        remaining: isNaN(remaining) ? 0 : remaining,
        code: code,
        slot: parseSlotCode(code),
        hours: hours,
        status: status,
        full: full,
        flowNum: flowInput ? flowInput.value : '',
        csrfToken: csrfInput ? csrfInput.value : '',
        reserveForm: reserveForm || null,
        canReserve: !!reserveForm && !full,
        testPassed: testPassed,
        testNotTaken: testNotTaken,
        testFailed: testFailed
      });
    }
    return rows;
  }

  function buildPanel(rowsData) {
    const root = document.createElement('div');
    root.id = 'ulph-panel';
    root.className = 'ulph-panel';
    root.innerHTML =
      '<div class="ulph-head">' +
      '<span class="ulph-title">实验选课助手（油猴版）</span>' +
      '<span class="ulph-stats" id="ulph-stats"></span>' +
      '<button type="button" class="ulph-mini-btn" id="ulph-open-settings">课表设置</button>' +
      '</div>' +
      '<div class="ulph-row">' +
      '<input type="text" id="ulph-kw" class="ulph-input" placeholder="搜索：实验名 / 教师 / 地点">' +
      '<select id="ulph-teacher" class="ulph-input ulph-teacher"><option value="">全部教师</option></select>' +
      '<select id="ulph-sort" class="ulph-input ulph-sort">' +
      '<option value="default">默认排序</option>' +
      '<option value="seats">剩余人数多优先</option>' +
      '</select>' +
      '</div>' +
      '<div class="ulph-row" id="ulph-days"></div>' +
      '<div class="ulph-row" id="ulph-groups"></div>' +
      '<div class="ulph-row">' +
      '<label class="ulph-chk"><input type="checkbox" id="ulph-only-open">仅看可约且无冲突</label>' +
      '<label class="ulph-chk"><input type="checkbox" id="ulph-hide-conflict">隐藏课表冲突</label>' +
      '<label class="ulph-chk"><input type="checkbox" id="ulph-hide-exp-conflict">隐藏实验冲突</label>' +
      '<label class="ulph-chk"><input type="checkbox" id="ulph-hide-full">隐藏已满</label>' +
      '<label class="ulph-chk"><input type="checkbox" id="ulph-only-tested">仅看测试通过</label>' +
      '<label class="ulph-chk"><input type="checkbox" id="ulph-hide-dup" checked>隐藏已选/已做同类</label>' +
      '<label class="ulph-chk"><input type="checkbox" id="ulph-hide-unwanted" checked>隐藏不想选</label>' +
      '<label class="ulph-chk"><input type="checkbox" id="ulph-only-reserved">仅看已选</label>' +
      '<label class="ulph-chk"><input type="checkbox" id="ulph-hide-reserved">隐藏已选</label>' +
      '</div>' +
      '<div class="ulph-row">' +
      '<button type="button" class="ulph-mini-btn" id="ulph-reset">重置筛选</button>' +
      '<button type="button" class="ulph-mini-btn ulph-auto-btn" id="ulph-auto-reserve">🔄自动抢课</button>' +
      '<span class="ulph-auto-status" id="ulph-auto-status"></span>' +
      '</div>' +
      '<div class="ulph-row ulph-sched" id="ulph-sched"></div>';

    const $ = id => root.querySelector('#' + id);
    const kw = $('ulph-kw');
    const sort = $('ulph-sort');
    const onlyOpen = $('ulph-only-open');
    const hideConflict = $('ulph-hide-conflict');
    const hideExpConflict = $('ulph-hide-exp-conflict');
    const hideFull = $('ulph-hide-full');
    const onlyTested = $('ulph-only-tested');
    const hideDup = $('ulph-hide-dup');
    const hideUnwanted = $('ulph-hide-unwanted');
    const onlyReserved = $('ulph-only-reserved');
    const hideReserved = $('ulph-hide-reserved');
    const teacherSel = $('ulph-teacher');
    const autoBtn = $('ulph-auto-reserve');
    const autoStatus = $('ulph-auto-status');
    const daysBox = $('ulph-days');
    const groupsBox = $('ulph-groups');
    const statsEl = $('ulph-stats');
    const schedEl = $('ulph-sched');

    const activeDays = new Set();
    const activeGroups = new Set();

    [1, 2, 3, 4, 5, 6, 7].forEach(d => {
      daysBox.appendChild(chip(DAY_NAMES[d], () => {
        toggleSet(activeDays, d);
        applyAndSave();
      }));
    });
    [1, 2, 3, 4, 5].forEach(g => {
      const b = chip(LAB_GROUP_SHORT[g], () => {
        toggleSet(activeGroups, g);
        applyAndSave();
      });
      b.title = LAB_GROUP_FULL[g] || '';
      groupsBox.appendChild(b);
    });

    function chip(text, onClick) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ulph-chip';
      b.textContent = text;
      b.addEventListener('click', () => { b.classList.toggle('on'); onClick(); });
      return b;
    }
    function toggleSet(set, v) {
      if (set.has(v)) set.delete(v); else set.add(v);
    }

    root.querySelector('#ulph-open-settings').addEventListener('click', openSettingsOverlay);

    root.querySelector('#ulph-reset').addEventListener('click', () => {
      kw.value = '';
      sort.value = 'default';
      onlyOpen.checked = false;
      hideConflict.checked = false;
      hideExpConflict.checked = false;
      hideFull.checked = false;
      onlyTested.checked = false;
      hideDup.checked = true;
      hideUnwanted.checked = true;
      onlyReserved.checked = false;
      hideReserved.checked = false;
      teacherSel.value = '';
      activeDays.clear();
      activeGroups.clear();
      root.querySelectorAll('.ulph-chip.on').forEach(x => x.classList.remove('on'));
      applyAndSave();
    });

    kw.addEventListener('input', applyAndSave);
    sort.addEventListener('change', applyAndSave);
    onlyOpen.addEventListener('change', applyAndSave);
    hideConflict.addEventListener('change', applyAndSave);
    hideExpConflict.addEventListener('change', applyAndSave);
    hideFull.addEventListener('change', applyAndSave);
    onlyTested.addEventListener('change', applyAndSave);
    hideDup.addEventListener('change', applyAndSave);
    hideUnwanted.addEventListener('change', applyAndSave);
    onlyReserved.addEventListener('change', () => { if (onlyReserved.checked) hideReserved.checked = false; applyAndSave(); });
    hideReserved.addEventListener('change', () => { if (hideReserved.checked) onlyReserved.checked = false; applyAndSave(); });
    teacherSel.addEventListener('change', applyAndSave);

    // 填充老师下拉
    const teachers = [...new Set(rowsData.map(r => r.teacher).filter(Boolean))].sort();
    for (const t of teachers) {
      const o = document.createElement('option');
      o.value = t; o.textContent = t;
      teacherSel.appendChild(o);
    }

    // 自动抢课模式
    let autoTimer = null;
    let autoCount = 0;
    autoBtn.addEventListener('click', () => {
      if (autoTimer) {
        clearInterval(autoTimer);
        autoTimer = null;
        autoBtn.textContent = '🔄自动抢课';
        autoBtn.classList.remove('active');
        autoStatus.textContent = '已停止';
        return;
      }
      autoBtn.textContent = '⏹停止抢课';
      autoBtn.classList.add('active');
      autoStatus.textContent = '监控中…';
      autoCount = 0;
      autoTimer = setInterval(() => {
        autoCount++;
        autoStatus.textContent = '第 ' + autoCount + ' 次刷新…';
        // 智能选课优先级：必做未选 > 普通可约，均跳过同类已选/已做/已预约/有冲突
        const candidates = rowsData.filter(r =>
          r.canReserve && !r.full && !(r.conflicts && r.conflicts.length) && !r.isReserved && !r.isSameType && !r.isDone && !r.isUnwanted
        );
        // 优先必做实验
        const target = candidates.find(r => r.isMandatory) || candidates[0];
        if (target) {
          clearInterval(autoTimer);
          autoTimer = null;
          autoStatus.textContent = '发现可约场次' + (target.isMandatory ? '（必做）' : '') + '，正在预约…';
          const btn = target.tr.querySelector('.ulph-quick-reserve');
          if (btn) btn.click();
          else quickReserve(target, { disabled: false, textContent: '', classList: { add: () => {}, remove: () => {} } });
          return;
        }
        location.reload();
      }, 3000);
    });

    let scheduleCount = null;

    function apply() {
      const k = kw.value.trim().toLowerCase();
      const visible = [];
      for (const r of rowsData) {
        let ok = true;
        if (k) {
          ok = r.name.toLowerCase().indexOf(k) >= 0 ||
               r.teacher.toLowerCase().indexOf(k) >= 0 ||
               r.room.toLowerCase().indexOf(k) >= 0 ||
               r.code.toLowerCase().indexOf(k) >= 0;
        }
        if (ok && activeDays.size && r.slot) ok = activeDays.has(r.slot.day);
        if (ok && activeGroups.size && r.slot) {
          ok = slotGroupsFor(r.hours, r.slot.slotGroup).some(g => activeGroups.has(g));
        }
        if (ok && onlyOpen.checked) ok = !r.full && !(r.conflicts && r.conflicts.length);
        if (ok && hideFull.checked) ok = !r.full;
        if (ok && onlyTested.checked) ok = r.testPassed;
        if (ok && hideConflict.checked) ok = !(r.courseConflicts && r.courseConflicts.length);
        if (ok && hideExpConflict.checked) ok = !(r.expConflicts && r.expConflicts.length);
        if (ok && hideDup.checked) ok = !r.isSameType && !r.isDone;
        if (ok && hideUnwanted.checked) ok = !r.isUnwanted;
        if (ok && onlyReserved.checked) ok = !!r.isReserved;
        if (ok && hideReserved.checked) ok = !r.isReserved;
        if (ok && teacherSel.value) ok = r.teacher === teacherSel.value;
        r.tr.style.display = ok ? '' : 'none';
        r.tr.classList.toggle('ulph-open-row', ok && !r.full && !(r.conflicts && r.conflicts.length));
        if (ok) visible.push(r);
      }
      if (sort.value === 'seats') {
        const tb = rowsData[0].tr.parentNode;
        visible.slice().sort((a, b) => b.remaining - a.remaining)
               .forEach(r => tb.appendChild(r.tr));
      }
      const open = rowsData.filter(r => !r.full).length;
      const conflict = rowsData.filter(r => r.conflicts && r.conflicts.length).length;
      const expConflict = rowsData.filter(r => r.expConflicts && r.expConflicts.length).length;
      let s = '共 ' + rowsData.length + ' 场 · 可约 ' + open + ' · 显示 ' + visible.length;
      if (scheduleCount !== null) s += ' · 课表冲突 ' + conflict;
      if (expConflict > 0) s += ' · 实验冲突 ' + expConflict;
      statsEl.textContent = s;
    }

    function applyAndSave() {
      apply();
      store.set(KEY_FILTERS, {
        kw: kw.value,
        sort: sort.value,
        onlyOpen: onlyOpen.checked,
        hideConflict: hideConflict.checked,
        hideExpConflict: hideExpConflict.checked,
        hideFull: hideFull.checked,
        onlyTested: onlyTested.checked,
        hideDup: hideDup.checked,
        hideUnwanted: hideUnwanted.checked,
        onlyReserved: onlyReserved.checked,
        hideReserved: hideReserved.checked,
        teacher: teacherSel.value
      });
    }

    function restore(f) {
      if (typeof f.kw === 'string') kw.value = f.kw;
      if (f.sort) sort.value = f.sort;
      onlyOpen.checked = !!f.onlyOpen;
      hideConflict.checked = !!f.hideConflict;
      hideExpConflict.checked = !!f.hideExpConflict;
      hideFull.checked = !!f.hideFull;
      onlyTested.checked = !!f.onlyTested;
      hideDup.checked = f.hideDup !== undefined ? !!f.hideDup : true;
      hideUnwanted.checked = f.hideUnwanted !== undefined ? !!f.hideUnwanted : true;
      onlyReserved.checked = !!f.onlyReserved;
      hideReserved.checked = !!f.hideReserved;
      if (f.teacher) teacherSel.value = f.teacher;
    }

    function setScheduleInfo(n, reservedN, progress) {
      scheduleCount = n;
      schedEl.classList.remove('ok', 'warn');
      const parts = [];
      // 交接检查①：当前可预约周次（从列表场次代码推导，即只能预约的"下一周"）
      if (progress && progress.listWeek) {
        parts.push('列表场次：第' + progress.listWeek + '周');
      }
      if (progress && progress.fetchError) {
        parts.push('⚠ 获取已预约数据失败：' + progress.fetchError + '（冲突检测/已选标记可能不准确）');
        schedEl.classList.add('warn');
      } else if (n > 0) {
        parts.push('已载入课表（' + n + ' 条）');
      } else {
        parts.push('尚未设置课表');
      }
      // 交接检查②：已预约实验确认（每次打开列表页自动同步"我的实验"页）
      if (progress && progress.fetchError) {
        // 同步失败时不显示数量，避免误导
      } else if (reservedN > 0) {
        parts.push('已预约 ' + reservedN + ' 个实验（自动同步）');
      } else {
        parts.push('已预约 0 个实验（自动同步）');
      }
      // 交接检查②补充：已做完的实验（来自成绩查询页自动同步）
      if (progress && !progress.fetchError && progress.doneCount > 0) {
        parts.push('已做 ' + progress.doneCount + ' 个（自动同步）');
      }
      // 选课进度（来自 PDF 要求：AI需9个 / BI需6个）——仅在数据加载成功时显示
      if (progress && !progress.fetchError) {
        const aiRem = Math.max(0, EXPERIMENT_META.totalAI - reservedN);
        const biRem = Math.max(0, EXPERIMENT_META.totalBI - reservedN);
        parts.push('AI还需' + aiRem + '个 / BI还需' + biRem + '个');
        // 必做实验状态
        if (progress.mandatoryMissing && progress.mandatoryMissing.length) {
          parts.push('⚠必做未选：' + progress.mandatoryMissing.join('、'));
        } else if (reservedN > 0) {
          parts.push('✓必做已选');
        }
      }
      schedEl.textContent = parts.join(' · ') + (n > 0 ? '，冲突场次已标红。' : '，无法做冲突检测——点击右上角「课表设置」导入。');
      // 交接检查②明细：悬停状态栏查看已同步的已预约实验（名称+场次）
      if (progress && progress.reservedDetail && progress.reservedDetail.length) {
        schedEl.title = '已自动同步「我的实验」页数据：\n' + progress.reservedDetail.join('\n') + '\n（每次打开列表页自动重新同步）';
      } else {
        schedEl.title = '';
      }
      schedEl.classList.toggle('ok', n > 0);
      schedEl.classList.toggle('warn', n === 0);
      apply();
    }

    return { root: root, apply: apply, restore: restore, setScheduleInfo: setScheduleInfo };
  }

  /* ================= 6. 我的实验页 ================= */
  function initMyExperimentsPage() {
    for (const tr of document.querySelectorAll('table tr')) {
      const c = tr.cells;
      if (!c || c.length < 4 || c[0].tagName === 'TH') continue;
      for (const td of c) {
        if (td.querySelector('.ulph-badge')) continue; // 防重复
        const code = (td.textContent || '').trim();
        const p = parseSlotCode(code);
        if (p) {
          const name = (c[0].textContent || '').trim();
          const hoursM = /(\d+)\s*学时/.exec(name);
          const div = document.createElement('div');
          div.className = 'ulph-badge';
          div.textContent = humanizeSlotCode(code, hoursM ? +hoursM[1] : 2);
          td.appendChild(div);
          break;
        }
      }
    }
  }

  /* ================= 入口 ================= */
  injectStyle();

  try {
    if (typeof GM_registerMenuCommand === 'function') {
      GM_registerMenuCommand('打开课表设置', openSettingsOverlay);
    }
  } catch (e) { /* 忽略 */ }

  const qs = new URLSearchParams(location.search);
  const action = qs.get('action') || '';
  const controller = qs.get('controller') || '';

  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  /* ---- 诊断横幅：在页面顶部显示脚本运行状态 ---- */
  const diagLogs = [];
  function diag(msg) {
    diagLogs.push(msg);
    updateDiagBanner();
  }
  function updateDiagBanner() {
    let b = document.getElementById('ulph-diag');
    if (!b) {
      b = document.createElement('div');
      b.id = 'ulph-diag';
      b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:999999;background:#1a1a2e;color:#0f0;font:12px/1.5 monospace;padding:6px 10px;white-space:pre-wrap;max-height:200px;overflow:auto;border-bottom:2px solid #0f0;';
      document.body.appendChild(b);
    }
    b.textContent = '【实验选课助手 v1.6.3 诊断】\n' + diagLogs.join('\n');
  }
  diag('脚本已加载 @ ' + location.href);
  diag('URL参数: controller=' + controller + ' action=' + action);
  diag('readyState=' + document.readyState);

  // 检查 iframe
  const iframes = document.querySelectorAll('iframe');
  if (iframes.length > 0) {
    diag('⚠️ 页面有 ' + iframes.length + ' 个 iframe，表格可能在 iframe 内（脚本无法访问跨域 iframe）');
    for (let i = 0; i < iframes.length; i++) {
      diag('  iframe[' + i + ']: src=' + (iframes[i].src || '(空)'));
    }
  }

  // 检查所有 table
  function scanTables() {
    const tables = document.querySelectorAll('table');
    diag('页面 table 数量: ' + tables.length);
    for (let i = 0; i < Math.min(tables.length, 5); i++) {
      const t = tables[i];
      const rc = t.rows ? t.rows.length : 0;
      let hdr = '';
      if (rc > 0 && t.rows[0].cells) {
        hdr = Array.from(t.rows[0].cells).map(c => (c.textContent || '').trim()).join(' | ');
      }
      diag('  table[' + i + ']: ' + rc + '行, 表头: ' + hdr.substring(0, 120));
    }
    return tables;
  }

  // 带诊断的 initListPage
  function initListPageDiag() {
    diag('→ initListPage() 开始');
    if (document.getElementById('ulph-panel')) {
      diag('  面板已存在，跳过');
      return;
    }
    let tries = 0;
    (function wait() {
      const tables = scanTables();
      // 找到有内容的表格（>2行）
      let targetTable = null;
      for (const t of tables) {
        if (t.rows && t.rows.length > 2) {
          targetTable = t;
          break;
        }
      }
      if (targetTable) {
        diag('  ✓ 找到目标表格: ' + targetTable.rows.length + '行');
        try {
          const rowsData = parseRows(targetTable);
          diag('  parseRows 返回: ' + rowsData.length + '条数据');
          if (rowsData.length === 0) {
            diag('  ⚠️ parseRows 返回空！表格结构可能不匹配（需要≥7列，首列非TH）');
            // 显示第一行详细信息
            if (targetTable.rows[0]) {
              const c = targetTable.rows[0].cells;
              diag('  首行列数: ' + c.length + ', 首格tagName: ' + (c[0] ? c[0].tagName : '?'));
            }
            if (targetTable.rows[1]) {
              const c = targetTable.rows[1].cells;
              diag('  第二行列数: ' + c.length + ', 内容: ' + Array.from(c).map(x => (x.textContent||'').trim()).join(' | ').substring(0, 150));
            }
          }
          buildListEnhancement(targetTable);
          diag('  ✓ buildListEnhancement 完成');
        } catch (e) {
          diag('  ❌ 错误: ' + e.message + '\n  ' + (e.stack || '').substring(0, 200));
        }
      } else if (tries++ < 30) {
        if (tries === 1) diag('  等待表格加载…');
        setTimeout(wait, 300);
      } else {
        diag('  ❌ 30次重试后仍未找到表格');
      }
    })();
  }

  // 带诊断的 initMyExperimentsPage
  function initMyExperimentsPageDiag() {
    diag('→ initMyExperimentsPage() 开始');
    try {
      initMyExperimentsPage();
      diag('  ✓ initMyExperimentsPage 完成');
    } catch (e) {
      diag('  ❌ 错误: ' + e.message);
    }
  }

  // 页面检测：优先用 URL 参数；WebVPN 改写 URL 时降级为内容检测
  if (controller === 'student' && action === 'experimentList') {
    diag('✓ URL参数匹配 experimentList，调用 initListPage');
    onReady(() => initListPageDiag());
  } else if (controller === 'student' && action === 'myExperiments') {
    diag('✓ URL参数匹配 myExperiments');
    onReady(() => initMyExperimentsPageDiag());
  } else {
    diag('URL参数不匹配，尝试内容检测');
    onReady(() => {
      let dTries = 0;
      (function tryDetect() {
        const tables = scanTables();
        for (const tbl of tables) {
          if (tbl.rows && tbl.rows.length > 0) {
            const hdr = Array.from(tbl.rows[0].cells).map(c => (c.textContent || '').trim()).join('|');
            if (hdr.includes('剩余人数') && hdr.includes('实验节次')) {
              diag('✓ 内容检测: 实验列表页');
              initListPageDiag();
              return;
            }
            if (hdr.includes('实验名称') && hdr.includes('状态') && !hdr.includes('剩余人数')) {
              diag('✓ 内容检测: 我的实验页');
              initMyExperimentsPageDiag();
              return;
            }
          }
        }
        if (dTries++ < 20) setTimeout(tryDetect, 300);
        else diag('❌ 内容检测20次重试后仍未识别页面类型');
      })();
    });
  }
})();
