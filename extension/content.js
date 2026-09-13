/* content.js — 注入 experimentList / myExperiments 页面
 * 筛选增强 + 课表/实验间冲突检测 + 一键预约 + 自动抢课
 */
(function () {
  'use strict';

  const qs = new URLSearchParams(location.search);
  const action = qs.get('action') || '';
  const controller = qs.get('controller') || '';

  // 页面检测：优先用 URL 参数；WebVPN 改写 URL 时降级为内容检测
  if (controller === 'student' && action === 'experimentList') {
    onReady(() => initListPage());
  } else if (controller === 'student' && action === 'myExperiments') {
    onReady(() => initMyExperimentsPage());
  } else {
    // WebVPN 等 URL 被改写的情况：通过表格表头内容判断页面类型
    onReady(() => {
      let dTries = 0;
      (function tryDetect() {
        const tbl = document.querySelector('table');
        if (tbl && tbl.rows && tbl.rows.length > 0) {
          const hdr = Array.from(tbl.rows[0].cells).map(c => (c.textContent || '').trim()).join('|');
          if (hdr.includes('剩余人数') && hdr.includes('实验节次')) { initListPage(); return; }
          if (hdr.includes('实验名称') && hdr.includes('状态') && !hdr.includes('剩余人数')) { initMyExperimentsPage(); return; }
        }
        if (dTries++ < 20) setTimeout(tryDetect, 300);
      })();
    });
  }

  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  /* ---------------- 通用：读取课表 ---------------- */
  function loadCourses(cb) {
    try {
      chrome.storage.local.get(['labHelperCourses'], res => {
        const data = res && res.labHelperCourses;
        cb((data && Array.isArray(data.courses)) ? data.courses : []);
      });
    } catch (e) {
      cb([]);
    }
  }

  /* ---------------- 通用：不想选列表 ---------------- */
  function loadUnwanted(cb) {
    try {
      chrome.storage.local.get(['labHelperUnwanted'], res => {
        const arr = res && res.labHelperUnwanted;
        cb(new Set(Array.isArray(arr) ? arr : []));
      });
    } catch (e) {
      cb(new Set());
    }
  }

  function saveUnwanted(set) {
    try {
      chrome.storage.local.set({ labHelperUnwanted: [...set] });
    } catch (e) { /* 忽略 */ }
  }

  /* ================= 实验列表页 ================= */
  function initListPage() {
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

    // 面板插到表格前面（同一父节点，尽量贴着表格）
    const host = table.parentNode;
    host.insertBefore(panel.root, table);

    // 给节次单元格加人话徽标
    for (const r of rowsData) {
      if (r.infoCell && r.slot) {
        const badge = document.createElement('div');
        badge.className = 'lph-badge';
        badge.textContent = humanizeSlotCode(r.code, r.hours);
        r.infoCell.appendChild(badge);
      }
      // 余量高亮
      if (r.seatsCell && !r.full && r.remaining > 0) {
        if (r.remaining === 1) r.seatsCell.classList.add('lph-seats-critical');
        else if (r.remaining <= 2) r.seatsCell.classList.add('lph-seats-low');
      }
    }

    // 添加一键预约按钮 + 必做标记
    for (const r of rowsData) {
      if (r.canReserve && r.opCell) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'lph-quick-reserve';
        btn.textContent = '⚡一键预约';
        btn.addEventListener('click', () => quickReserve(r, btn));
        r.opCell.appendChild(document.createTextNode(' '));
        r.opCell.appendChild(btn);
      }
      // 必做实验标记
      if (isMandatoryExperiment(r.name)) {
        r.isMandatory = true;
        if (r.opCell) {
          const badge = document.createElement('span');
          badge.className = 'lph-mandatory-tag';
          badge.textContent = '必做';
          r.opCell.appendChild(document.createTextNode(' '));
          r.opCell.appendChild(badge);
        }
      }
    }

    // 加载不想选列表 + 已预约实验数据
    loadUnwanted(unwantedSet => {
      // 加载提示
      const schedEl0 = panel.root.querySelector('#lph-sched');
      if (schedEl0) schedEl0.textContent = '正在加载已预约数据…';
      fetchReservedExperiments().then(result => {
        const reservedExps = result.exps || [];
        const fetchError = result.error;
        // 已预约实验的归一化名称集合 + 精确 slot 集合
        const reservedNorms = new Set(reservedExps.map(e => normalizeExpName(e.name)));
        const reservedSlots = new Set(reservedExps.map(e => e.slot.week + '-' + e.slot.day + '-' + e.slot.slotGroup));
        for (const r of rowsData) {
          const rNorm = normalizeExpName(r.name);
          const rSlotKey = r.slot ? (r.slot.week + '-' + r.slot.day + '-' + r.slot.slotGroup) : '';
          // 精确匹配：同一实验同一时间段 = 已预约的那一行
          if (reservedNorms.has(rNorm) && reservedSlots.has(rSlotKey)) {
            r.isReserved = true;
            r.tr.classList.add('lph-reserved-row');
          }
          // 同类匹配：同名但不同时间段 = 选过不用再选
          else if (reservedNorms.has(rNorm)) {
            r.isSameType = true;
            r.tr.classList.add('lph-dup-row');
          }
          // 不想选标记
          if (unwantedSet.has(rNorm)) {
            r.isUnwanted = true;
            r.tr.classList.add('lph-unwanted-row');
          }
          // 不想选按钮
          if (r.opCell) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'lph-unwanted-btn';
            btn.textContent = r.isUnwanted ? '↩想选' : '🚫不想选';
            btn.addEventListener('click', () => {
              const norm = normalizeExpName(r.name);
              const newState = !unwantedSet.has(norm);
              if (newState) unwantedSet.add(norm); else unwantedSet.delete(norm);
              saveUnwanted(unwantedSet);
              // 更新所有同类行
              for (const r2 of rowsData) {
                if (normalizeExpName(r2.name) === norm) {
                  r2.isUnwanted = newState;
                  r2.tr.classList.toggle('lph-unwanted-row', newState);
                  const b2 = r2.tr.querySelector('.lph-unwanted-btn');
                  if (b2) b2.textContent = newState ? '↩想选' : '🚫不想选';
                }
              }
              panel.apply();
            });
            r.opCell.appendChild(document.createTextNode(' '));
            r.opCell.appendChild(btn);
          }
        }

        // 课表冲突 + 实验间冲突
        loadCourses(courses => {
          for (const r of rowsData) {
            r.courseConflicts = findConflicts(r.slot, courses);
            r.expConflicts = r.isReserved ? [] : findExpConflicts(
              r.slot ? { week: r.slot.week, day: r.slot.day, slotGroup: r.slot.slotGroup, hours: r.hours } : null,
              reservedExps
            );
            r.conflicts = r.courseConflicts.concat(r.expConflicts);
            if (r.conflicts.length && r.tr) {
              r.tr.classList.add('lph-conflict');
              if (r.expConflicts.length) r.tr.classList.add('lph-exp-conflict');
              if (r.infoCell) {
                r.infoCell.querySelectorAll('.lph-conflict-tip').forEach(x => x.remove());
                if (r.courseConflicts.length) {
                  const tip = document.createElement('div');
                  tip.className = 'lph-conflict-tip';
                  tip.textContent = '与课表冲突：' + r.courseConflicts.join('、');
                  r.infoCell.appendChild(tip);
                }
                if (r.expConflicts.length) {
                  const tip2 = document.createElement('div');
                  tip2.className = 'lph-conflict-tip lph-exp-tip';
                  tip2.textContent = '与已预约实验冲突：' + r.expConflicts.join('、');
                  r.infoCell.appendChild(tip2);
                }
              }
            }
            // 状态徽标：在 opCell 最前面插入
            if (r.opCell && !r.tr.querySelector('.lph-status-tag')) {
              let text, cls;
              if (r.isReserved) { text = '已预约'; cls = 'lph-status-reserved'; }
              else if (r.isUnwanted) { text = '不想选'; cls = 'lph-status-unwanted'; }
              else if (r.full) { text = '已满'; cls = 'lph-status-full'; }
              else if (r.testFailed) { text = '测试未过'; cls = 'lph-status-full'; }
              else if (r.testNotTaken) { text = '未测试'; cls = 'lph-status-dup'; }
              else if (r.courseConflicts && r.courseConflicts.length) { text = '课表冲突'; cls = 'lph-status-conflict'; }
              else if (r.expConflicts && r.expConflicts.length) { text = '实验冲突'; cls = 'lph-status-exp'; }
              else if (r.isSameType) { text = '同类已选'; cls = 'lph-status-dup'; }
              else if (r.canReserve) { text = '✓可约'; cls = 'lph-status-ok'; }
              if (text) {
                const badge = document.createElement('span');
                badge.className = 'lph-status-tag ' + cls;
                badge.textContent = text;
                r.opCell.insertBefore(badge, r.opCell.firstChild);
              }
            }
          }
          // 计算选课进度
          const reservedTypes = new Set(reservedExps.map(e => normalizeExpName(e.name)));
          const mandatoryMissing = EXPERIMENT_META.mandatory.filter(k =>
            !reservedExps.some(e => e.name.indexOf(k) >= 0)
          );
          // 交接信息：当前可预约周次（列表场次推导）+ 已预约实验明细（悬停状态栏查看）
          const listWeek = rowsData.reduce((mx, r) => Math.max(mx, r.slot ? r.slot.week : 0), 0) || undefined;
          const reservedDetail = reservedExps.map(e =>
            '- ' + e.name + '：' + humanizeSlotCode(e.slot.week + '-' + e.slot.day + '-' + e.slot.slotGroup, e.hours)
          );
          panel.setScheduleInfo(courses.length, reservedExps.length, {
            reservedTypes: reservedTypes.size,
            mandatoryMissing: mandatoryMissing,
            fetchError: fetchError,
            listWeek: listWeek,
            reservedDetail: reservedDetail
          });
          panel.apply();
        });
      });
    });

    // 恢复上次的筛选条件
    try {
      chrome.storage.local.get(['labHelperFilters'], res => {
        const f = res && res.labHelperFilters;
        if (f) panel.restore(f);
        panel.apply();
      });
    } catch (e) { /* 忽略 */ }
  }

  /* 获取已预约实验列表（同源 fetch myExperiments 页面） */
  async function fetchReservedExperiments() {
    try {
      const url = new URL(location.href);
      url.searchParams.set('action', 'myExperiments');
      const resp = await fetch(url.toString(), { credentials: 'same-origin' });
      if (!resp.ok) return { error: 'HTTP ' + resp.status, exps: [] };
      const html = await resp.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      // 检查是否被重定向到登录页
      if (doc.querySelector('input[name="username"]') || /登录|login/i.test(doc.title || '')) {
        return { error: '会话已过期，请重新登录', exps: [] };
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
      return { error: null, exps: exps };
    } catch (e) { return { error: (e.message || e), exps: [] }; }
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
      // 网站 POST 后通常重定向（302），fetch redirect:follow 自动跟随
      btn.textContent = '✓ 已预约';
      btn.classList.add('lph-success');
      r.tr.classList.add('lph-reserved');
      r.tr.classList.remove('lph-open-row');
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
    root.className = 'lph-panel';
    root.innerHTML =
      '<div class="lph-head">' +
      '<span class="lph-title">实验选课助手</span>' +
      '<span class="lph-stats" id="lph-stats"></span>' +
      '<button type="button" class="lph-mini-btn" id="lph-open-options">课表设置</button>' +
      '</div>' +
      '<div class="lph-row">' +
      '<input type="text" id="lph-kw" class="lph-input" placeholder="搜索：实验名 / 教师 / 地点">' +
      '<select id="lph-teacher" class="lph-input lph-teacher"><option value="">全部教师</option></select>' +
      '<select id="lph-sort" class="lph-input lph-sort">' +
      '<option value="default">默认排序</option>' +
      '<option value="seats">剩余人数多优先</option>' +
      '</select>' +
      '</div>' +
      '<div class="lph-row" id="lph-days"></div>' +
      '<div class="lph-row" id="lph-groups"></div>' +
      '<div class="lph-row">' +
      '<label class="lph-chk"><input type="checkbox" id="lph-only-open">仅看可约且无冲突</label>' +
      '<label class="lph-chk"><input type="checkbox" id="lph-hide-conflict">隐藏课表冲突</label>' +
      '<label class="lph-chk"><input type="checkbox" id="lph-hide-exp-conflict">隐藏实验冲突</label>' +
      '<label class="lph-chk"><input type="checkbox" id="lph-hide-full">隐藏已满</label>' +
      '<label class="lph-chk"><input type="checkbox" id="lph-only-tested">仅看测试通过</label>' +
      '<label class="lph-chk"><input type="checkbox" id="lph-hide-dup" checked>隐藏已选同类</label>' +
      '<label class="lph-chk"><input type="checkbox" id="lph-hide-unwanted" checked>隐藏不想选</label>' +
      '<label class="lph-chk"><input type="checkbox" id="lph-only-reserved">仅看已选</label>' +
      '<label class="lph-chk"><input type="checkbox" id="lph-hide-reserved">隐藏已选</label>' +
       '</div>' +
      '<div class="lph-row">' +
      '<button type="button" class="lph-mini-btn" id="lph-reset">重置筛选</button>' +
      '<button type="button" class="lph-mini-btn lph-auto-btn" id="lph-auto-reserve">🔄自动抢课</button>' +
      '<span class="lph-auto-status" id="lph-auto-status"></span>' +
      '</div>' +
      '<div class="lph-row lph-sched" id="lph-sched"></div>';

    const $ = id => root.querySelector('#' + id);
    const kw = $('lph-kw');
    const sort = $('lph-sort');
    const onlyOpen = $('lph-only-open');
    const hideConflict = $('lph-hide-conflict');
    const hideExpConflict = $('lph-hide-exp-conflict');
    const hideFull = $('lph-hide-full');
    const onlyTested = $('lph-only-tested');
    const hideDup = $('lph-hide-dup');
    const hideUnwanted = $('lph-hide-unwanted');
    const onlyReserved = $('lph-only-reserved');
    const hideReserved = $('lph-hide-reserved');
    const teacherSel = $('lph-teacher');
    const autoBtn = $('lph-auto-reserve');
    const autoStatus = $('lph-auto-status');
    const daysBox = $('lph-days');
    const groupsBox = $('lph-groups');
    const statsEl = $('lph-stats');
    const schedEl = $('lph-sched');

    const activeDays = new Set();
    const activeGroups = new Set();

    // 星期与节组的可点选 chip
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

    // 教师下拉：从数据中收集唯一教师名
    const teachers = [...new Set(rowsData.map(r => r.teacher).filter(Boolean))].sort();
    for (const t of teachers) {
      const o = document.createElement('option');
      o.value = t;
      o.textContent = t;
      teacherSel.appendChild(o);
    }

    function chip(text, onClick) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'lph-chip';
      b.textContent = text;
      b.addEventListener('click', () => { b.classList.toggle('on'); onClick(); });
      return b;
    }
    function toggleSet(set, v) {
      if (set.has(v)) set.delete(v); else set.add(v);
    }

    // 课表设置入口
    root.querySelector('#lph-open-options').addEventListener('click', () => {
      try { chrome.runtime.openOptionsPage(); } catch (e) { /* 忽略 */ }
    });

    // 重置
    root.querySelector('#lph-reset').addEventListener('click', () => {
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
      root.querySelectorAll('.lph-chip.on').forEach(x => x.classList.remove('on'));
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
        // 智能选课优先级：必做未选 > 普通可约，均跳过同类已选/已预约/有冲突
        const candidates = rowsData.filter(r =>
          r.canReserve && !r.full && !(r.conflicts && r.conflicts.length) && !r.isReserved && !r.isSameType && !r.isUnwanted
        );
        // 优先必做实验
        const target = candidates.find(r => r.isMandatory) || candidates[0];
        if (target) {
          clearInterval(autoTimer);
          autoTimer = null;
          autoStatus.textContent = '发现可约场次' + (target.isMandatory ? '（必做）' : '') + '，正在预约…';
          const btn = target.tr.querySelector('.lph-quick-reserve');
          if (btn) btn.click();
          else quickReserve(target, { disabled: false, textContent: '', classList: { add: () => {}, remove: () => {} } });
          return;
        }
        // 刷新页面获取最新数据
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
        if (ok && hideDup.checked) ok = !r.isSameType;
        if (ok && hideUnwanted.checked) ok = !r.isUnwanted;
        if (ok && onlyReserved.checked) ok = !!r.isReserved;
        if (ok && hideReserved.checked) ok = !r.isReserved;
        if (ok && teacherSel.value) ok = r.teacher === teacherSel.value;
        r.tr.style.display = ok ? '' : 'none';
        r.tr.classList.toggle('lph-open-row', ok && !r.full && !(r.conflicts && r.conflicts.length));
        if (ok) visible.push(r);
      }
      // 排序：把数据行按剩余人数降序重新 append（表头不受影响）
      if (sort.value === 'seats') {
        const tb = rowsData[0].tr.parentNode;
        visible.slice().sort((a, b) => b.remaining - a.remaining)
               .forEach(r => tb.appendChild(r.tr));
      }
      // 统计
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
      try {
        chrome.storage.local.set({
          labHelperFilters: {
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
          }
        });
      } catch (e) { /* 忽略 */ }
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

  /* ================= 我的实验页 ================= */
  function initMyExperimentsPage() {
    for (const tr of document.querySelectorAll('table tr')) {
      const c = tr.cells;
      if (!c || c.length < 4 || c[0].tagName === 'TH') continue;
      for (const td of c) {
        const code = (td.textContent || '').trim();
        const p = parseSlotCode(code);
        if (p) {
          const name = (c[0].textContent || '').trim();
          const hoursM = /(\d+)\s*学时/.exec(name);
          const div = document.createElement('div');
          div.className = 'lph-badge';
          div.textContent = humanizeSlotCode(code, hoursM ? +hoursM[1] : 2);
          td.appendChild(div);
          break;
        }
      }
    }
  }
})();
