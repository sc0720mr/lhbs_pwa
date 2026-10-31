# 水蓮社區巴士時刻表 PWA

水蓮山莊社區巴士、591、F913 公車時刻表與站點資訊，可安裝到手機主畫面、離線可用。

線上網址：https://sc0720mr.github.io/lhbs_pwa/

---

## 版本號怎麼改（重要）

這個專案是純靜態（GitHub Pages），沒有 build 步驟，所以版本號會散落在**四個地方**。
只要漏改一個，瀏覽器就會因為「網址沒變」而命中舊快取，出現「檔案已經改了、畫面卻還是舊的」。

**唯一來源是 `version.json`。** 改版時不要手動改四個檔案，執行：

```bash
./scripts/bump-version.sh 6.4.1        # 指定新版本，cache 版號自動 +1
./scripts/bump-version.sh 6.4.1 v41    # 同時指定 cache 版號
./scripts/bump-version.sh --check      # 只檢查四處是否一致，不改檔
```

腳本會一次同步這四個位置：

| # | 檔案 | 位置 |
|---|---|---|
| 1 | `index.html` | `<meta name="app-version">` 與 `<meta name="app-cache-version">` |
| 2 | `index.html` | 所有 `?v=` 查詢字串（manifest / style.css / js / 安裝步驟圖） |
| 3 | `js/core.js` | `var BUILD = 'LHBS build X.Y.Z / cache vNN'` |
| 4 | `service-worker.js` | `const CACHE_VERSION = 'vNN'` |

改完後：

```bash
git add -A && git commit -m "版本 6.4.1" && git push
```

**驗證線上跑的是哪一版**：開 `https://sc0720mr.github.io/lhbs_pwa/?v=check`，
畫面底部會出現一條黑底綠邊的版本條，顯示 `LHBS build X.Y.Z / cache vNN` 與 CSS 檔名。
或按 F12 開 Console，開頭會有一行綠底標籤。

---

## 目錄結構

```
index.html            單頁應用（四個分頁：時刻表 / 站點 / 電話 / 關於）
style.css             全部樣式（含深色模式、觸控命中區）
manifest.json         PWA manifest
service-worker.js     離線快取（網路優先：index.html、data/*.json；快取優先：其餘靜態資源）
version.json          版本號唯一來源
js/data.js            時刻表資料（由 tools/build_snapshot.py 產生）
js/core.js            行為層（不含任何顏色／間距決定）
data/                 TDX 快照與公告設定
images/               安裝步驟圖（WebP，全部 lazy loading）
icon/                 App 圖示（192 / 512 / maskable / apple-touch）
scripts/bump-version.sh  版本號一鍵同步
tools/                資料產生腳本
```

---

## 本次修正（6.4.0）

1. **版本號收斂成單一來源** —— 新增 `version.json` 與 `scripts/bump-version.sh`，
   四處版本號一次同步。修正前為 `6.3.9 / 6.3.0 / 6.3.2` 三個不一致。
2. **安裝步驟圖改為 lazy loading** —— 10 張圖加上 `loading="lazy"` 與 `decoding="async"`，
   首屏不再下載 323 KB 圖片，切到「關於」分頁才載入。
3. **觸控命中區補到 44px** —— `.iconbtn--sm`（32×32）原本只擴張到 38px，
   補到 `inset: -6px` 後等效 44×44，視覺完全不變。

---

## 本機預覽

```bash
python3 -m http.server 8099
# 開 http://127.0.0.1:8099/index.html
```

Service Worker 需要 http(s)，`file://` 直接開不會註冊。

---

## 授權

見 `LICENSE`。
