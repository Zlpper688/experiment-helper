/* pdf-extract.js — 课表 PDF 直接解析（浏览器版，算法经 Node + 真实课表 PDF 回归：23/23 条全对）
 * 依赖：<script src="vendor/pdf.min.js">（pdfjsLib）与 shared.js（parseScheduleText）先加载。
 *
 * 算法（与真实课表结构对应）：
 *  1. getTextContent -> viewport 坐标（页面自带 /Rotate 已折算，vy 自上而下）；
 *  2. 表头页识别「星期一~日」横向分布 -> 得到各星期列边界；跨页大表（续页无表头）继承该边界；
 *  3. 单元格内按 vy 分行、行内按 vx 排序重建文本；把紧邻标记行上方的纯名字行并入标记行
 *     （修复课程名跨行折行截断，如「大学生职业发展与就业/指导Ⅱ」）；
 *  4. 每列 chunk 交给 parseScheduleText，星期强制取列号；最后按「名字+星期+节组+周次」去重。
 */
'use strict';

const PDFX_DAY_RE = /^(?:星期|周)([一二三四五六日天])$/;
const PDFX_DAY_NUM = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7 };
/* 纯名字行：只含中文/字母/数字/罗马数字/全角括号/连接符，且至少一个中文或字母 */
const PDFX_NAME_LINE_RE = /^(?=[\u4e00-\u9fa5A-Za-z0-9ⅠⅡⅢⅣ（）·、\-—－]+$)[\u4e00-\u9fa5A-Za-z0-9ⅠⅡⅢⅣ（）·、\-—－]*[\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z0-9ⅠⅡⅢⅣ（）·、\-—－]*$/;
const PDFX_MARK_START_RE = /^\s*[(（]\s*\d+\s*[-–—]\s*\d+\s*节/;

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

/* 主入口：data 为 ArrayBuffer/TypedArray；返回 {pages, text, entries} */
async function extractScheduleFromPdf(data) {
  if (typeof pdfjsLib === 'undefined') {
    throw new Error('pdf.js 未加载（缺少 vendor/pdf.min.js）');
  }
  if (typeof parseScheduleText !== 'function') {
    throw new Error('parseScheduleText 未加载（缺少 shared.js）');
  }
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('vendor/pdf.worker.min.js', location.href).href;
  const doc = await pdfjsLib.getDocument({
    data: data instanceof Uint8Array ? data : new Uint8Array(data),
    cMapUrl: new URL('vendor/cmaps/', location.href).href,
    cMapPacked: true
  }).promise;

  const allTextLines = [];
  const pageData = []; /* {items:[{vx,vy,w,s}], header:{vy,bounds[],days[]} | null} */
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
    /* 列模式：按列×页分桶，续页继承最近表头页的列边界 */
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
