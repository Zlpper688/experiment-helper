# 网站业务逻辑与代码完整分析报告

> 生成时间：2026-09-12  
> 目标网站：`https://wlsy.webvpn.sau.edu.cn/lab2026/index.php`  
> 学生：翟宏鹏（学号：[学号已隐去]，班级：计科2502，课程：物理实验B）

---

## 一、网站技术架构总览

| 维度 | 说明 |
|------|------|
| 后端 | PHP MVC（`controller` + `action` 路由模式） |
| 前端框架 | layui v2.5.6（模块化加载，仅用于 UI 渲染） |
| 渲染方式 | **纯服务端渲染**（PHP 输出完整 HTML，前端无 SPA/ AJAX 数据加载） |
| 安全机制 | CSRF Token（每个表单隐藏字段 `csrf_token`，每次请求刷新） |
| 会话管理 | PHPSESSID=REDACTED + `csrf_token` Cookie + `device` Cookie |
| 客户端 JS | `responsive.js`（移动端菜单）+ `main.js`（通用工具函数）+ 各页面内联 `<script>` |

### 关键结论
> **网站没有用于实验数据的客户端筛选/搜索/排序逻辑。** 所有实验数据由 PHP 直接输出 HTML 表格行。  
> 但 `js/main.js` 提供了通用的 `searchTable()`、`exportCSV()`、`ajax()` 等工具函数（**当前学生页面未引用**）。  
> 有实际客户端交互逻辑的页面：**答题测试页**、**预习报告上传页**、**下载报告页**。

### `js/main.js` 通用工具函数（5,241 字节，当前学生页面未引用）

| 函数 | 功能 | 潜在用途 |
|------|------|----------|
| `searchTable(inputId, tableId)` | 客户端表格搜索/过滤 | 可参考其过滤逻辑 |
| `exportCSV(tableId, filename)` | 导出表格为 CSV 文件 | 可用于数据导出 |
| `ajax(options)` | XMLHttpRequest 封装 | 可用于 AJAX 请求 |
| `validateForm(formId)` | 表单必填字段验证 | — |
| `toggleSelectAll(checkbox, name)` | 全选/取消全选 | — |
| `formatDate(dateString)` | 日期格式化 | — |
| `showLoading()` / `hideLoading()` | 加载动画 | — |
| `showModal(id)` / `hideModal(id)` | 模态框显示/隐藏 | — |
| `deleteConfirm(msg)` | 删除确认对话框 | — |
| `printPage()` | 打印页面 | — |

---

## 二、完整路由表（controller=student）

| action | 页面名称 | 有表单 | 有客户端JS逻辑 | 文件大小 |
|--------|----------|--------|---------------|----------|
| `index` | 学生首页 | 否 | 否 | 8,656 B |
| `experimentList` | 实验课程查询 | 是（预约） | 否 | 87,634 B |
| `myExperiments` | 我的实验 | 是（取消预约） | 否 | 9,107 B |
| `testList` | 实验测试 | 否 | 否 | 41,340 B |
| `startTest` | 答题测试 | 是（提交答案） | **是**（计时器+进度条+自动提交） | 13,345 B |
| `submitTest` | 提交答案（POST目标） | — | — | 未抓取 |
| `processData` | 实验过程数据 | 否 | 否 | 6,361 B |
| `resultData` | 实验数据处理 | 否 | 否 | 4,843 B |
| `scoreQuery` | 成绩查询 | 否 | 否 | 5,181 B |
| `downloadReport` | 下载实验报告 | 是（选择+下载） | **是**（URL参数自动选中+下载跳转） | 9,718 B |
| `previewReport` | 预习报告上传列表 | 否 | 否 | 7,101 B |
| `previewReport&expPlanId=XXX` | 预习报告上传表单 | 是（文件上传） | **是**（拖拽上传+文件选择） | 17,503 B |
| `uploadPreviewFile` | 上传文件（POST目标） | — | — | 未抓取 |
| `reserve` | 预约（POST目标） | — | — | 未抓取 |
| `cancel` | 取消预约（POST目标） | — | — | 未抓取 |

---

## 三、核心业务流程与表单结构

### 3.1 登录流程

```
GET  index.php?controller=login&action=index
  → 提取隐藏字段 csrf_token

POST index.php?controller=login&action=login
  Body: role=student&username=XXX&password=XXX&csrf_token=XXX
  Content-Type: application/x-www-form-urlencoded
  → 成功后设置 Cookies: PHPSESSID=REDACTED csrf_token, device
  → 重定向到 index.php?controller=student&action=index
```

