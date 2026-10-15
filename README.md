# 水蓮巴士 PWA — 部署與使用說明

本資料夾是完整的 PWA 網站（可直接放到任何靜態主機）。
本版重點：**站點資訊分頁每 30 秒自動更新 TDX 到站資料**，並修正搜尋後的區段間距。

---

## 一、檔案結構

```
.
├── index.html                 主頁（含 4 個分頁：時刻表／站點資訊／電話／關於）
├── manifest.json              PWA 安裝資訊（名稱、主題色、圖示）
├── service-worker.js          Service Worker：App Shell 快取 + 離線支援
├── css/
│   └── lhbs.css               樣式（含站點資訊版面與區段分隔）
├── js/
│   ├── lhbs_114.js            時刻表邏輯（原有）
│   ├── ad.js                  公告／廣告視窗（原有）
│   └── tdx_eta_v2.js          ★ TDX 即時到站：每 30 秒輪詢、就地更新
├── data/
│   └── tdx_snapshot.json      TDX 快照（方案 B 備援資料來源）
├── icon/                      App 圖示（多尺寸）
├── images/                    安裝教學用圖（iOS／Android 步驟圖）
├── worker/                    ★ 即時模式（方案 A）
│   ├── cloudflare-worker.js   Cloudflare Worker 代理程式碼
│   ├── worker-setup.md        Worker 逐步部署教學
│   └── snapshot-mode.md       方案 B 快照備援模式說明
└── tools/
    └── build_snapshot.py      重建 data/tdx_snapshot.json 的腳本
```

---

## 二、部署到 GitHub 的 `lhbs_pwa` 專案

### 方式 A：用網頁介面上傳（最簡單，不用裝任何工具）

1. 登入 GitHub，進入你的 `lhbs_pwa` repo。
2. 點 **Add file** → **Upload files**。
3. 把本資料夾內**所有檔案與子資料夾**（`index.html`、`manifest.json`、`service-worker.js`、`css/`、`js/`、`data/`、`icon/`、`images/`、`worker/`、`tools/`）一起拖進去。
   - ⚠️ **不要把整個外層資料夾拖進去**，否則網址會多一層。
     正確：repo 根目錄下就看得到 `index.html`。
4. 下方 Commit message 填「更新 PWA（即時到站 + 版面修正）」，點 **Commit changes**。
5. 若想一次把整個專案換掉，可先刪除舊檔再上傳（或在 commit 時讓同名檔案被覆蓋）。

### 方式 B：用 git 指令

```bash
# 1. 取得 repo（若尚未 clone）
git clone https://github.com/<你的帳號>/lhbs_pwa.git
cd lhbs_pwa

# 2. 清空舊檔（保留 .git），把新版檔案複製進來
#    （把 <解壓縮後的資料夾> 換成本包解壓後的路徑）
rm -rf index.html css js data manifest.json service-worker.js icon images worker tools
cp -r <解壓縮後的資料夾>/* .

# 3. 提交並推上去
git add -A
git commit -m "更新 PWA：站點資訊每 30 秒即時更新、修正區段間距"
git push origin main
```

> 分支名稱可能是 `main` 或 `master`，依你的 repo 而定。

---

## 三、確認 GitHub Pages 設定

1. 進入 repo → **Settings** → 左側 **Pages**。
2. **Source** 選 **Deploy from a branch**。
3. **Branch** 選 `main`（或 `master`），資料夾選 **`/ (root)`** → **Save**。
4. 等 1～2 分鐘，頁面上方會出現網站網址。

### 部署後的網址格式

| repo 名稱 | 網址 |
|---|---|
| `lhbs_pwa` | `https://<你的帳號>.github.io/lhbs_pwa/` |
| `<你的帳號>.github.io`（特例 repo） | `https://<你的帳號>.github.io/` |

例如你的帳號是 `sc0720mr`、repo 是 `lhbs_pwa`，網址就是：

```
https://sc0720mr.github.io/lhbs_pwa/
```

> ⚠️ **必須使用 HTTPS**（GitHub Pages 預設提供），Service Worker 與「安裝 App」才會運作。

---

## 四、手機安裝 PWA

### Android（Chrome）

1. 用 Chrome 開啟網站網址。
2. 畫面下方或右上選單會出現 **「安裝應用程式 / 加到主畫面」**；網站內也會出現 **「安裝 App」** 按鈕。
3. 點下去 → 確認 → 主畫面就會出現「水蓮巴士」圖示。
4. 之後點圖示即可以全螢幕 App 模式開啟，並支援離線瀏覽。

### iOS（Safari）

