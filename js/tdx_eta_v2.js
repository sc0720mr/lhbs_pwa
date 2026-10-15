/* TDX 即時到站（站點資訊分頁）— 水蓮社區巴士及公車時刻表 PWA
 *  支援：每 30 秒自動更新、只在站點資訊分頁輪詢、切回前景立即更新、
 *        就地更新不閃爍、最後更新時間與倒數、即時/快照模式標示。
 *
 * 設計原則（保留原本架構與版面）：
 *  1. 完全不更動「站點資訊」分頁既有的區段標題（h3）與站點清單（.stop_item）結構；
 *     站點名稱與 Google Maps 導航連結一律沿用原本網站內容。
 *  2. 依「站序」把 TDX 的預估到站時間，內嵌到對應的 .stop_item 之後，
 *     顯示格式：（約 XX 分到站）／（進站中）／（即將到站）。
 *  3. 只要有 TDX 預估到站時間即顯示，不限時間長短（例如「約 75 分到站」亦顯示）；
 *     末班車已過、今日未營運、交管不停靠者不顯示。
 *  4. 社巴（非 TDX 路線）沒有即時資料，維持原樣不顯示。
 *
 * 兩種資料來源：
 *  A. 即時模式：index.html 設定 window.TDX_PROXY_URL 指向自架的代理端點
 *     （Cloudflare Worker，見 worker/cloudflare-worker.js）。每 30 秒呼叫一次。
 *     TDX 官方 API 未開放瀏覽器跨域（CORS），必須經由代理端點取得 access token 與資料。
 *  B. 快照模式：未設定代理時，讀取建置時抓取的 data/tdx_snapshot.json，
 *     並在頁面明確標示「目前為快照資料，非即時」。
 */
