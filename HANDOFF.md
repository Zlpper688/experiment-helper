# 二次开发交接提示词（HANDOFF）

> **用法**：接手的开发者通读一遍即可上手；用 AI 辅助开发时，把本文档全文作为上下文粘贴给 AI，再描述需求，可显著减少它瞎猜源码结构的次数。
>
> 本文所有函数名、键名、列序号、时间表均从源码逐一核实，非凭记忆编写。

---

## 一、项目一句话

为学校「开放实验教学管理系统」（`https://wlsy.webvpn.sau.edu.cn/lab2026/index.php`，WebVPN 内网）的**实验列表页**做浏览器端增强：筛选、排序、节次码翻译、课表冲突检测、一键预约、自动抢课。纯前端注入，无服务端。

## 二、硬性红线（改代码前必读）

1. **绝不自动批量提交预约请求**。一键预约 / 自动抢课必须由用户点击触发；自动抢课只是"定时刷新监控 + 逐条可约项处理"，不得改成无人值守批量刷单。
2. **不得引入构建工具/依赖管理**。油猴版必须保持单文件可直接粘贴安装；扩展版保持"加载已解压文件夹即可用"。vendor 里的 pdf.js 是唯一第三方文件。
3. **只读解析为主**：除预约/抢课两个用户主动动作外，不得对目标网站发起任何写请求。
4. 改动 `shared.js` 的纯函数后，**必须同步** `userscript/experiment-helper.user.js` 中的对应函数（见第三节）。

## 三、两个发行版：改一处要同步另一处

| | 扩展版 `extension/` | 油猴版 `userscript/experiment-helper.user.js` |
|---|---|---|
| 版本号 | manifest.json `0.5.2`（独立管理） | 头部 `@version 1.6.3`（独立管理，与扩展版**不同步是正常的**） |
| 注入方式 | MV3 content_scripts，`document_idle` | Tampermonkey，`document-end` |
| 纯函数 | `shared.js`（独立文件） | 内嵌在脚本第 2 节，**逐函数与 shared.js 保持一致** |
| 存储 | `chrome.storage.local` | `GM_getValue/GM_setValue`（降级 localStorage，键加 `ulph:` 前缀） |
| CSS 前缀 | `lph-`（类名与 DOM id，如 `lph-kw`） | `ulph-`（避免与扩展版/layui 冲突） |
| PDF 课表解析 | `pdf-extract.js` + vendor/pdf.js（本地） | 从 CDN 加载 pdf.js（`@connect cdn.jsdelivr.net` / `unpkg.com`） |

**同步规则**：改筛选逻辑、冲突算法、时间表常量时，两个文件都要改；改 UI 文案/布局时尽量同步。数据靠「导出/导入 JSON」互通，存储实现互不相通。

## 四、目标网站 DOM 契约（content.js `parseRows` 依赖的列序）

实验列表页表格 `table` 每行 `tr.cells` 固定 7 列：

| 列 | 内容 | 解析方式 |
|---|---|---|
| c[0] | 实验名（含 `N学时` 字样） | 正则 `/(\d+)\s*学时/` 提取学时，默认 2 |
| c[1] | 地点 | trim |
| c[2] | 教师 | trim |
| c[3] | 剩余人数 | 去非数字后 parseInt，≤0 视为已满 |
| c[4] | 节次码 `周-星期-场`，如 `3-1-2` | `parseSlotCode` |
| c[5] | 测试状态（已通过/未测试/…） | `indexOf` 判断 |
| c[6] | 操作（含「已满」字样或预约按钮） | 文本判断 |

行内还依赖：`input[name="flowNum"]`、`form[action="index.php"]`、`input[name="csrf_token"]`（预约 POST 必带）。

**风险**：学校改版列序会直接破坏解析。改动解析前先 `console.table(parseRows(document.querySelector('table')))` 核对。

## 五、领域知识：时间表与冲突规则（最容易改错）

**节次码** `周-星期-场`：`3-1-2` = 第3周 · 周一 · 第2场。星期 1–7，场次 1–5。

**实验官方场次时间**（`LAB_SESSIONS_2H` / `LAB_SESSIONS_4H`，勿凭直觉改）：

| 2学时 | 时间 | 4学时 | 时间 |
|---|---|---|---|
| 第1场 | 08:20–09:50 | 第1场 | 08:20–11:20 |
| 第2场 | 10:20–11:50 | 第2场 | 14:00–17:00 |
| 第3场 | 14:00–15:30 | 第3场 | 17:45–20:45 |
| 第4场 | 16:00–17:30 | | |
| 第5场 | 17:45–19:15 | | |

**理论课 12 节制**（`THEORY_SLOT_TIMES`）：1节 08:20–09:05 … 9节 18:30–19:15、10节 19:20–20:05、11节 20:30–21:20、12节 21:25–22:00。

**冲突判定 = 真实时间重叠，不是节组号比较**：`findConflicts` 把实验场次和课程节次都换算成分钟区间，**重叠 ≥ 10 分钟**才判冲突（阈值防边界误报）。典型案例：晚9-10节（18:30–20:05）与实验第5场（17:45–19:15）重叠 45 分钟 → 冲突；晚11-12节（20:30–22:00）→ 不冲突。

**4学时场次展开**：`slotGroupsFor(hours, startGroup)` 按 `span = hours/2` 连续占用 startGroup 起的场次。