### 3.2 预约实验（核心！）

**页面**：`experimentList`  
**触发**：点击「预约」按钮  
**方式**：表单 POST（非 AJAX）

```html
<form action="index.php" method="post" style="display: inline;">
    <input type="hidden" name="csrf_token" value="XXX">
    <input type="hidden" name="controller" value="student">
    <input type="hidden" name="action" value="reserve">
    <input type="hidden" name="flowNum" value="4922">
    <button type="submit" class="layui-btn layui-btn-sm reserve-btn">
        <i class="layui-icon layui-icon-date"></i> 预约
    </button>
</form>
```

**关键参数**：
- `flowNum`：每行实验的唯一标识（预约流水号）
- `csrf_token`：CSRF 令牌（页面级，所有表单共用同一个值）

**行状态判断**（3种）：
| 状态 | HTML 特征 | 操作列内容 |
|------|-----------|-----------|
| 可预约 | `<td>剩余人数</td>` > 0 + 有 `<form>` | 预约按钮（submit） |
| 已满 | `<td>0</td>` + 无 form | `<button disabled>已满</button>` |
| 未通过测试 | 测试状态列显示"未测试" | 无预约按钮（需先通过测试） |

**表格列结构**（7列）：
```
| 实验名称 | 实验地点 | 上课教师 | 剩余人数 | 实验节次 | 测试状态 | 操作 |
```

- 实验名称格式：`XXX-N学时`（N=2或4）
- 实验节次格式：`周-星期-节组`（如 `3-1-2` = 第3周周一第2场）
- 剩余人数：纯数字（0 = 已满）

### 3.3 取消预约

**页面**：`myExperiments`  
**触发**：点击「取消预约」按钮  
**方式**：表单 POST + `confirm()` 确认

```html
<form action="index.php" method="post" style="display: inline;">
    <input type="hidden" name="csrf_token" value="XXX">
    <input type="hidden" name="controller" value="student">
    <input type="hidden" name="action" value="cancel">
    <input type="hidden" name="flowNum" value="4915">
    <button type="submit" class="layui-btn layui-btn-sm layui-btn-danger"
            onclick="return confirm('确定要取消预约吗？')">
        <i class="layui-icon layui-icon-close"></i> 取消预约
    </button>
</form>
```

**myExperiments 表格列结构**（6列）：
```
| 实验名称 | 实验地点 | 上课教师 | 实验节次 | 状态 | 操作 |
```

**状态值**：`实验未开始`（可取消）、`实验已开始`/`已完成`（不可取消）

**操作列还包含**：
- 报告下载链接：`<a href="pdf3/download.php?&fname=6&random=445f9d797da60ccb">报告下载</a>`

### 3.4 实验测试（startTest）

**入口**：`testList` 页面中 `<a href="index.php?controller=student&action=startTest&flowNum=4933">开始测试</a>`

**测试页面结构**：
- 15分钟倒计时（固定在右上角）
- 进度条（已答题/总题数）
- 题目卡片（支持单选/多选/填空）
- 提交按钮 + 自动提交

**提交表单**：
```html
<form id="quizForm" method="POST" action="index.php?controller=student&action=submitTest">
    <input type="hidden" name="csrf_token" value="XXX">
    <input type="hidden" name="flowNum" value="4933">
    
    <!-- 单选题 -->
    <input type="radio" name="answers[489]" value="A">
    <input type="radio" name="answers[489]" value="B">
    <input type="radio" name="answers[489]" value="C">
    <input type="radio" name="answers[489]" value="D">
    
    <button type="submit" onclick="return confirmSubmit()">提交答案</button>
</form>
```

