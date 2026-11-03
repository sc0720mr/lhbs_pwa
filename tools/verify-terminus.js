/*
 * verify-terminus.js — 6.6.2 驗證：回程標「出發站點」
 *
 * 一次跑完：
 *   1. 桌面 1280 / 手機 390 × 中文 / 英文 × 平日 / 假日 × 去程 / 回程
 *   2. 水平溢出（scrollWidth vs clientWidth）
 *   3. console error / pageerror 計數
 *   4. 英文模式 CJK 掃描
 *   5. 逐班比對標籤文字 == 期望值（由 data.js 直接算，不靠畫面猜）
 *   6. 版本號四處一致
 *
 * 用法：node tools/verify-terminus.js [baseUrl]
 */
const path = require('path');
const fs = require('fs');
const puppeteer = require('/workspace/node_modules/puppeteer-core');

/* 為什麼用 Playwright 的 headless_shell 而不是 agent-browser 的 chrome：
 * agent-browser 的 chrome-151 在這台沙箱裡「任何」導航都會拋
 * Navigating frame was detached（連純 HTML 測試頁也一樣），與本專案無關。
 * ms-playwright 的 chromium_headless_shell 正常。 */
const CHROME = '/root/.cache/ms-playwright/chromium_headless_shell-1181/chrome-linux/headless_shell';
const BASE = process.argv[2] || 'http://127.0.0.1:8231';
const OUT = path.join(__dirname, '..', 'shots');
fs.mkdirSync(OUT, { recursive: true });

/* ---------- 期望值：直接從 data.js 算，不從畫面猜 ---------- */
global.window = {};
require(path.join(__dirname, '..', 'js', 'data.js'));
const DATA = global.window.LHBS_DATA;

const DEST_SEP = /\s*[\u27A1\u2192\u2794\u279E]\uFE0E?\s*/;
function parts(dest) {
  const a = String(dest).split(DEST_SEP);
  if (a.length < 2) return { from: String(dest), to: '' };
  return { from: a[0].trim(), to: a.slice(1).join(' ').replace(/^往/, '').trim() };
}

function expected(day, dir) {
  return DATA.normalSchedule[day][dir]
    .filter((r) => !/^\s*停駛\s*$/.test(r[2]))
    .map((r) => {
      const p = parts(r[2]);
      const focus = dir === 'from' ? p.from : p.to;
      const via = dir === 'from' && p.to.indexOf('水蓮') === -1 ? p.to : '';
      return { t: r[0], route: r[1], focus, via };
    });
}

