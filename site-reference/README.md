# site-reference — 目标网站源码快照

本目录保存了插件所服务的「学生预约实验管理系统」（`https://wlsy.webvpn.sau.edu.cn/lab2026/`）的**真实页面快照与站点自有代码**，供二次开发时直接对照 DOM 结构、表单字段与业务流程，无需登录学校系统反复抓取。

- 抓取时间：2025 年开发插件期间（登录态抓取）
- 前端框架：Layui 2.x + 原生 JS，页面编码 UTF-8
- 路由方式：所有页面均为 `index.php`（`controller=student`），表单 POST 目标也是 `index.php`，靠隐藏字段 / 查询参数区分 action
- ⚠️ **隐私脱敏说明见文末**，快照中的姓名 / 学号 / csrf_token 值均为占位符

## 页面 ↔ 站点路由对照表

| 快照文件 | 站点 action | 页面功能 | 对插件的意义 |
|---|---|---|---|
| `pages/live_experimentList.html` | `experimentList` | 实验课程查询（核心页） | **`parseRows()` 解析目标**：结果表 7 列序号、行内预约表单（`csrf_token`）都以此为准 |
| `pages/live_index.html` | `index` | 学生首页 | 登录后落地页 |
| `pages/live_myExperiments.html` | `myExperiments` | 我的实验 | 取消预约表单所在页（`content.js` 的"我的实验"面板同源） |
| `pages/live_downloadReport.html` | `downloadReport` | 下载实验报告 | URL 参数自动选中 + 下载跳转（自带客户端 JS） |
| `pages/live_previewReport.html` | `previewReport` | 预习报告上传列表 | — |
| `pages/student_previewReport_upload.html` | `previewReport&expPlanId=…` | 预习报告上传表单 | 拖拽上传 + 文件选择（自带客户端 JS） |
| `pages/live_processData.html` | `processData` | 实验过程数据 | — |
| `pages/live_resultData.html` | `resultData` | 实验数据处理 | — |
| `pages/live_scoreQuery.html` | `scoreQuery` | 成绩查询 | — |
| `pages/live_testList.html` | `testList` | 实验测试列表 | — |
| `pages/student_startTest.html` | `startTest` | 答题页 | 计时器 + 进度条 + 自动提交（站点自有 JS 逻辑样本） |
| `pages/student_experimentList_live.html` | （登录页） | 登录表单 | `csrf_token` 获取入口（分析文档 §四） |

## 其他文件

| 路径 | 内容 |
|---|---|
| `assets/js_main.js` | 站点公共 JS（`deleteConfirm` / `showModal` 等） |
| `assets/js_responsive.js`、`assets/css_responsive.css` | 站点响应式菜单层 |
| `data/experiments_live.json` / `.csv` | 实验课程列表的一次真实抓取样本（仅课程数据，无个人信息）——解析 / 测试可直接当 fixture 用 |
| `WEBSITE_BUSINESS_LOGIC_ANALYSIS.md` | 完整业务分析报告：§二 路由表、§三 各业务流程与表单字段、§四 CSRF 机制、§五 与插件的差距分析、§七 改造路线图（P0–P4） |

> 站点使用的 Layui 框架文件未收录（第三方通用库，可从 [layui 官网](https://layui.dev) 获取对应版本）。

## 二次开发怎么用

1. **先读** [HANDOFF.md](../HANDOFF.md)（DOM 契约、时间表规则、红线），遇到存疑的列序 / 字段名，直接在 `pages/live_experimentList.html` 里搜原始 HTML 验证；
2. 想加新功能（批量取消、跨页联动、一键下载报告等），先看分析文档 §五（插件未覆盖的能力）和 §七（改造建议），再对照对应页面快照写选择器；
3. 解析 / 测试函数需要样例数据时，用 `data/experiments_live.json`，不要为了造数据去登录学校系统。

## 隐私脱敏记录

快照来自真实登录会话，发布前已做如下替换（**未改变 DOM 结构**，字段名与层级保持原样）：

| 原内容 | 替换为 |
|---|---|
| 学生真实姓名 | `[姓名已隐去]` |
| 学号 | `[学号已隐去]` |
| 班级号 | `[已隐去]` |
| `csrf_token` 表单值（64 位 hex） | `REDACTED`（字段本身保留，开发时以登录后实测为准） |
| PHPSESSID 会话标识 | `REDACTED` |
| **个人使用记录**：快照中「我预约的两门实验」的具体实验名（首页/我的实验/成绩/测试/过程数据/预习报告等页） | `示例实验A-4学时` / `示例实验B-2学时`（公共课程目录 `data/*.json|csv` 与 `experimentList` 结果表行名保留原样，那是全校统一数据） |
| **个人成绩与测试状态**：成绩分数、`成绩：18.00分`、每行的「已通过测试」 | `–` |
| **个人使用记录**：快照中「我预约的两门实验」的具体实验名（首页/我的实验/成绩/测试/过程数据/预习报告等页） | `示例实验A-4学时` / `示例实验B-2学时`（公共课程目录 `data/*.json|csv` 与 `experimentList` 结果表行名保留原样，那是全校统一数据） |
| **个人成绩与测试状态**：成绩分数、`成绩：18.00分`、每行的「已通过测试」 | `–` |

抓取过程中使用的探针脚本（含登录凭据）**未收录**在本仓库；抓取时的会话与令牌均已失效。
