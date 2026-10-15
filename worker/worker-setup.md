# 方案 A：部署 Cloudflare Worker 代理（可真正即時更新）

> 為什麼需要代理？TDX 官方 API（`tdx.transportdata.tw`）**不回傳 CORS 標頭**，
> 瀏覽器無法直接跨域呼叫；而且 **Client Secret 絕對不能放在前端**。
> 這個 Worker 在伺服器端用 Client Id / Secret 取得 access token，代打 TDX API，
> 再補上 CORS 標頭把 JSON 回傳給你的網頁。**免費方案即可**。

---

## 一、登入 Cloudflare

1. 前往 <https://dash.cloudflare.com/> ，註冊或登入（免費帳號即可，不需要有網域）。
2. 左側選單點 **Workers & Pages** → **Create** → 選 **Create Worker**。
3. 幫 Worker 取個名字，例如 `lhbs-tdx-proxy`，按 **Deploy**（先部署預設範本即可）。
4. 部署完成後，你會拿到一個網址，長得像：
   `https://lhbs-tdx-proxy.<你的帳號>.workers.dev`
   **這個網址先記下來，待會前端要用。**

---

## 二、貼上程式碼

1. 在該 Worker 頁面點右上 **Edit code**（或 **Quick edit**）。
2. 把編輯器裡原本的範例程式碼 **全部刪除**。
3. 打開本專案的 `worker/cloudflare-worker.js`，**整份內容複製貼上**。
4. 點右上 **Deploy**。

> 若偏好用 CLI（wrangler）也可以，但用網頁介面最簡單，不需要安裝任何東西。

---

## 三、設定環境變數（金鑰）

1. 回到該 Worker 的頁面 → **Settings** → **Variables and Secrets**（舊版為 **Environment Variables**）。
2. 逐一點 **Add** 新增以下變數，**Type 選 Secret（加密）**：

| 變數名稱 | 值 | 類型 |
|---|---|---|
| `CLIENT_ID` | `sc0720mr-3f77b43a-75ad-475b` | Secret（或 Text） |
| `CLIENT_SECRET` | （你的 TDX Client Secret） | **Secret（務必加密）** |
| `ROUTES` | `591,F913`（選填，預設即此值） | Text |
| `ALLOWED_ORIGIN` | `*`（選填；上線後可改成你的網域） | Text |

3. 按 **Save and deploy**（或 **Deploy**）讓變數生效。

> ⚠️ **絕對不要把 `CLIENT_SECRET` 寫進前端檔案（index.html / js/）**，
> 前端只保留 Worker 的網址，Secret 只存在 Cloudflare 的加密變數裡。

---

## 四、驗證代理是否正常

在瀏覽器直接打開（把網址換成你自己的）：

```
https://lhbs-tdx-proxy.<你的帳號>.workers.dev/
```

應該看到類似：

```json
{"ok":true,"service":"TDX 即時到站代理","endpoints":["/bus/eta","/bus/raw/<tdx-path>"],"routes":["591","F913"]}
```

再打開主要端點：

```
https://lhbs-tdx-proxy.<你的帳號>.workers.dev/bus/eta
```

應該看到 `{"generatedAt":"...","source":"TDX 新北市公車 EstimatedTimeOfArrival","count":NN,"data":[...]}`，
`count` 大於 0 就代表成功。若看到 `{"error":"..."}`，請看下一節排除。

---

## 五、設定前端指向 Worker

打開 `index.html`，找到檔案最下方這一行：

```html
<script>/* ... */ window.TDX_PROXY_URL = '';</script>
```

把單引號內填入你的 Worker 網址（**不要加結尾斜線**）：

```html
<script>/* ... */ window.TDX_PROXY_URL = 'https://lhbs-tdx-proxy.<你的帳號>.workers.dev';</script>
```

存檔、重新部署你的網站後：
- 站點資訊面板的標籤會變成 **「即時模式」**（黃色標籤）。
- 每 **30 秒** 自動更新一次；切到其他分頁會暫停，切回站點資訊分頁或回到前景會立即更新。
- 狀態列會顯示「最後更新 時:分:秒」與「倒數 XX 秒後更新」。

前端呼叫的是 `{你的 Worker 網址}/bus/eta`。

---

## 六、常見問題排除

| 症狀 | 原因與解法 |
|---|---|
| `/bus/eta` 回 `{"error":"尚未設定 CLIENT_ID / CLIENT_SECRET 環境變數"}` | 第三步的變數沒設好，或設完沒重新 Deploy。 |
| 回 `{"error":"取得 TDX token 失敗：HTTP 400"}` | Client Id / Secret 打錯；請重新貼上確認。 |
| 回 `{"error":"TDX API 連續 429"}` | TDX 短時間請求過多；Worker 已內建重試與 25 秒邊緣快取，稍等再試。 |
| 網頁標籤一直顯示「快照資料（非即時）」 | `window.TDX_PROXY_URL` 沒填、填錯，或 Worker 未部署成功。 |
| 網頁標籤顯示「代理暫時無法連線，暫用快照」 | Worker 有問題；前端會自動退回快照，網站不會壞。 |
| 改了前端卻看到舊版 | Service Worker 快取；請見部署教學的「看到舊版快取怎麼辦」。 |

---

## 七、費用與限額

- Cloudflare Workers 免費方案：**每日 10 萬次請求**，對社區使用綽綽有餘。
- Worker 內建 **25 秒邊緣快取**：同一時間多位住戶開啟，只會對 TDX 發一次請求，保護 API 額度。
- TDX token 在 Worker 內快取（到期前不重複取），進一步降低請求數。

---

## 八、可選：代理其他 TDX 端點

除了 `/bus/eta`，Worker 也支援通用代理：

```
https://<你的 Worker>/bus/raw/v2/Bus/StopOfRoute/City/NewTaipei?$filter=RouteName/Zh_tw eq '591'&$top=1000
```

回傳 `{"data":[...]}`。可用來取路線、站牌、班表等資料。
