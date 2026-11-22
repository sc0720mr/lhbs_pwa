#!/usr/bin/env python3
"""重建 TDX 到站快照 data/tdx_snapshot.json（水蓮社區巴士及公車時刻表 PWA）

用途：TDX 官方 API 未開放瀏覽器跨域（CORS），前端無法直接呼叫，
      因此即時資料必須在伺服器端抓取後寫入快照檔。

本腳本會：
  1. 以 Client Id / Secret 取得 TDX access token（OAuth client_credentials）
  2. 抓取 591 與 F913（含 F913延）的 StopOfRoute 與 EstimatedTimeOfArrival
  3. 從 js/data.js 讀出本頁 10 個區段的站點（含經緯度），
     以「經緯度最近鄰 + 站序遞增」對應到 TDX 的正確站點
     （不用站名比對，因為站名做過住戶友善化，且迴圈路線會重複經過同一站）
  4. 輸出 data/tdx_snapshot.json

用法：
  python3 build_snapshot.py --client-id <ID> --client-secret <SECRET> \
                            --data-js ../js/data.js --out ../data/tdx_snapshot.json

重要變更（v2）：
  舊版從 index.html 解析 <section id="content2"> 的靜態站點區塊。
  網站改版後 index.html 只剩 4 個 <section class="panel"> 分頁，
  站點資料已移到 js/data.js 的 window.LHBS_DATA.sections。
  本版改讀 js/data.js，並在找不到預期結構時給出明確錯誤訊息。
"""
import argparse
import datetime
import gzip
import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request

TOKEN_URL = os.environ.get(
    "TDX_TOKEN_URL",
    "https://tdx.transportdata.tw/auth/realms/TDXConnect/"
    "protocol/openid-connect/token")
API_BASE = os.environ.get("TDX_API_BASE", "https://tdx.transportdata.tw/api/basic")
CITY = "NewTaipei"   # 社區路線 591 / F913 屬於新北市，不是台北市
ROUTES = ["591", "F913"]

# 本頁區段索引 → (TDX 路線, 方向, 子路線, 起始站序, 結束站序)
# 迴圈路線（F913）去程與回程共用同一個 Direction，只是 StopSequence 區段不同。
# 社巴（0-3）沒有 TDX 資料，route 為 None。
SECTION_MAPPING = {
    0: (None, None, None, None, None),      # 社巴平日去程
    1: (None, None, None, None, None),      # 社巴平日回程
    2: (None, None, None, None, None),      # 社巴假日去程
    3: (None, None, None, None, None),      # 社巴假日回程
    4: ("591", 0, None, 1, 15),
    5: ("591", 1, None, 1, 14),
    6: ("F913", 0, "F913", 1, 38),
    7: ("F913", 0, "F913", 38, 77),
    8: ("F913", 0, "ext", 1, 41),
    9: ("F913", 0, "ext", 41, 83),
}

# 經緯度對應容許誤差（公尺）。超過就退回站序對應並警告。
MATCH_TOLERANCE_M = 80.0


class SnapshotError(Exception):
    """可預期的錯誤：印出清楚訊息後以非 0 結束，不丟 traceback。"""


