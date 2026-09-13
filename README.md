# 实验选课助手

为开放实验教学管理系统（lab2026）的「实验列表」页提供选课增强：智能筛选、余量排序、节次码翻译、课表冲突检测。只读增强，**绝不自动提交任何预约请求**。

两个发行版本功能一致，任选其一安装即可（都装会出现两层面板，不建议）：

| 版本 | 适合人群 | 安装方式 |
|------|----------|----------|
| [油猴脚本版](./userscript/) | 已装 [Tampermonkey](https://www.tampermonkey.net/) 的用户 | 粘贴脚本代码或拖入 `.user.js` 文件 |
| [浏览器扩展版](./extension/) | Chrome / Edge 用户 | 开发者模式「加载已解压的扩展程序」 |

## 功能亮点

- 🔍 **关键字搜索**：实验名 / 教师 / 地点
- 🏷️ **星期、场次点选筛选**：chip 标签显示真实时段（如「第2场 10:20」，悬停看完整时间）
- ✅ **一键过滤**：仅看可约 / 隐藏已满 / 隐藏冲突场次
- 🔢 **剩余人数优先排序**，筛选条件自动记忆（刷新后保留）
- 🈯 **节次码人话徽标**：`3-1-2` → 「第3周 周一 第2场 10:20–11:50」
- 📅 **课表冲突检测**：按真实时间重叠判定（重叠 ≥ 10 分钟才标红并注明冲突课程），支持 PDF 课表粘贴解析 / 周网格手动勾选

## 快速安装（油猴版）

1. 浏览器安装 [Tampermonkey](https://www.tampermonkey.net/) 扩展
2. Tampermonkey → 「添加新脚本」→ 粘贴 [experiment-helper.user.js](./userscript/experiment-helper.user.js) 全部内容 → `Ctrl+S` 保存
3. 打开实验列表页，表格上方出现「实验选课助手（油猴版）」面板即安装成功

## 快速安装（扩展版）

1. 地址栏进入 `chrome://extensions`（Edge 为 `edge://extensions`）
2. 打开右上角「开发者模式」
3. 「加载已解压的扩展程序」→ 选择本仓库的 [extension](./extension/) 文件夹

## 目录结构

```
experiment-helper/
├── HANDOFF.md                        # 二次开发交接提示词（接手必读 / 可直接投喂 AI）
├── userscript/                       # Tampermonkey 单文件脚本
│   ├── experiment-helper.user.js
│   └── README.md
└── extension/                        # Chrome/Edge 扩展（Manifest V3）
    ├── manifest.json
    ├── shared.js                     # 节次码解析 / 课表解析 / 冲突检测（纯函数）
    ├── content.js                    # 注入实验列表页与我的实验页
    ├── panel.css / options.*         # 面板与课表设置页
    └── vendor/                       # pdf.js（Apache-2.0，本地 PDF 解析用）
```

## 安全与隐私

- 只读解析与界面增强，**不自动提交任何预约请求**，预约仍需手动点击
- 不上传任何数据，课表与筛选条件仅存浏览器本地（GM storage / `chrome.storage`）

## License

[MIT](./LICENSE)