(function () {
  'use strict';

  var SNAPSHOT_URL = 'data/tdx_snapshot.json';
  var PROXY_URL = (typeof window !== 'undefined' && window.TDX_PROXY_URL) || '';

  var POLL_MS = 30000;                /* 每 30 秒自動更新 */
  var STALE_MS = 6 * 60 * 1000;       /* 快照超過 6 分鐘視為非即時 */

  var sectionsCache = null;
  var lastGeneratedAt = '';
  var lastFetchAt = null;
  var inFlight = false;
  var pollTimer = null;
  var tickTimer = null;
  var nextAt = 0;
  var deferredPrompt = null;

  /* ---------- 小工具 ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function setSyncStatus(text, isError) {
    var el = document.getElementById('syncStatus');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('error', !!isError);
  }

  function setOfflineBadge() {
    var badge = document.getElementById('offlineBadge');
    if (!badge) return;
    badge.hidden = navigator.onLine;
  }

  function setSummary(text) {
    var el = document.getElementById('tdxSummary');
    if (el) el.textContent = text;
  }

  function setMode(mode) {
    var el = document.getElementById('tdxMode');
    if (!el) return;
    if (mode === 'live') {
      el.textContent = '即時模式';
      el.className = 'tdx-mode live';
    } else if (mode === 'snapshot-stale') {
      el.textContent = '快照資料（非即時）';
      el.className = 'tdx-mode stale';
    } else {
      el.textContent = '快照資料';
      el.className = 'tdx-mode';
    }
  }

  function setCountdown(text) {
    var el = document.getElementById('tdxCountdown');
    if (el) el.textContent = text;
  }

  function fmtTime(iso) {
    if (!iso) return '';
    return String(iso).replace('T', ' ').slice(0, 16);
  }

  function timeOnly(d) {
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  /* ---------- 到站時間格式化 ---------- */
  /* 回傳 '' 代表不顯示；否則回傳「（…）」字串 */
  function formatEta(stop) {
    if (!stop) return '';
    var sec = stop.estimateTime;
    var status = stop.stopStatus;

    if (sec === null || sec === undefined) return '';
    /* status：0 正常、1 尚未發車、2 交管不停靠、3 末班車已過、4 今日未營運。
       2/3/4 無有效到站時間；0 與 1 皆帶有預估秒數，一律顯示，不限時間長短。 */
    if (status !== 0 && status !== 1) return '';

    if (sec <= 30) return '（進站中）';
    var mins = Math.round(sec / 60);
    if (mins <= 0) return '（即將到站）';
    return '（約' + mins + '分到站）';
  }

  /* ---------- 資料索引 ---------- */
  function keyOf(route, dir, stopID) { return route + '|' + dir + '|' + stopID; }

  /* 由快照自身的資料列建立索引 */
  function indexFromSections(sections) {
    var map = {};
    sections.forEach(function (sec) {
      if (!sec || !sec.stops || !sec.routeName) return;
      sec.stops.forEach(function (st) {
        map[keyOf(sec.routeName, sec.direction, st.stopID)] = {
          estimateTime: st.estimateTime,
          stopStatus: st.stopStatus,
          srcUpdateTime: st.srcUpdateTime
        };
      });
    });
    return map;
  }

  /* 由代理端點回傳的 TDX 原始資料列建立索引 */
  function indexFromEtaRows(rows) {
    var map = {};
    if (!Array.isArray(rows)) return map;
    rows.forEach(function (it) {
      if (!it || it.StopID === undefined) return;
      var rn = (it.RouteName && (it.RouteName.Zh_tw || it.RouteName)) || '';
      map[keyOf(rn, it.Direction === undefined ? 0 : it.Direction, String(it.StopID))] = {
        estimateTime: it.EstimateTime === undefined ? null : it.EstimateTime,
        stopStatus: it.StopStatus === undefined ? null : it.StopStatus,
        srcUpdateTime: it.SrcUpdateTime || it.UpdateTime || null
      };
    });
    return map;
  }

  function loadSnapshot() {
    return fetch(SNAPSHOT_URL, { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) throw new Error('快照讀取失敗');
      return res.json();
    });
  }

  /* ---------- 把 ETA 就地內嵌到每個站點（只改文字，不重建 DOM） ---------- */
  function renderIndex(map) {
    var blocks = $all('#content2 .bus_stops');
    var shownStops = 0;
    var liveSections = 0;

    blocks.forEach(function (block, i) {
      var sec = sectionsCache ? sectionsCache[i] : null;
      var items = $all('.stop_item', block);

      if (!sec || !sec.stops || !sec.stops.length) {
        /* 非 TDX 區段（社巴）：確保不留殘影 */
        items.forEach(function (item) {
          var old = $('.eta-tag', item);
          if (old && old.parentNode) old.parentNode.removeChild(old);
        });
        return;
      }

      var sectionHasEta = false;
      items.forEach(function (item, idx) {
        var st = sec.stops[idx];
        if (!st) return;
        var rec = map[keyOf(sec.routeName, sec.direction, st.stopID)];
        var text = formatEta(rec);

        var old = $('.eta-tag', item);
        if (!text) {
          if (old && old.parentNode) { old.parentNode.removeChild(old); }
          return;
        }

        /* 就地更新：有舊節點就只改文字，沒有才建立 → 不閃爍、不影響捲動位置 */
        var host = item.lastElementChild || item;
        var em = old;
        if (!em) {
          em = document.createElement('em');
          em.className = 'eta-tag';
          host.appendChild(em);
        }
        if (em.textContent !== text) em.textContent = text;
        if (rec && rec.srcUpdateTime) {
          var tip = 'TDX 更新：' + fmtTime(rec.srcUpdateTime);
          if (em.title !== tip) em.title = tip;
        }

        shownStops++;
        sectionHasEta = true;
      });

      if (sectionHasEta) liveSections++;
    });

    return { shownStops: shownStops, liveSections: liveSections };
  }

  /* ---------- 更新流程 ---------- */
  function activeTabIsStops() {
    var radio = document.getElementById('tab2');
    return !!(radio && radio.checked);
  }

  function summarize(result, mode) {
    var stamp = lastGeneratedAt ? ('（資料時間 ' + fmtTime(lastGeneratedAt) + '）') : '';
    var tail = mode === 'live'
      ? '點站名可開啟 Google Maps 導航。'
      : '目前為快照資料、非即時；點站名可開啟 Google Maps 導航。';
    setSummary('TDX 即時到站：' + result.shownStops + ' 個站點顯示預估到站時間' + stamp + '。' + tail);
  }

  /* 呼叫代理端點取得即時到站資料；失敗回傳 null（自動退回快照） */
  function fetchLive() {
    var url = PROXY_URL.replace(/\/+$/, '') + '/bus/eta';
    return fetch(url, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('proxy ' + res.status);
      return res.json();
    }).then(function (json) {
      var rows = json && (json.data || json);
      if (Array.isArray(rows) && !rows.length) return {};
      return indexFromEtaRows(rows);
    }).catch(function (error) {
      console.warn('TDX 代理取得失敗，改用快照：', error && error.message);
      return null;
    });
  }

  function update(silent) {
    if (inFlight) return Promise.resolve();
    inFlight = true;

    if (!silent) setSyncStatus('正在同步 TDX 即時資料…');

    var loadSections = sectionsCache
      ? Promise.resolve(sectionsCache)
      : loadSnapshot().then(function (data) {
          sectionsCache = (data && data.sections) || [];
          lastGeneratedAt = (data && data.generatedAt) || '';
          return sectionsCache;
        });

    return loadSections.then(function () {
      var livePromise = PROXY_URL ? fetchLive() : Promise.resolve(null);

      return livePromise.then(function (liveMap) {
        var result, mode;

        if (liveMap) {
          lastFetchAt = new Date();
          mode = 'live';
          result = renderIndex(liveMap);
          /* 即時模式：更新資料時間為本次抓取時間 */
          lastGeneratedAt = toIso(lastFetchAt);
          setMode('live');
          setSyncStatus('TDX 即時到站已更新（' + result.shownStops + ' 個站點）　最後更新 '
            + timeOnly(lastFetchAt));
        } else {
          mode = 'snapshot';
          result = renderIndex(indexFromSections(sectionsCache));
          var ageMs = Date.now() - (lastGeneratedAt ? Date.parse(lastGeneratedAt) : 0);
          var stale = !lastGeneratedAt || isNaN(ageMs) || ageMs > STALE_MS;
          setMode(stale ? 'snapshot-stale' : 'snapshot');
          setSyncStatus(result.shownStops
            ? 'TDX 到站資訊已更新' + (PROXY_URL ? '（代理暫時無法連線，暫用快照）' : '（快照資料，非即時）')
            : 'TDX 到站資訊已更新，目前無預估到站資料');
        }

        summarize(result, mode);
        scheduleNext();
        return result;
      });
    }).catch(function (error) {
      console.error(error);
      setSyncStatus('TDX 即時資料載入失敗', true);
      setSummary('即時到站暫無法取得，時刻表仍可正常使用。');
      scheduleNext();
    }).then(function (v) {
      inFlight = false;
      return v;
    }, function (e) {
      inFlight = false;
      throw e;
    });
  }

  function toIso(d) {
    function p(n) { return (n < 10 ? '0' : '') + n; }
    var off = -d.getTimezoneOffset();
    var sign = off >= 0 ? '+' : '-';
    var oh = p(Math.floor(Math.abs(off) / 60));
    var om = p(Math.abs(off) % 60);
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T'
      + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + sign + oh + ':' + om;
  }

  /* ---------- 輪詢控制（只在站點資訊分頁輪詢） ---------- */
  function scheduleNext() {
    nextAt = Date.now() + POLL_MS;
  }

  function tick() {
    if (!activeTabIsStops() || !nextAt) {
      setCountdown('');
      return;
    }
    var left = Math.max(0, Math.ceil((nextAt - Date.now()) / 1000));
    setCountdown(left > 0 ? ('倒數 ' + left + ' 秒後更新') : '更新中…');
    if (left <= 0 && !inFlight) { update(true); }
  }

  function startTimers() {
    stopTimers();
    pollTimer = setInterval(function () {
      if (activeTabIsStops() && !inFlight) update(true);
    }, POLL_MS);
    tickTimer = setInterval(tick, 1000);
  }

  function stopTimers() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  }

  /* 切換分頁：只有站點資訊分頁才輪詢，其餘暫停以節省流量與 API 額度 */
  function bindTabWatcher() {
    $all('input[name="tabs"]').forEach(function (r) {
      r.addEventListener('change', function () {
        if (activeTabIsStops()) {
          update(true);
          startTimers();
          scheduleNext();
        } else {
          setCountdown('');
          stopTimers();
        }
      });
    });
  }

  /* ---------- 站點搜尋（僅過濾站點，不動結構） ---------- */
  function setupSearch() {
    var input = document.getElementById('stopSearch');
    if (!input) return;
    input.addEventListener('input', function () {
      var kw = input.value.trim();
      $all('#content2 .bus_stops').forEach(function (block) {
        var anyVisible = false;
        $all('.stop_item', block).forEach(function (item) {
          var hit = !kw || (item.textContent || '').indexOf(kw) !== -1;
          item.style.display = hit ? '' : 'none';
          if (hit) anyVisible = true;
        });
        block.style.display = (!kw || anyVisible) ? '' : 'none';
      });
    });
  }

  /* ---------- PWA 安裝提示 ---------- */
  function setupInstallPrompt() {
    var btn = document.getElementById('installAppBtn');
    window.addEventListener('beforeinstallprompt', function (event) {
      event.preventDefault();
      deferredPrompt = event;
      if (btn) btn.hidden = false;
    });
    if (btn) {
      btn.addEventListener('click', function () {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(function () {
          deferredPrompt = null;
          btn.hidden = true;
        });
      });
    }
  }

  function setupRefreshButton() {
    var btn = document.getElementById('refreshTdxBtn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      update(false);
    });
  }

  /* ---------- 事件 ---------- */
  window.addEventListener('online', function () {
    setOfflineBadge();
    setSyncStatus('網路已恢復，正在重新整理即時資料…');
    update(true);
  });

  window.addEventListener('offline', function () {
    setOfflineBadge();
    setSyncStatus('目前離線，顯示快取內容');
  });

  /* 切回前景時立即更新一次 */
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && activeTabIsStops()) {
      update(true);
      scheduleNext();
    }
  });

  document.addEventListener('DOMContentLoaded', function () {
    setOfflineBadge();
    setupInstallPrompt();
    setupRefreshButton();
    setupSearch();
    bindTabWatcher();
    setMode(PROXY_URL ? 'live' : 'snapshot');
    update(false).then(function () {
      if (activeTabIsStops()) startTimers();
    });
  });

  /* 供驗證／測試使用 */
  window.TDXPatch = {
    update: update,
    formatEta: formatEta,
    get sections() { return sectionsCache; },
    get nextAt() { return nextAt; },
    get polling() { return !!pollTimer; }
  };
})();
