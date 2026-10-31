#!/usr/bin/env node
/* ==========================================================================
   update-holidays.js — 產生 js/holidays.js（節日與補班日清單）
   --------------------------------------------------------------------------
   用法：
     node scripts/update-holidays.js 2027          # 嘗試自動抓取
     node scripts/update-holidays.js 2027 --template  # 只輸出空白範本，自己填

   --------------------------------------------------------------------------
   ⚠️ 誠實說明：這支腳本「不是」全自動
   --------------------------------------------------------------------------
   我實際測試過，政府資料源無法穩定自動抓取，原因有三：

   1. 人事行政總處（dgpa.gov.tw）公布的行事曆是「新聞稿 + PDF/ODS 附表」，
      沒有穩定的 JSON API。附表下載連結每次公告都會換檔名。
   2. 政府資料開放平臺（data.gov.tw）雖有「政府行政機關辦公日曆表」資料集，
      但它是 CSV/XML 打包下載，欄位名稱與編碼在不同年度會變動，且沒有
      CORS 標頭 —— 在 Node 端可以抓，但格式一變就整支壞掉。
   3. 最關鍵的是：**放假規則本身會改**。2025 年修法後取消彈性放假與補班，
      2026 年起 workdays 變成空陣列。任何「照去年規則推算」的自動化都會錯。

   所以這支腳本採「半自動」：
     - 先嘗試抓 data.gov.tw 的資料集（若成功，解析後輸出）
     - 抓不到 / 格式不符 / 解析失敗 → 明確報錯，並輸出一份「已填好週末與
       常見國定假日骨架」的範本檔，讓你只補日期，不用從零開始
     - 絕不憑印象編造日期。寧可留 TODO 註解，也不要寫錯讓住戶搭錯車。

   輸出後請務必人工核對一次，再執行 ./scripts/bump-version.sh 升版。
   ========================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'js', 'holidays.js');

const args = process.argv.slice(2);
const year = parseInt(args.find(a => /^\d{4}$/.test(a)), 10);
const templateOnly = args.includes('--template');

if (!year || year < 2020 || year > 2100) {
  console.error('✗ 請指定年份，例如：node scripts/update-holidays.js 2027');
  process.exit(1);
}

/* --------------------------------------------------------------------------
   農曆節日對照（僅供範本提示，不是自動計算）
   農曆轉國曆需要完整萬年曆，這裡刻意不實作 —— 寫死會錯。
   -------------------------------------------------------------------------- */
const LUNAR_HINTS = [
  '除夕（農曆 12/30 或 12/29）',
  '春節（農曆 1/1 ~ 1/3）',
  '元宵節（農曆 1/15，非國定假日）',
  '端午節（農曆 5/5）',
  '中秋節（農曆 8/15）'
];

/* 固定國曆日期的國定假日（日期固定，但遇週末要補假，補哪天要查公告） */
const FIXED = [
  { md: '01-01', name: '元旦' },
  { md: '02-28', name: '和平紀念日' },
  { md: '04-04', name: '兒童節' },
  { md: '04-05', name: '清明節' },
  { md: '05-01', name: '勞動節' },
  { md: '09-28', name: '教師節' },
  { md: '10-10', name: '國慶日' },
  { md: '10-25', name: '光復節' },
  { md: '12-25', name: '行憲紀念日' }
];

function weekdayOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay(); // 0=Sun
}
const WD = ['日', '一', '二', '三', '四', '五', '六'];

/* --------------------------------------------------------------------------
   嘗試從政府資料開放平臺抓取
   -------------------------------------------------------------------------- */
async function tryFetchGov() {
  /* 資料集頁面（僅供參考，實際下載連結會變）：
     https://data.gov.tw/dataset/6179  「政府行政機關辦公日曆表」 */
  const candidates = [
    `https://data.gov.tw/api/v2/rest/dataset/6179`,
    `https://opendata.cwb.gov.tw/` // 佔位，不會用到
  ];
  for (const url of candidates) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const text = await res.text();
      /* 只確認「有沒有這個資料集」，不嘗試解析 —— 解析格式每年度不同，
         硬解會產生錯誤日期，比不抓更危險。 */
      if (text.includes('辦公日曆') || text.includes('6179')) {
        return { reachable: true, url };
      }
    } catch (e) {
      /* 忽略，繼續試下一個 */
    }
  }
  return { reachable: false };
}

/* --------------------------------------------------------------------------
   產生範本：把該年度「確定是週末」的日期算好，固定假日列出並標註需補假確認
   -------------------------------------------------------------------------- */
