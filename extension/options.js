/* options.js — 课表设置页逻辑（无内联脚本，符合 MV3 CSP） */
(function () {
  'use strict';

  const KEY = 'labHelperCourses';
  let state = { version: 1, courses: [] };

  const $ = id => document.getElementById(id);
  const entriesBody = $('entries-body');
  const saveMsg = $('save-msg');

  init();

  function init() {
    buildGrid();
    chrome.storage.local.get([KEY], res => {
      const d = res && res[KEY];
      if (d && Array.isArray(d.courses)) state = d;
      renderEntries();
      renderGrid();
    });
    wire();
  }

  function wire() {
    $('btn-parse').addEventListener('click', doParse);
    $('btn-clear-paste').addEventListener('click', () => { $('paste-box').value = ''; $('parse-msg').textContent = ''; });
    $('pdf-file').addEventListener('change', doPdfFile);
    $('pdf-file').addEventListener('change', doPdfFile);
    $('btn-add').addEventListener('click', () => {
      state.courses.push({ name: '', day: 1, slots: [1], weeks: [[1, 20]], auto: false, src: '手动' });
      renderEntries();
      renderGrid();
      save();
    });
    $('btn-export').addEventListener('click', () => {
      $('json-box').value = JSON.stringify(state, null, 1);
    });
    $('btn-import').addEventListener('click', () => {
      try {
        const d = JSON.parse($('json-box').value);
        if (!d || !Array.isArray(d.courses)) throw new Error('格式不对：缺少 courses 数组');
        state = { version: 1, courses: d.courses };
        renderEntries();
        renderGrid();
        save();
      } catch (e) {
        alert('导入失败：' + e.message);
      }
    });
    $('btn-wipe').addEventListener('click', () => {
      if (!confirm('确定清空全部课表条目？')) return;
      state = { version: 1, courses: [] };
      renderEntries();
      renderGrid();
      save();
    });
  }

  /* ---------- PDF 文件上传解析 ---------- */
  async function doPdfFile(ev) {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = ''; /* 允许再次选择同一文件 */
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      $('pdf-msg').textContent = '请选择 PDF 文件';
      return;
    }
    $('pdf-msg').textContent = '解析中…';
    try {
      const buf = await file.arrayBuffer();
      const res = await extractScheduleFromPdf(buf);
      if (!res.entries.length) {
        $('pdf-msg').textContent = '没有解析出课程条目，请确认这是课表 PDF（或改用方式二粘贴文字）';
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
      $('pdf-msg').textContent = '已从「' + file.name + '」解析出 ' + res.entries.length + ' 条（共 ' + res.pages + ' 页，星期自动识别）';
    } catch (e) {
      $('pdf-msg').textContent = '解析失败：' + (e && e.message ? e.message : e);
    }
  }

  /* ---------- 粘贴解析 ---------- */
  function doParse() {
    const text = $('paste-box').value;
    if (!text.trim()) { $('parse-msg').textContent = '请先粘贴课表文字'; return; }
    const items = parseScheduleText(text);
    if (!items.length) {
      $('parse-msg').textContent = '没有解析出课程条目，请确认粘贴的是课表 PDF 的文字';
      return;
    }
    let added = 0;
    for (const it of items) {
      state.courses.push({
        name: it.name, day: null, slots: it.slots, slotSpan: it.slotSpan || null, weeks: it.weeks,
        auto: false, src: '粘贴', raw: it.raw || ''
      });
      added++;
    }
    renderEntries();
    renderGrid();
    save();
    $('parse-msg').textContent = '解析出 ' + added + ' 条，请在下方列表为每条补选「星期」';
    $('paste-box').value = '';
  }

  /* ---------- 周网格 ---------- */
  function buildGrid() {
    const grid = $('grid');
    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    hr.appendChild(document.createElement('th')).textContent = '节组\\星期';
    for (let d = 1; d <= 7; d++) hr.appendChild(document.createElement('th')).textContent = DAY_NAMES[d];
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
  }

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
    document.querySelectorAll('#grid td').forEach(td => {
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
    entriesBody.textContent = '';
    if (!state.courses.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 6;
      td.className = 'empty';
      td.textContent = '暂无条目：用上面的方式添加';
      tr.appendChild(td);
      entriesBody.appendChild(tr);
      return;
    }
    state.courses.forEach((c, i) => {
      entriesBody.appendChild(entryRow(c, i));
    });
  }

  function entryRow(c, i) {
    const tr = document.createElement('tr');

    // 课程名
    const tdName = document.createElement('td');
    const name = document.createElement('input');
    name.type = 'text';
    name.value = c.name || '';
    name.placeholder = '课程名（可空）';
    name.addEventListener('change', () => { c.name = name.value; save(); });
    tdName.appendChild(name);
    tr.appendChild(tdName);

    // 星期
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
    if (!c.day) day.classList.add('need');
    tdDay.appendChild(day);
    tr.appendChild(tdDay);

    // 节组（多选框）
    const tdSlots = document.createElement('td');
    for (let g = 1; g <= 5; g++) {
      const lb = document.createElement('label');
      lb.className = 'slot-chk';
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

    // 周次
    const tdWeeks = document.createElement('td');
    const weeks = document.createElement('input');
    weeks.type = 'text';
    weeks.className = 'weeks';
    weeks.value = weeksText(c.weeks);
    weeks.placeholder = '如 1-12 或 6-8,10';
    weeks.addEventListener('change', () => {
      c.weeks = parseWeeksText(weeks.value);
      weeks.value = weeksText(c.weeks);
      save();
    });
    tdWeeks.appendChild(weeks);
    tr.appendChild(tdWeeks);

    // 来源
    const tdSrc = document.createElement('td');
    tdSrc.className = 'src';
    tdSrc.textContent = c.src || '';
    if (c.raw) tdSrc.title = c.raw;
    tr.appendChild(tdSrc);

    // 删除
    const tdOp = document.createElement('td');
    const del = document.createElement('button');
    del.className = 'btn small danger';
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

  /* ---------- 保存 ---------- */
  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      chrome.storage.local.set({ [KEY]: state }, () => {
        const err = chrome.runtime.lastError;
        saveMsg.textContent = err ? '保存失败：' + err.message : '已保存 ✓';
        setTimeout(() => { saveMsg.textContent = ''; }, 1800);
      });
    }, 250);
  }
})();