**客户端 JS 逻辑**（完整）：
```javascript
// 1. 倒计时（15分钟）
var totalTime = 15 * 60;
var currentTime = totalTime;
function updateTimer() {
    var minutes = Math.floor(currentTime / 60);
    var seconds = currentTime % 60;
    document.getElementById('timeDisplay').textContent = 
        (minutes < 10 ? '0' : '') + minutes + ':' + (seconds < 10 ? '0' : '') + seconds;
    if (currentTime <= 300) { // 5分钟警告
        document.getElementById('timer').classList.add('warning');
    }
    if (currentTime <= 0) { autoSubmit(); }
    currentTime--;
}
var timerInterval = setInterval(updateTimer, 1000);

// 2. 自动提交
function autoSubmit() {
    clearInterval(timerInterval);
    layer.msg('考试时间到，正在自动提交...', {icon: 0, time: 2000}, function(){
        document.getElementById('quizForm').submit();
    });
}

// 3. 进度条更新
function updateProgress() {
    var totalQuestions = 1; // 动态生成
    var answeredQuestions = 0;
    var questionCards = document.querySelectorAll('.question-card');
    questionCards.forEach(function(card) {
        var inputs = card.querySelectorAll('input[type="radio"], input[type="checkbox"], input[type="text"]');
        var isAnswered = false;
        inputs.forEach(function(input) {
            if ((input.type === 'radio' || input.type === 'checkbox') && input.checked) {
                isAnswered = true;
            } else if (input.type === 'text' && input.value.trim() !== '') {
                isAnswered = true;
            }
        });
        if (isAnswered) answeredQuestions++;
    });
    var progress = (answeredQuestions / totalQuestions) * 100;
    document.getElementById('progressBar').style.width = progress + '%';
}

// 4. 确认提交
function confirmSubmit() {
    // 统计未答题数，提示确认
    if (answeredQuestions < totalQuestions) {
        return confirm('您还有 X 道题未作答，确定要提交吗？');
    }
    return confirm('确定要提交答案吗？提交后将无法修改。');
}

// 5. 选项点击效果（整行可点）
document.querySelectorAll('.option-item').forEach(function(item) {
    item.addEventListener('click', function(e) {
        if (e.target.tagName !== 'INPUT') {
            var input = this.querySelector('input');
            if (input.type === 'radio') input.checked = true;
            else if (input.type === 'checkbox') input.checked = !input.checked;
            updateProgress();
        }
    });
});

// 6. 防止意外离开
window.onbeforeunload = function() { return "您正在答题中，确定要离开吗？"; };
document.getElementById('quizForm').addEventListener('submit', function() {
    window.onbeforeunload = null;
});
```

**测试状态规则**：
- 通过线：≥12分（满分20分）
- 通过后：同一实验的所有课节都可预约
- 已通过：显示「已通过」+「重新测试」按钮（均 disabled）

### 3.5 预习报告上传

**入口**：`previewReport` 列表页 → 点击「上传报告」→ `previewReport&expPlanId=4915`

**上传表单结构**（两个独立 form）：

```html
<!-- 表单1：首页上传（仅1张） -->
<form action="index.php?controller=student&action=uploadPreviewFile" 
      method="post" enctype="multipart/form-data">
    <input type="hidden" name="csrf_token" value="XXX">
    <input type="hidden" name="exp_plan_id" value="4915">
    <input type="hidden" name="exp_name" value="分光计的调整与使用-4学时">
    <input type="hidden" name="upload_type" value="homepage">
    <input type="file" name="image_files[]" accept=".jpg,.jpeg,.png,.gif">
    <button type="submit" name="upload_action" value="save">确认上传</button>
    <button type="submit" name="upload_action" value="submit"
            onclick="return confirm('提交后将无法修改首页图片，确定吗？')">提交</button>
</form>

<!-- 表单2：预习报告上传（最多3张） -->
<form action="index.php?controller=student&action=uploadPreviewFile"
      method="post" enctype="multipart/form-data">
    <input type="hidden" name="csrf_token" value="XXX">
    <input type="hidden" name="exp_plan_id" value="4915">
    <input type="hidden" name="exp_name" value="分光计的调整与使用-4学时">
    <input type="hidden" name="upload_type" value="report">
    <input type="file" name="image_files[]" accept=".jpg,.jpeg,.png,.gif" multiple>
    <button type="submit" name="upload_action" value="save">确认上传</button>
    <button type="submit" name="upload_action" value="submit"
            onclick="return confirm('提交后将无法修改预习报告图片，确定吗？')">提交</button>
</form>
```

**上传参数说明**：
| 参数 | 值 | 说明 |
|------|-----|------|
| `upload_type` | `homepage` / `report` | 首页图片 / 预习报告图片 |
| `upload_action` | `save` / `submit` | 暂存 / 最终提交（提交后不可修改） |
| `image_files[]` | 文件数组 | 支持 jpg/jpeg/png/gif，单文件≤10MB |
| `exp_plan_id` | 数字 | 对应 myExperiments 中的 flowNum |

**客户端 JS**：拖拽上传 + 文件名显示（纯 UI 交互，无业务逻辑）

### 3.6 下载实验报告

**页面**：`downloadReport`  
**方式**：JavaScript 跳转下载（非表单提交）

```javascript
function downFile() {
    var code = document.querySelector('input[name="fname"]:checked');
    if (!code) {
        layui.layer.msg('请先选择下载的报告');
        return false;
    }
    var random = document.getElementById('random').value || 0;
    location.href = 'pdf6/downloadall.php?fname=' + code.value + '&random=' + random;
    return false;
}
```