# --------------------------------------------------------------------------
# 1. 讀取 js/data.js
# --------------------------------------------------------------------------
def _extract_js_object(src, marker="window.LHBS_DATA"):
    """從 JS 檔取出 marker 之後的第一個 JSON 物件（大括號配對）。"""
    idx = src.find(marker)
    if idx < 0:
        raise SnapshotError(
            "在檔案中找不到 `%s`。\n"
            "  預期 js/data.js 內有 `window.LHBS_DATA = { ... }`。\n"
            "  請確認 --data-js 指向正確的檔案（應為 repo 的 js/data.js）。" % marker)
    start = src.find("{", idx)
    if start < 0:
        raise SnapshotError("找到 `%s` 但後面沒有 `{`，檔案可能已損毀。" % marker)

    depth = 0
    in_str = False
    quote = ""
    esc = False
    for i in range(start, len(src)):
        ch = src[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == quote:
                in_str = False
            continue
        if ch in "\"'":
            in_str = True
            quote = ch
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return src[start:i + 1]
    raise SnapshotError("`%s` 的物件大括號沒有閉合，檔案可能被截斷。" % marker)


def parse_sections_from_data_js(path):
    """從 js/data.js 解析出 10 個區段的標題與站點（含經緯度）。"""
    if not os.path.isfile(path):
        raise SnapshotError(
            "找不到資料檔：%s\n"
            "  請確認路徑。若你在 repo 根目錄執行，應為 --data-js js/data.js" % path)

    with open(path, encoding="utf-8") as fh:
        src = fh.read()

    raw = _extract_js_object(src)
    try:
        obj = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise SnapshotError(
            "js/data.js 的 LHBS_DATA 不是合法 JSON：%s\n"
            "  （位置：第 %d 行第 %d 欄）" % (exc.msg, exc.lineno, exc.colno))

    sections = obj.get("sections")
    if not isinstance(sections, list) or not sections:
        raise SnapshotError(
            "js/data.js 內沒有 `sections` 陣列，或它是空的。\n"
            "  目前頂層鍵：%s" % ", ".join(sorted(obj.keys())))

    out = []
    for i, sec in enumerate(sections):
        if not isinstance(sec, dict):
            raise SnapshotError("sections[%d] 不是物件。" % i)
        stops = sec.get("stops")
        if not isinstance(stops, list):
            raise SnapshotError(
                "sections[%d]「%s」沒有 `stops` 陣列。" % (i, sec.get("title", "?")))
        out.append({
            "title": sec.get("title") or sec.get("label") or ("區段 %d" % i),
            "route": sec.get("route"),
            "dir": sec.get("dir"),
            "day": sec.get("day"),
            "stops": [{
                "name": s.get("name"),
                "lat": _to_float(s.get("lat")),
                "lng": _to_float(s.get("lng")),
            } for s in stops],
        })

    if len(out) != len(SECTION_MAPPING):
        print("   !! js/data.js 有 %d 個區段，但 SECTION_MAPPING 定義了 %d 個。"
              % (len(out), len(SECTION_MAPPING)), file=sys.stderr)
        print("      多出的區段會以「無 TDX 資料」輸出。", file=sys.stderr)
    return out


def _to_float(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


# --------------------------------------------------------------------------
# 2. TDX API
# --------------------------------------------------------------------------
def get_token(cid, csec):
    data = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "client_id": cid,
        "client_secret": csec,
    }).encode()
    req = urllib.request.Request(
        TOKEN_URL, data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)["access_token"]
    except urllib.error.HTTPError as exc:
        body = exc.read()[:300].decode("utf-8", "replace")
        if exc.code in (400, 401):
            raise SnapshotError(
                "TDX 授權失敗（HTTP %d）：Client Id / Secret 可能填錯或已失效。\n"
                "  回應：%s" % (exc.code, body))
        if exc.code == 429:
            raise SnapshotError(
                "TDX 授權被限流（HTTP 429）：短時間內取 token 太多次。\n"
                "  請等 1 分鐘後再跑一次。回應：%s" % body)
        raise SnapshotError("TDX 授權端點回應 HTTP %d：%s" % (exc.code, body))
    except urllib.error.URLError as exc:
        raise SnapshotError(
            "連不上 TDX 授權端點：%s\n"
            "  若為 SSL 憑證錯誤，請確認系統時間正確，或設定 SSL_CERT_FILE。" % exc.reason)


def api_get(path, token, tries=4):
    last = None
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
            last = exc
            if i == tries - 1:
                break
            print("   重試 %d：%s %s" % (i + 1, type(exc).__name__, str(exc)[:100]),
                  file=sys.stderr)
            time.sleep(4 + 3 * i)
    raise SnapshotError("TDX API 連續 %d 次失敗：%s\n  路徑：%s"
                        % (tries, last, path))


# --------------------------------------------------------------------------
# 3. 站點對應
# --------------------------------------------------------------------------
def haversine_m(lat1, lng1, lat2, lng2):
    if None in (lat1, lng1, lat2, lng2):
        return float("inf")
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def stop_pos(st):
    pos = st.get("StopPosition") or {}
    return _to_float(pos.get("PositionLat")), _to_float(pos.get("PositionLon"))