**课表解析**（`parseScheduleText`）：用正则 `[(（]\s*(\d+)\s*[-–—]\s*(\d+)\s*节\s*[)）]` 在粘贴文本中定位节次标记，向前取词组课程名、向后取周次。**PDF 复制出的文本没有星期信息**，所以课程条目的 `day` 允许为 `null`，由用户在 UI 里补选——这是设计约定，别"修复"它。

## 六、代码结构地图

**扩展版加载顺序**：`shared.js`（纯函数，无 DOM 依赖）→ `content.js`（注入逻辑）+ `panel.css`。

- `shared.js`：全部领域算法。改算法只动这里（并同步油猴版）。
- `content.js`：
  - `parseRows(table)` — 表格 → 行数据（DOM 契约所在）
  - `buildListEnhancement/buildPanel` — 面板 DOM，控件 id 一律 `lph-*`：`lph-kw`(搜索)、`lph-sort`、`lph-only-open`、`lph-hide-conflict`、`lph-hide-exp-conflict`、`lph-hide-full`、`lph-only-tested`、`lph-hide-dup`、`lph-hide-unwanted`、`lph-only-reserved`、`lph-hide-reserved`、`lph-teacher`、`lph-days`/`lph-groups`(chip 筛选)、`lph-stats`(统计行)、`lph-sched`(进度)、`lph-auto-reserve`(抢课)
  - `fetchReservedExperiments()` — fetch 当前 URL 解析「我的实验」页 → 已预约名单（实验间冲突、同类去重、AI/BI 进度都靠它）
  - `quickReserve(r, btn)` — fetch POST FormData（含 csrf_token）不跳页预约，靠响应文本判断成败
- `options.js/html/css` — 课表设置页（`state = { version: 1, courses: [] }`，250ms 防抖自动保存）
- `pdf-extract.js` + `vendor/` — PDF 直接上传解析（cmaps 目录是 pdf.js 中文映射，**删了中文 PDF 解析会乱码**）

**油猴版单文件内部分节**（有注释分隔）：1 存储层 → 2 纯函数 → 3 样式(`ulph-`) → 4 课表设置弹层（移植 options 页）→ 5 列表页增强 → 6 我的实验页徽标。

## 七、存储 Schema（两版键名相同）

```js
// labHelperCourses —— 课表
{ version: 1, courses: [ {
    name: '高等数学',       // 课程名
    day: 1 | null,          // 星期 1-7；粘贴解析后待补选时为 null
    slots: [2],             // 节组 1-5（=实验场次组）
    slotSpan: [9, 10] | null, // 起止节次（理论课），用于精确时间换算
    weeks: [[1, 20]],       // 周次区间数组
    auto: false,            // 网格/解析自动生成
    src: '手动' | '网格' | '粘贴解析'
} ] }

// labHelperFilters —— 筛选状态（刷新记忆）
{ kw, sort, onlyOpen, hideConflict, hideExpConflict, hideFull,
  onlyTested, hideDup, hideUnwanted, onlyReserved, hideReserved, ... }

// labHelperUnwanted —— 「不想选」名单（normalizeExpName 后的实验名数组）
```

## 八、常见修改场景速查

| 要做的事 | 改哪里 | 别忘了 |
|---|---|---|
| 新增筛选条件 | content.js `buildPanel` + 油猴版第 5 节 | 加进 `labHelperFilters` 持久化；样式前缀注意版本 |
| 调整冲突规则 | shared.js `findConflicts`/`findExpConflicts` | 同步油猴版第 2 节；≥10 分钟阈值是有意设计 |
| 学校改了时间表 | shared.js 顶部 `LAB_SESSIONS_*`/`THEORY_*` 常量 | 两版同步；对照本文第五节表格 |
| 表格列变化 | content.js `parseRows` | 先在控制台核对真实列序 |
| 新增必做实验 | shared.js `EXPERIMENT_META.mandatory` | 用 `normalizeExpName` 后的规范名 |
| 纯函数回归验证 | 不依赖 DOM，可直接 Node 跑：`node -e "eval(require('fs').readFileSync('extension/shared.js','utf8')); console.log(humanizeSlotCode('3-1-2',2))"` | shared.js 用 `const` 声明，eval 作用域内直接可用 |

## 九、测试与验收清单

1. `chrome://extensions` 开发者模式加载 `extension/`，进实验列表页出现面板
2. 筛选/排序/隐藏各项逐个点一遍，刷新后状态保留（`labHelperFilters`）
3. 课表设置：粘贴一段真实课表 PDF 文本 → 解析出条目且 `day=null` 待补 → 补选后列表页冲突行标红
4. 一键预约一次（真预约前先用"已满"行验证失败分支的提示）
5. 油猴版粘贴安装后重复 2–4
6. **验收底线**：不点预约按钮时，Network 面板不得出现任何 POST 请求

## 十、已知坑

- **乱码**：Windows PowerShell 控制台显示中文提交信息/文件会乱，实际存储是 UTF-8，别当成 bug 反复"修复"编码。
- **两套前缀**：`lph-`（扩展）与 `ulph-`（油猴）同时存在是有意的，防同页双装冲突，不要统一。
- **版本号**：油猴 `1.6.x` 与扩展 `0.5.x` 各自独立递增，不要互相"对齐"。
- **同装两版**会出现两层面板，属预期行为，README 已提示用户二选一。
- **vendor/cmaps** 看着一堆小文件很碍眼，但删了中文 PDF 解析就坏。
- WebVPN 环境下 CDN（油猴版加载 pdf.js）偶发不可达，属用户网络问题，扩展版无此问题。