**报告编号映射**（fname → 实验名称）：
| fname | 实验名称 |
|-------|---------|
| 1 | 霍尔元件 |
| 2 | 示波器 |
| 3 | 模拟静电场 |
| 4 | 直流电桥 |
| 5 | 刚体转动惯量 |
| 6 | 拉伸法 |
| 7 | PN结 |
| 8 | 理想气体 |
| 9 | 显微系统 |
| 10 | 牛顿环 |
| 11 | 分光计 |
| 12 | 虚拟实验：重力加速度 |

**URL 参数自动选中**：如果地址栏带 `?fname=X`，页面加载后自动选中对应 radio。

### 3.7 成绩查询

**表格列**（6列）：
```
| 实验名称 | 测试成绩(20分) | 过程数据成绩(40分) | 数据处理成绩(40分) | 总成绩(100分) | 状态 |
```

**状态**：`不合格`（红色）/ `合格`（绿色）

### 3.8 学生首页

**展示信息**：
- 个人信息：班级、学号、姓名、本学期课程
- 实验信息表：已预约实验的名称、课节、教师、状态、成绩
- 状态值：`已预约`（蓝色）、`已出席`（紫色）、`已完成`（绿色）、`缺席`（红色）

---

## 四、CSRF Token 机制

### 特征
1. **页面级共享**：同一页面中所有表单的 `csrf_token` 值相同
2. **页面间不同**：不同页面（不同请求）的 csrf_token 不同
3. **Cookie 中也有**：`csrf_token` Cookie 值与登录时获取的相同
4. **隐藏字段位置**：`<input type="hidden" name="csrf_token" value="XXX">`，紧跟 `<form>` 标签

### 获取方式
```javascript
// 从页面中提取（任一表单均可）
document.querySelector('input[name="csrf_token"]')?.value

// 或从 Cookie 中读取（可能与页面内的不同，需验证）
document.cookie.match(/csrf_token=([^;]+)/)?.[1]
```

---

## 五、与现有插件的对比分析

### 5.1 插件已实现的功能

| 功能 | 实现位置 | 状态 |
|------|---------|------|
| 实验列表筛选面板 | `content.js` `buildPanel()` | ✅ 已实现 |
| 关键词搜索 | `content.js` `apply()` | ✅ 已实现 |
| 星期/节组 chip 筛选 | `content.js` `activeDays/activeGroups` | ✅ 已实现 |
| 仅看可约 | `content.js` `onlyOpen` | ✅ 已实现 |
| 隐藏冲突场次 | `content.js` `hideConflict` | ✅ 已实现 |
| 隐藏已满场次 | `content.js` `hideFull` | ✅ 已实现 |
| 剩余人数排序 | `content.js` `sort.value === 'seats'` | ✅ 已实现 |
| 课表冲突检测 | `shared.js` `findConflicts()` | ✅ 已实现 |
| 节次码人性化显示 | `shared.js` `humanizeSlotCode()` | ✅ 已实现 |
| 筛选条件持久化 | `content.js` `applyAndSave()/restore()` | ✅ 已实现 |
| PDF 课表上传解析 | `shared.js` `parseScheduleText()` | ✅ 已实现 |
| flowNum 提取 | `content.js` `parseRows()` | ✅ 已实现 |

### 5.2 插件未实现但可利用网站逻辑实现的功能

| 功能 | 网站提供的接口 | 插件改造方向 |
|------|--------------|-------------|
| **一键预约** | POST `index.php` with `csrf_token + controller=student + action=reserve + flowNum=XXX` | 在可约行添加「一键预约」按钮，用 fetch POST 提交 |
| **批量取消** | POST `index.php` with `action=cancel + flowNum=XXX` | 在 myExperiments 页添加「全部取消」按钮 |
| **CSRF Token 提取** | 页面内 `input[name="csrf_token"]` | `parseRows()` 中增加 `csrfToken` 字段 |
| **隐藏未通过测试** | 测试状态列文本判断 | 新增 checkbox「隐藏未通过测试」 |
| **测试状态联动** | testList 页面的通过/未通过状态 | 跨页面数据：在 experimentList 标记哪些实验已通过测试 |
| **自动下载报告** | `pdf6/downloadall.php?fname=X&random=Y` | 新增「一键下载所有报告」按钮 |
| **预习报告状态显示** | previewReport 页面的上传状态 | 在 experimentList 标记哪些实验已上传预习报告 |

