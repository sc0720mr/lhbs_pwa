#!/usr/bin/env python3
"""重建 TDX 到站快照 data/tdx_snapshot.json（水蓮社區巴士及公車時刻表 PWA）

用途：TDX 官方 API 未開放瀏覽器跨域（CORS），前端無法直接呼叫，
      因此即時資料必須在伺服器端抓取後寫入快照檔。

本腳本會：
  1. 以 Client Id / Secret 取得 TDX access token（OAuth client_credentials）
  2. 抓取 591 與 F913（含 F913延）的 StopOfRoute 與 EstimatedTimeOfArrival
  3. 依「站序」把本頁 10 個區段的站點，對應到 TDX 的正確站點
     （不用站名比對，因為站名做過住戶友善化，且迴圈路線會重複經過同一站）
  4. 輸出 data/tdx_snapshot.json

用法：
  python3 build_snapshot.py --client-id <ID> --client-secret <SECRET> \
                            --html ../index.html --out ../data/tdx_snapshot.json
"""
import argparse
import datetime
import gzip
import html as htmlmod
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

TOKEN_URL = ("https://tdx.transportdata.tw/auth/realms/TDXConnect/"
             "protocol/openid-connect/token")
API_BASE = "https://tdx.transportdata.tw/api/basic"
CITY = "NewTaipei"   # 社區路線 591 / F913 屬於新北市，不是台北市
ROUTES = ["591", "F913"]

# 本頁「站點資訊」分頁的區段索引 → (TDX 路線, 方向, 起始站序, 結束站序)
# 迴圈路線（F913）去程與回程共用同一個 Direction，只是 StopSequence 區段不同。
SECTION_MAPPING = {
    4: ("591", 0, 1, 15),
    5: ("591", 1, 1, 14),
    6: ("F913", 0, 1, 38),
    7: ("F913", 0, 38, 77),
    8: ("F913", 0, 1, 41),
    9: ("F913", 0, 41, 83),
}
EXPECTED_COUNTS = [6, 8, 11, 9, 15, 14, 38, 40, 41, 43]