1. **必須用 Safari** 開啟網站網址（Chrome 在 iOS 無法安裝）。
2. 點下方 **分享** 鈕（方框加向上箭頭）。
3. 選 **「加入主畫面」** → **新增**。
4. 主畫面就會出現「水蓮巴士」圖示。

> 網站「關於」分頁內也附有 iOS／Android 的圖文步驟（`images/` 內的圖）。

---

## 五、選擇資料模式（快照 vs 即時）

本版支援兩種模式，**預設是快照模式，不需要任何後端**：

| 模式 | 設定 | 行為 |
|---|---|---|
| **B. 快照（預設）** | `window.TDX_PROXY_URL = ''` | 讀 `data/tdx_snapshot.json`；面板標示「快照資料（非即時）」 |
| **A. 即時（推薦）** | `window.TDX_PROXY_URL = 'https://<你的-worker>.workers.dev'` | 每 30 秒打代理取得即時資料；面板標示「即時模式」 |

要開啟即時模式，請照 **`worker/worker-setup.md`** 部署 Cloudflare Worker（免費），
然後編輯 `index.html` 最下方這行填入 Worker 網址：

```html
<script>/* ... */ window.TDX_PROXY_URL = 'https://<你的-worker>.workers.dev';</script>
```

> 為什麼一定要代理？TDX 官方 API 沒有回傳 CORS 標頭，瀏覽器無法直接呼叫；
> 且 Client Secret 絕不可放在前端。Worker 在伺服器端處理金鑰與跨域。

---

## 六、站點資訊分頁的更新機制（本版新增）

- **每 30 秒**自動重新取得 TDX 到站資料（`setInterval`）。
- **只在「站點資訊」分頁輪詢**：切到時刻表／電話／關於時會自動暫停，節省流量與 TDX API 額度。
- **切回前景立即更新**：手機切回瀏覽器或從背景喚醒時（`visibilitychange`）馬上更新一次。
- **就地更新、不閃爍**：只改到站時間的文字，不重建 DOM，捲動位置不會跑掉。
- 面板顯示：**最後更新時間**、**倒數 XX 秒後更新**、**即時模式／快照資料** 標籤。
- 到站顯示規則：≤30 秒「進站中」、<1 分「即將到站」、其餘「約 XX 分到站」，**不限時間長短**（超過一小時也顯示）。
- 末班車已過、今日未營運、交管不停靠、無預估時間者不顯示。
- 社巴（非 TDX 路線）維持原樣，不顯示即時到站。

---

## 七、看到舊版快取怎麼辦（重要）

PWA 的 Service Worker 會快取檔案，更新後手機可能仍顯示舊版。處理方式：

1. **先嘗試**：在網站上重新整理 1～2 次（Service Worker 已升版並會自動更新）。
2. **仍為舊版時**，清除網站資料：
   - **Android Chrome**：網址列左側「鎖頭／調整」圖示 → 網站設定 → **清除與重設** → 回到網站重新整理。
   - **iOS Safari**：設定 App → Safari → 進階 → 網站資料 → 找到該網站 → 刪除；或刪除主畫面圖示後重新「加入主畫面」。
   - **電腦版 Chrome**：F12 開發者工具 → **Application** → **Service Workers** → 勾 **Update on reload**；或 **Storage** → **Clear site data**。
3. 本版已將 Service Worker 快取名稱升為 **`lhbs-pwa-v7`**，樣式版本改為
   **`lhbs.css?v=1.0.21`**，腳本為 **`tdx_eta_v2.js?v=1`**，正常情況下重新整理即會取得新版。
   （樣式版本一定要換，否則住戶瀏覽器會沿用舊的 lhbs.css 快取，看不到新的區段間距。）

---

## 八、更新 TDX 快照（快照模式用）

快照會隨時間變舊。要更新時，在**可以連外網的電腦**上執行：

```bash
cd tools
python3 build_snapshot.py \
  --client-id sc0720mr-3f77b43a-75ad-475b \
  --client-secret <你的 TDX Client Secret> \
  --out ../data/tdx_snapshot.json
```

執行完把 `data/tdx_snapshot.json` 上傳覆蓋網站上的同名檔案即可。
（若已部署 Worker 即時模式，就不需要手動更新快照。）

---

## 九、安全提醒

- **TDX Client Secret 不可放在前端**（`index.html`、`js/` 一律不得出現）。
  即時模式請把金鑰放在 Cloudflare Worker 的加密環境變數。
- 建議把 TDX Client Id／Secret 定期更換，並在 TDX 平台設定用量提醒。
- Worker 的 `ALLOWED_ORIGIN` 上線穩定後可從 `*` 改為你的網域，避免被他人轉用。