### 5.3 插件当前 `parseRows()` 的不足

```javascript
// 当前代码（content.js line 95-126）
function parseRows(table) {
    // ...
    const flowInput = tr.querySelector('input[name="flowNum"]');
    rows.push({
        // ...
        flowNum: flowInput ? flowInput.value : ''
        // ❌ 缺少 csrfToken 提取
        // ❌ 缺少测试状态结构化（当前仅存为文本 status）
        // ❌ 缺少预约表单引用（无法直接提交）
    });
}
```

**建议改进**：
```javascript
function parseRows(table) {
    // ...
    const flowInput = tr.querySelector('input[name="flowNum"]');
    const reserveForm = tr.querySelector('form[action="index.php"]');
    const csrfInput = tr.querySelector('input[name="csrf_token"]');
    rows.push({
        // ...现有字段...
        flowNum: flowInput ? flowInput.value : '',
        csrfToken: csrfInput ? csrfInput.value : '',
        reserveForm: reserveForm || null,  // 直接引用表单 DOM
        testPassed: status.indexOf('已通过') >= 0,
        canReserve: !!reserveForm && !full,
    });
}
```

---

## 六、文件清单

### 已保存的页面快照（`website-snapshot/` 目录）

| 文件 | 说明 | 大小 |
|------|------|------|
| `student_index.html` | 学生首页 | 8,656 B |
| `student_experimentList.html` | 实验课程查询（核心页面） | 87,634 B |
| `student_myExperiments.html` | 我的实验（已预约列表） | 9,107 B |
| `student_testList.html` | 实验测试列表 | 41,340 B |
| `student_startTest.html` | 答题测试页（含完整JS逻辑） | 13,345 B |
| `student_processData.html` | 实验过程数据 | 6,361 B |
| `student_resultData.html` | 实验数据处理 | 4,843 B |
| `student_scoreQuery.html` | 成绩查询 | 5,181 B |
| `student_downloadReport.html` | 下载实验报告（含JS下载逻辑） | 9,718 B |
| `student_previewReport.html` | 预习报告上传列表 | 7,101 B |
| `student_previewReport_upload.html` | 预习报告上传表单（含拖拽JS） | 17,503 B |
| `js_responsive.js` | 响应式菜单切换 | 2,152 B |
| `css_responsive.css` | 响应式样式 | 4,435 B |
| `layui_layui.js` | layui 模块加载器 | 7,395 B |
| `layui_css_layui.css` | layui 核心样式 | 74,518 B |
| `module_*.js` (11个) | layui 各模块 | 共~215 KB |

### 项目源码

| 文件 | 说明 |
|------|------|
| `extension/content.js` | 内容脚本（315行，注入 experimentList/myExperiments 页） |
| `extension/shared.js` | 共享工具函数（210行，节次解析/冲突检测/PDF解析） |
| `extension/options.js` | 选项页（课表设置） |
| `extension/manifest.json` | 扩展清单 |
| `userscript/experiment-helper.user.js` | Tampermonkey 油猴脚本 |

---

## 七、后续改造建议（按优先级排序）

### P0：一键预约按钮
- **位置**：`content.js` `buildListEnhancement()` 中，遍历 `rowsData`
- **逻辑**：对 `canReserve && flowNum && csrfToken` 的行，在操作列追加「⚡一键预约」按钮
- **提交方式**：`fetch(location.pathname, { method: 'POST', body: new FormData(reserveForm) })` 然后刷新页面
- **安全考虑**：需二次确认 `confirm('确定预约？')`

### P1：结构化测试状态
- **位置**：`content.js` `parseRows()`
- **逻辑**：将 `status` 文本解析为 `testPassed: boolean` + `testScore: number`
- **用途**：新增筛选 checkbox「隐藏未通过测试」

### P2：批量取消预约
- **位置**：`content.js` 新增 `initMyExperimentsPage()` 增强
- **逻辑**：在表格上方添加「全部取消」按钮，遍历所有取消表单逐个 POST
- **安全考虑**：需强确认 `confirm('确定取消全部 N 个预约？')`

### P3：跨页面数据联动
- **思路**：后台 fetch `testList` 页面，解析测试状态，在 `experimentList` 标记
- **实现**：`chrome.runtime.sendMessage` → background script fetch → 返回测试状态映射
- **用途**：在实验列表直接显示哪些实验还没通过测试

### P4：一键下载所有报告
- **位置**：`downloadReport` 页面注入
- **逻辑**：遍历所有 radio，依次 `location.href = downloadUrl`（需间隔延迟）
