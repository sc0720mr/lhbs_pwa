# 方案 B：免後端的快照備援模式（預設）

若你**還沒有部署代理端點**，網站依然可以完整運作，不會壞掉。

---

## 運作方式

- 網站讀取建置時抓取的 `data/tdx_snapshot.json`，其中已包含每條路線、每個站點的
  **預估到站時間（秒）**、**狀態碼** 與 **TDX 更新時間**。
- 站點資訊面板會明確標示：
  - 標籤顯示 **「快照資料（非即時）」**（紅色標籤，若資料超過 6 分鐘）。
  - 狀態列顯示 **「TDX 到站資訊已更新（快照資料，非即時）」**。
  - 摘要文字加上「目前為快照資料、非即時」。
- 到站時間的**顯示規則完全相同**（進站中／約 XX 分到站／不限時間長短）。

也就是說：**功能一樣，差別只在「資料是不是剛剛抓的」。**

---

## 快照與即時的差異

| | 快照模式（方案 B） | 即時模式（方案 A） |
|---|---|---|
| 需要後端 | 不需要 | 需要 Cloudflare Worker |
| 資料新鮮度 | 建置／更新快照的那一刻 | 每 30 秒 |
| 面板標籤 | 快照資料（非即時） | 即時模式 |
| 離線可用 | 可以（Service Worker 快取） | 快照仍可離線顯示 |
| 適合情境 | 想先上線、驗收版面；住戶偶爾查 | 住戶要看到「現在幾分鐘到站」 |

---

## 如何手動更新快照（讓資料變新）

快照是「抓取當下的 TDX 資料」。TDX 未開放瀏覽器跨域，所以**必須在伺服器端**抓。

### 方式一：使用附帶的腳本（推薦）

本專案附有 `tools/build_snapshot.py`，會：
1. 用 Client Id / Secret 取得 TDX access token。
2. 抓取 591 與 F913 的 `StopOfRoute` 與 `EstimatedTimeOfArrival`。
3. 依「站序」對齊本頁 10 個區段，產生新的 `data/tdx_snapshot.json`。

執行：

```bash
cd tools
python3 build_snapshot.py --client-id sc0720mr-3f77b43a-75ad-475b \
                          --client-secret <你的 Secret> \
                          --out ../data/tdx_snapshot.json
```

> 需要一台可以連外網的電腦（你的筆電即可），執行完把產生的
> `data/tdx_snapshot.json` 上傳覆蓋網站上的同名檔案。

### 方式二：改成「真正的即時」

直接部署方案 A 的 Cloudflare Worker，前端每 30 秒自動更新，就不需要手動更新快照了。
詳見 `worker-setup.md`。

---

## 自動化建議

若想「每天自動更新快照」，可用 GitHub Actions 每天定時執行
`tools/build_snapshot.py` 並 commit 回 repo（TDX 金鑰放在 GitHub Secrets）。
由於社區巴士班次時刻變動不頻繁，通常一天更新一次、甚至每週一次就很夠用。