/* ---------- CJK 掃描（與 tools/cjk-scan.js 同邏輯的內嵌版） ---------- */
function cjkScan() {
  const CJK = /[\u4e00-\u9fff\u3400-\u4dbf]/;
  const WANT = ['aria-label', 'title', 'alt', 'placeholder', 'aria-description', 'aria-valuetext'];
  const out = [];
  const sel = (el) => {
    const parts = [];
    let n = el, g = 0;
    while (n && n.nodeType === 1 && g++ < 6) {
      let s = n.tagName.toLowerCase();
      if (n.id) { parts.unshift(s + '#' + n.id); break; }
      const c = (n.className && typeof n.className === 'string') ? n.className.trim().split(/\s+/)[0] : '';
      if (c) s += '.' + c;
      parts.unshift(s);
      n = n.parentNode;
    }
    return parts.join('>');
  };
  const vis = (el) => {
    if (!el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const txt = (node.nodeValue || '').trim();
    if (!txt || !CJK.test(txt)) continue;
    const el = node.parentElement;
    if (!el || !vis(el)) continue;
    const cs = getComputedStyle(el);
    if (el.classList.contains('sr-only') ||
        (cs.clip && cs.clip !== 'auto') ||
        (cs.position === 'absolute' && parseFloat(cs.width) <= 1)) continue;
    out.push({ kind: 'text', sel: sel(el), text: txt });
  }
  WANT.forEach((attr) => {
    document.querySelectorAll('[' + attr + ']').forEach((el) => {
      const v = el.getAttribute(attr) || '';
      if (CJK.test(v) && vis(el)) out.push({ kind: attr, sel: sel(el), text: v });
    });
  });
  return out;
}

/* ---------- 主流程 ---------- */
(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'shell',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--font-render-hinting=none'],
  });

  const report = { shots: [], overflow: [], errors: [], cjk: {}, terminus: {}, version: null, hit: [] };

  async function newPage(w, h, lang, opts) {
    /* 為什麼要 stub service worker：
       index.html 的 controllerchange 監聽器（首次註冊 SW 時會觸發）會直接
       window.location.reload()。這是 App 的真實行為，但會把 puppeteer 的
       goto 導航 detach 掉（Navigating frame was detached）。
       截圖情境不需要 SW，把它 stub 掉即可；離線測試另外用真 SW。 */
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h, isMobile: w < 500, hasTouch: w < 500, deviceScaleFactor: 2 });
    if (lang) {
      await page.evaluateOnNewDocument((l) => {
        try { localStorage.setItem('lhbs_lang', l); } catch (e) {}
      }, lang);
    }
    if (!opts || !opts.sw) {
      await page.evaluateOnNewDocument(() => {
        try {
          Object.defineProperty(navigator, 'serviceWorker', {
            get: () => ({ register: () => Promise.reject(new Error('stub')), addEventListener: () => {}, ready: new Promise(() => {}) }),
            configurable: true,
          });
        } catch (e) {}
      });
    }
    const errs = [];
    page.on('console', (m) => {
      const t = m.text();
      /* 被 stub 的 SW 會讓瀏覽器自己吐一行錯誤，那不是 App 的問題 */
      if (t.indexOf('stub') !== -1) return;
      if (m.type() === 'error') errs.push('console: ' + t);
    });
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    await page.goto(BASE + '/index.html', { waitUntil: 'networkidle2' });
    return { page, errs };
  }

  async function setLang(page, lang) {
    const cur = await page.evaluate(() => window.LHBS_I18N.getLang());
    if ((lang === 'en') !== (cur === 'en')) {
      await page.evaluate(() => document.getElementById('langBtn').click());
      await new Promise((r) => setTimeout(r, 350));
    }
  }
  async function setDay(page, day) {
    const cur = await page.evaluate(() => window.__lhbsState ? window.__lhbsState.day : null);
    await page.evaluate((d) => {
      const b = document.querySelector('#segDay button[data-day="' + d + '"]');
      if (b) b.click();
    }, day);
    await new Promise((r) => setTimeout(r, 250));
  }
  async function setDir(page, dir) {
    await page.evaluate((d) => {
      const b = document.querySelector('#segDir button[data-dir="' + d + '"]');
      if (b) b.click();
    }, dir);
    await new Promise((r) => setTimeout(r, 250));
  }

  /* 讀出畫面上每一列的 標籤文字 + data-term，用來逐班比對 */
  async function readRows(page) {
    return page.evaluate(() => {
      return Array.from(document.querySelectorAll('#scheduleList .dep')).map((el) => {
        const term = el.querySelector('.dep__term');
        return {
          time: el.querySelector('.dep__time').textContent.replace(/\s/g, ''),
          route: el.querySelector('.dep__route').textContent.trim(),
          termText: term ? term.textContent.replace(/\s/g, '') : '',
          termKey: term ? term.getAttribute('data-term') : '',
          isOrigin: term ? term.classList.contains('dep__term--origin') : false,
          arrow: term ? term.querySelector('.dep__termArrow').textContent.trim() : '',
          via: term && term.querySelector('.dep__termVia') ? term.querySelector('.dep__termVia').textContent.trim() : '',
          susp: el.classList.contains('is-susp'),
        };
      });
    });
  }

  /* ---- 情境矩陣 ---- */
  const cases = [
    { w: 1280, h: 900, tag: 'desktop', lang: 'zh', day: 'workday', dir: 'to', shot: 'zh-desktop-workday-to' },
    { w: 1280, h: 900, tag: 'desktop', lang: 'zh', day: 'holiday', dir: 'from', shot: 'zh-desktop-holiday-from' },
    { w: 1280, h: 900, tag: 'desktop', lang: 'en', day: 'holiday', dir: 'from', shot: 'en-desktop-holiday-from' },
    { w: 390, h: 844, tag: 'mobile', lang: 'zh', day: 'workday', dir: 'from', shot: 'zh-mobile-workday-from' },
    { w: 390, h: 844, tag: 'mobile', lang: 'zh', day: 'holiday', dir: 'from', shot: 'zh-mobile-holiday-from' },
    { w: 390, h: 844, tag: 'mobile', lang: 'en', day: 'holiday', dir: 'from', shot: 'en-mobile-holiday-from' },
    { w: 390, h: 844, tag: 'mobile', lang: 'en', day: 'workday', dir: 'from', shot: 'en-mobile-workday-from' },
  ];

  for (const c of cases) {
    const { page, errs } = await newPage(c.w, c.h, c.lang);
    await setLang(page, c.lang);
    await setDay(page, c.day);
    await setDir(page, c.dir);
    await new Promise((r) => setTimeout(r, 400));

    // 版本號
    if (!report.version) {
      report.version = await page.evaluate(() => ({
        meta: document.querySelector('meta[name="app-version"]').content,
        metaCache: document.querySelector('meta[name="app-cache-version"]').content,
        manifest: (document.querySelector('link[rel="manifest"]').href.match(/v=([^&]+)/) || [])[1],
      }));
      /* BUILD 只在 console 與 ?v=check 徽章出現，另行讀取 */
      report.version.build = await page.evaluate(async () => {
        const r = await fetch('js/core.js', { cache: 'no-store' });
        const t = await r.text();
        const m = t.match(/var BUILD = '([^']+)'/);
        return m ? m[1] : null;
      });
      report.version.swCache = await page.evaluate(async () => {
        const r = await fetch('service-worker.js', { cache: 'no-store' });
        const t = await r.text();
        const m = t.match(/CACHE_VERSION = '([^']+)'/);
        return m ? m[1] : null;
      });
    }

    // 溢出
    const ov = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      bodyScroll: document.body.scrollWidth,
    }));
    report.overflow.push({ shot: c.shot, ...ov, ok: ov.scrollWidth <= ov.clientWidth });

    // 逐班比對
    const rows = await readRows(page);
    const exp = expected(c.day, c.dir);
    let mismatch = [];
    if (rows.length !== exp.length) mismatch.push('列數 ' + rows.length + ' != 期望 ' + exp.length);
    else {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i], e = exp[i];
        if (r.time !== e.t) mismatch.push('#' + i + ' 時間 ' + r.time + ' != ' + e.t);
        const expFocus = e.focus;
        if (c.lang === 'zh') {
          if (!r.termText.includes(expFocus)) mismatch.push('#' + i + ' ' + r.time + ' 標籤「' + r.termText + '」缺「' + expFocus + '」');
        }
        if (e.via && !r.via) mismatch.push('#' + i + ' ' + r.time + ' 缺 via「' + e.via + '」');
        if (!e.via && r.via) mismatch.push('#' + i + ' ' + r.time + ' 多餘 via「' + r.via + '」');
        if (c.dir === 'from' && !r.isOrigin && !r.susp) mismatch.push('#' + i + ' 回程缺 dep__term--origin');
      }
    }
    report.terminus[c.shot] = {
      rows: rows.length, expected: exp.length, mismatch: mismatch.slice(0, 8), mismatchCount: mismatch.length,
      sample: rows.filter((r) => !r.susp).slice(0, 3).map((r) => r.time + ' ' + r.route + ' ' + r.termText),
    };

    // CJK（英文模式）
    if (c.lang === 'en') {
      const hits = await page.evaluate(cjkScan);
      report.cjk[c.shot] = hits;
    }

    // 命中區（只在手機量一次）
    if (c.tag === 'mobile' && !report.hit.length) {
      report.hit = await page.evaluate(() => {
        const bad = [];
        document.querySelectorAll('button, a, label.switch, .chip, [role="button"]').forEach((el) => {
          const r = el.getBoundingClientRect();
          if (!r.width && !r.height) return;
          const cs = getComputedStyle(el);
          let w = r.width, h = r.height;
          const a = getComputedStyle(el, '::after');
          if (a && a.content && a.content !== 'none' && a.position === 'absolute') {
            const ins = ['top', 'bottom', 'left', 'right'].map((k) => parseFloat(a[k]) || 0);
            h += Math.abs(ins[0]) + Math.abs(ins[1]);
            w += Math.abs(ins[2]) + Math.abs(ins[3]);
          }
          if (w < 44 || h < 44) bad.push({ t: el.tagName, c: el.className.toString().slice(0, 40), w: Math.round(w), h: Math.round(h) });
        });
        return bad;
      });
    }

    const file = path.join(OUT, c.shot + '.png');
    await page.screenshot({ path: file, fullPage: false });
    report.shots.push(file);

    report.errors.push({ shot: c.shot, count: errs.length, list: errs.slice(0, 4) });
    await page.close();
  }

  /* ---- 離線：用「真」service worker 載入一次，斷網後重新載入 ---- */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    await page.goto(BASE + '/index.html', { waitUntil: 'networkidle2' });
    // 等 SW 接管（第一次註冊後 controllerchange 會觸發一次 reload，屬正常）
    await page.waitForFunction('navigator.serviceWorker.controller !== null', { timeout: 15000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1200));
    const online = await page.evaluate(() => ({
      controlled: !!navigator.serviceWorker.controller,
      rows: document.querySelectorAll('#scheduleList .dep').length,
      day: window.LHBS_DAY ? window.LHBS_DAY.day : null,
    }));

    // 真斷網
    await page.setOfflineMode(true);
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));
    const offline = await page.evaluate(() => ({
      rows: document.querySelectorAll('#scheduleList .dep').length,
      hero: (document.getElementById('heroTime') || {}).textContent || '',
      offlineBanner: !!document.querySelector('.offline, #offline, [data-offline]'),
      terms: document.querySelectorAll('#scheduleList .dep__term').length,
    })).catch((e) => ({ error: e.message }));

    await page.screenshot({ path: path.join(OUT, 'offline-mobile.png') });
    report.shots.push(path.join(OUT, 'offline-mobile.png'));
    report.offline = { online, offline, errs: errs.slice(0, 3) };
    await page.setOfflineMode(false);
    await page.close();
  }

  /* ---- 標籤特寫：手機假日回程，只截時刻表上半 ---- */
  {
    const { page } = await newPage(390, 844, "zh");
    await setLang(page, 'zh');
    await setDay(page, 'holiday');
    await setDir(page, 'from');
    await new Promise((r) => setTimeout(r, 400));
    const box = await page.evaluate(() => {
      const el = document.getElementById('scheduleList');
      const r = el.getBoundingClientRect();
      return { y: r.top + window.scrollY, h: Math.min(r.height, 520) };
    });
    await page.screenshot({
      path: path.join(OUT, 'zh-mobile-holiday-from-detail.png'),
      clip: { x: 0, y: box.y, width: 390, height: box.h },
    });
    report.shots.push(path.join(OUT, 'zh-mobile-holiday-from-detail.png'));
    await page.close();
  }

  await browser.close();

  /* ---- 匯總 ---- */
  const bad = report.overflow.filter((o) => !o.ok);
  const errTot = report.errors.reduce((a, e) => a + e.count, 0);

  /* CJK 判定：允許清單（刻意保留的雙語站名 / 語言鈕本身）
     其餘一律視為漏翻。stationary 併排字串的樣式是「中文 + 英文」。 */
  const ALLOW = [
    '中',                                        // 語言鈕上的「中」，代表可切回中文
    /^[\u4e00-\u9fff]+ [A-Za-z]/,                // 專有名詞併排：水蓮 Lotus Hill
    /Switch language/,                            // 語言鈕 aria-label（刻意雙語）
  ];
  function isAllowed(text) {
    return ALLOW.some((a) => (typeof a === 'string' ? text === a : a.test(text)));
  }
  const cjkBad = {};
  let cjkBadTot = 0;
  Object.entries(report.cjk).forEach(([k, v]) => {
    const unexp = v.filter((x) => !isAllowed(x.text));
    if (unexp.length) { cjkBad[k] = unexp; cjkBadTot += unexp.length; }
  });
  const cjkTotAll = Object.values(report.cjk).reduce((a, v) => a + v.length, 0);
  const cjkUniq = [...new Set(Object.values(report.cjk).flat().map((x) => x.text))];

  const misTot = Object.values(report.terminus).reduce((a, v) => a + v.mismatchCount, 0);

  console.log('\n================ 驗證結果 ================');
  console.log('版本號      :', JSON.stringify(report.version));
  console.log('水平溢出    :', bad.length === 0 ? 'OK 0 筆' : 'FAIL ' + JSON.stringify(bad));
  console.log('JS 錯誤總數 :', errTot);
  report.errors.forEach((e) => { if (e.count) console.log('   ', e.shot, e.list); });
  console.log('逐班比對    :', misTot === 0 ? 'OK 全數相符' : 'FAIL ' + misTot + ' 筆');
  Object.entries(report.terminus).forEach(([k, v]) => {
    console.log('   ' + k.padEnd(30), v.rows + '/' + v.expected, v.mismatchCount ? 'MISMATCH ' + JSON.stringify(v.mismatch) : 'ok', '|', (v.sample || []).join(' , '));
  });
  console.log('英文模式 CJK:', cjkTotAll, '筆 / 去重', cjkUniq.length, '種；非白名單', cjkBadTot);
  console.log('   白名單字串:', JSON.stringify(cjkUniq));
  if (cjkBadTot) console.log('   FAIL 非白名單:', JSON.stringify(cjkBad, null, 1).slice(0, 900));
  console.log('命中區 <44  :', report.hit.length === 0 ? 'OK 0 個' : JSON.stringify(report.hit));
  if (report.offline) {
    const o = report.offline;
    console.log('離線        : 線上', JSON.stringify(o.online), '→ 斷網', JSON.stringify(o.offline),
      (o.offline && o.offline.rows > 0) ? 'OK 仍可渲染' : 'FAIL 斷網後無班次');
    if (o.errs.length) console.log('   離線 JS 錯誤:', o.errs);
  }
  console.log('截圖        :', report.shots.length, '張');
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log('報告        :', path.join(OUT, 'report.json'));
  console.log('==========================================\n');

  const fail = bad.length || errTot || misTot || cjkBadTot ||
    (report.hit && report.hit.length) ||
    (report.offline && !(report.offline.offline && report.offline.offline.rows > 0));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
