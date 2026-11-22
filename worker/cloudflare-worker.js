/**
 * TDX 即時到站代理 — 修正版（v2）
 * ---------------------------------------------------------------------------
 * 修正重點（對照原始 worker/cloudflare-worker.js）：
 *
 *  [1] getToken() 原本「取 token 失敗就直接 throw」→ 前端收到 500 → 退回 37 天前的快照。
 *      現在：429 時指數退避重試 3 次；仍失敗則沿用「上一顆尚未真正過期的 token」。
 *
 *  [2] token 快取原本只存在模組變數（Cloudflare 每個 isolate 各自一份），
 *      isolate 一被回收就要重新取 token，這是 429 的主因。
 *      現在：若綁了 KV（TOKEN_KV）就跨 isolate 共用；沒綁也能靠 [1] 的退避撐住。
 *
 *  [3] /bus/eta 原本「TDX 失敗就回 500」→ 前端只能退回舊快照。
 *      現在：失敗時回「上一次成功的資料」並標記 stale:true，前端可顯示
 *      「即時（延遲 N 秒）」而不是「快照·非即時」。
 *
 *  [4] 邊緣快取 25 秒 → 60 秒（前端每 30 秒輪詢一次，25 秒幾乎等於沒快取）。
 *
 *  [5] 回應加上 X-Cache: HIT / MISS / STALE，方便用 curl 一眼看出狀況。
 *
 * 環境變數（Cloudflare Worker → Settings → Variables）：
 *   CLIENT_ID      ：TDX 會員中心的 Client Id（必填）
 *   CLIENT_SECRET  ：TDX 會員中心的 Client Secret（必填，請用 Secret 類型）
 *   ROUTES         ：要抓的路線，預設 "591,F913"
 *   ALLOWED_ORIGIN ：允許的來源網域，預設 "*"
 * 選填 KV 綁定：
 *   TOKEN_KV       ：一個 KV namespace，用來跨 isolate 共用 token（強烈建議）
 */

const TDX_TOKEN_URL =
  'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token';
const TDX_API_BASE = 'https://tdx.transportdata.tw/api/basic';
const CITY = 'NewTaipei';
const DEFAULT_ROUTES = '591,F913';
const TOKEN_SAFETY_MS = 60000;   // 提前 60 秒視為過期
const EDGE_CACHE_SECONDS = 60;   // [4] 25 → 60
const TOKEN_KV_KEY = 'tdx_token';

// 模組層級快取（同一 isolate 內共用）
let cachedToken = null;
let tokenExpireAt = 0;
// [1] 最後一顆「拿得到」的 token，即使過了安全期也留著當備援
let lastGoodToken = null;
// [3] 最後一次成功的 ETA payload，TDX 掛掉時拿來頂著
let lastGoodPayload = null;

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

