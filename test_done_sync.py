# -*- coding: utf-8 -*-
"""
Playwright integration test for experiment-helper plugin.
Tests the new scoreQuery fetch feature: completed experiments are marked "已做"
and can be filtered out via "隐藏已选/已做同类" checkbox.

Run: python test_done_sync.py
"""
import asyncio
import os
import sys
import tempfile
import textwrap
from pathlib import Path

from playwright.async_api import async_playwright

REPO = Path(__file__).resolve().parent
EXT = REPO / "extension"

LIST_HTML = r"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>实验列表</title></head>
<body>
<table class="layui-table">
<thead><tr>
<th>实验名称</th><th>实验地点</th><th>上课教师</th>
<th>剩余人数</th><th>实验节次</th><th>测试状态</th><th>操作</th>
</tr></thead>
<tbody>
<tr><td>直流电桥测电阻-2学时</td><td>逸夫馆204</td><td>周老师</td>
<td>3</td><td>5-1-1</td><td><span>已通过</span></td>
<td><form action="index.php"><input type="hidden" name="csrf_token" value="tok1"><input type="hidden" name="flowNum" value="1001"><button class="layui-btn">预约</button></form></td></tr>
<tr><td>示波器的原理与使用-2学时</td><td>逸夫馆202</td><td>董老师</td>
<td>2</td><td>5-1-2</td><td><span>已通过</span></td>
<td><form action="index.php"><input type="hidden" name="csrf_token" value="tok2"><input type="hidden" name="flowNum" value="1002"><button class="layui-btn">预约</button></form></td></tr>
<tr><td>拉伸法测杨氏模量-2学时</td><td>逸夫馆207</td><td>吴老师</td>
<td>5</td><td>5-2-1</td><td><span>已通过</span></td>
<td><form action="index.php"><input type="hidden" name="csrf_token" value="tok3"><input type="hidden" name="flowNum" value="1003"><button class="layui-btn">预约</button></form></td></tr>
</tbody>
</table>
</body></html>
"""

# myExperiments page: user has reserved "示波器" at 5-1-2
MY_EXPS_HTML = r"""<!DOCTYPE html>
<html><head><title>我的实验</title></head><body>
<table><thead><tr>
<th>实验名称</th><th>实验地点</th><th>上课教师</th>
<th>实验节次</th><th>状态</th><th>操作</th>
</tr></thead><tbody>
<tr><td>示波器的原理与使用-2学时</td><td>逸夫馆202</td><td>董老师</td>
<td>5-1-2</td><td>实验未开始</td><td>取消</td></tr>
</tbody></table>
</body></html>
"""

# scoreQuery page: user has done "直流电桥" (has a score entry)
SCORE_HTML = r"""<!DOCTYPE html>
<html><head><title>成绩查询</title></head><body>
<table><thead><tr>
<th>实验名称</th><th>测试成绩</th><th>过程数据</th><th>数据处理</th><th>总成绩</th><th>状态</th>
</tr></thead><tbody>
<tr><td>直流电桥测电阻-2学时</td><td>18.00</td><td>35.00</td><td>38.00</td><td>91.00</td><td>合格</td></tr>
</tbody></table>
</body></html>
"""


async def run_test():
    results = []
    def check(name, cond, detail=""):
        tag = "PASS" if cond else "FAIL"
        results.append((tag, name, detail))
        print(f"  [{tag}] {name}" + (f" — {detail}" if detail else ""))

    async with async_playwright() as p:
        browser = await p.chromium.launch()

        # --- Scenario: extension content.js with scoreQuery sync ---
        print("\n=== Scenario: 已做实验自动同步（扩展版）===")
        page = await browser.new_page()

        # Collect console errors
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        # Stub fetch BEFORE content.js runs
        await page.route("**/index.php*", lambda route: route.fulfill(
            status=200,
            content_type="text/html",
            body=LIST_HTML
        ))

        # We need to intercept fetch calls from within the page.
        # Use add_init_script to stub fetch before any script runs.
        await page.add_init_script(f"""
        (function() {{
            const origFetch = window.fetch;
            window.fetch = async function(url, opts) {{
                const u = new URL(url, location.href);
                const action = u.searchParams.get('action');
                if (action === 'myExperiments') {{
                    return new Response({repr(MY_EXPS_HTML)}, {{
                        status: 200,
                        headers: {{'Content-Type': 'text/html'}}
                    }});
                }}
                if (action === 'scoreQuery') {{
                    return new Response({repr(SCORE_HTML)}, {{
                        status: 200,
                        headers: {{'Content-Type': 'text/html'}}
                    }});
                }}
                return origFetch.apply(this, arguments);
            }};
        }})();
        """)

        # Also stub chrome.storage.local
        await page.add_init_script("""
        window.chrome = {
            storage: {
                local: {
                    _data: {},
                    get: function(keys, cb) {
                        const result = {};
                        for (const k of keys) result[k] = this._data[k];
                        cb(result);
                    },
                    set: function(obj, cb) {
                        Object.assign(this._data, obj);
                        if (cb) cb();
                    }
                }
            }
        };
        """)

        # Navigate to the list page
        await page.goto("https://wlsy.webvpn.sau.edu.cn/lab2026/index.php?controller=student&action=experimentList")

        # Inject shared.js + content.js
        shared_js = (EXT / "shared.js").read_text(encoding="utf-8")
        content_js = (EXT / "content.js").read_text(encoding="utf-8")
        panel_css = (EXT / "panel.css").read_text(encoding="utf-8")

        # Add CSS
        await page.add_style_tag(content=panel_css)

        # Inject scripts via <script> tags (so top-level const/let are global)
        await page.add_script_tag(content=shared_js)
        await page.add_script_tag(content=content_js)

        # Wait for panel to render
        await page.wait_for_timeout(2000)

        # Assertions
        print("\n--- Assertions ---")

        # 1. Panel exists
        panel = await page.query_selector(".lph-panel")
        check("面板已注入", panel is not None)

        # 2. Status bar contains "已做 1 个"
        sched = await page.query_selector("#lph-sched")
        if sched:
            sched_text = await sched.text_content()
            check("状态栏含「已做 1 个」", "已做 1 个" in sched_text, f"actual: {sched_text[:120]}")
        else:
            check("状态栏存在", False, "#lph-sched not found")

        # 3. Status bar contains "已预约 1 个"
        if sched:
            check("状态栏含「已预约 1 个」", "已预约 1 个" in sched_text, f"actual: {sched_text[:120]}")

        # 4. "直流电桥" row has "已做" badge
        rows = await page.query_selector_all("table tbody tr")
        done_badge_found = False
        reserved_badge_found = False
        ok_badge_found = False
        for row in rows:
            text = await row.text_content()
            if "直流电桥" in text:
                badge = await row.query_selector(".lph-status-tag")
                if badge:
                    badge_text = await badge.text_content()
                    if badge_text and "已做" in badge_text:
                        done_badge_found = True
            if "示波器" in text:
                badge = await row.query_selector(".lph-status-tag")
                if badge:
                    badge_text = await badge.text_content()
                    if badge_text and "已预约" in badge_text:
                        reserved_badge_found = True
            if "拉伸法" in text:
                badge = await row.query_selector(".lph-status-tag")
                if badge:
                    badge_text = await badge.text_content()
                    if badge_text and "可约" in badge_text:
                        ok_badge_found = True

        check("「直流电桥」行有「已做」徽标", done_badge_found)
        check("「示波器」行有「已预约」徽标", reserved_badge_found)
        check("「拉伸法」行有「✓可约」徽标", ok_badge_found)

        # 5. "隐藏已选/已做同类" checkbox is checked by default
        hide_dup = await page.query_selector("#lph-hide-dup")
        if hide_dup:
            is_checked = await hide_dup.is_checked()
            check("「隐藏已选/已做同类」默认勾选", is_checked)
        else:
            check("「隐藏已选/已做同类」复选框存在", False)

        # 6. "直流电桥" row is hidden (display:none) because isDone + hideDup checked
        if rows:
            bridge_row = None
            for row in rows:
                text = await row.text_content()
                if "直流电桥" in text:
                    bridge_row = row
                    break
            if bridge_row:
                is_hidden = await bridge_row.evaluate("el => getComputedStyle(el).display === 'none'")
                check("「直流电桥」行被隐藏（已做+默认隐藏）", is_hidden)
            else:
                check("找到直流电桥行", False)
        else:
            check("表格有数据行", False)

        # 7. Uncheck hide-dup → 直流电桥 row becomes visible
        if hide_dup:
            await hide_dup.uncheck()
            await page.wait_for_timeout(500)
            if bridge_row:
                is_visible = await bridge_row.evaluate("el => getComputedStyle(el).display !== 'none'")
                check("取消勾选后「直流电桥」行可见", is_visible)

        # 8. No JS runtime errors
        check("无 JS 运行时错误", len(errors) == 0, f"errors: {errors[:3]}" if errors else "")

        await page.close()

        # --- Scenario: scoreQuery fetch failure (non-fatal) ---
        print("\n=== Scenario: scoreQuery 请求失败（不影响主流程）===")
        page2 = await browser.new_page()
        errors2 = []
        page2.on("pageerror", lambda e: errors2.append(str(e)))

        await page2.add_init_script(f"""
        (function() {{
            const origFetch = window.fetch;
            window.fetch = async function(url, opts) {{
                const u = new URL(url, location.href);
                const action = u.searchParams.get('action');
                if (action === 'myExperiments') {{
                    return new Response({repr(MY_EXPS_HTML)}, {{
                        status: 200,
                        headers: {{'Content-Type': 'text/html'}}
                    }});
                }}
                if (action === 'scoreQuery') {{
                    return new Response('', {{ status: 500 }});
                }}
                return origFetch.apply(this, arguments);
            }};
        }})();
        """)

        await page2.add_init_script("""
        window.chrome = {
            storage: {
                local: {
                    _data: {},
                    get: function(keys, cb) {
                        const result = {};
                        for (const k of keys) result[k] = this._data[k];
                        cb(result);
                    },
                    set: function(obj, cb) {
                        Object.assign(this._data, obj);
                        if (cb) cb();
                    }
                }
            }
        };
        """)

        await page2.route("**/index.php*", lambda route: route.fulfill(
            status=200,
            content_type="text/html",
            body=LIST_HTML
        ))
        await page2.goto("https://wlsy.webvpn.sau.edu.cn/lab2026/index.php?controller=student&action=experimentList")
        await page2.add_style_tag(content=panel_css)
        await page2.add_script_tag(content=shared_js)
        await page2.add_script_tag(content=content_js)
        await page2.wait_for_timeout(3000)

        # scoreQuery failed → no "已做" in status bar, but "已预约" still works
        sched2 = await page2.query_selector("#lph-sched")
        if sched2:
            sched2_text = await sched2.text_content()
            check("scoreQuery失败时状态栏不含「已做」", "已做" not in sched2_text, f"actual: {sched2_text[:120]}")
            check("scoreQuery失败时「已预约」仍正常", "已预约 1 个" in sched2_text, f"actual: {sched2_text[:120]}")
        else:
            check("状态栏存在", False)

        # 直流电桥 should NOT have "已做" badge (scoreQuery failed)
        rows2 = await page2.query_selector_all("table tbody tr")
        done_badge2 = False
        for row in rows2:
            text = await row.text_content()
            if "直流电桥" in text:
                badge = await row.query_selector(".lph-status-tag")
                if badge:
                    bt = await badge.text_content()
                    if bt and "已做" in bt:
                        done_badge2 = True
        check("scoreQuery失败时「直流电桥」无「已做」徽标", not done_badge2)

        check("scoreQuery失败时无JS错误", len(errors2) == 0, f"errors: {errors2[:3]}" if errors2 else "")

        await page2.close()
        await browser.close()

    # Summary
    passed = sum(1 for t, _, _ in results if t == "PASS")
    failed = sum(1 for t, _, _ in results if t == "FAIL")
    print(f"\n{'='*50}")
    print(f"Total: {len(results)}  PASS: {passed}  FAIL: {failed}")
    return failed == 0


if __name__ == "__main__":
    ok = asyncio.run(run_test())
    sys.exit(0 if ok else 1)
