/*
 * cjk-scan.js — 找出畫面上所有「仍含中文字元」的可見文字與屬性。
 * 用法（在瀏覽器端 eval，或 node + playwright 注入）：
 *   await page.evaluate(window.__cjkScan)
 * 回傳陣列，每筆 { kind, sel, text, block, cjk }
 */
(function () {
  var CJK = /[\u4e00-\u9fff\u3400-\u4dbf]/;
  var WANT = ['aria-label', 'title', 'alt', 'placeholder', 'aria-description', 'aria-valuetext', 'data-label'];

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    return true;
  }

  function selPath(el) {
    var parts = [];
    var n = el;
    var guard = 0;
    while (n && n.nodeType === 1 && guard++ < 8) {
      var s = n.tagName.toLowerCase();
      if (n.id) { parts.unshift(s + '#' + n.id); break; }
      var cls = (n.className && typeof n.className === 'string') ? n.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
      if (cls) s += '.' + cls;
      // index among siblings of same tag
      var p = n.parentNode, idx = 1;
      if (p) {
        var sibs = p.children;
        for (var i = 0; i < sibs.length; i++) {
          if (sibs[i] === n) break;
          if (sibs[i].tagName === n.tagName) idx++;
        }
        if (idx > 1) s += ':nth-of-type(' + idx + ')';
      }
      parts.unshift(s);
      n = n.parentNode;
    }
    return parts.join(' > ');
  }

  function blockOf(el) {
    var n = el, guard = 0;
    while (n && n.nodeType === 1 && guard++ < 12) {
      if (n.id) return '#' + n.id;
      var cls = (n.className && typeof n.className === 'string') ? n.className : '';
      if (/panel|hero|card|section|mast|board|tab|modal/.test(cls)) return '.' + cls.trim().split(/\s+/).join('.');
      n = n.parentNode;
    }
    return '(body)';
  }

  function scan() {
    var out = [];
    var seen = new Set();

    // 1) text nodes
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    var tn;
    while ((tn = walker.nextNode())) {
      var txt = tn.nodeValue;
      if (!txt || !CJK.test(txt)) continue;
      var t = txt.replace(/\s+/g, ' ').trim();
      if (!t) continue;
      var el = tn.parentElement;
      if (!el || !isVisible(el)) continue;
      if (el.closest('.cjk-allow')) continue; // 刻意保留的專有名詞區
      var key = 'T|' + selPath(el) + '|' + t;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind: 'text', sel: selPath(el), text: t, block: blockOf(el) });
    }

    // 2) attributes
    var all = document.body.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var e = all[i];
      if (!isVisible(e)) continue;
      if (e.closest && e.closest('.cjk-allow')) continue;
      for (var w = 0; w < WANT.length; w++) {
        var v = e.getAttribute(WANT[w]);
        if (v && CJK.test(v)) {
          var k2 = 'A|' + selPath(e) + '|' + WANT[w] + '|' + v;
          if (seen.has(k2)) continue;
          seen.add(k2);
          out.push({ kind: WANT[w], sel: selPath(e), text: v.slice(0, 120), block: blockOf(e) });
        }
      }
    }

    // 3) <title> 與 <option> 文字
    if (document.title && CJK.test(document.title)) {
      out.push({ kind: 'document.title', sel: 'title', text: document.title, block: '(head)' });
    }
    return out;
  }

  window.__cjkScan = scan;
  return scan();
})();