function json(body, status, env, extraHeaders) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign(
      {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
      corsHeaders(env),
      extraHeaders || {}
    ),
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** [2] 從 KV 讀 token（有綁才用） */
async function readTokenFromKV(env) {
  if (!env || !env.TOKEN_KV) return null;
  try {
    const raw = await env.TOKEN_KV.get(TOKEN_KV_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (obj && obj.token && obj.expireAt > Date.now()) return obj;
  } catch (_) { /* KV 壞掉不該讓整個服務掛掉 */ }
  return null;
}

/** [2] 寫 token 到 KV（有綁才用） */
async function writeTokenToKV(env, token, expireAt) {
  if (!env || !env.TOKEN_KV) return;
  try {
    await env.TOKEN_KV.put(
      TOKEN_KV_KEY,
      JSON.stringify({ token, expireAt }),
      { expirationTtl: Math.max(60, Math.floor((expireAt - Date.now()) / 1000)) }
    );
  } catch (_) { /* 忽略 */ }
}

/**
 * 取得 TDX access token
 * [1] 429 指數退避重試；全失敗則退回 lastGoodToken
 */
async function getToken(env) {
  const now = Date.now();
  if (cachedToken && now < tokenExpireAt) return cachedToken;

  // [2] 先問 KV（跨 isolate 共用）
  const kv = await readTokenFromKV(env);
  if (kv) {
    cachedToken = kv.token;
    tokenExpireAt = kv.expireAt;
    lastGoodToken = kv.token;
    return cachedToken;
  }

  if (!env || !env.CLIENT_ID || !env.CLIENT_SECRET) {
    throw new Error('尚未設定 CLIENT_ID / CLIENT_SECRET 環境變數');
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: env.CLIENT_ID,
    client_secret: env.CLIENT_SECRET,
  }).toString();

  let lastStatus = 0;
  let lastText = '';

  // [1] 最多 3 次，退避 1s / 3s / 7s
  for (let i = 0; i < 3; i++) {
    let res;
    try {
      res = await fetch(TDX_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
    } catch (e) {
      lastStatus = 0;
      lastText = String((e && e.message) || e);
      await sleep(1000 * (2 ** i));
      continue;
    }

    if (res.ok) {
      const data = await res.json();
      cachedToken = data.access_token;
      lastGoodToken = cachedToken;
      const ttl = (data.expires_in ? data.expires_in * 1000 : 3600000) - TOKEN_SAFETY_MS;
      tokenExpireAt = now + Math.max(ttl, 60000);
      await writeTokenToKV(env, cachedToken, tokenExpireAt);
      return cachedToken;
    }

    lastStatus = res.status;
    lastText = await res.text().catch(() => '');

    // 只有 429 / 5xx 值得重試；401/400 是帳密錯，重試沒用
    if (res.status !== 429 && res.status < 500) break;
    await sleep(1000 * (2 ** i));
  }

  // [1] 全部失敗 → 用上一顆還能用的 token 撐一下
  if (lastGoodToken) {
    cachedToken = lastGoodToken;
    tokenExpireAt = Date.now() + 30000; // 30 秒後再試一次
    return cachedToken;
  }

  throw new Error(
    '取得 TDX token 失敗：HTTP ' + lastStatus +
    (lastStatus === 429 ? '（授權端點限流，請稍後重試或改用 KV 共用 token）' : '') +
    (lastText ? ' ' + lastText.slice(0, 120) : '')
  );
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
      await sleep(1500 * (i + 1));
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

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }
    if (request.method !== 'GET') {
      return json({ error: '只支援 GET' }, 405, env);
    }

    try {
      if (url.pathname === '/' || url.pathname === '/health') {
        return json(
          {
            ok: true,
            service: 'TDX 即時到站代理',
            version: 2,
            endpoints: ['/bus/eta', '/bus/raw/<tdx-path>'],
            routes: ((env && env.ROUTES) || DEFAULT_ROUTES).split(','),
            kvBound: !!(env && env.TOKEN_KV),
            hasLastGood: !!lastGoodPayload,
          },
          200,
          env
        );
      }

      if (url.pathname === '/bus/eta') {
        const cache = caches.default;
        const cacheKey = new Request(url.origin + '/bus/eta', { method: 'GET' });
        const hit = await cache.match(cacheKey);
        if (hit) {
          const body = await hit.text();
          return new Response(body, {
            status: 200,
            headers: Object.assign(
              {
                'Content-Type': 'application/json; charset=utf-8',
                'X-Cache': 'HIT',
                'Cache-Control': 'public, max-age=' + EDGE_CACHE_SECONDS,
              },
              corsHeaders(env)
            ),
          });
        }

        let data;
        try {
          data = await fetchEtaRows(env);
        } catch (err) {
          // [3] TDX 掛掉 → 回上一次成功的資料，而不是 500
          if (lastGoodPayload) {
            const staleBody = JSON.stringify(
              Object.assign({}, lastGoodPayload, {
                stale: true,
                staleReason: String((err && err.message) || err),
                servedAt: new Date().toISOString(),
              })
            );
            return new Response(staleBody, {
              status: 200,
              headers: Object.assign(
                {
                  'Content-Type': 'application/json; charset=utf-8',
                  'X-Cache': 'STALE',
                  'Cache-Control': 'no-store',
                },
                corsHeaders(env)
              ),
            });
          }
          throw err;
        }

        const payload = {
          generatedAt: new Date().toISOString(),
          source: 'TDX 新北市公車 EstimatedTimeOfArrival',
          count: data.length,
          stale: false,
          data,
        };
        lastGoodPayload = payload;
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
            {
              'Content-Type': 'application/json; charset=utf-8',
              'X-Cache': 'MISS',
              'Cache-Control': 'public, max-age=' + EDGE_CACHE_SECONDS,
            },
            corsHeaders(env)
          ),
        });
      }

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
