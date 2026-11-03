/* ==========================================================================
   i18n.js — 水蓮社區巴士 PWA｜中英雙語字典與執行時切換
   --------------------------------------------------------------------------
   用途：社區有外籍住戶，介面需支援繁體中文（zh-TW）與英文（en）。

   設計原則
   1. 字典只放「介面文字」（標題、按鈕、提示、空狀態、錯誤訊息、安裝步驟）。
   2. 專有名詞（站名、路線名）另建 PROPER 對照表，不放進一般字典 —— 因為
      它們會被「中文＋英文併排」方式呈現，而不是二選一。
   3. 所有查表都經過 t(key, vars)，找不到 key 時回傳 key 本身（方便除錯），
      絕不回傳 undefined 讓畫面出現空字串。
   4. 語言選擇存 localStorage（lhbs_lang），首次依 navigator.language 判斷。
   5. 切換語言即時重繪，不需重新整理。

   使用方式
     window.LHBS_I18N.t('tab.schedule')          // → 時刻表 / Schedule
     window.LHBS_I18N.t('days.after', {n: 5})    // → 5 分後 / in 5 min
     window.LHBS_I18N.stopName('水蓮山莊')        // → 水蓮山莊 Lotus Hill
     window.LHBS_I18N.setLang('en')              // 切換並重繪
   ========================================================================== */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'lhbs_lang';
  var DEFAULT_LANG = 'zh-TW';
  var SUPPORTED = ['zh-TW', 'en'];

  /* ======================================================================
     一、介面文字字典
     ====================================================================== */
  var DICT = {
    'zh-TW': {
      /* ---- 站名 / 品牌 ---- */
      'brand.title': '水蓮車班時刻表',
      'brand.en': 'Lotus Hill Bus Schedule',
      'brand.aria': '水蓮社巴時刻表，回到首頁',

      /* ---- 分頁 ---- */
      'tab.schedule': '時刻表',
      'tab.stops': '站點',
      'tab.phone': '電話',
      'tab.about': '關於',
      'tab.navAria': '主要功能',

      /* ---- 語言切換 ---- */
      'lang.toggleAria': '切換語言（中文／English）',
      'lang.zh': '中',
      'lang.en': 'EN',

      /* ---- 主題 / 安裝 ---- */
      'theme.toDark': '切換深色模式',
      'theme.toLight': '切換淺色模式',
      'install.aria': '安裝這個 App 到主畫面',

      /* ---- 公告 / 離線 ---- */
      'alert.title': '公告',
      'alert.close': '關閉公告',
      'alert.typhoon': '今天為颱風日，班次可能異動，請留意社區公告。',
      'offline.note': '目前離線，顯示上次快取內容；時刻表仍可正常使用。',

      /* ---- Hero ---- */
      'hero.loading': '正在讀取時刻表…',
      'hero.next': '下班車',
      'hero.estimated': '預計發車',
      'hero.leaving': '車輛即將離站',
      'hero.noMore': '今天已無後續班次。',
      'hero.noToday': '今日已無班次',
      'hero.dayDirSuffix': '，請參考完整時刻表',
      'hero.announce': '下班車 ',

      /* ---- 篩選控制 ---- */
      'ctrl.aria': '時刻表篩選條件',
      'ctrl.day': '日期',
      'ctrl.dayAria': '日期，二選一',
      'ctrl.dir': '方向',
      'ctrl.dirAria': '方向，二選一',
      'ctrl.route': '路線',
      'ctrl.routeAria': '路線篩選',
      'ctrl.upcomingOnly': '只看接下來班次',
      'ctrl.scrollToNow': '跳到最近班次',
      'ctrl.reset': '重置篩選條件',

      'day.workday': '平日',
      'day.holiday': '假日',
      'dir.to': '去程',
      'dir.from': '回程',
      'route.all': '全部',
      'route.sheba': '社巴',
      'route.r591': '591',
      'route.f913': 'F913',

      /* ---- 時刻表看板 ---- */
      'board.title': '完整時刻表',
      'board.col.hour': '時',
      'board.col.time': '發車',
      'board.col.route': '路線',
      'board.col.dest': '起訖',
      'board.col.rel': '剩餘',
      'board.countSuffix': ' 班',
      'board.countPrefix': '共 ',
      'board.suspended': ' 班停駛',
      'board.allSuspended': '今日班次已全部停駛',
      'board.empty.title': '沒有符合條件的班次',
      'board.empty.desc': '試著切換「假日」、改用其他路線篩選，或關閉「只看接下來」。',
      'board.empty.typhoon': '颱風日班表：接下來已無行駛班次，請留意社區公告或改搭其他運輸工具。',

      /* ---- 相對時間 ---- */
      'rel.departing': '即將發車',
      'rel.departingShort': '即將',
      'rel.departed': '已發車',
      'rel.minAfter': '{n} 分後',
      'rel.minShort': '{n} 分',
      'rel.hourAfter': '{h} 小時',
      'rel.hourSuffix': '後',
      'rel.minSuffix': ' 分',
      'rel.hourShort': '{h}時',

      /* ---- 目的地 / 停駛 ---- */
      'dest.to': '往',
      'dest.suspended': '停駛',

      /* ---- 日型自動判斷提示 ---- */
      'dayhint.overridden': '已手動設為{label}（今天有效）',
      'dayhint.workday': '今天是補班日，已自動切換為平日班表',
      'dayhint.holiday': '今天是{name}，已自動切換為假日班表',
      'dayhint.weekend': '今天是{weekday}，已自動切換為假日班表',
      'dayhint.holidayFallback': '國定假日',
      'dayhint.actionAuto': '恢復自動',
      'dayhint.actionToWorkday': '改回平日',
      'dayhint.actionToHoliday': '改回假日',

      /* ---- 星期 ---- */
      'weekday.0': '週日',
      'weekday.1': '週一',
      'weekday.2': '週二',
      'weekday.3': '週三',
      'weekday.4': '週四',
      'weekday.5': '週五',
      'weekday.6': '週六',

      /* ---- 免責 ---- */
      'disclaimer.title': '【免責聲明】',
      'disclaimer.body': '本網頁之公車與社巴動態資訊係串接「交通部 TDX 運具資料交換平台」之開放資料。因受車機訊號、網路傳輸或官方資料源更新頻率影響，實際到站時間可能與現場略有落差。本網站不對因 API 延遲或中斷所造成的行程延誤承擔責任。',
      'footer.line1': 'Ver. 114.02.04 · Build 2024.11.05 · 介面重構 v4.0.0（Nightline）',
      'footer.line2': 'Copyright © 2024 Steven Chang. All rights reserved.',

      /* ---- 站點頁 ---- */
      'stops.title': '站點資訊',
      'stops.desc': '10 條行駛方向、225 個站位。點站名可開啟 Google Maps 導航。',
      'stops.searchPlaceholder': '搜尋站名或路線，例如：水蓮、東湖、591',
      'stops.searchAria': '搜尋站名或路線',
      'stops.clearAria': '清除搜尋',
      'stops.tdxTitle': '即時到站',
      'stops.refresh': '更新',
      'stops.loading': '載入中',
      'stops.summaryLoading': '正在整理站點資料…',
      'stops.syncPending': '即時資料待載入',
      'stops.anchorsAria': '跳到路線區段',
      'stops.empty.title': '找不到符合的站點',
      'stops.empty.desc': '換個關鍵字試試，例如「水蓮山莊」、「東湖國小」或路線「F913」。',
      'stops.clearSearch': '清除搜尋',
      'stops.stopCount': ' 站',
      'stops.sectionAria': '站點資訊',

      /* ---- TDX 狀態 ---- */
      'tdx.live': '即時',
      'tdx.snapshotNotLive': '快照·非即時',
      'tdx.snapshot': '快照',
      'tdx.unavailable': '無法取得',
      'tdx.approaching': '進站中',
      'tdx.arriving': '進站中',
      'tdx.minShort': '{n} 分',
      'tdx.modeLive': '即時',
      'tdx.modeStale': '快照·非即時',
      'tdx.modeSnapshot': '快照',
      'tdx.modeError': '無法取得',
      'tdx.soon': '即將到站',
      'tdx.updated': 'TDX 更新：',
      'tdx.dataTime': '（資料時間 ',
      'tdx.snapshotNote': '目前為快照、非即時。',
      'tdx.shebaNoEta': '社巴非 TDX 路線，不提供預估時間。',
      'tdx.stopsWithEta': ' 個站位有預估到站時間',
      'tdx.syncing': '正在同步 TDX 資料…',
      'tdx.updatedN': '已更新 ',
      'tdx.updatedStops': ' 個站位 · ',
      'tdx.updatedSnapshot': '已更新（快照資料）',
      'tdx.updatedNoEta': '已更新，目前無預估到站資料',
      'tdx.failed': 'TDX 載入失敗',
      'tdx.failedNote': '即時到站暫時無法取得，時刻表與站點清單仍可正常使用。',
      'tdx.secLater': ' 秒後更新',
      'tdx.updating': '更新中…',
      'tdx.cantGet': '取不到即時資料 · 顯示 ',
      'tdx.snapshotOf': ' 的快照',
      'tdx.lastSnapshot': '上次快照',
      'tdx.retryHint': '，可再按一次重試',
      'tdx.offlineSnapshot': '目前離線，顯示快取內容',
      'tdx.tag.sheba': '社巴',
      'tdx.tag.f913': 'F913',

      /* ---- 電話頁 ---- */
      'phone.title': '社區服務電話',
      'phone.desc': '點號碼即可直撥。同單位的多支號碼已整併於同一張卡片。',
      'phone.searchPlaceholder': '搜尋單位名稱或號碼，例如：服務中心、2690',
      'phone.searchAria': '搜尋單位名稱或電話號碼',
      'phone.empty.title': '找不到符合的單位',
      'phone.empty.desc': '試試「管理中心」、「警衛」或電話前幾碼「2690」。',
      'phone.ext': '分機 ',
      'phone.callAria': '撥打 ',
      'phone.call': '撥號',
      'phone.foundPrefix': '找到 <b>',
      'phone.foundSuffix': '</b> 個單位（共 ',
      'phone.totalPrefix': '共 <b>',
      'phone.totalSuffix': '</b> 個單位 · 點號碼直撥',
      'phone.sectionAria': '社區服務電話',

      /* ---- 輪播 ---- */
      'slider.prev': '上一張',
      'slider.next': '下一張',
      'slider.dotsAria': '安裝步驟圖片',
      'slider.dotLabel': '第 ',
      'slider.dotOf': ' 張，共 ',
      'slider.dotSuffix': ' 張',

      /* ---- 關於頁 ---- */
      'about.title': '關於時刻表',
      'about.desc': '熱心住戶自主維護，內容參考管理委員會公布之社巴時刻表。',
      'about.sectionAria': '關於時刻表',
      'about.sponsorTitle': '請開發者喝杯咖啡',
      'about.sponsorDesc': '這個時刻表是免費維護的。如果它幫到你，歡迎小額贊助，讓它能繼續更新。',
      'about.sponsorShow': '顯示贊助資訊',
      'about.sponsorHide': '收合贊助資訊',
      'about.account': '帳戶：824 連線商業銀行（總行 6880）',
      'about.accountNo': '帳號：111018165754',
      'about.usageTitle': '使用說明',
      'about.usageBody': '班次資訊仍請以社區公告欄或管理中心最新版本為準；如發現資訊有誤，歡迎隨時指正。',
      'about.sourceTitle': '資料來源',
      'about.metaVersion': '時刻表版本',
      'about.metaDepartures': '班次筆數',
      'about.metaSections': '站點區段',
      'about.metaLive': '即時到站',
      'about.metaLiveValue': 'TDX 運輸資料流通服務',
      'about.metaPage': '頁面版本',
      'about.installTitle': '加入手機主畫面',
      'about.installDesc': '加入後可全螢幕開啟，並在離線時檢視時刻表。',
      'about.iosSteps': ['以 Safari 開啟本頁。', '點選底部工具列的「分享」。（若工具列消失，請將頁面稍微上滑）', '在分享選單中選擇「加入主畫面」。', '可自行修改名稱，完成後點選「新增」。'],
      'about.androidSteps': ['以 Chrome 開啟本頁，點選右上角「更多」選單。', '選擇「安裝應用程式」或「加到主畫面」。', '確認後即可在桌面看到捷徑圖示。'],
      'about.imgAlt.ios': 'iPhone 安裝步驟 {n}：{desc}',
      'about.imgAlt.android': 'Android 安裝步驟 {n}：{desc}',
      'about.iosStepTexts': ['以 Safari 開啟時刻表', '點選底部分享按鈕', '選擇加入主畫面', '命名後新增'],
      'about.androidStepTexts': ['以 Chrome 開啟時刻表', '開啟右上角更多選單', '選擇安裝應用程式', '確認安裝', '桌面上出現捷徑', '點選捷徑開啟'],

      /* ---- 搭車提醒 ---- */
      'boarding.title': '搭乘社巴請使用悠遊卡<br>或悠遊付乘車碼',
      'boarding.body': '上車刷卡一次即可，到站可直接下車。',
      'boarding.ok': '我知道了',

      /* ---- 6.6.1 補漏：靜態 HTML 與動態字串 ---- */
      'skip.link': '跳至主要內容',
      'meta.title': '水蓮車班時刻表',
      'meta.desc': '水蓮山莊社區巴士及 591、F913 公車時刻表、站點資訊與即時到站查詢。',
      'brand.aria': '水蓮社巴時刻表，回到首頁',
      'nav.aria': '主要功能',
      'about.iosTitle': 'iPhone / iPad',
      'about.androidTitle': 'Android',
      'about.pageVersionValue': '4.0.0（Nightline）',
      'phone.clearSearch': '清除搜尋',
      'stops.modeLoading': '載入中',
      'stops.sectionCount': ' 站',
      'board.empty.title': '沒有符合條件的班次',
      'hero.badgeFallback': '社巴',

      /* ---- 其他 ---- */
      'misc.stops': ' 站'
    },

    'en': {
      /* ---- 站名 / 品牌 ---- */
      'brand.title': 'Lotus Hill Bus Schedule',
      /* 英文模式的副標題不要放中文。
         原本這裡是「水蓮車班時刻表」，等於英文介面下仍有一行中文，
         看起來就像漏翻。改成英文副標，語意更清楚。 */
      'brand.en': 'Community Shuttle Timetable',
      'brand.aria': 'Lotus Hill community bus schedule — back to home',

      /* ---- 分頁 ---- */
      'tab.schedule': 'Schedule',
      'tab.stops': 'Stops',
      'tab.phone': 'Phone',
      'tab.about': 'About',
      'tab.navAria': 'Main sections',

      /* ---- 語言切換 ---- */
      'lang.toggleAria': 'Switch language (English / 中文)',
      'lang.zh': '中',
      'lang.en': 'EN',

      /* ---- 主題 / 安裝 ---- */
      'theme.toDark': 'Switch to dark mode',
      'theme.toLight': 'Switch to light mode',
      'install.aria': 'Install this app to home screen',

      /* ---- 公告 / 離線 ---- */
      'alert.title': 'Notice',
      'alert.close': 'Close notice',
      'alert.typhoon': 'Typhoon day today — services may change. Please check the community notice board.',
      'offline.note': 'You are offline. Showing the last cached version; the timetable still works.',

      /* ---- Hero ---- */
      'hero.loading': 'Loading timetable…',
      'hero.next': 'Next bus',
      'hero.estimated': 'Estimated departure',
      'hero.leaving': 'Departing now',
      'hero.noMore': 'No more departures today.',
      'hero.noToday': 'No departures today',
      'hero.dayDirSuffix': ' — see the full timetable',
      'hero.announce': 'Next bus ',

      /* ---- 篩選控制 ---- */
      'ctrl.aria': 'Timetable filters',
      'ctrl.day': 'Day',
      'ctrl.dayAria': 'Day type, one of two',
      'ctrl.dir': 'Direction',
      'ctrl.dirAria': 'Direction, one of two',
      'ctrl.route': 'Route',
      'ctrl.routeAria': 'Route filter',
      'ctrl.upcomingOnly': 'Upcoming only',
      'ctrl.scrollToNow': 'Jump to next bus',
      'ctrl.reset': 'Reset filters',

      'day.workday': 'Weekday',
      'day.holiday': 'Weekend/Holiday',
      'dir.to': 'Outbound',
      'dir.from': 'Return',
      'route.all': 'All',
      'route.sheba': 'Shuttle',
      'route.r591': '591',
      'route.f913': 'F913',

      /* ---- 時刻表看板 ---- */
      'board.title': 'Full timetable',
      'board.col.hour': 'Hr',
      'board.col.time': 'Departs',
      'board.col.route': 'Route',
      'board.col.dest': 'From → To',
      'board.col.rel': 'In',
      'board.countSuffix': ' trips',
      'board.countPrefix': 'Total ',
      'board.suspended': ' suspended',
      'board.allSuspended': 'All departures today are suspended',
      'board.empty.title': 'No departures match',
      'board.empty.desc': 'Try switching to “Weekend”, clearing the route filter, or turning off “Upcoming only”.',
      'board.empty.typhoon': 'Typhoon schedule: no further departures today. Check the community notice or use other transport.',

      /* ---- 相對時間 ---- */
      'rel.departing': 'Departing now',
      'rel.departingShort': 'Now',
      'rel.departed': 'Departed',
      'rel.minAfter': 'in {n} min',
      'rel.minShort': '{n} min',
      'rel.hourAfter': '{h} hr',
      'rel.hourSuffix': '',
      'rel.minSuffix': ' min',
      'rel.hourShort': '{h}h',

      /* ---- 目的地 / 停駛 ---- */
      'dest.to': 'to',
      'dest.suspended': 'Suspended',

      /* ---- 日型自動判斷提示 ---- */
      'dayhint.overridden': 'Manually set to {label} (today only)',
      'dayhint.workday': 'Today is a make-up workday — showing the weekday timetable',
      'dayhint.holiday': 'Today is {name} — showing the weekend/holiday timetable',
      'dayhint.weekend': 'Today is {weekday} — showing the weekend/holiday timetable',
      'dayhint.holidayFallback': 'a public holiday',
      'dayhint.actionAuto': 'Back to auto',
      'dayhint.actionToWorkday': 'Use weekday',
      'dayhint.actionToHoliday': 'Use weekend',

      /* ---- 星期 ---- */
      'weekday.0': 'Sunday',
      'weekday.1': 'Monday',
      'weekday.2': 'Tuesday',
      'weekday.3': 'Wednesday',
      'weekday.4': 'Thursday',
      'weekday.5': 'Friday',
      'weekday.6': 'Saturday',

      /* ---- 免責 ---- */
      'disclaimer.title': '[Disclaimer]',
      'disclaimer.body': 'Live bus and shuttle information on this page is sourced from the Ministry of Transportation’s TDX open data platform. Due to onboard signal quality, network transmission, or the update frequency of the official data source, actual arrival times may differ slightly from what is shown here. This site accepts no liability for delays caused by API latency or outages.',
      'footer.line1': 'Ver. 114.02.04 · Build 2024.11.05 · Interface v4.0.0 (Nightline)',
      'footer.line2': 'Copyright © 2024 Steven Chang. All rights reserved.',

      /* ---- 站點頁 ---- */
      'stops.title': 'Stops',
      'stops.desc': '10 route segments, 225 stops. Tap a stop name to open Google Maps navigation.',
      'stops.searchPlaceholder': 'Search a stop or route, e.g. Lotus Hill, Donghu, 591',
      'stops.searchAria': 'Search stop name or route',
      'stops.clearAria': 'Clear search',
      'stops.tdxTitle': 'Live arrivals',
      'stops.refresh': 'Refresh',
      'stops.loading': 'Loading',
      'stops.summaryLoading': 'Preparing stop data…',
      'stops.syncPending': 'Live data pending',
      'stops.anchorsAria': 'Jump to a route segment',
      'stops.empty.title': 'No matching stops',
      'stops.empty.desc': 'Try another keyword, e.g. “Lotus Hill”, “Donghu Elementary” or route “F913”.',
      'stops.clearSearch': 'Clear search',
      'stops.stopCount': ' stops',
      'stops.sectionAria': 'Stop information',

      /* ---- TDX 狀態 ---- */
      'tdx.live': 'Live',
      'tdx.snapshotNotLive': 'Snapshot · not live',
      'tdx.snapshot': 'Snapshot',
      'tdx.unavailable': 'Unavailable',
      'tdx.approaching': 'Arriving',
      'tdx.arriving': 'Arriving',
      'tdx.minShort': '{n} min',
      'tdx.modeLive': 'Live',
      'tdx.modeStale': 'Snapshot · not live',
      'tdx.modeSnapshot': 'Snapshot',
      'tdx.modeError': 'Unavailable',
      'tdx.soon': 'Arriving soon',
      'tdx.updated': 'TDX updated: ',
      'tdx.dataTime': '(data time ',
      'tdx.snapshotNote': 'Currently a snapshot, not live.',
      'tdx.shebaNoEta': 'The community shuttle is not a TDX route, so no ETA is provided.',
      'tdx.stopsWithEta': ' stops have estimated arrival times',
      'tdx.syncing': 'Syncing TDX data…',
      'tdx.updatedN': 'Updated ',
      'tdx.updatedStops': ' stops · ',
      'tdx.updatedSnapshot': 'Updated (snapshot data)',
      'tdx.updatedNoEta': 'Updated, no arrival estimates available',
      'tdx.failed': 'TDX failed to load',
      'tdx.failedNote': 'Live arrivals are temporarily unavailable. The timetable and stop list still work.',
      'tdx.secLater': 's to refresh',
      'tdx.updating': 'Updating…',
      'tdx.cantGet': 'Live data unavailable · showing ',
      'tdx.snapshotOf': ' snapshot',
      'tdx.lastSnapshot': 'last snapshot',
      'tdx.retryHint': ' — tap to retry',
      'tdx.offlineSnapshot': 'Offline — showing cached content',
      'tdx.tag.sheba': 'Shuttle',
      'tdx.tag.f913': 'F913',

      /* ---- 電話頁 ---- */
      'phone.title': 'Community Contacts',
      'phone.desc': 'Tap a number to call directly. Multiple numbers for the same office are grouped on one card.',
      'phone.searchPlaceholder': 'Search an office or number, e.g. Service Centre, 2690',
      'phone.searchAria': 'Search office name or phone number',
      'phone.empty.title': 'No matching offices',
      'phone.empty.desc': 'Try “Management Centre”, “Security”, or the first digits “2690”.',
      'phone.ext': 'ext. ',
      'phone.callAria': 'Call ',
      'phone.call': 'Call',
      'phone.foundPrefix': 'Found <b>',
      'phone.foundSuffix': '</b> offices (of ',
      'phone.totalPrefix': 'Total <b>',
      'phone.totalSuffix': '</b> offices · tap a number to call',
      'phone.sectionAria': 'Community contacts',

      /* ---- 輪播 ---- */
      'slider.prev': 'Previous',
      'slider.next': 'Next',
      'slider.dotsAria': 'Installation step images',
      'slider.dotLabel': 'Image ',
      'slider.dotOf': ' of ',
      'slider.dotSuffix': '',

      /* ---- 關於頁 ---- */
      'about.title': 'About this timetable',
      'about.desc': 'Maintained voluntarily by residents, based on the shuttle timetable published by the management committee.',
      'about.sectionAria': 'About this timetable',
      'about.sponsorTitle': 'Buy the developer a coffee',
      'about.sponsorDesc': 'This timetable is maintained for free. If it helps you, a small donation keeps it updated.',
      'about.sponsorShow': 'Show donation info',
      'about.sponsorHide': 'Hide donation info',
      'about.account': 'Account: 824 Line Bank (HQ 6880)',
      'about.accountNo': 'Account no.: 111018165754',
      'about.usageTitle': 'How to use',
      'about.usageBody': 'Always defer to the latest version on the community notice board or at the management office. Corrections are always welcome.',
      'about.sourceTitle': 'Data sources',
      'about.metaVersion': 'Timetable version',
      'about.metaDepartures': 'Departures',
      'about.metaSections': 'Route segments',
      'about.metaLive': 'Live arrivals',
      'about.metaLiveValue': 'TDX Transport Data Platform',
      'about.metaPage': 'Page version',
      'about.installTitle': 'Add to home screen',
      'about.installDesc': 'Add it for a full-screen experience, and to view the timetable offline.',
      'about.iosSteps': ['Open this page in Safari.', 'Tap “Share” in the bottom toolbar. (If the toolbar is hidden, scroll up slightly.)', 'Choose “Add to Home Screen” in the share sheet.', 'Rename it if you like, then tap “Add”.'],
      'about.androidSteps': ['Open this page in Chrome and tap the “More” menu at the top right.', 'Choose “Install app” or “Add to Home screen”.', 'Confirm — the shortcut icon appears on your home screen.'],
      'about.imgAlt.ios': 'iPhone installation step {n}: {desc}',
      'about.imgAlt.android': 'Android installation step {n}: {desc}',
      'about.iosStepTexts': ['Open the timetable in Safari', 'Tap the Share button', 'Choose Add to Home Screen', 'Rename and add'],
      'about.androidStepTexts': ['Open the timetable in Chrome', 'Open the top-right menu', 'Choose Install app', 'Confirm installation', 'Shortcut on home screen', 'Tap the shortcut to open'],

      /* ---- 搭車提醒 ---- */
      'boarding.title': 'Please use an EasyCard or the<br>EasyWallet boarding code',
      'boarding.body': 'Tap once when boarding; simply get off at your stop.',
      'boarding.ok': 'Got it',

      /* ---- 6.6.1 補漏：靜態 HTML 與動態字串 ---- */
      'skip.link': 'Skip to main content',
      'meta.title': 'Lotus Hill Bus Schedule',
      'meta.desc': 'Lotus Hill community shuttle and bus 591 / F913 timetables, stop information and live arrival times.',
      'brand.aria': 'Lotus Hill shuttle timetable — back to home',
      'nav.aria': 'Main sections',
      'about.iosTitle': 'iPhone / iPad',
      'about.androidTitle': 'Android',
      'about.pageVersionValue': '4.0.0 (Nightline)',
      'phone.clearSearch': 'Clear search',
      'stops.modeLoading': 'Loading',
      'stops.sectionCount': ' stops',
      'board.empty.title': 'No departures match',
      'hero.badgeFallback': 'Shuttle',

      /* ---- 其他 ---- */
      'misc.stops': ' stops'
    }
  };

  /* ======================================================================
     二、專有名詞對照表
     ----------------------------------------------------------------------
     原則：
       · 有官方英文名的（捷運站、火車站、學校、行政區）用官方英文名。
         - 東湖捷運站 → Donghu MRT Station（台北捷運官方站名）
         - 南港火車站 → Nangang Railway Station（台鐵官方站名）
         - 南港軟體園區 → Nangang Software Park（經濟部官方譯名）
         - 汐科站 → Xike Station（台鐵官方站名）
         - 汐止 → Xizhi（新北市官方羅馬拼音）
         - 南港 → Nangang
         - 國泰醫院 → Cathay General Hospital（醫院官方英文名）
         - 東湖國小 → Donghu Elementary School（學校官方譯名）
       · 社區／住宅名稱用既有社區英文名或音譯：
         - 水蓮山莊 → Lotus Hill（社區自用英文名，沿用品牌字樣）
         - 伯爵山莊 → Bojue Villa（音譯）
         - 摩登家庭社區 → Modern Family Community（意譯，社區名稱本身即英文外來詞）
         - 日月光社區 → Riyueguang Community（音譯）
       · 道路名音譯：明峰街 → Mingfeng St.、康寧街 → Kangning St. 等。
       · 無法確認官方英文名者，一律採漢語拼音音譯並在註解標明 —— 不假裝是官方譯名。
     ====================================================================== */
  var PROPER = {
    /* --- 主要端點（班表目的地欄會用到的 6 個 token） --- */
    '水蓮': 'Lotus Hill',
    '水蓮山莊': 'Lotus Hill',
    '東湖捷運站': 'Donghu MRT Station',
    '南港火車站': 'Nangang Railway Station',
    '國泰醫院': 'Cathay General Hospital',
    '汐湖橋口': 'Xihu Bridge',
    '忠三街口': 'Zhong 3rd St.',

    /* --- 行政／地標 --- */
    '南港車站': 'Nangang Station',
    '南港行政中心': 'Nangang Admin. Centre',
    '南港高工': 'Nangang Vocational High School',
    '南港軟體園區北站': 'Nangang Software Park (N.)',
    '南港軟體園區南站': 'Nangang Software Park (S.)',
    '汐止火車站': 'Xizhi Railway Station',
    '汐科站北站': 'Xike Station (N.)',
    '汐科站南站': 'Xike Station (S.)',
    '汐止國中': 'Xizhi Junior High',
    '汐止國小': 'Xizhi Elementary',
    '東湖國中': 'Donghu Junior High',
    '東湖國小': 'Donghu Elementary',
    '崇義高中': 'Chongyi High School',
    '秀峰高中': 'Xiufeng High School',
    '樟樹國小': 'Zhangshu Elementary',
    '樟樹國際實中': 'Zhangshu Intl. Experimental School',
    '金龍國小': 'Jinlong Elementary',
    '金龍市場': 'Jinlong Market',
    '金龍湖': 'Jinlong Lake',
    '金龍里': 'Jinlong Village',
    '北峰里': 'Beifeng Village',
    '北峰寺': 'Beifeng Temple',
    '北山里': 'Beishan Village',
    '忠孝里': 'Zhongxiao Village',
    '厚德里': 'Houde Village',
    '山光社區': 'Shanguang Community',
    '五分社區': 'Wufen Community',
    '民族六街口': 'Minzu 6th St. Intersection',
    '民族六街市場口': 'Minzu 6th St. Market',
    '經貿園區': 'Trade Park',
    '西陵科學園區': 'Xiling Science Park',
    '遠東科技中心': 'Far Eastern Technology Centre',
    '木南煤礦': 'Munan Coal Mine',
    '樟江大橋': 'Zhangjiang Bridge',
    '橋東': 'Qiaodong',
    '湖東街口': 'Hudong St. Intersection',
    '茄苳路口': 'Jiadong Rd. Intersection',
    '樟樹一路口': 'Zhangshu 1st Rd. Intersection',
    '濱湖大第': 'Binhu Dadi',
    '白馬山莊': 'Baima Villa',
    '伯爵山莊': 'Bojue Villa',
    '伯爵山莊一': 'Bojue Villa 1',
    '半島花園': 'Peninsula Garden',
    '摩登家庭社區': 'Modern Family Community',
    '日月光社區': 'Riyueguang Community',
    '日月光社區B區': 'Riyueguang Community Blk. B',
    '日月光社區D區': 'Riyueguang Community Blk. D',
    '昊天嶺': 'Haotianling',
    '福安宮': 'Fu’an Temple',
    '開山宮': 'Kaishan Temple',
    '黃昏市場': 'Evening Market',
    '忠孝里活動中心': 'Zhongxiao Village Activity Centre',

    /* --- 括號補充站位（同上主站名 + 括號說明） --- */
    '五分社區(寶島鐘錶旁)': 'Wufen Community (beside Formosa Watches)',
    '北峰里(中興路)': 'Beifeng Village (Zhongxing Rd.)',
    '北峰里(康寧街)': 'Beifeng Village (Kangning St.)',
    '北峰里(明峰街)': 'Beifeng Village (Mingfeng St.)',
    '南港高工(南港路)': 'Nangang Voc. High (Nangang Rd.)',
    '厚德里(樟樹國小)': 'Houde Village (Zhangshu Elem.)',
    '國泰醫院(建成路)': 'Cathay General Hospital (Jiancheng Rd.)',
    '崇義高中(忠孝東路)': 'Chongyi High School (Zhongxiao E. Rd.)',
    '忠三街口(循環接續點)': 'Zhong 3rd St. (loop transfer)',
    '捷運東湖站(南湖高中)': 'Donghu MRT Stn. (Nanhu High School)',
    '汐湖橋口(循環接續點)': 'Xihu Bridge (loop transfer)',
    '汐止火車站(忠孝東路)': 'Xizhi Railway Stn. (Zhongxiao E. Rd.)',
    '秀峰高中(忠孝東路)': 'Xiufeng High School (Zhongxiao E. Rd.)',
    '東湖國小(東湖路126號前)': 'Donghu Elem. (before No.126 Donghu Rd.)',
    '東湖捷運站(3號出口)': 'Donghu MRT Station (Exit 3)',
    '金龍國小(同591公車站牌)': 'Jinlong Elem. (same as route 591 stop)',
    '金龍國小(康寧街)': 'Jinlong Elem. (Kangning St.)',
    '金龍國小(明峰街)': 'Jinlong Elem. (Mingfeng St.)',
    '金龍里(家樂福)': 'Jinlong Village (Carrefour)',

    /* --- 路線名 --- */
    '社巴': 'Shuttle',
    '社巴平日去程': 'Shuttle · Weekday Outbound',
    '社巴平日回程': 'Shuttle · Weekday Return',
    '社巴假日去程': 'Shuttle · Holiday Outbound',
    '社巴假日回程': 'Shuttle · Holiday Return',
    '591公車平、假日去程': 'Bus 591 · Outbound',
    '591公車平、假日回程': 'Bus 591 · Return',
    '591 公車去程': 'Bus 591 · Outbound',
    '591 去程': '591 Outbound',
    '591 公車回程': 'Bus 591 · Return',
    '591 回程': '591 Return',
    'F913去程': 'F913 Outbound',
    'F913 去程': 'F913 Outbound',
    'F913回程': 'F913 Return',
    'F913 回程': 'F913 Return',
    'F913延（忠三街口）去程': 'F913 Ext. · Outbound',
    'F913延 去程': 'F913 Ext. · Outbound',
    'F913延（忠三街口）回程': 'F913 Ext. · Return',
    'F913延 回程': 'F913 Ext. · Return',
    /* 班表資料裡的路線欄位就是「F913延」三個字（沒有去/回程後綴），
       上面四筆是區段標題用的。少了這一筆，英文模式的班次列會直接顯示「F913延」。 */
    'F913延': 'F913 Ext.',
    'F913社后線公車平日及假日去程': 'F913 Shehou Line · Outbound',
    'F913社后線公車平日及假日回程': 'F913 Shehou Line · Return',
    'F913社后線延(忠三街口)公車平日及假日去程': 'F913 Shehou Ext. (Zhong 3rd St.) · Outbound',
    'F913社后線延(忠三街口)公車平日及假日回程': 'F913 Shehou Ext. (Zhong 3rd St.) · Return'
  };

  /* 區段說明（data.js 的 section.note） */
  var NOTES = {
    '走汐湖二橋不經東湖': 'Via Xihu 2nd Bridge, skipping Donghu',
    '經東湖，康寧路轉明峰街': 'Via Donghu; Kangning Rd. → Mingfeng St.',
    '至水蓮約23分，不含塞車及停靠站時間': '~23 min to Lotus Hill, excluding traffic and dwell time',
    '循環接續站點折返': 'Loops back at the transfer stop',
    '國泰醫院至水蓮約20分，不含塞車及停靠站時間': '~20 min from Cathay Hospital to Lotus Hill, excluding traffic and dwell time'
  };
  /* 區段標題的另一批變體（data.js 的 section.short / section.label 與 title 不完全相同，
     逐一補上以免英文模式漏字）。這幾筆是「區段名稱」而非站名。 */
  var SECTION_EXTRA = {
    '591 公車去程': 'Bus 591 · Outbound',
    '591 去程': '591 Outbound',
    '591 公車回程': 'Bus 591 · Return',
    '591 回程': '591 Return',
    'F913去程': 'F913 Outbound',
    'F913 去程': 'F913 Outbound',
    'F913回程': 'F913 Return',
    'F913 回程': 'F913 Return',
    'F913延（忠三街口）去程': 'F913 Ext. · Outbound',
    'F913延 去程': 'F913 Ext. · Outbound',
    'F913延（忠三街口）回程': 'F913 Ext. · Return',
    'F913延 回程': 'F913 Ext. · Return'
  };
  Object.keys(SECTION_EXTRA).forEach(function (k) {
    if (!PROPER[k]) PROPER[k] = SECTION_EXTRA[k];
  });

  /* 電話頁的單位名稱（data.js 的 phoneGroups[].unit）。
     這些是「商家／櫃檯名稱」而非站名，但同樣是專有名詞，走同一張對照表。
     原則：連鎖品牌用官方英文名（全家便利商店 → FamilyMart），
     社區自營單位用意譯（服務中心 → Service Center），
     個人姓名用漢語拼音（董文燕 → Dong Wenyan）。 */
  var PHONE_UNITS = {
    '城事不動產': 'City Realty',
    '城事 - 董文燕': 'City Realty — Dong Wenyan',
    '城事 - 虞明思': 'City Realty — Yu Mingsi',
    '服務中心': 'Service Center',
    '中控大門警衛': 'Main Gate Security',
    '生活館': 'Life Center',
    '樂活天地': 'Lohas Club',
    '郵局代辦所': 'Post Office Counter',
    '康大幼兒園': 'Kangda Kindergarten',
    '全家便利商店': 'FamilyMart',
    '自助洗衣': 'Self-service Laundry',
    '臻妮髮藝': 'Zhenni Hair Salon',
    '樂．美甲': 'Le Nail Studio',
    '服飾店-吳小姐': 'Clothing Store — Ms. Wu',
    '樂廚': 'Le Kitchen',
    '小廚房': 'Little Kitchen',
    '東豐科技': 'Dongfeng Technology',
    '磐石之家': 'Rock House',
    'Pizza的家': "Pizza's Home",
    '健身工作室': 'Fitness Studio',
    '力揚機械車位': 'Liyang Mechanical Parking'
  };
  Object.keys(PHONE_UNITS).forEach(function (k) {
    if (!PROPER[k]) PROPER[k] = PHONE_UNITS[k];
  });

  /* 電話備註（data.js 的 phoneGroups[].note） */
  var PHONE_NOTES = {
    '水電修繕': 'Plumbing & electrical repairs'
  };
  Object.keys(PHONE_NOTES).forEach(function (k) {
    if (!NOTES[k]) NOTES[k] = PHONE_NOTES[k];
  });

  /* ======================================================================
     三、執行時狀態與查表
     ====================================================================== */
  var current = DEFAULT_LANG;

  function normalize(lang) {
    if (!lang) return null;
    var l = String(lang).toLowerCase();
    if (l.indexOf('zh') === 0) return 'zh-TW';
    if (l.indexOf('en') === 0) return 'en';
    return null;
  }

  /* 首次：localStorage → navigator.language → 繁中 */
  function detect() {
    var saved = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    var n = normalize(saved);
    if (n) return n;
    /* navigator.languages 優先（使用者排序過的偏好），再退回 navigator.language */
    var list = [];
    try {
      if (navigator.languages && navigator.languages.length) list = navigator.languages;
      else if (navigator.language) list = [navigator.language];
    } catch (e) {}
    for (var i = 0; i < list.length; i++) {
      var m = normalize(list[i]);
      if (m) return m;
    }
    return DEFAULT_LANG;
  }

  /* 取代 {name} 這種佔位符 */
  function interpolate(str, vars) {
    if (!vars) return str;
    return String(str).replace(/\{(\w+)\}/g, function (whole, key) {
      return Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : whole;
    });
  }

  function t(key, vars) {
    var pack = DICT[current] || DICT[DEFAULT_LANG];
    var v = pack[key];
    if (v === undefined) v = (DICT[DEFAULT_LANG] || {})[key];
    if (v === undefined) {
      /* 找不到就回傳 key 本身 —— 比回傳空字串好除錯 */
      try { console.warn('[i18n] missing key: ' + key); } catch (e) {}
      return key;
    }
    if (Array.isArray(v)) return v;
    return interpolate(v, vars);
  }

  /* 專有名詞：英文模式下顯示「中文 English」；中文模式只顯示中文。
     ---- 為什麼要併排而不是純英文 ----
     住戶看的是站牌上的中文字。若英文模式只給譯名，外籍住戶到了現場
     反而對不上中文站牌；併排讓兩種人（以及幫外籍住戶指路的中文住戶）
     都能一眼對照。代價是字串變長，所以行動版必須允許換行。 */
  function proper(zh) {
    var en = PROPER[zh];
    if (!en) {
      /* 沒有對照的站名不硬翻 —— 直接原樣顯示，避免出現亂譯 */
      return zh;
    }
    if (current === 'en') return zh + ' ' + en;
    return zh;
  }

  /* 只取英文部分（給空間很窄的地方用，例如終站標籤） */
  function properEn(zh) {
    return PROPER[zh] || zh;
  }

  /* 區段說明：英文模式優先英文，中文模式中文 */
  function note(zh) {
    if (current !== 'en') return zh;
    return NOTES[zh] || zh;
  }

  /* 路線名：英文模式用英文全名；中文模式中文 */
  function routeLabel(zh) {
    if (current !== 'en') return zh;
    return PROPER[zh] || zh;
  }

  function weekdayName(idx) {
    return t('weekday.' + idx);
  }

  /* 更新 <html lang>；英文模式用 en，中文模式用 zh-Hant-TW */
  function applyHtmlLang() {
    try {
      document.documentElement.setAttribute('lang', current === 'en' ? 'en' : 'zh-Hant-TW');
    } catch (e) {}
  }

  /* 語言切換：寫入 localStorage → 更新 <html lang> → 觸發重繪事件 */
  function setLang(lang, opts) {
    var n = normalize(lang) || DEFAULT_LANG;
    if (SUPPORTED.indexOf(n) === -1) n = DEFAULT_LANG;
    var changed = (n !== current);
    current = n;
    try { localStorage.setItem(STORAGE_KEY, n); } catch (e) {}
    applyHtmlLang();
    if (changed || (opts && opts.force)) {
      try {
        document.dispatchEvent(new CustomEvent('lhbs:langchange', { detail: { lang: n } }));
      } catch (e) {
        /* 舊瀏覽器沒有 CustomEvent 建構子 */
        try {
          var ev = document.createEvent('Event');
          ev.initEvent('lhbs:langchange', true, true);
          ev.detail = { lang: n };
          document.dispatchEvent(ev);
        } catch (e2) {}
      }
    }
    return n;
  }

  function toggle() { return setLang(current === 'en' ? 'zh-TW' : 'en'); }
  function getLang() { return current; }
  function isEn() { return current === 'en'; }

  /* 給 HTML 用的雙語標籤：中文模式中文、英文模式英文 */
  function label(zh, en) { return current === 'en' ? en : zh; }

  /* ----------------------------------------------------------------------
     初始化：必須在 core.js 之前執行（index.html 的載入順序已確保）
     ---------------------------------------------------------------------- */
  current = detect();
  applyHtmlLang();

  global.LHBS_I18N = {
    t: t,
    proper: proper,
    properEn: properEn,
    note: note,
    routeLabel: routeLabel,
    weekdayName: weekdayName,
    setLang: setLang,
    toggle: toggle,
    getLang: getLang,
    isEn: isEn,
    label: label,
    detect: detect,
    supported: SUPPORTED.slice(),
    dict: DICT,
    properTable: PROPER
  };
})(window);