def pick_stop_list(items, route, direction, subroute):
    """從 StopOfRoute 回應挑出指定路線／方向／子路線的站序清單。"""
    cands = [it for it in (items or []) if it.get("Direction") == direction]
    if not cands:
        raise SnapshotError(
            "TDX 沒有回傳 %s 方向 %s 的 StopOfRoute。" % (route, direction))

    if subroute == "ext":
        # F913延：子路線名稱不是 "F913"
        picked = [it for it in cands
                  if (it.get("SubRouteName") or {}).get("Zh_tw") not in (None, route)]
        if not picked:
            names = sorted({(it.get("SubRouteName") or {}).get("Zh_tw") for it in cands})
            raise SnapshotError(
                "找不到 %s 的延伸子路線（F913延）。TDX 目前子路線：%s"
                % (route, ", ".join(str(n) for n in names)))
        return picked[0]["Stops"]

    picked = [it for it in cands
              if (it.get("SubRouteName") or {}).get("Zh_tw") in (None, route)]
    if not picked:
        picked = cands
    return picked[0]["Stops"]


def align_section(sec, tdx_stops, seq1, seq2, idx):
    """把 data.js 的站點對應到 TDX 站點，回傳 [{stopID, ...}]。

    策略：以經緯度最近鄰為主、站序遞增為約束；對不到就退回站序。
    """
    window = tdx_stops[seq1 - 1:seq2]
    if len(window) != len(sec["stops"]):
        print("   !! 區段 %d「%s」：data.js 有 %d 站，TDX 站序 %d-%d 有 %d 站"
              % (idx, sec["title"][:24], len(sec["stops"]), seq1, seq2, len(window)),
              file=sys.stderr)

    rows = []
    cursor = 0
    used_seq_fallback = 0
    for n, st in enumerate(sec["stops"]):
        best_i, best_d = None, float("inf")
        for j in range(cursor, len(window)):
            tlat, tlng = stop_pos(window[j])
            d = haversine_m(st["lat"], st["lng"], tlat, tlng)
            if d < best_d:
                best_d, best_i = d, j
        if best_i is not None and best_d <= MATCH_TOLERANCE_M:
            cursor = best_i + 1
            chosen = window[best_i]
        else:
            # 退回站序
            if n < len(window):
                chosen = window[n]
                cursor = n + 1
                used_seq_fallback += 1
            else:
                raise SnapshotError(
                    "區段 %d「%s」第 %d 站「%s」對不到 TDX 站點，且站序超出範圍。\n"
                    "  data.js 有 %d 站，TDX 只有 %d 站。請確認路線是否改點。"
                    % (idx, sec["title"], n + 1, st["name"], len(sec["stops"]), len(window)))
        rows.append({"stopID": str(chosen["StopID"]), "_seq": chosen.get("StopSequence")})

    if used_seq_fallback:
        print("   !! 區段 %d：%d 站以站序退回對應（經緯度誤差 > %.0fm）"
              % (idx, used_seq_fallback, MATCH_TOLERANCE_M), file=sys.stderr)
    return rows


