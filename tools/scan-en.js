// scan-en.js — 在真實 Chromium 掃描各語言模式下的中文殘留
const puppeteer = require('/workspace/node_modules/puppeteer-core');
const fs = require('fs');

const EXEC = '/root/.agent-browser/browsers/chrome-151.0.7922.138/chrome';
const SCAN = fs.readFileSync('/workspace/documents/lhbs_pwa_v5/tools/cjk-scan.js', 'utf8');

const SHOTS = process.argv[2] || ''; // 例如 "before" → 存 before-*.png

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EXEC,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none', '--hide-scrollbars'],
  });
  const results = {};

  for (const [name, vp, lang, mobile] of [
    ['en-desktop', { width: 1280, height: 900 }, 'en-US', false],
    ['en-mobile', { width: 390, height: 844 }, 'en-US', true],
    ['zh-desktop', { width: 1280, height: 900 }, 'zh-TW', false],
    ['zh-mobile', { width: 390, height: 844 }, 'zh-TW', true],
  ]) {
    const page = await browser.newPage();
    await page.setViewport({ ...vp, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile });
    await page.setUserAgent(mobile
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36');

    const errs = [];
    page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
    page.on('pageerror', e => errs.push('pageerror: ' + e.message));

    // 先設語言（在頁面載入前）
    await page.evaluateOnNewDocument((l) => {
      try { localStorage.setItem('lhbs_lang', l); } catch (e) {}
    }, name.startsWith('en') ? 'en' : 'zh-TW');

    await page.goto('http://127.0.0.1:8899/index.html?v=scan', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 1200));

    // 找出所有分頁按鈕
    const tabs = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('[data-tab]'));
      return [...new Set(els.map(e => e.getAttribute('data-tab')))];
    });

    const all = [];
    const perTab = {};
    for (const tab of tabs) {
      const ok = await page.evaluate((t) => {
        const btn = document.querySelector(`[data-tab="${t}"]`);
        if (!btn) return false;
        btn.click();
        return true;
      }, tab);
      if (!ok) continue;
      await new Promise(r => setTimeout(r, 650));
      const found = await page.evaluate(SCAN);
      perTab[tab] = found.length;
      found.forEach(f => all.push({ ...f, tab }));
    }

    // 回第一頁
    if (tabs[0]) {
      await page.evaluate((t) => { const b = document.querySelector(`[data-tab="${t}"]`); if (b) b.click(); }, tabs[0]);
      await new Promise(r => setTimeout(r, 500));
    }

    const info = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
      lang: document.documentElement.lang,
      ver: (document.querySelector('meta[name="app-version"]') || {}).content,
    }));

    if (SHOTS) {
      const dir = '/workspace/documents/lhbs_pwa_v5_shots';
      fs.mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: `${dir}/${SHOTS}-${name}.png`, fullPage: false });
    }

    results[name] = { perTab, total: all.length, items: all, errs, ...info };
    await page.close();
  }

  await browser.close();
  const out = `/workspace/documents/lhbs_pwa_v5/tools/${SHOTS ? SHOTS + '-' : ''}scan.json`;
  fs.writeFileSync(out, JSON.stringify(results, null, 2));

  for (const k of Object.keys(results)) {
    const r = results[k];
    console.log(`\n=== ${k} | lang=${r.lang} ver=${r.ver} | 中文殘留=${r.total} | overflow ${r.sw}/${r.cw} | err=${r.errs.length}`);
    console.log('   perTab:', JSON.stringify(r.perTab));
    r.items.forEach(i => console.log(`   [${i.tab}] (${i.kind}) ${i.block}\n        ${i.text.replace(/\n/g, ' ⏎ ').slice(0, 110)}`));
    if (r.errs.length) r.errs.forEach(e => console.log('   !! ' + e));
  }
  console.log('\nWROTE ' + out);
})();
