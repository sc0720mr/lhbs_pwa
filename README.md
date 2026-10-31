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
js/holidays.js        節日與補班日清單（決定預設顯示平日或假日）
js/core.js            行為層（不含任何顏色／間距決定）
data/                 TDX 快照與公告設定
images/               安裝步驟圖（WebP，全部 lazy loading）
icon/                 App 圖示（192 / 512 / maskable / apple-touch）
scripts/bump-version.sh  版本號一鍵同步
scripts/update-holidays.js 產生節日清單（半自動，見下節）
tools/                資料產生腳本
```

---

## 預設班表自動切換（6.5.0 新增）

打開 App 時會依「今天」自動決定顯示平日或假日班表，不用再手動切。

**判斷順序（不可顛倒）：**

1. 使用者今天手動選過 → 用他的選擇（只在當天有效，隔天自動失效）
2. 補班日（`workdays`）→ 平日 ← **必須先於節日與週末**，否則補班日會被「週末＝假日」蓋掉
3. 國定假日（`holidays`）→ 假日
4. 週六、週日 → 假日
5. 其餘 → 平日

**日期一律用台北時間**（`Intl.DateTimeFormat` + `Asia/Taipei`），不用 `toISOString()`。
後者取的是 UTC，台北晚上 8 點後會算成隔天 —— 週日晚上 8 點就會跳成「週一平日」。

**畫面上的提示列**（切換鈕下方 12px 小字，一般平日不顯示）：

| 情況 | 顯示文字 | 右側連結 |
|---|---|---|
| 週六／週日 | 今天是週六，已自動切換為假日班表 | 改回平日 |
| 國定假日 | 今天是中秋節，已自動切換為假日班表 | 改回平日 |
| 補班日 | 今天是補班日，已自動切換為平日班表 | 改回假日 |
| 使用者手動改過 | 已手動設為平日（今天有效） | 恢復自動 |
| 一般平日 | 不顯示 | — |

手動選擇存在 `localStorage` 的 `lhbs_daytype_override`，格式
`{ date: 'YYYY-MM-DD', type: 'weekday'|'holiday' }`。讀取時比對日期，
不是今天就自動清除 —— 昨天的選擇不會影響今天。

---

## 每年更新節日清單

```bash
node scripts/update-holidays.js 2027            # 產生 2027 年清單
node scripts/update-holidays.js 2027 --template # 只輸出空白範本
```

**⚠️ 這支腳本是「半自動」，不是全自動。** 原因：

1. 人事行政總處公布的行事曆是「新聞稿 + PDF/ODS 附表」，沒有穩定的 JSON API，
   附表下載連結每次公告都換檔名。
2. 政府資料開放平臺的資料集是 CSV/XML 打包下載，欄位名稱與編碼逐年變動。
3. **最關鍵：放假規則本身會改。** 2025 年修法後取消彈性放假與補班，
   2026 年起 `workdays` 變成空陣列。任何「照去年規則推算」的自動化都會錯。

所以腳本會：嘗試連線 → 抓不到或格式不符就**明確報錯**，並輸出一份
「週末與固定國曆假日已算好」的範本，你只需補農曆節日與補假日期。
**絕不憑印象編造日期** —— 寧可留 TODO，也不要寫錯讓住戶搭錯車。

填完後執行 `./scripts/bump-version.sh <新版本>` 升版。

官方公告：https://www.dgpa.gov.tw/information?pid=12574&uid=83

---

## 手動部署步驟（不透過 git 時）

1. 解壓縮 zip，確認根目錄有 `index.html`、`js/`、`style.css`、`service-worker.js`
2. 登入 GitHub → 進入 `sc0720mr/lhbs_pwa` repo
3. 點 **Add file → Upload files**，把解壓後的所有檔案拖進去
   （GitHub 會覆蓋同名檔案；`js/holidays.js` 是新增檔，會一併上傳）
4. Commit message 填「版本 6.5.0：預設班表自動切換」
5. 等 1～2 分鐘 GitHub Pages 部署完成
6. 開 https://sc0720mr.github.io/lhbs_pwa/?v=check 確認底部版本條顯示
   `LHBS build 6.5.0 / cache v41`
7. 手機上的 App 要**完全關掉再開**（或強制重新整理）才會換到新快取

---

## 本次修正（6.5.0）

1. **預設班表自動切換** —— 新增 `js/holidays.js` 與三層判斷邏輯，
   依台北時間自動決定平日／假日，並提供「改回」與「恢復自動」。
2. **2026 年節日清單** —— 依人事行政總處 115 年辦公日曆表填入 16 筆，
   逐日核對星期。2026 年因修法取消彈性放假，**沒有補班日**。
3. **每年更新腳本** —— `scripts/update-holidays.js`（半自動，見上節）。

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