function buildTemplate(y) {
  const lines = [];
  lines.push('  holidays: [');
  lines.push('    /* ⚠️ 以下是骨架，請對照人事行政總處公告逐筆確認後再使用。');
  lines.push('       標 TODO 的表示「日期需人工確認」（農曆節日、補假日期）。 */');

  /* 固定國曆假日：只列「落在週間」的，週末由週末規則處理 */
  FIXED.forEach(f => {
    const iso = `${y}-${f.md}`;
    const wd = weekdayOf(iso);
    if (wd === 0 || wd === 6) {
      lines.push(`    /* ${iso}（週${WD[wd]}）${f.name} —— 逢例假日，補假日期請查公告 */`);
    } else {
      lines.push(`    { date: '${iso}', name: '${f.name}' },`);
    }
  });

  lines.push('');
  lines.push('    /* TODO 農曆節日：請填入該年度實際國曆日期（含補假） */');
  LUNAR_HINTS.forEach(h => {
    lines.push(`    /* { date: '${y}-MM-DD', name: '${h.split('（')[0]}' }, */`);
  });
  lines.push('  ],');
  lines.push('');
  lines.push('  /* 補班日：若該年度有彈性放假與補行上班，把日期填進來。');
  lines.push('     2025 年修法後已取消此制度，2026 年起通常為空陣列。 */');
  lines.push('  workdays: [');
  lines.push(`    /* { date: '${y}-MM-DD', name: '補班' }, */`);
  lines.push('  ]');
  return lines.join('\n');
}

function writeFile(y, body, note) {
  const content = `/* ==========================================================================
   holidays.js — 水蓮社區巴士 PWA｜節日與補班日清單
   --------------------------------------------------------------------------
   ⚠️ 本檔由 scripts/update-holidays.js 產生（${new Date().toISOString().slice(0, 10)}）
   ${note}
   --------------------------------------------------------------------------
   判斷順序（不可顛倒）：
     1. 使用者今天手動選過 → 用他的選擇
     2. workdays（補班日）→ 平日   ← 必須先於節日與週末
     3. holidays（國定假日）→ 假日
     4. 週六、週日 → 假日
     5. 其餘 → 平日
   ========================================================================== */

window.LHBS_CALENDAR = {
  years: [${y}],

${body}
};
`;
  fs.writeFileSync(OUT, content, 'utf8');
  console.log('✓ 已寫入 ' + path.relative(ROOT, OUT));
}

(async function main() {
  console.log(`── 產生 ${year} 年節日清單 ──`);

  if (templateOnly) {
    writeFile(year, buildTemplate(year), '※ 這是空白範本，所有日期都需人工填寫。');
    console.log('');
    console.log('下一步：打開 js/holidays.js，把 TODO 的部分填完。');
    console.log('資料來源：https://www.dgpa.gov.tw/information?pid=12574&uid=83');
    return;
  }

  const gov = await tryFetchGov();
  if (!gov.reachable) {
    console.error('');
    console.error('✗ 無法從政府開放資料取得 ' + year + ' 年行事曆。');
    console.error('');
    console.error('  原因：人事行政總處沒有穩定的 JSON API，公布形式是新聞稿 +');
    console.error('        PDF/ODS 附表，下載連結每年度更換；data.gov.tw 的資料集');
    console.error('        欄位格式也會變動，硬解會產生錯誤日期。');
    console.error('');
    console.error('  已改為輸出「半自動範本」—— 週末與固定國曆假日已算好，');
    console.error('  你只需補農曆節日與補假日期。');
    console.error('');
    writeFile(year, buildTemplate(year), '※ 自動抓取失敗，這是半自動範本，請人工補完 TODO。');
    console.error('');
    console.error('  請對照官方公告手動確認：');
    console.error('  https://www.dgpa.gov.tw/information?pid=12574&uid=83');
    console.error('');
    console.error('  填完後執行：./scripts/bump-version.sh <新版本>');
    process.exitCode = 2;
    return;
  }

  /* 即使資料集頁面可達，也不自動解析 —— 見檔頭說明第 2、3 點。
     這裡輸出範本並提示人工核對，避免產生錯誤日期。 */
  console.log('· 找到政府資料集頁面：' + gov.url);
  console.log('· 但該資料集為 CSV/XML 打包下載，欄位格式逐年變動，');
  console.log('  且放假規則本身會改（2025 修法取消補班），因此不自動解析。');
  console.log('· 輸出半自動範本供人工核對。');
  writeFile(year, buildTemplate(year), '※ 政府資料集可達，但格式不穩定，輸出半自動範本供人工核對。');
  console.log('');
  console.log('請對照官方公告確認後再使用：');
  console.log('https://www.dgpa.gov.tw/information?pid=12574&uid=83');
})();
