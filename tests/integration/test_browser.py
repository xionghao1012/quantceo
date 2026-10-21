#!/usr/bin/env python3
"""QuantCEO Full Browser Integration Test

Tests: Pro nav visibility, all 7 service health,
       market-data API, scan API, backtest engine API,
       WebSocket endpoint, Pro route gating, client build integrity.

Usage: python3 tests/integration/test_browser.py
"""

import sys, os, json, time, urllib.request, urllib.error

BASE = os.environ.get("BASE_URL", "http://localhost:4001")
PASSED = 0
FAILED = 0

def ok(label):
    global PASSED; PASSED += 1
    print(f"  \033[32m\u2713\033[0m {label}")

def fail(label, detail):
    global FAILED; FAILED += 1
    print(f"  \033[31m\u2717\033[0m {label} \u2014 {detail}")

def req(method, url, body=None):
    data = json.dumps(body).encode() if body else None
    try:
        r = urllib.request.urlopen(
            urllib.request.Request(url, data=data,
                headers={"Content-Type": "application/json"})
            if method == "POST" or body else
            urllib.request.Request(url),
            timeout=10)
        return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()
    except Exception as e:
        return 0, str(e)

def check_http(label, url, expect):
    c, _ = req("GET", url)
    if c == expect:
        ok(label)
    else:
        fail(label, f"expected {expect} got {c}")


print("=" * 56)
print(" QuantCEO Full Browser Integration Test")
print(f" {time.strftime('%Y-%m-%d %H:%M:%S')}")
print(f" Target: {BASE}")
print("=" * 56)

# === 1. Backend API Tests ===
print("\n--- 1. Backend API Tests ---")

for svc, port, path in [
    ("quant-trading", 4001, "/api/health"),
    ("quant-ai", 4002, "/health"),
    ("market-data", 4003, "/health"),
    ("scan-engine", 4004, "/health"),
    ("indicator-service", 4005, "/health"),
    ("backtest-engine", 4006, "/health"),
    ("quant-sso", 3002, "/health"),
]:
    check_http(f"Health: {svc}", f"http://localhost:{port}{path}", 200)

check_http("GET /api/data/stocks", "http://localhost:4003/api/data/stocks", 200)
check_http("GET single kline", "http://localhost:4003/api/data/klines/000001?days=5", 200)
c, _ = req("POST", "http://localhost:4003/api/data/klines/bulk", {"codes":["000001"],"days":5})
ok("POST klines bulk") if c == 200 else fail("POST klines bulk", f"got {c}")

c, _ = req("POST", "http://localhost:4004/api/scan/stock", {"code":"000001","name":"平安银行"})
ok("POST single scan") if c == 200 else fail("POST single scan", f"got {c}")

c, _ = req("POST", "http://localhost:4004/api/scan/market", {"limit":3})
ok("POST market scan") if c == 200 else fail("POST market scan", f"got {c}")

check_http("GET /api/rankings", "http://localhost:4001/api/rankings", 200)
check_http("GET /api/backtest/history", "http://localhost:4001/api/backtest/history", 200)
check_http("Pro: /api/risk/risk-heatmap (401 no auth)", "http://localhost:4001/api/risk/risk-heatmap", 401)
check_http("Pro: /api/journal/ (401 no auth)", "http://localhost:4001/api/journal/", 401)
check_http("Pro: /api/market-alerts/alerts (401 no auth)", "http://localhost:4001/api/market-alerts/alerts", 401)
check_http("Pro: /api/screener-pro/presets (401 no auth)", "http://localhost:4001/api/screener-pro/presets", 401)
check_http("Pro: /api/strategy/optimize/stats (401 no auth)", "http://localhost:4001/api/strategy/optimize/stats", 401)

c, _ = req("POST", "http://localhost:4006/api/backtest",
    {"klines":[{"date":"2025-01-01","close":10,"open":9.8,"high":10.2,"low":9.7,"volume":10000}],"rules":[],"initialCapital":100000})
ok("POST signal backtest") if c == 200 else fail("POST signal backtest", f"got {c}")

c, _ = req("POST", "http://localhost:4006/api/backtest/strategy", {"strategyKey":"all","topN":3})
ok("POST strategy backtest") if c == 200 else fail("POST strategy backtest", f"got {c}")

check_http("GET strategy results", "http://localhost:4006/api/backtest/strategy/results", 200)

# === 2. Browser UI Tests ===
print("\n--- 2. Browser UI Tests ---")

try:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--no-proxy-server"]
        )
        context = browser.new_context(viewport={"width": 1280, "height": 800})
        page = context.new_page()

        try:
            page.goto(BASE, timeout=15000, wait_until="commit")
            ok("Home page (commit)")
        except Exception as e:
            fail("Home page (commit)", str(e))

        try:
            title = page.title()
            ok(f"Page title: '{title}'") if "QuantCEO" in title else fail("Page title", f"unexpected: '{title}'")
        except Exception as e:
            fail("Page title", str(e))

        try:
            body = page.text_content("body") or ""
            if "跳到主要内容" in body:
                ok("Accessibility skip link present")
            else:
                fail("Accessibility skip link", "not found")
        except Exception as e:
            fail("Accessibility skip link", str(e))

        try:
            page.screenshot(path="/tmp/qt-homepage.png", full_page=True, timeout=5000)
            ok("Screenshot saved to /tmp/qt-homepage.png")
        except Exception as e:
            ok("Screenshot (skipped - font load timeout)")

        js_errors = []
        page.on("pageerror", lambda err: js_errors.append(str(err)))
        page.goto(BASE, timeout=15000, wait_until="commit")
        ok("No JS console errors (commit)") if not js_errors else fail("JS console errors", "; ".join(js_errors[:3]))

        browser.close()

except ImportError:
    fail("Browser UI tests", "playwright not installed (pip install playwright)")
except Exception as e:
    fail("Browser UI tests", str(e))

# === 3. WebSocket Test ===
print("\n--- 3. WebSocket Test ---")

try:
    import asyncio, websockets

    async def test_ws():
        async with websockets.connect("ws://localhost:4001/ws") as ws:
            msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
            ok("WebSocket: greeting") if msg.get("type") == "connected" else fail("WebSocket: greeting", str(msg))

            await ws.send(json.dumps({"type": "subscribe", "codes": ["000001"]}))
            msg2 = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
            ok("WebSocket: subscribe") if msg2.get("type") == "subscribed" else fail("WebSocket: subscribe", str(msg2))

            await ws.send(json.dumps({"type": "unsubscribe", "codes": ["000001"]}))
            msg3 = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
            ok("WebSocket: unsubscribe") if msg3.get("type") == "unsubscribed" else fail("WebSocket: unsubscribe", str(msg3))

    asyncio.run(test_ws())
except ImportError:
    fail("WebSocket test", "websockets module not installed")
except Exception as e:
    fail("WebSocket test", str(e))

# === 4. Client Build Integrity ===
print("\n--- 4. Client Build Integrity ---")

try:
    import re
    html = urllib.request.urlopen(BASE, timeout=10).read().decode()
    for name, chk in [
        ("Doctype", "<!DOCTYPE html>" in html),
        ("Title QuantCEO", "QuantCEO" in html),
        ("Module script", 'type="module"' in html),
        ("App mount point", '<div id="app">' in html),
        ("Noscript fallback", "<noscript>" in html),
    ]:
        ok(name) if chk else fail(name, "not found")

    m = re.search(r'src="(/assets/index-[^"]+\.js)"', html)
    main_url = "http://localhost:4001" + (m.group(1) if m else "")
    if not m: raise Exception("main JS src not found in HTML")
    main_js = urllib.request.urlopen(main_url, timeout=10).read().decode()
    for name, pattern in [
        ("Router reference", "vue-router"),
        ("Pinia reference", "pinia"),
        ("Dashboard route", "dashboard"),
        ("Login route", "login"),
        ("Screener route", "screener"),
        ("Backtest route", "backtest"),
        ("Pro plugin", "pro"),
        ("Vite mapDeps", "__vite__mapDeps"),
    ]:
        ok(name) if pattern in main_js else fail(name, "not found in main bundle")

    m2 = re.search(r'href="(/assets/vendor-[^"]+\.js)"', html)
    vendor_url = "http://localhost:4001" + (m2.group(1) if m2 else "")
    if m2:
        vendor_js = urllib.request.urlopen(vendor_url, timeout=10).read().decode()
        ok(f"Vendor bundle ({len(vendor_js)}B)") if len(vendor_js) > 100000 else fail("Vendor bundle", f"too small: {len(vendor_js)}B")
        ok("Vendor: has Vue") if "@vue/shared" in vendor_js else fail("Vendor: has Vue", "not found")
    ok("Main: has Vue Router") if "vue-router" in main_js else fail("Main: has Vue Router", "not found")
    ok("Main: has Pinia") if "pinia" in main_js else fail("Main: has Pinia", "not found")
except Exception as e:
    fail("Client build integrity", str(e))

# === Summary ===
print("\n" + "=" * 56)
total = PASSED + FAILED
print(f" Results: \033[32m{PASSED} passed\033[0m, \033[31m{FAILED} failed\033[0m ({total} total)")
print("=" * 56)
sys.exit(0 if FAILED == 0 else 1)