def get_token(cid, csec):
    data = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "client_id": cid,
        "client_secret": csec,
    }).encode()
    req = urllib.request.Request(
        TOKEN_URL, data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["access_token"]


def api_get(path, token, tries=4):
    for i in range(tries):
        req = urllib.request.Request(
            API_BASE + path, headers={"Authorization": "Bearer " + token})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
                return json.loads(raw)
        except Exception as exc:  # noqa: BLE001
            if i == tries - 1:
                raise
            print("   重試 %d：%s %s" % (i + 1, type(exc).__name__, str(exc)[:100]),
                  file=sys.stderr)
            time.sleep(4 + 3 * i)
    return None


def parse_page_sections(html_path):
    """從 index.html 解析出「站點資訊」分頁的區段標題與站點數。"""
    src = open(html_path, encoding="utf-8").read()
    start = src.index('<section id="content2">')
    end = src.index('<section id="content3">') if '<section id="content3">' in src \
        else src.index('<section id="content4">')
    c2 = src[start:end]
    parts = re.split(r'(?=<div class="bus_stops)', c2)
    out = []
    for part in parts:
        h3 = re.search(r"<h3>(.*?)</h3>", part, re.S)
        if not h3:
            continue
        title = htmlmod.unescape(h3.group(1).strip())
        stops = re.findall(r'<div class="stop_item">\s*<div></div>\s*<div><a href="[^"]*"[^>]*>(.*?)</a>',
                           part, re.S)
        out.append({"title": title,
                    "names": [htmlmod.unescape(s.strip()) for s in stops]})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--client-id", required=True)
    ap.add_argument("--client-secret", required=True)
    ap.add_argument("--html", default=os.path.join(os.path.dirname(__file__), "..", "index.html"))
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "data", "tdx_snapshot.json"))
    args = ap.parse_args()

    print("1/4 取得 TDX access token …")
    token = get_token(args.client_id, args.client_secret)

    raw = {}
    print("2/4 抓取 TDX 資料（每筆間隔 3 秒避免 429）…")
    for route in ROUTES:
        flt = urllib.parse.quote("RouteName/Zh_tw eq '%s'" % route)
        for name, path in (
            ("sor", "/v2/Bus/StopOfRoute/City/%s?$filter=%s&$top=1000&$format=JSON" % (CITY, flt)),
            ("eta", "/v2/Bus/EstimatedTimeOfArrival/City/%s?$filter=%s&$top=1000&$format=JSON" % (CITY, flt)),
        ):
            key = "%s_%s" % (route, name)
            raw[key] = api_get(path, token)
            print("   %s -> %s 筆" % (key, len(raw[key]) if isinstance(raw[key], list) else "?"))
            time.sleep(3)

    print("3/4 依站序對齊 10 個區段 …")
    sections_in = parse_page_sections(args.html)

    # 建立 TDX 各路線的站序清單
    def stop_list(items, want_sub=None):
        for it in items:
            if want_sub is None:
                return it["Stops"]
            if it.get("SubRouteName", {}).get("Zh_tw") == want_sub:
                return it["Stops"]
        return None

    sor591 = raw["591_sor"]
    sorF913 = raw["F913_sor"]
    lists = {
        ("591", 0): stop_list([i for i in sor591 if i["Direction"] == 0]),
        ("591", 1): stop_list([i for i in sor591 if i["Direction"] == 1]),
        ("F913", 0): stop_list([i for i in sorF913 if i.get("SubRouteName", {}).get("Zh_tw") == "F913"]),
        ("F913", 0, "ext"): stop_list([i for i in sorF913 if i.get("SubRouteName", {}).get("Zh_tw") != "F913"]),
    }

    eta_index = {}
    for key in ("591_eta", "F913_eta"):
        for it in raw[key] or []:
            rn = it["RouteName"]["Zh_tw"]
            eta_index[(rn, it.get("Direction", 0), str(it["StopID"]))] = it

    sections = []
    for idx, sec in enumerate(sections_in):
        got = len(sec["names"])
        want = EXPECTED_COUNTS[idx] if idx < len(EXPECTED_COUNTS) else got
        if got != want:
            print("   !! 區段 %d「%s」站點數 %d != 預期 %d"
                  % (idx, sec["title"], got, want), file=sys.stderr)
        m = SECTION_MAPPING.get(idx)
        if not m:
            sections.append({"title": sec["title"], "routeName": None,
                             "direction": None, "stops": []})
            continue
        route, direction, seq1, seq2 = m
        lst = lists.get((route, direction, "ext")) if idx in (8, 9) else lists.get((route, direction))
        rows = []
        for seq in range(seq1, seq2 + 1):
            st = lst[seq - 1]
            e = eta_index.get((route, direction, str(st["StopID"])))
            rows.append({
                "stopID": str(st["StopID"]),
                "estimateTime": (e or {}).get("EstimateTime"),
                "stopStatus": (e or {}).get("StopStatus"),
                "srcUpdateTime": (e or {}).get("SrcUpdateTime") or (e or {}).get("UpdateTime"),
            })
        sections.append({"title": sec["title"], "routeName": route,
                         "direction": direction, "stops": rows})
        print("   區段 %d %-30s route=%s 站點=%d" % (idx, sec["title"][:30], route, len(rows)))

    now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8)))
    snapshot = {
        "generatedAt": now.strftime("%Y-%m-%dT%H:%M:%S+08:00"),
        "source": "TDX 新北市公車 EstimatedTimeOfArrival / StopOfRoute（站序對齊）",
        "sections": sections,
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(snapshot, fh, ensure_ascii=False, indent=1)

    print("4/4 已寫入 %s" % args.out)
    print("   generatedAt = %s" % snapshot["generatedAt"])
    shown = sum(1 for s in sections for x in s["stops"]
                if x["estimateTime"] is not None and x["stopStatus"] in (0, 1))
    print("   顯示到站時間的站點數：%d" % shown)


if __name__ == "__main__":
    main()
