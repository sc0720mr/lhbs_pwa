/* ==========================================================================
   core.js — 水蓮社區巴士 PWA｜共用行為層 v3.0
   --------------------------------------------------------------------------
   這一層只負責「資料 + 行為」，不含任何顏色／間距／字體／圓角決定。
   三個視覺版本（v1-precise / v2-dispatch / v3-air）共用同一份邏輯，
   差異 100% 由各自的 style.css 決定 —— 因此功能不可能在不同版本間漂移。

   原站功能全數保留：
     時刻表（平/假日、去/回程、路線篩選、只顯示接下來、跳到最近班次、重設）
     站點（10 段錨點、站名搜尋、Google Maps 導航、TDX 即時到站 + 快照回退）
     電話（21 單位、直撥、搜尋）
     關於（版本、資料統計、iOS/Android 加入主畫面步驟 + 圖片輪播）
     公告橫幅、颱風日班表、24 小時搭乘提醒彈窗、離線提示、安裝提示、深色模式
   ========================================================================== */
(function () {
  'use strict';

  /* ---------------------------------------------------------------------
     版本識別：下載後想確認「線上跑的是哪一版」，看這裡。
     三個地方會同時出現同一組版本號：
       1) DevTools Console 的綠底標籤
       2) 網址後面加 ?v=check 時底部出現的檔案
       3) <meta name="app-version"> 與 <meta name="app-cache-version">
     三者不一致，就代表檔案沒蓋好或快取還在供應舊版。
     --------------------------------------------------------------------- */
  var BUILD = 'LHBS build 6.4.0 / cache v40';
  try {
    console.log('%c' + BUILD, 'background:#08B898;color:#04231C;font-weight:700;padding:3px 8px;border-radius:2px');
  } catch (e) { /* console 不可用時忽略 */ }

  function showVersionBadge() {
    if (location.search.indexOf('v=check') === -1) return;
    var sheet = document.querySelector('link[rel="stylesheet"]');
    var el = document.createElement('div');
    el.id = 'versionCheck';
    el.setAttribute('role', 'status');
    el.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:9999;' +
      'background:#0B0E13;color:#fff;border-top:3px solid #08B898;' +
      'font:600 13px/1.6 ui-monospace,Menlo,monospace;padding:11px 16px;text-align:center';
    el.textContent = BUILD + ' \uff5c CSS: ' + (sheet ? sheet.getAttribute('href') : 'n/a');
    document.body.appendChild(el);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showVersionBadge);
  else showVersionBadge();

  var DATA = window.LHBS_DATA || {
    normalSchedule: {}, typhoonSchedule: {}, sections: [], phoneGroups: [], version: ''
  };

  /* ---------------------------------------------------------------------
     設定（住戶可直接改這裡）
     --------------------------------------------------------------------- */
  var CONFIG = {
    TDX_PROXY_URL: 'https://lhbs-tdx-proxy.sc0720mr.workers.dev',
    POLL_MS: 30000,
    STALE_MS: 6 * 60 * 1000,
    BOARDING_KEY: 'lhbs_boarding_ack',
    BOARDING_HOURS: 24,
    THEME_KEY: 'lhbs_theme',

    /* 公告與颱風日的「真實來源」在 data/schedule-config.json。
       這裡的預設值刻意留空 —— 萬一 fetch 失敗（離線、檔案未部署），
       寧可什麼都不顯示，也不要顯示過期公告。 */
    RUNTIME_CONFIG_URL: 'data/schedule-config.json',
    ALERTS: [],
    TYPHOON_DAYS: []
  };

  /* ---------------------------------------------------------------------
     執行期設定（公告 / 颱風日）
     ---------------------------------------------------------------------
     原本這兩份資料硬寫在 JS 裡（ALERTS 只有 2026-07-10 一天、
     TYPHOON_DAYS 停在 2024/12/31），時間一過就整體失效：公告橫幅永遠
     不出現，颱風班表永遠不會被啟用 —— 而且沒有任何東西提醒維護者。
     現在改成讀外部 JSON，改公告不用動程式碼。

     日期格式約定：typhoonDays 用 YYYY/MM/DD（與 toLocaleDateString('zh-TW')
     的輸出一致）；alerts 的 startTime / endTime 用 ISO 8601 本地時間。
     --------------------------------------------------------------------- */
  function loadRuntimeConfig() {
    if (!window.fetch) return Promise.resolve();
    return fetch(CONFIG.RUNTIME_CONFIG_URL, { cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('config ' + res.status);
        return res.json();
      })
      .then(function (cfg) {
        if (!cfg) return;

        /* alerts 允許單一物件，typhoonDays 允許單一字串 —— 少寫一層括號不該讓整份設定失效。 */
        CONFIG.ALERTS = toArray(cfg.alerts);
        CONFIG.TYPHOON_DAYS = toArray(cfg.typhoonDays);

        /* 建索引時順便回報無法解析的日期，讓「靜默失效」變成有聲音的警告。 */
        var badDates = rebuildTyphoonIndex();
        if (badDates.length) {
          warn('颱風日清單有 ' + badDates.length + ' 筆無法解析，已忽略：' + JSON.stringify(badDates) +
               '　可接受的寫法：2026/10/22、2026/10/2、2026-10-22');
        }

        /* 最常見的失手：把日期改進 _example（範例）區塊，而真正的頂層陣列還是空的。
           這種情況畫面完全正常、主控台也全綠，維護者只會覺得「網站壞了」。 */
        if (!CONFIG.TYPHOON_DAYS.length && cfg._example && toArray(cfg._example.typhoonDays).length) {
          warn('偵測到 typhoonDays 只寫在 _example（範例）區塊裡，那不會生效。' +
               '請改檔案最下方的頂層 "typhoonDays": [...]');
        }
        if (!CONFIG.ALERTS.length && cfg._example && toArray(cfg._example.alerts).length) {
          warn('偵測到 alerts 只寫在 _example（範例）區塊裡，那不會生效。' +
               '請改檔案最下方的頂層 "alerts": [...]');
        }

        /* 唯一會提醒維護者的地方：公告全部過期就出聲。 */
        if (CONFIG.ALERTS.length) {
          var now = Date.now();
          var live = CONFIG.ALERTS.filter(function (a) {
            return a && a.endTime && now <= new Date(a.endTime).getTime();
          });
          if (!live.length) {
            warn('公告設定已全部過期，請更新 ' + CONFIG.RUNTIME_CONFIG_URL);
          }
        }

        /* 開發者自己看得到的一面：把「今天是什麼日期、命中哪些颱風日」印出來。
           維護者回報「設了沒生效」時，這一行就能直接分辨是日期算錯還是字串沒對上。 */
        if (CONFIG.TYPHOON_DAYS.length) {
          try {
            console.info('[LHBS] 今天是 ' + taipeiTodayKey() + '／颱風日清單索引 ' +
                         JSON.stringify(Object.keys(TYPHOON_SET)) +
                         '／判定：' + (isTyphoonDay() ? '颱風日班表' : '正常班表'));
          } catch (e) {}
        }
      })
      .catch(function (err) {
        /* 離線或檔案不存在：沿用空陣列，介面會自己隱藏。
           但一定要出聲 —— 404 或 JSON 語法錯誤原本是完全靜默的，
           維護者只會看到「公告不出現、颱風班表沒切」，卻沒有任何線索。 */
        rebuildTyphoonIndex();
        warn('讀不到 ' + CONFIG.RUNTIME_CONFIG_URL + '（' + (err && err.message ? err.message : '未知錯誤') +
             '）。公告與颱風日都不會生效，請確認檔案存在且 JSON 格式正確。');
      });
  }

  /* ---------------------------------------------------------------------
     小工具
     --------------------------------------------------------------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function toMin(hhmm) { var p = String(hhmm).split(':'); return (+p[0]) * 60 + (+p[1]); }
  function nowMin(d) { d = d || new Date(); return d.getHours() * 60 + d.getMinutes(); }
  function clockText(d) { d = d || new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  /* 目的字串格式為「水蓮➡︎往東湖捷運站」（U+27A1 + VS15）。原版以 ➤ 切分，
     實際上從未命中，箭頭字元因此被直接印出、無法單獨造型 —— 這裡改為正確解析。 */
  var DEST_SEP = /\s*[\u27A1\u2192\u2794]\uFE0E?\s*/;
  function destParts(dest) {
    var parts = String(dest).split(DEST_SEP);
    if (parts.length < 2) return { from: String(dest), to: '' };
    return { from: parts[0], to: parts.slice(1).join(' ') };
  }
  /* ----------------------------------------------------------------
     「停駛」不是地名。
     data.js 的 typhoonSchedule 把它放在「目的地」欄位（第三欄）：
         ["06:25", "F913", "停駛"]
     原本程式把整串當目的地渲染成 <span class="dep__dest">…停駛…</span>，
     而 .dep__dest 在手機版是 display:none（style.css 的 RESPONSIVE 區塊）——
     於是手機上 DOM 有 36 筆「停駛」、畫面上一個字都看不到，
     使用者只看到「06:25 F913 已發車」，完全不知道那班根本不開。
     現在把它抽成獨立的狀態語意，不再依賴被隱藏的目的地欄位。
     ---------------------------------------------------------------- */
  var SUSPEND_RE = /^\s*停駛\s*$/;
  function isSuspended(dest) { return SUSPEND_RE.test(String(dest)); }
  function routeKey(name) {
    if (String(name).indexOf('F913') === 0) return 'f913';
    if (name === '591') return 'r591';
    return 'sheba';
  }
  function relativeText(diffMin) {
    if (diffMin <= 0) return '即將發車';
    if (diffMin < 60) return diffMin + ' 分後';
    var h = Math.floor(diffMin / 60), m = diffMin % 60;
    return h + ' 小時' + (m ? ' ' + m + ' 分' : '') + '後';
  }
  /* 清單列的「剩餘」欄一律有值。遠班次用「2時39」的緊湊寫法，
     不能留白 —— 一欄 68px 卻整片空白，看起來像壞掉。 */
  function rowRelText(diffMin, isPast) {
    if (isPast) return '已發車';
    if (diffMin <= 0) return '即將';
    if (diffMin <= 59) return diffMin + ' 分';
    var h = Math.floor(diffMin / 60), m = diffMin % 60;
    return h + '時' + (m ? pad(m) : '');
  }
  function fmtTime(iso) {
    if (!iso) return '';
    return String(iso).replace('T', ' ').slice(0, 16);
  }
  function reduceMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  var store = {
    get: function (k, fb) { try { var v = localStorage.getItem(k); return v === null ? fb : v; } catch (e) { return fb; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    sget: function (k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    sset: function (k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }
  };

  /* ---------------------------------------------------------------------
     日期 / 班表
     --------------------------------------------------------------------- */
  /* 維護者可能寫 2026/10/22、2026/10/2、2026-10-22、2026.10.22、全形數字、
     甚至 2026年10月22日。這些全部收斂成同一個 key：Y/M/D（不補零），
     正好等於 toLocaleDateString('zh-TW') 的輸出。
     原本是拿原始字串直接 indexOf 比對，寫法差一個字元就永遠不會命中，
     而且沒有任何錯誤訊息 —— 那正是「設定了卻沒生效」的溫床。 */
  function normalizeDateKey(v) {
    if (v === null || v === undefined) return '';
    var s = String(v).trim();
    if (!s) return '';
    s = s.replace(/[\uFF10-\uFF19]/g, function (c) {            /* 全形數字 */
          return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
        })
        .replace(/[\uFF0F\u2571\u2044]/g, '/')                    /* 全形斜線、分數斜線 */
        .replace(/[\uFF0D\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, '-')  /* 各種破折號當減號 */
        .replace(/[\u3002\uFF0E\u2027\u00B7]/g, '.')              /* 句號、全形句點當小數點 */
        .replace(/\u5E74/g, '/').replace(/\u6708/g, '/').replace(/\u65E5/g, '')  /* 2026年10月22日 */
        .replace(/\s+/g, '');

    var m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
    if (!m) {
      var c = s.replace(/\D/g, '');
      if (c.length === 8) m = [null, c.slice(0, 4), c.slice(4, 6), c.slice(6, 8)];  /* 20261022 */
      else return '';
    }
    var y = +m[1], mo = +m[2], d = +m[3];
    if (!(y >= 1900 && y <= 2999 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return '';

    /* 擋掉 2026/2/30 這種「格式對、日期不存在」的輸入 */
    var probe = new Date(Date.UTC(y, mo - 1, d));
    if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return '';

    return y + '/' + mo + '/' + d;
  }

  /* 台北的「今天」。用 en-CA 的 YYYY-MM-DD 再正規化，不依賴 zh-TW 的輸出格式 ——
     這樣即使瀏覽器改了在地化格式（例如某天變成 2026年10月22日），判定也不會跟著壞。 */
  function taipeiTodayKey() {
    var d = new Date();
    try {
      var parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(d);
      var k = normalizeDateKey(parts);
      if (k) return k;
    } catch (e) {}
    try { return normalizeDateKey(d.toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' })); }
    catch (e) { return normalizeDateKey(d.toLocaleDateString()); }
  }

  /* 保留下這個名字：其他版本／外部呼叫可能還在用。 */
  function taipeiDateString() { return taipeiTodayKey(); }

  var TYPHOON_SET = {};
  function rebuildTyphoonIndex() {
    TYPHOON_SET = {};
    var bad = [];
    toArray(CONFIG.TYPHOON_DAYS).forEach(function (raw) {
      var v = raw;
      /* 也接受 [{ "date": "2026/10/22" }] 這種寫法，避免多一層物件就整份失效 */
      if (v && typeof v === 'object') v = v.date !== undefined ? v.date : (v.day !== undefined ? v.day : v.value);
      var k = normalizeDateKey(v);
      if (!k) { bad.push(raw); return; }
      TYPHOON_SET[k] = true;
    });
    return bad;
  }
  function toArray(v) {
    if (Array.isArray(v)) return v;
    if (v === null || v === undefined || v === '') return [];
    return [v];
  }
  function warn(msg) {
    try { console.warn('[LHBS] ' + msg); } catch (e) {}
  }

  function isTyphoonDay() { return !!TYPHOON_SET[taipeiTodayKey()]; }
  function activeSchedule() { return isTyphoonDay() ? DATA.typhoonSchedule : DATA.normalSchedule; }

  /* ---------------------------------------------------------------------
     主題
     --------------------------------------------------------------------- */
  var themeBtn = document.getElementById('themeBtn');
  var themeIconUse = document.getElementById('themeIcon');

  function applyTheme(theme) {
    var dark = theme === 'dark';
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    if (themeIconUse) themeIconUse.setAttribute('href', dark ? '#i-sun' : '#i-moon');
    if (themeBtn) {
      themeBtn.setAttribute('aria-pressed', dark ? 'true' : 'false');
      themeBtn.setAttribute('aria-label', dark ? '切換淺色模式' : '切換深色模式');
    }
    /* theme-color 交由各版本 HTML 內的兩組 meta（light / dark media query）決定，
       不在這裡覆寫 —— 三個版本共用同一支 JS，硬寫色值會把彼此的配色蓋掉。 */
  }
  (function initTheme() {
    var saved = store.get(CONFIG.THEME_KEY, null);
    if (saved === 'dark' || saved === 'light') { applyTheme(saved); return; }
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(prefersDark ? 'dark' : 'light');
  })();
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      store.set(CONFIG.THEME_KEY, next);
      applyTheme(next);
    });
  }

  /* ---------------------------------------------------------------------
     分頁
     --------------------------------------------------------------------- */
  var VIEWS = ['schedule', 'stops', 'phone', 'about'];
  var currentView = 'schedule';

  function navButtons() { return $$('[data-panel]'); }

  function activateView(name, opts) {
    opts = opts || {};
    if (VIEWS.indexOf(name) === -1) name = 'schedule';
    currentView = name;
    document.body.setAttribute('data-view', name);

    navButtons().forEach(function (b) {
      var on = b.getAttribute('data-panel') === name;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
      b.classList.toggle('is-active', on);
    });
    VIEWS.forEach(function (v) {
      var p = document.getElementById('panel-' + v);
      if (p) p.hidden = v !== name;
    });

    if (!opts.keepScroll) {
      if (opts.focusPanel) {
        var target = document.getElementById('panel-' + name);
        if (target) { target.setAttribute('tabindex', '-1'); target.focus({ preventScroll: true }); }
      }
      window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'auto' });
    }

    if (name === 'stops') { ensureStops(); tdx.start(); } else { tdx.stop(); }
    if (name === 'about') slider.playAll(); else slider.pauseAll();

    if (history.replaceState) history.replaceState(null, '', '#' + name);
  }

  navButtons().forEach(function (btn) {
    btn.addEventListener('click', function () { activateView(btn.getAttribute('data-panel')); });
  });
  var navRoot = document.querySelector('[role="tablist"]');
  if (navRoot) {
    navRoot.addEventListener('keydown', function (e) {
      var keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
      if (keys.indexOf(e.key) === -1) return;
      e.preventDefault();
      var idx = VIEWS.indexOf(currentView);
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') idx = (idx - 1 + VIEWS.length) % VIEWS.length;
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') idx = (idx + 1) % VIEWS.length;
      else if (e.key === 'Home') idx = 0; else idx = VIEWS.length - 1;
      activateView(VIEWS[idx]);
      var next = document.querySelector('[data-panel="' + VIEWS[idx] + '"]');
      if (next) next.focus();
    });
  }
  window.addEventListener('hashchange', function () {
    var h = (location.hash || '').replace('#', '');
    if (VIEWS.indexOf(h) !== -1 && h !== currentView) activateView(h);
  });

  /* ---------------------------------------------------------------------
     公告橫幅
     --------------------------------------------------------------------- */
  var ALERT_DISMISS_KEY = 'lhbs_alert_dismissed';

  function pickAlert() {
    if (isTyphoonDay()) {
      return { id: 'typhoon', title: '颱風日班表', message: '今天為颱風日，班次可能異動，請留意社區公告。' };
    }
    var now = new Date();
    for (var i = 0; i < CONFIG.ALERTS.length; i++) {
      var a = CONFIG.ALERTS[i];
      if (now >= new Date(a.startTime) && now <= new Date(a.endTime)) {
        return { id: a.id, title: '公告', message: a.message };
      }
    }
    return null;
  }

  function renderAlert() {
    var banner = document.getElementById('alertBanner');
    if (!banner) return;
    var alert = pickAlert();
    if (!alert || store.sget(ALERT_DISMISS_KEY) === alert.id) { banner.hidden = true; return; }
    var t = document.getElementById('alertTitle');
    var m = document.getElementById('alertText');
    if (t) t.textContent = alert.title;
    if (m) m.textContent = alert.message;
    banner.hidden = false;
    banner.setAttribute('data-alert-id', alert.id);
  }
  var alertClose = document.getElementById('alertClose');
  if (alertClose) {
    alertClose.addEventListener('click', function () {
      var banner = document.getElementById('alertBanner');
      var id = banner ? banner.getAttribute('data-alert-id') : '';
      if (id) store.sset(ALERT_DISMISS_KEY, id);
      if (banner) banner.hidden = true;
    });
  }

  /* ---------------------------------------------------------------------
     時刻表
     --------------------------------------------------------------------- */
  var state = { day: 'workday', dir: 'to', route: 'all', upcomingOnly: false };
  var lastScheduleSig = '';

  function currentRows() {
    var table = activeSchedule()[state.day];
    return (table && table[state.dir]) ? table[state.dir] : [];
  }
  function filteredRows() {
    var rows = currentRows();
    if (state.route !== 'all') {
      rows = rows.filter(function (r) {
        if (state.route === 'F913') return String(r[1]).indexOf('F913') === 0;
        return r[1] === state.route;
      });
    }
    return rows.slice().sort(function (a, b) { return toMin(a[0]) - toMin(b[0]); });
  }
  function nextDeparture() {
    var rows = filteredRows();
    var now = nowMin();
    for (var i = 0; i < rows.length; i++) {
      /* 停駛班次不是「下一班」。原本這裡會回傳停駛那一列，首頁於是顯示
         「16:45 預計發車／3 分後」，而那一班根本不開 —— 比看不到停駛更糟，
         因為它讓使用者據此出門。跳過，只找真正會開的班次。 */
      if (isSuspended(rows[i][2])) continue;
      if (toMin(rows[i][0]) >= now) return { row: rows[i], diff: toMin(rows[i][0]) - now, index: i };
    }
    return null;
  }
  /* 接下來 n 班（只算會開的），供首頁「後三班」使用 */
  function followingRunning(rows, fromIndex, n) {
    var out = [];
    for (var i = fromIndex + 1; i < rows.length && out.length < n; i++) {
      if (!isSuspended(rows[i][2])) out.push(rows[i]);
    }
    return out;
  }
  function countSuspended(rows) {
    var n = 0;
    for (var i = 0; i < rows.length; i++) if (isSuspended(rows[i][2])) n++;
    return n;
  }

  function renderSchedule(force) {
    var list = document.getElementById('scheduleList');
    var emptyEl = document.getElementById('scheduleEmpty');
    var countEl = document.getElementById('scheduleCount');
    if (!list) return;

    var rows = filteredRows();
    var now = nowMin();
    /* 「接下來」只算真的會開的班次：停駛的時刻照樣會到，但它不是「下一班」。
       原本 upcoming 含停駛，於是 nextMin 可能落在停駛那一列，
       is-next 會把「停駛」標成下一班 —— 兩個錯誤疊在一起。 */
    var upcoming = rows.filter(function (r) { return !isSuspended(r[2]) && toMin(r[0]) >= now; });
    var display = state.upcomingOnly ? upcoming : rows;
    var nextMin = upcoming.length ? toMin(upcoming[0][0]) : -1;
    var suspCount = countSuspended(rows);

    if (countEl) {
      var baseCount = state.upcomingOnly
        ? '剩 ' + display.length + ' / 共 ' + rows.length + ' 班'
        : '共 ' + rows.length + ' 班';
      /* 44 班裡有 36 班停駛卻只寫「共 44 班」，等於告訴使用者今天車很多。
         把停駛數直接寫進這一行 —— 這是他掃一眼就會看到的數字。 */
      countEl.textContent = suspCount ? baseCount + ' · ' + suspCount + ' 班停駛' : baseCount;
    }

    /* 只有「畫面上真的會變」時才重建 DOM：避免每 30 秒整份 innerHTML 重繪造成
       焦點遺失、hover 中斷與行動裝置捲動跳動 */
    var sig = [state.day, state.dir, state.route, state.upcomingOnly, now, nextMin, display.length].join('|');
    if (!force && sig === lastScheduleSig) return;
    lastScheduleSig = sig;

    if (!display.length) {
      list.innerHTML = '';
      list.hidden = true;
      if (emptyEl) {
        /* 颱風日「只看接下來」若剩下的全是停駛，原本會顯示
           「沒有符合條件的班次／試著切換假日」—— 使用者會以為是自己篩選錯，
           而不是「今天真的沒車了」。 */
        var noMoreRunning = rows.length > 0 && upcoming.length === 0;
        var et = emptyEl.querySelector('.empty__title');
        var ed = emptyEl.querySelector('.empty__desc');
        if (et) et.textContent = noMoreRunning ? '今日班次已全部停駛' : '沒有符合條件的班次';
        if (ed) ed.textContent = noMoreRunning
          ? '颱風日班表：接下來已無行駛班次，請留意社區公告或改搭其他運輸工具。'
          : '試著切換「假日」、改用其他路線篩選，或關閉「只看接下來」。';
        emptyEl.hidden = false;
      }
      return;
    }
    list.hidden = false;
    if (emptyEl) emptyEl.hidden = true;

    var prevHour = '';
    var prevFrom = '';
    var html = display.map(function (r) {
      var t = r[0], route = r[1], dest = r[2];
      var m = toMin(t);
      var isNext = (m === nextMin && m >= now);
      var isPast = m < now;
      var hour = t.slice(0, 2);
      var hourStart = hour !== prevHour;
      prevHour = hour;
      var susp = isSuspended(dest);
      var p = susp ? { from: '', to: '' } : destParts(dest);
      /* 同一方向下「水蓮」幾乎每列都一樣。重複 66 次是純粹的視覺噪音，
         只會在它真的改變時才顯示 —— 列一密集也不會丢掉資訊。 */
      var showFrom = susp ? true : (!p.to || p.from !== prevFrom);
      if (!susp) prevFrom = p.from;
      var rel = rowRelText(m - now, isPast);
      var spokenRel = isPast ? '已發車' : relativeText(m - now);
      var cls = 'dep' + (susp ? ' is-susp' : '') + (isNext ? ' is-next' : '') +
        (isPast ? ' is-past' : '') + (hourStart ? ' is-hour-start' : '');
      var spoken = t + '，' + route + '，' +
        (susp ? '停駛' : p.from + (p.to ? '往' + p.to.replace(/^往/, '') : '') + '，' + spokenRel);

      return '<div class="' + cls + '" role="listitem" data-route="' + routeKey(route) + '" data-hour="' + hour + '">' +
        '<span class="sr-only">' + escapeHtml(spoken) + '</span>' +
        '<span class="dep__hour" aria-hidden="true">' + hour + '</span>' +
        '<span class="dep__time" aria-hidden="true"><span class="hh">' + t.slice(0, 2) + '</span>' +
          '<span class="cc">:</span><span class="mm">' + t.slice(3, 5) + '</span></span>' +
        '<span class="dep__route" aria-hidden="true">' + escapeHtml(route) + '</span>' +
        '<span class="dep__dest' + (showFrom ? '' : ' dep__dest--cont') + '" aria-hidden="true">' +
          (susp ? '' :
            (showFrom ? '<span class="dep__from">' + escapeHtml(p.from) + '</span>' : '') +
            (p.to ? '<span class="dep__sep">→</span><span class="dep__to">' + escapeHtml(p.to) + '</span>' : '')) +
        '</span>' +
        /* 停駛用「剩餘」欄承載：那一欄在每一個斷點都存在（手機在 grid 第 3 欄），
           而「剩餘 3 分」對一班不開的車本來就沒有意義。
           這樣不必新增 grid 欄位、不必動任何版面骨架，手機與桌機都看得到。 */
        '<span class="dep__rel' + (susp ? ' dep__rel--susp' : '') + '" aria-hidden="true">' +
          (susp ? '<span class="dep__state">停駛</span>' : escapeHtml(rel)) +
        '</span>' +
      '</div>';
    }).join('');

    list.innerHTML = html;
  }

  function renderHero() {
    var timeEl = document.getElementById('heroTime');
    if (!timeEl) return;
    var countEl = document.getElementById('heroCount');
    var labelEl = document.getElementById('heroLabel');
    var routeEl = document.getElementById('heroRoute');
    var badgeEl = document.getElementById('heroBadge');
    var destEl = document.getElementById('heroDest');
    var nextEl = document.getElementById('heroNext');
    var emptyEl = document.getElementById('heroEmpty');
    var clockEl = document.getElementById('heroClock');
    var scrollBtn = document.getElementById('scrollToNow');

    if (clockEl) clockEl.textContent = clockText();

    var rows = filteredRows();
    var now = nowMin();
    var next = nextDeparture();

    if (!next) {
      timeEl.textContent = '--:--';
      if (countEl) countEl.textContent = '今日已無班次';
      if (labelEl) labelEl.textContent = (state.day === 'holiday' ? '假日' : '平日') + '／' +
        (state.dir === 'to' ? '去程' : '回程') + '，請參考完整時刻表';
      if (routeEl) routeEl.hidden = true;
      if (nextEl) nextEl.hidden = true;
      if (emptyEl) emptyEl.hidden = false;
      if (scrollBtn) scrollBtn.hidden = true;
      return;
    }
    if (emptyEl) emptyEl.hidden = true;

    var row = next.row;
    var p = destParts(row[2]);
    timeEl.textContent = row[0];
    if (countEl) countEl.textContent = relativeText(next.diff);
    if (labelEl) labelEl.textContent = next.diff <= 0 ? '車輛即將離站' : '預計發車';

    if (routeEl) routeEl.hidden = false;
    if (badgeEl) { badgeEl.textContent = row[1]; badgeEl.setAttribute('data-route', routeKey(row[1])); }
    if (destEl) destEl.textContent = p.to ? p.from + ' → ' + p.to : p.from;

    /* 「後三班」也只列會開的：列一班停駛的「06:50」在標題寫著「預計發車」的卡片上，
       等於叫使用者去等一班不會來的車。 */
    var following = followingRunning(rows, next.index, 3);
    if (nextEl) {
      if (!following.length) { nextEl.hidden = true; }
      else {
        nextEl.hidden = false;
        nextEl.innerHTML = following.map(function (r) {
          return '<span class="nxt" data-route="' + routeKey(r[1]) + '">' +
            '<b>' + escapeHtml(r[0]) + '</b><i>' + escapeHtml(r[1]) + '</i></span>';
        }).join('');
      }
    }
    if (scrollBtn) scrollBtn.hidden = !(next.index > 2);

    announceNext(row, next.diff, p);
  }

  /* ---------------------------------------------------------------------
     螢幕閱讀器公告
     ---------------------------------------------------------------------
     原本 aria-live="polite" aria-atomic="true" 掛在整個 Hero 上，而 Hero 内含
     下班車時間、剩餘分鐘、路線、目的地、後三班 —— init() 每 30 秒呼叫一次
     refreshScheduleViews()，等於每 30 秒把整段重唸一次，使用者只要停在時刻表
     頁就週期性被打斷。
     改成：live region 縮到一個 sr-only 節點，只有「下班車真的換了」才寫入。
     --------------------------------------------------------------------- */
  var lastAnnounced = '';
  function announceNext(row, diff, p) {
    var host = document.getElementById('heroAnnounce');
    if (!host) return;
    var sig = row[0] + '|' + row[1] + '|' + (diff <= 0 ? 'now' : 'soon');
    if (sig === lastAnnounced) return;
    lastAnnounced = sig;
    host.textContent = '下班車 ' + row[0] + '，' + row[1] + '，' +
      (p.to ? '往' + p.to.replace(/^往/, '') : p.from) + '，' +
      (diff <= 0 ? '即將發車' : relativeText(diff));
  }

  function refreshScheduleViews() {
    renderHero();
    renderSchedule();
  }

  /* 分段控制 */
  function bindSegmented(id, key, attr) {
    var group = document.getElementById(id);
    if (!group) return;
    group.addEventListener('click', function (e) {
      var btn = e.target.closest('button[' + attr + ']');
      if (!btn) return;
      state[key] = btn.getAttribute(attr);
      $$('button', group).forEach(function (b) {
        b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
      });
      refreshScheduleViews();
    });
  }
  bindSegmented('segDay', 'day', 'data-day');
  bindSegmented('segDir', 'dir', 'data-dir');

  var routeFilter = document.getElementById('routeFilter');
  if (routeFilter) {
    routeFilter.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-route]');
      if (!btn) return;
      state.route = btn.getAttribute('data-route');
      $$('button', routeFilter).forEach(function (b) {
        b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
        b.classList.toggle('is-active', b === btn);
      });
      refreshScheduleViews();
    });
  }

  var upcomingToggle = document.getElementById('upcomingOnly');
  if (upcomingToggle) {
    upcomingToggle.addEventListener('change', function () {
      state.upcomingOnly = upcomingToggle.checked;
      renderSchedule(true);
    });
  }

  var resetBtn = document.getElementById('resetScheduleBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      state.day = 'workday'; state.dir = 'to'; state.route = 'all'; state.upcomingOnly = false;
      if (upcomingToggle) upcomingToggle.checked = false;
      $$('#segDay button').forEach(function (b) {
        b.setAttribute('aria-pressed', b.getAttribute('data-day') === 'workday' ? 'true' : 'false');
      });
      $$('#segDir button').forEach(function (b) {
        b.setAttribute('aria-pressed', b.getAttribute('data-dir') === 'to' ? 'true' : 'false');
      });
      if (routeFilter) {
        $$('button', routeFilter).forEach(function (b) {
          var on = b.getAttribute('data-route') === 'all';
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
          b.classList.toggle('is-active', on);
        });
      }
      refreshScheduleViews();
    });
  }

  var scrollToNow = document.getElementById('scrollToNow');
  if (scrollToNow) {
    scrollToNow.addEventListener('click', function () {
      var target = $('.dep.is-next') || $('.dep:not(.is-past)');
      if (target) target.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'center' });
    });
  }

  /* ---------------------------------------------------------------------
     站點
     --------------------------------------------------------------------- */
  var stopsRendered = false;

  function stopItemHtml(st) {
    var maps = st.lat
      ? 'https://www.google.com/maps/dir/?api=1&destination=' + st.lat + ',' + st.lng
      : '#';
    /* 只有「站名文字」本身是連結。<li> 不再包 <a>，所以點時間、點右側空白
       都不會誤觸導航。時間軸圓點與 ↗ 都留在 <li> 上，純裝飾、不可點。 */
    return '<li class="stop-item" data-name="' + escapeHtml(st.name) + '">' +
      '<span class="stop-dot" aria-hidden="true"></span>' +
      '<a class="stop-name-text" href="' + maps + '" target="_blank" rel="noopener noreferrer">' +
        escapeHtml(st.name) +
      '</a>' +
      '<span class="stop-go" aria-hidden="true">↗</span>' +
    '</li>';
  }

  function buildStops() {
    var wrap = document.getElementById('stopSections');
    var anchors = document.getElementById('stopAnchors');
    if (!wrap || stopsRendered) return;

    wrap.innerHTML = DATA.sections.map(function (sec, i) {
      return '<details class="sect" id="sec-' + i + '" data-section="' + i + '" data-route="' + routeKey(sec.route) + '"' +
        (i === 0 ? ' open' : '') + '>' +
        '<summary class="sect__head">' +
          '<span class="sect__swatch" aria-hidden="true"></span>' +
          '<span class="sect__text">' +
            '<span class="sect__title">' + escapeHtml(sec.short || sec.title) + '</span>' +
            (sec.note ? '<span class="sect__note">' + escapeHtml(sec.note) + '</span>' : '') +
          '</span>' +
          '<span class="sect__count">' + sec.stops.length + ' 站</span>' +
          '<span class="sect__caret" aria-hidden="true"><svg viewBox="0 0 24 24"><use href="#i-chevron-down"/></svg></span>' +
        '</summary>' +
        '<ul class="sect__list">' + sec.stops.map(stopItemHtml).join('') + '</ul>' +
      '</details>';
    }).join('');

    if (anchors) {
      anchors.innerHTML = DATA.sections.map(function (sec, i) {
        return '<button class="chip" type="button" data-anchor="sec-' + i + '" data-route="' + routeKey(sec.route) + '">' +
          '<span class="chip__dot" aria-hidden="true"></span>' + escapeHtml(sec.label) + '</button>';
      }).join('');
      anchors.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-anchor]');
        if (!btn) return;
        var target = document.getElementById(btn.getAttribute('data-anchor'));
        if (!target) return;
        target.open = true;
        target.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
      });
    }
    stopsRendered = true;
    applyStopSearch();
  }

  function ensureStops() {
    buildStops();
    tdx.renderFromSnapshotIfNeeded();
  }

  var stopSearch = document.getElementById('stopSearch');
  var stopSearchWrap = document.getElementById('stopSearchWrap');

  function applyStopSearch() {
    var kw = (stopSearch ? stopSearch.value : '').trim();
    if (stopSearchWrap) stopSearchWrap.classList.toggle('has-value', !!kw);
    var anyVisible = false;

    $$('#stopSections .sect').forEach(function (card) {
      var visible = 0;
      $$('.stop-item', card).forEach(function (item) {
        var hit = !kw || (item.dataset.name || '').indexOf(kw) !== -1;
        item.hidden = !hit;
        if (hit) { visible++; anyVisible = true; }
      });
      var titleEl = card.querySelector('.sect__title');
      if (kw && titleEl && titleEl.textContent.indexOf(kw) !== -1) {
        $$('.stop-item', card).forEach(function (item) { item.hidden = false; visible++; });
        anyVisible = true;
      }
      card.hidden = kw ? visible === 0 : false;
      if (kw) { card.open = true; }
      var countEl = card.querySelector('.sect__count');
      if (countEl) {
        var idx = +card.getAttribute('data-section');
        countEl.textContent = (kw ? visible : (DATA.sections[idx] ? DATA.sections[idx].stops.length : visible)) + ' 站';
      }
    });

    var emptyEl = document.getElementById('stopsEmpty');
    if (emptyEl) emptyEl.hidden = !(kw && !anyVisible);
  }

  if (stopSearch) {
    stopSearch.addEventListener('input', applyStopSearch);
    stopSearch.addEventListener('search', applyStopSearch);
  }
  [['stopSearchClear'], ['clearStopSearch']].forEach(function (pair) {
    var el = document.getElementById(pair[0]);
    if (el) el.addEventListener('click', function () {
      if (stopSearch) { stopSearch.value = ''; stopSearch.focus(); }
      applyStopSearch();
    });
  });

  /* ---------------------------------------------------------------------
     TDX 即時到站（代理優先、失敗回退快照）
     --------------------------------------------------------------------- */
  var tdx = (function () {
    var PROXY_URL = CONFIG.TDX_PROXY_URL || '';
    /* 各版本位於自己的子目錄，快照放在專案根的 data/ */
    var SNAPSHOT_URL = 'data/tdx_snapshot.json';
    var sectionsCache = null;
    var lastGeneratedAt = '';
    var inFlight = false;
    var pollTimer = null;
    var tickTimer = null;
    var nextAt = 0;

    function setSync(text, isError) {
      var el = document.getElementById('syncStatus');
      if (!el) return;
      el.textContent = text;
      el.classList.toggle('is-error', !!isError);
    }
    function setSummary(text) {
      var el = document.getElementById('tdxSummary');
      if (el) el.textContent = text;
    }
    function setMode(mode) {
      var el = document.getElementById('tdxMode');
      var dot = document.getElementById('tdxDot');
      if (el) {
        el.className = 'mode ' + (mode === 'live' ? 'is-live' : mode === 'snapshot-stale' ? 'is-stale' : mode === 'snapshot' ? 'is-snap' : 'is-error');
        el.textContent = mode === 'live' ? '即時' : mode === 'snapshot-stale' ? '快照·非即時' : mode === 'snapshot' ? '快照' : '無法取得';
      }
      if (dot) dot.className = 'dot ' + (mode === 'live' ? 'is-live' : mode === 'snapshot-stale' ? 'is-stale' : 'is-idle');
    }
    function setCountdown(text) {
      var el = document.getElementById('tdxCountdown');
      if (el) el.textContent = text;
    }
    function formatEta(rec) {
      if (!rec) return '';
      var sec = rec.estimateTime, status = rec.stopStatus;
      if (sec === null || sec === undefined) return '';
      if (status !== 0 && status !== 1) return '';
      if (sec <= 30) return '進站中';
      var mins = Math.round(sec / 60);
      if (mins <= 0) return '即將到站';
      return mins + ' 分';
    }
    function keyOf(route, dir, stopID) { return route + '|' + dir + '|' + stopID; }

    function indexFromSections(sections) {
      var map = {};
      (sections || []).forEach(function (sec) {
        if (!sec || !sec.stops || !sec.routeName) return;
        sec.stops.forEach(function (st) {
          map[keyOf(sec.routeName, sec.direction, st.stopID)] = {
            estimateTime: st.estimateTime, stopStatus: st.stopStatus, srcUpdateTime: st.srcUpdateTime
          };
        });
      });
      return map;
    }
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
        if (!res.ok) throw new Error('snapshot ' + res.status);
        return res.json();
      });
    }

    function renderIndex(map) {
      var cards = $$('#stopSections .sect');
      var shown = 0, noEta = 0, covered = 0;

      cards.forEach(function (card) {
        var i = +card.getAttribute('data-section');
        var sec = sectionsCache ? sectionsCache[i] : null;
        var meta = DATA.sections[i] || null;
        var items = $$('.stop-item', card);

        /* 社巴不是 TDX 路線：明確標示，而不是留一片空白像壞掉 */
        if (meta && meta.route === '社巴') noEta += items.length;
        card.classList.toggle('has-no-eta', !!(meta && meta.route === '社巴'));

        if (!sec || !sec.stops || !sec.stops.length) {
          items.forEach(function (item) { var old = item.querySelector('.eta'); if (old) old.remove(); });
          return;
        }
        covered += items.length;

        items.forEach(function (item, idx) {
          var st = sec.stops[idx];
          if (!st) return;
          var rec = map[keyOf(sec.routeName, sec.direction, st.stopID)];
          var text = formatEta(rec);
          var host = item;
          var old = item.querySelector('.eta');
          var dot = item.querySelector('.stop-dot');
          /* 即將抵達（<= 3 分鐘或進站中）：圓點閃爍，與首頁「下班車」同一組動畫 */
          var approaching = !!(rec && rec.estimateTime !== null && rec.estimateTime !== undefined &&
            (rec.stopStatus === 0 || rec.stopStatus === 1) && rec.estimateTime <= 180);
          if (dot) dot.classList.toggle('is-approaching', approaching);
          if (!text || !host) { if (old) old.remove(); return; }
          var tag = old;
          if (!tag) { tag = document.createElement('em'); tag.className = 'eta'; host.appendChild(tag); }
          if (tag.textContent !== text) tag.textContent = text;
          if (rec && rec.srcUpdateTime) tag.title = 'TDX 更新：' + fmtTime(rec.srcUpdateTime);
          shown++;
        });
      });
      return { shown: shown, noEta: noEta };
    }

    function summarize(result, mode) {
      var stamp = lastGeneratedAt ? '（資料時間 ' + fmtTime(lastGeneratedAt) + '）' : '';
      var tail = mode === 'live' ? '' : '目前為快照、非即時。';
      var extra = result.noEta ? '社巴非 TDX 路線，不提供預估時間。' : '';
      setSummary(result.shown + ' 個站位有預估到站時間' + stamp + '。' + extra + tail);
    }

    function fetchLive() {
      var url = PROXY_URL.replace(/\/+$/, '') + '/bus/eta';
      return fetch(url, { cache: 'no-store' }).then(function (res) {
        if (!res.ok) throw new Error('proxy ' + res.status);
        return res.json();
      }).then(function (json) {
        var rows = json && (json.data || json);
        if (Array.isArray(rows) && !rows.length) return {};
        return indexFromEtaRows(rows);
      }).catch(function () { return null; });
    }

    function update(silent) {
      if (inFlight) return Promise.resolve();
      inFlight = true;
      if (!silent) setSync('正在同步 TDX 資料…');

      var loadSections = sectionsCache
        ? Promise.resolve(sectionsCache)
        : loadSnapshot().then(function (data) {
            sectionsCache = (data && data.sections) || [];
            lastGeneratedAt = (data && data.generatedAt) || '';
            return sectionsCache;
          });

      return loadSections.then(function () {
        return (PROXY_URL ? fetchLive() : Promise.resolve(null)).then(function (liveMap) {
          var result, mode;
          if (liveMap) {
            mode = 'live';
            result = renderIndex(liveMap);
            lastGeneratedAt = new Date().toISOString();
            setMode('live');
            setSync('已更新 ' + result.shown + ' 個站位 · ' + clockText());
          } else {
            mode = 'snapshot';
            result = renderIndex(indexFromSections(sectionsCache));
            var ageMs = Date.now() - (lastGeneratedAt ? Date.parse(lastGeneratedAt) : 0);
            var stale = !lastGeneratedAt || isNaN(ageMs) || ageMs > CONFIG.STALE_MS;
            setMode(stale ? 'snapshot-stale' : 'snapshot');
            setSync(result.shown ? '已更新（快照資料）' : '已更新，目前無預估到站資料');
          }
          summarize(result, mode);
          nextAt = Date.now() + CONFIG.POLL_MS;
          return result;
        });
      }).catch(function () {
        setSync('TDX 載入失敗', true);
        setMode('error');
        setSummary('即時到站暫時無法取得，時刻表與站點清單仍可正常使用。');
        nextAt = Date.now() + CONFIG.POLL_MS;
        throw new Error('tdx update failed');
      }).then(function (v) { inFlight = false; return v; },
              function (e) { inFlight = false; throw e; });
    }

    function tick() {
      if (!nextAt) { setCountdown(''); return; }
      var left = Math.max(0, Math.ceil((nextAt - Date.now()) / 1000));
      setCountdown(left > 0 ? left + ' 秒後更新' : '更新中…');
      if (left <= 0 && !inFlight) update(true);
    }

    function start() {
      if (pollTimer) return;
      pollTimer = setInterval(function () { if (!inFlight) update(true); }, CONFIG.POLL_MS);
      tickTimer = setInterval(tick, 1000);
      if (!sectionsCache) update(false);
      else { renderFromSnapshotIfNeeded(); nextAt = nextAt || Date.now() + CONFIG.POLL_MS; }
    }
    function stop() {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
      setCountdown('');
    }
    function renderFromSnapshotIfNeeded() {
      if (!sectionsCache) return;
      renderIndex(indexFromSections(sectionsCache));
    }

    var refreshBtn = document.getElementById('refreshTdx');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function () {
        if (refreshBtn.disabled) return;
        refreshBtn.disabled = true;
        refreshBtn.classList.add('is-busy');
        refreshBtn.classList.remove('is-error');
        var settle = function (failed) {
          refreshBtn.disabled = false;
          refreshBtn.classList.remove('is-busy');
          if (failed) {
            /* 失敗時錯誤訊息原本只寫在下面那行 13px 小字（#syncStatus），
               但使用者的視線在按鈕上 —— 主觀感受就是「按了、轉了一下、什麼都沒發生」。
               讓按鈕自己也短暫變色，並把行內提示寫成可重試的句子。 */
            refreshBtn.classList.add('is-error');
            setSync('取不到即時資料 · 顯示 ' + (lastGeneratedAt ? fmtTime(lastGeneratedAt) + ' 的快照' : '上次快照') + '，可再按一次重試', true);
            setTimeout(function () { refreshBtn.classList.remove('is-error'); }, 2400);
          }
        };
        update(false).then(function () { settle(false); }, function () { settle(true); });
      });
    }

    window.addEventListener('online', function () { setOffline(false); update(true); });
    window.addEventListener('offline', function () { setOffline(true); setSync('目前離線，顯示快取內容'); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && currentView === 'stops') {
        update(true); nextAt = Date.now() + CONFIG.POLL_MS;
      }
    });

    return {
      start: start, stop: stop, update: update,
      renderFromSnapshotIfNeeded: renderFromSnapshotIfNeeded
    };
  })();

  function setOffline(offline) {
    var note = document.getElementById('offlineNote');
    if (note) note.hidden = !offline;
  }

  /* ---------------------------------------------------------------------
     電話
     --------------------------------------------------------------------- */
  function renderPhones() {
    var wrap = document.getElementById('phoneGroups');
    if (!wrap) return;
    var groups = (DATA.phoneGroups || []).filter(function (g) { return g && g.unit && g.lines && g.lines.length; });

    wrap.innerHTML = groups.map(function (g) {
      var lines = g.lines.map(function (l) {
        var ext = (l.ext && /^\d+$/.test(l.ext)) ? '<span class="ph__ext">分機 ' + escapeHtml(l.ext) + '</span>' : '';
        if (!l.tel) {
          return '<div class="ph ph--muted"><span class="ph__num">分機 ' + escapeHtml(l.ext) + '</span></div>';
        }
        return '<a class="ph" href="' + escapeHtml(l.href || ('tel:' + l.tel.replace(/[^0-9+]/g, ''))) + '"' +
            ' aria-label="撥打 ' + escapeHtml(g.unit) + ' ' + escapeHtml(l.tel) + '">' +
          '<span class="ph__num">' + escapeHtml(l.tel) + '</span>' + ext +
          '<span class="ph__call" aria-hidden="true">撥號</span>' +
        '</a>';
      }).join('');
      var hay = (g.unit + ' ' + (g.note || '') + ' ' + g.lines.map(function (l) { return l.tel + ' ' + (l.ext || ''); }).join(' ')).toLowerCase();
      return '<div class="unit" data-search="' + escapeHtml(hay) + '">' +
        '<div class="unit__head"><span class="unit__name">' + escapeHtml(g.unit) + '</span>' +
        (g.note ? '<span class="unit__note">' + escapeHtml(g.note) + '</span>' : '') + '</div>' +
        '<div class="unit__lines">' + lines + '</div>' +
      '</div>';
    }).join('');
  }

  var phoneSearch = document.getElementById('phoneSearch');
  var phoneSearchWrap = document.getElementById('phoneSearchWrap');

  function applyPhoneSearch() {
    var kw = (phoneSearch ? phoneSearch.value : '').trim().toLowerCase();
    if (phoneSearchWrap) phoneSearchWrap.classList.toggle('has-value', !!kw);
    var shown = 0, total = 0;
    $$('#phoneGroups .unit').forEach(function (card) {
      total++;
      var hit = !kw || (card.getAttribute('data-search') || '').indexOf(kw) !== -1;
      card.hidden = !hit;
      if (hit) shown++;
    });
    var bar = document.getElementById('phoneResultBar');
    if (bar) {
      bar.innerHTML = kw
        ? '找到 <b>' + shown + '</b> 個單位（共 ' + total + '）'
        : '共 <b>' + total + '</b> 個單位 · 點號碼直撥';
    }
    var emptyEl = document.getElementById('phoneEmpty');
    if (emptyEl) emptyEl.hidden = !(kw && shown === 0);
  }
  if (phoneSearch) {
    phoneSearch.addEventListener('input', applyPhoneSearch);
    phoneSearch.addEventListener('search', applyPhoneSearch);
  }
  ['phoneSearchClear', 'clearPhoneSearch'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('click', function () {
      if (phoneSearch) { phoneSearch.value = ''; phoneSearch.focus(); }
      applyPhoneSearch();
    });
  });

  /* ---------------------------------------------------------------------
     安裝步驟輪播
     --------------------------------------------------------------------- */
  var slider = (function () {
    var instances = [];
    var rm = reduceMotion();

    function setup(root) {
      var viewport = $('.slider__track', root);
      var slides = $$('.slide', root);
      var dotsWrap = $('.dots', root);
      var prev = $('[data-slide-prev]', root);
      var next = $('[data-slide-next]', root);
      var index = 0, timer = null, visible = false, syncT = null, resumeT = null;
      if (!viewport || !slides.length) return null;

      if (dotsWrap) {
        dotsWrap.innerHTML = slides.map(function (_, i) {
          /* 原本用 role="tab"，但父層是 role="group"、也沒有 tabpanel，
             屬於語意錯誤（實測 10 個孤兒 tab），輔助技術會回報不存在的 Tab 關係。
             圓點只是「第 n 張」的跳轉鈕，用 aria-current 就夠。 */
          return '<button class="dot" type="button" aria-label="第 ' + (i + 1) + ' 張，共 ' +
            slides.length + ' 張" aria-current="' + (i === 0 ? 'true' : 'false') + '"></button>';
        }).join('');
      }
      var dots = $$('.dot', root);

      /* ---- 位移一律走原生捲動（scrollLeft）---------------------------------
         舊版同時設定 transform 與依賴 scroll-snap 的原生捲動，等於兩套位移
         系統並存：自動輪播只改 transform、手動滑動只改 scrollLeft，兩者
         疊加後第 2 張之後的內容被推到視窗外，看起來就是「一片空白」。
         現在只保留一條路徑：slides 用 flex-basis:100%，JS 只呼叫 scrollTo。 */
      function slideW() {
        var w = slides[0].getBoundingClientRect().width;
        return w > 1 ? w : viewport.clientWidth;
      }
      function maxLeft() {
        return Math.max(0, viewport.scrollWidth - viewport.clientWidth);
      }
      function paint() {
        dots.forEach(function (d, di) { d.setAttribute('aria-current', di === index ? 'true' : 'false'); });
        dots.forEach(function (d, di) { d.tabIndex = di === index ? 0 : -1; });
        slides.forEach(function (s, si) { s.setAttribute('aria-hidden', si === index ? 'false' : 'true'); });
      }
      function go(i, instant) {
        if (!slides.length) return;
        index = (i + slides.length) % slides.length;
        paint();
        var w = slideW();
        if (!w) return;                     /* 面板隱藏時量不到寬度，show() 會再補一次 */
        var left = Math.min(index * w, maxLeft());
        if (instant || rm || !viewport.scrollTo) { viewport.scrollLeft = left; return; }
        viewport.scrollTo({ left: left, behavior: 'smooth' });
      }
      function syncFromScroll() {
        var w = slideW();
        if (!w) return;
        var i = Math.round(viewport.scrollLeft / w);
        i = Math.max(0, Math.min(slides.length - 1, i));
        if (i !== index) { index = i; paint(); }
      }
      function start() {
        if (rm || timer || !visible) return;
        timer = setInterval(function () { go(index + 1); }, 6000);
      }
      function pause() { if (timer) { clearInterval(timer); timer = null; } }
      /* 手動操作後只暫停 9 秒就恢復 —— 舊版一旦互動就永久停擺 */
      function interact(fn) {
        fn();
        pause();
        if (resumeT) clearTimeout(resumeT);
        resumeT = setTimeout(function () { if (visible) start(); }, 9000);
      }
      function show() { visible = true; go(index, true); start(); }
      function hide() { visible = false; pause(); if (resumeT) { clearTimeout(resumeT); resumeT = null; } }
      function refresh() { if (visible) go(index, true); }

      if (prev) prev.addEventListener('click', function () { interact(function () { go(index - 1); }); });
      if (next) next.addEventListener('click', function () { interact(function () { go(index + 1); }); });
      dots.forEach(function (d, i) { d.addEventListener('click', function () { interact(function () { go(i); }); }); });

      /* 觸控滑動交給原生捲動 + scroll-snap，JS 不再自己做位移 */
      root.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowLeft') { e.preventDefault(); interact(function () { go(index - 1); }); }
        if (e.key === 'ArrowRight') { e.preventDefault(); interact(function () { go(index + 1); }); }
      });
      root.addEventListener('mouseenter', pause);
      root.addEventListener('mouseleave', function () { if (visible) start(); });
      root.addEventListener('focusin', pause);

      /* 手動滑動：只讀捲動結果，不回寫位移 */
      viewport.addEventListener('scroll', function () {
        if (syncT) clearTimeout(syncT);
        syncT = setTimeout(syncFromScroll, 80);
      }, { passive: true });

      /* 轉向／縮放／字級變化後重新對齊，避免停在兩張之間 */
      window.addEventListener('resize', function () { if (visible) go(index, true); });
      if (window.ResizeObserver) {
        new ResizeObserver(function () { if (visible) go(index, true); }).observe(viewport);
      }

      paint();
      return { show: show, hide: hide, start: start, pause: pause, refresh: refresh };
    }

    $$('.slider').forEach(function (root) {
      var inst = setup(root);
      if (inst) instances.push(inst);
    });

    return {
      playAll: function () { instances.forEach(function (s) { s.show(); }); },
      pauseAll: function () { instances.forEach(function (s) { s.hide(); }); }
    };
  })();

  /* ---------------------------------------------------------------------
     搭乘提醒（24 小時一次）
     --------------------------------------------------------------------- */
  var boardingModal = document.getElementById('boardingModal');
  var lastFocused = null;

  function shouldShowBoarding() {
    var last = store.get(CONFIG.BOARDING_KEY, null);
    if (!last) return true;
    return (Date.now() - Number(last)) / 3600000 >= CONFIG.BOARDING_HOURS;
  }
  function openBoarding() {
    if (!boardingModal) return;
    lastFocused = document.activeElement;
    boardingModal.hidden = false;
    document.body.classList.add('is-locked');
    var btn = document.getElementById('boardingOk');
    if (btn) btn.focus();
    document.addEventListener('keydown', onBoardingKey);
  }
  function closeBoarding() {
    if (!boardingModal) return;
    boardingModal.hidden = true;
    document.body.classList.remove('is-locked');
    store.set(CONFIG.BOARDING_KEY, String(Date.now()));
    document.removeEventListener('keydown', onBoardingKey);
    if (lastFocused && lastFocused.focus) lastFocused.focus({ preventScroll: true });
  }
  function onBoardingKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); closeBoarding(); }
    if (e.key === 'Tab' && boardingModal) {
      var f = $$('button, [href], input, select, textarea', boardingModal)
        .filter(function (el) { return !el.disabled && el.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  var boardingOk = document.getElementById('boardingOk');
  if (boardingOk) boardingOk.addEventListener('click', closeBoarding);
  if (boardingModal) {
    boardingModal.addEventListener('click', function (e) { if (e.target === boardingModal) closeBoarding(); });
  }

  /* ---------------------------------------------------------------------
     安裝提示
     --------------------------------------------------------------------- */
  var installBtn = document.getElementById('installBtn');
  var deferredPrompt = null;
  var isStandalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches ||
    navigator.standalone === true;

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    if (installBtn && !isStandalone) installBtn.hidden = false;
  });
  if (installBtn) {
    installBtn.addEventListener('click', function () {
      if (!deferredPrompt) { activateView('about'); return; }
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function () { deferredPrompt = null; installBtn.hidden = true; });
    });
  }
  window.addEventListener('appinstalled', function () { if (installBtn) installBtn.hidden = true; });

  /* ---------------------------------------------------------------------
     贊助區塊（請開發者喝杯咖啡）
     ---------------------------------------------------------------------
     用原生 <button> 做展開鈕，所以 Enter / Space 由瀏覽器處理，不需要自己攔鍵盤。
     唯一的紀律：aria-expanded 與 hidden 必須永遠同步 —— 兩者脫鉤時，
     螢幕閱讀器會唸「已展開」但畫面上什麼都沒有。
     --------------------------------------------------------------------- */
  var sponsorToggle = document.getElementById('sponsorToggle');
  var sponsorQR = document.getElementById('sponsorQR');
  var sponsorToggleLabel = document.getElementById('sponsorToggleLabel');

  if (sponsorToggle && sponsorQR) {
    var setSponsor = function (open) {
      sponsorToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      sponsorQR.hidden = !open;
      if (sponsorToggleLabel) {
        sponsorToggleLabel.textContent = open ? '收合贊助資訊' : '顯示贊助資訊';
      }
    };

    sponsorToggle.addEventListener('click', function () {
      setSponsor(sponsorToggle.getAttribute('aria-expanded') !== 'true');
    });

    /* 從外面切回「關於」頁時，收合狀態保持一致（.panel 只切 hidden，不會動內部） */
    setSponsor(false);
  }

  /* ---------------------------------------------------------------------
     啟動
     --------------------------------------------------------------------- */
  function totalDepartures() {
    /* normalSchedule 與 typhoonSchedule 是「互斥」的兩套班表：颱風日只用後者。
       原本把兩者相加，等於把同一批班次算兩次 —— 「關於」頁顯示 456 筆，
       而時刻表面板寫「共 66 班」，兩個數字差 7 倍，使用者會懷疑資料正確性。
       現在只算「正常班表」，並把平／假日分開呈現。 */
    var sched = DATA.normalSchedule || {};
    var n = 0;
    Object.keys(sched).forEach(function (d) {
      Object.keys(sched[d]).forEach(function (t) { n += sched[d][t].length; });
    });
    return n;
  }
  /* 平／假日分開的細項，供「關於」頁顯示，避免只給一個無法核對的大數字。 */
  function departureBreakdown() {
    var sched = DATA.normalSchedule || {};
    function count(day) {
      var t = sched[day] || {};
      return Object.keys(t).reduce(function (a, k) { return a + t[k].length; }, 0);
    }
    return { workday: count('workday'), holiday: count('holiday') };
  }
  function totalStops() {
    return (DATA.sections || []).reduce(function (a, s) { return a + s.stops.length; }, 0);
  }

  /* ---------------------------------------------------------------------
     公告 / 颱風日：依賴執行期設定，所以必須等外部 JSON 回來才決定
     ---------------------------------------------------------------------
     原本 init() 一開始就 renderAlert()，若改成讀外部檔案，「先 렌더、後載入」
     會讓使用者在載入完成前看到錯誤狀態（或永遠不更新）。這裡抽成一個
     applyRuntimeState()，只在設定真的到手（或確定拿不到）後跑一次。
     --------------------------------------------------------------------- */
  function applyRuntimeState() {
    renderAlert();

    if (isTyphoonDay()) {
      state.day = 'holiday';
      $$('#segDay button').forEach(function (b) {
        b.setAttribute('aria-pressed', b.getAttribute('data-day') === 'holiday' ? 'true' : 'false');
      });
      renderHero();
      renderSchedule(true);
    }
  }

  function init() {
    var mDep = document.getElementById('metaDepartures');
    if (mDep) {
      var b = departureBreakdown();
      mDep.textContent = totalDepartures() + ' 筆（平日 ' + b.workday + ' · 假日 ' + b.holiday + '）';
    }
    var mSec = document.getElementById('metaSections');
    if (mSec) mSec.textContent = DATA.sections.length + ' 段 / ' + totalStops() + ' 站';
    var mVer = document.getElementById('metaVersion');
    if (mVer) mVer.textContent = DATA.version || '—';

    renderPhones();
    applyPhoneSearch();
    renderHero();
    renderSchedule(true);
    buildStops();
    setOffline(!navigator.onLine);

    /* 公告與颱風日要等 data/schedule-config.json 回來；先畫時刻表，
       不阻塞首屏。拿到設定後再補上橫幅（或確定不顯示）。 */
    loadRuntimeConfig().then(applyRuntimeState);

    var initial = (location.hash || '').replace('#', '');
    if (VIEWS.indexOf(initial) === -1) initial = 'schedule';
    activateView(initial, { keepScroll: true });

    setInterval(function () { if (currentView === 'schedule') refreshScheduleViews(); }, 30000);
    setInterval(function () {
      var clockEl = document.getElementById('heroClock');
      if (clockEl && currentView === 'schedule') clockEl.textContent = clockText();
    }, 1000);

    if (shouldShowBoarding()) {
      setTimeout(function () { if (!boardingModal || boardingModal.hidden) openBoarding(); }, 1600);
    }

    window.addEventListener('focus', function () { if (currentView === 'schedule') refreshScheduleViews(); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && currentView === 'schedule') refreshScheduleViews();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.LHBS = {
    state: state,
    refresh: refreshScheduleViews,
    activateTab: activateView,
    filteredRows: filteredRows,
    nextDeparture: nextDeparture,
    totals: { departures: totalDepartures, stops: totalStops, sections: function () { return DATA.sections.length; }, phones: function () { return (DATA.phoneGroups || []).length; } },
    version: '3.0.0'
  };
})();