# --------------------------------------------------------------------------
# 4. 主流程
# --------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(
        description="重建 TDX 到站快照（讀 js/data.js 的站點結構）")
    ap.add_argument("--client-id", required=True)
    ap.add_argument("--client-secret", required=True)
    ap.add_argument("--data-js", default=None,
                    help="js/data.js 路徑（預設 ../js/data.js）")
    ap.add_argument("--html", default=None,
                    help="（已停用）舊版讀 index.html；給此參數會自動改用同層的 js/data.js")
    ap.add_argument("--out", default=None,
                    help="輸出檔（預設 ../data/tdx_snapshot.json）")
    args = ap.parse_args()

    here = os.path.dirname(os.path.abspath(__file__))
    repo = os.path.dirname(here)

    data_js = args.data_js
    if not data_js and args.html:
        # 相容舊指令：--html ../index.html → 自動找 ../js/data.js
        guess = os.path.join(os.path.dirname(os.path.abspath(args.html)), "js", "data.js")
        print("注意：--html 已停用（index.html 不再包含站點區塊）。")
        print("      自動改用：%s" % guess)
        data_js = guess
    if not data_js:
        data_js = os.path.join(repo, "js", "data.js")

    out_path = args.out or os.path.join(repo, "data", "tdx_snapshot.json")

    print("1/4 讀取站點結構 %s …" % data_js)
    sections_in = parse_sections_from_data_js(data_js)
    print("   共 %d 個區段，%d 個站點"
          % (len(sections_in), sum(len(s["stops"]) for s in sections_in)))

    print("2/4 取得 TDX access token …")
    token = get_token(args.client_id, args.client_secret)

    raw = {}
    print("3/4 抓取 TDX 資料（每筆間隔 3 秒避免 429）…")
    for route in ROUTES:
        flt = urllib.parse.quote("RouteName/Zh_tw eq '%s'" % route)
        for name, path in (
            ("sor", "/v2/Bus/StopOfRoute/City/%s?$filter=%s&$top=1000&$format=JSON"
                    % (CITY, flt)),
            ("eta", "/v2/Bus/EstimatedTimeOfArrival/City/%s?$filter=%s&$top=1000&$format=JSON"
                    % (CITY, flt)),
        ):
            key = "%s_%s" % (route, name)
            raw[key] = api_get(path, token)
            print("   %s -> %s 筆"
                  % (key, len(raw[key]) if isinstance(raw[key], list) else "?"))
            time.sleep(3)

    print("4/4 依站序＋經緯度對齊 %d 個區段 …" % len(sections_in))

    eta_index = {}
    for key in ("591_eta", "F913_eta"):
        for it in raw.get(key) or []:
            rn = (it.get("RouteName") or {}).get("Zh_tw")
            eta_index[(rn, it.get("Direction", 0), str(it.get("StopID")))] = it

    sections = []
    for idx, sec in enumerate(sections_in):
        m = SECTION_MAPPING.get(idx)
        if not m or m[0] is None:
            sections.append({"title": sec["title"], "routeName": None,
                             "direction": None, "stops": []})
            print("   區段 %d %-28s 社巴（無 TDX 資料）" % (idx, sec["title"][:28]))
            continue

        route, direction, subroute, seq1, seq2 = m
        tdx_stops = pick_stop_list(raw.get("%s_sor" % route), route, direction, subroute)
        aligned = align_section(sec, tdx_stops, seq1, seq2, idx)

        rows = []
        for a in aligned:
            e = eta_index.get((route, direction, a["stopID"])) or {}
            rows.append({
                "stopID": a["stopID"],
                "estimateTime": e.get("EstimateTime"),
                "stopStatus": e.get("StopStatus"),
                "srcUpdateTime": e.get("SrcUpdateTime") or e.get("UpdateTime"),
            })
        sections.append({"title": sec["title"], "routeName": route,
                         "direction": direction, "stops": rows})
        print("   區段 %d %-28s route=%s 站點=%d"
              % (idx, sec["title"][:28], route, len(rows)))

    now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8)))
    snapshot = {
        "generatedAt": now.strftime("%Y-%m-%dT%H:%M:%S+08:00"),
        "source": "TDX 新北市公車 EstimatedTimeOfArrival / StopOfRoute（站序對齊）",
        "sections": sections,
    }

    total = sum(len(s["stops"]) for s in sections)
    if total == 0:
        raise SnapshotError(
            "產出的快照 0 個站點，拒絕寫檔（避免覆蓋掉可用的舊快照）。")

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(snapshot, fh, ensure_ascii=False, indent=1)

    shown = sum(1 for s in sections for x in s["stops"]
                if x["estimateTime"] is not None and x["stopStatus"] in (0, 1))
    print()
    print("完成：已寫入 %s" % out_path)
    print("  generatedAt = %s" % snapshot["generatedAt"])
    print("  區段數 = %d，站點總數 = %d" % (len(sections), total))
    print("  有到站時間的站點數 = %d" % shown)


if __name__ == "__main__":
    try:
        main()
    except SnapshotError as exc:
        print("\n[錯誤] %s" % exc, file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print("\n已中止。", file=sys.stderr)
        sys.exit(130)
