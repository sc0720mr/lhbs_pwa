/**
 * TDX 即時到站代理 — Cloudflare Worker
 * ================================================================
 * 為什麼需要這個代理？
 *   TDX 官方 API（tdx.transportdata.tw）沒有回傳 Access-Control-Allow-Origin，
 *   瀏覽器無法直接跨域呼叫，且 Client Secret 也不該放在前端。
 *   這個 Worker 在伺服器端用 Client Id / Client Secret 取得 access token，
 *   代理 TDX 的到站預估 API，並補上 CORS 標頭回傳 JSON 給你的網頁。
 *
 * 前端如何串接
 *   index.html 內設定：window.TDX_PROXY_URL = 'https://<你的-worker>.workers.dev';
 *   前端會每 30 秒呼叫 GET {TDX_PROXY_URL}/bus/eta
 *
 * 部署步驟請見同目錄的 worker-setup.md
 *
 * 環境變數（在 Cloudflare Worker 設定）
 *   CLIENT_ID      ：TDX Client Id
 *   CLIENT_SECRET  ：TDX Client Secret（機密，只存在 Worker，不會外洩到前端）
 *   ROUTES         ：（選填）要代理的路線名稱，以逗號分隔，預設 "591,F913"
 *   ALLOWED_ORIGIN ：（選填）允許的來源網域，預設 "*"
 */

const TDX_TOKEN_URL =
  'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token';
const TDX_API_BASE = 'https://tdx.transportdata.tw/api/basic';
const CITY = 'NewTaipei'; // 新北市（社區路線 591 / F913 屬於新北市，非台北市）
const DEFAULT_ROUTES = '591,F913';
const TOKEN_SAFETY_MS = 60000; // 提前 60 秒視為過期
const EDGE_CACHE_SECONDS = 25;  // 邊緣快取，避免多個使用者同時打爆 TDX 額度

// 模組層級變數：同一個 Worker 實例內共用 token 快取
let cachedToken = null;
let tokenExpireAt = 0;

function corsHeaders(env) {
  const origin = (env && env.ALLOWED_ORIGIN) || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body, status, env) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign(
      {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
      corsHeaders(env)
    ),
  });
}

/** 取得 TDX access token（有效期內不重複取） */
async function getToken(env) {
  const now = Date.now();
  if (cachedToken && now < tokenExpireAt) return cachedToken;

  if (!env || !env.CLIENT_ID || !env.CLIENT_SECRET) {
    throw new Error('尚未設定 CLIENT_ID / CLIENT_SECRET 環境變數');
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: env.CLIENT_ID,
    client_secret: env.CLIENT_SECRET,
  });

  const res = await fetch(TDX_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error('取得 TDX token 失敗：HTTP ' + res.status);
  }
  const data = await res.json();
  cachedToken = data.access_token;
  const ttl = (data.expires_in ? data.expires_in * 1000 : 3600000) - TOKEN_SAFETY_MS;
  tokenExpireAt = now + Math.max(ttl, 60000);
  return cachedToken;
}

/** 呼叫 TDX API（含 429 重試） */
async function tdxGet(path, token, tries) {
  const max = tries || 4;
  for (let i = 0; i < max; i++) {
    const res = await fetch(TDX_API_BASE + path, {
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/json',
      },
    });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error('TDX API HTTP ' + res.status + ' ' + text.slice(0, 160));
    }
    return res.json();
  }
  throw new Error('TDX API 連續 429（請求過於頻繁），請稍後再試');
}

/** 取得各站預估到站時間（合併所有指定路線） */
async function fetchEtaRows(env) {
  const token = await getToken(env);
  const routes = ((env && env.ROUTES) || DEFAULT_ROUTES)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const all = [];
  for (const route of routes) {
    const filter = encodeURIComponent(`RouteName/Zh_tw eq '${route}'`);
    const path = `/v2/Bus/EstimatedTimeOfArrival/City/${CITY}?$filter=${filter}&$top=1000&$format=JSON`;
    const rows = await tdxGet(path, token);
    if (Array.isArray(rows)) all.push(...rows);
  }
  return all;
}

/** 通用 TDX 端點代理：/bus/raw/<path>?<query> */
async function proxyRaw(url, env) {
  const token = await getToken(env);
  const path = url.pathname.replace(/^\/bus\/raw/, '');
  const search = url.search || '?$format=JSON';
  return tdxGet((path || '/') + search, token);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS 預檢
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    if (request.method !== 'GET') {
      return json({ error: '只支援 GET' }, 405, env);
    }

    try {
      // 健康檢查
      if (url.pathname === '/' || url.pathname === '/health') {
        return json(
          {
            ok: true,
            service: 'TDX 即時到站代理',
            endpoints: ['/bus/eta', '/bus/raw/<tdx-path>'],
            routes: ((env && env.ROUTES) || DEFAULT_ROUTES).split(','),
          },
          200,
          env
        );
      }

      // 主要端點：前端每 30 秒呼叫一次
      if (url.pathname === '/bus/eta') {
        // 讓 Cloudflare 邊緣節點快取 25 秒，保護 TDX 額度
        const cache = caches.default;
        const cacheKey = new Request(url.origin + '/bus/eta', { method: 'GET' });
        const hit = await cache.match(cacheKey);
        if (hit) {
          const body = await hit.text();
          return new Response(body, {
            status: 200,
            headers: Object.assign(
              { 'Content-Type': 'application/json; charset=utf-8', 'X-Cache': 'HIT' },
              corsHeaders(env)
            ),
          });
        }

        const data = await fetchEtaRows(env);
        const payload = {
          generatedAt: new Date().toISOString(),
          source: 'TDX 新北市公車 EstimatedTimeOfArrival',
          count: data.length,
          data,
        };
        const body = JSON.stringify(payload);

        ctx.waitUntil(
          cache.put(
            cacheKey,
            new Response(body, {
              headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'public, max-age=' + EDGE_CACHE_SECONDS,
              },
            })
          )
        );

        return new Response(body, {
          status: 200,
          headers: Object.assign(
            { 'Content-Type': 'application/json; charset=utf-8', 'X-Cache': 'MISS' },
            corsHeaders(env)
          ),
        });
      }

      // 進階：代理任意 TDX basic API（例如 StopOfRoute、Route）
      if (url.pathname.startsWith('/bus/raw/')) {
        const data = await proxyRaw(url, env);
        return json({ data }, 200, env);
      }

      return json({ error: '找不到端點，可用：/bus/eta、/bus/raw/<tdx-path>' }, 404, env);
    } catch (error) {
      return json({ error: String((error && error.message) || error) }, 500, env);
    }
  },
};
