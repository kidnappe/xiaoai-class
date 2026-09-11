// ==/CHENGFANG EXTRACTOR==
// 由「小爱课表导入器 · 乘方教务版」内置提供（脚本版本 1.4.1）
// 兼容：油猴脚本 / Bookmarklet 直接 <script> 注入到乘方教务页面
// 用途：登录后，在任意教务页面点击右下角「📚 提取课表」按钮 → 提取整学期课表 JSON 并复制到剪贴板
// 节次时间表：从课程行自带的 qssj/jssj（连堂块）直接推导单节时间（45 分钟一课 + 10 分钟课间）；
//             businessHours 是 FullCalendar 拖拽网格背景块，不是课时表，已弃用。

(function () {
  'use strict';

  var courses = [];
  var maxPageSection = 0;

  function cleanText(text) {
    return (text || '')
      .replace(/&nbsp;/g, '')
      .replace(/ /g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // "1-16(周)" / "1-16(周)单" / "1,3,5(周)" → "1-16周(单)" / "1,3,5周"
  function normalizeWeeks(weekText) {
    weekText = cleanText(weekText);
    if (!weekText) return '';
    var m = weekText.match(/[\d]+(?:\s*[-—~,，]\s*\d+)*/);
    var base = m ? m[0] : weekText;
    base = base.replace(/\s+/g, '')
      .replace(/[—–]/g, '-')
      .replace(/[，~]/g, ',')
      .replace(/,+$/, '')
      .replace(/周+$/, '');
    var suffix = '';
    if (/单/.test(weekText)) suffix = '(单)';
    else if (/双/.test(weekText)) suffix = '(双)';
    return base + '周' + suffix;
  }

  // 解析节次代码："09,10" / "9-10" / "0910" / 数组 [9,10] → [9,10]
  function parseJcdm(jcdm) {
    if (jcdm === null || jcdm === undefined) return [];
    if (Array.isArray(jcdm)) {
      return jcdm
        .map(function (x) { return parseInt(x, 10); })
        .filter(function (n) { return !isNaN(n) && n > 0; })
        .sort(function (a, b) { return a - b; });
    }
    var s = String(jcdm).trim();
    if (!s) return [];
    // 4 位连写（如 "0910" 表示 9-10 节）
    if (/^\d{4}$/.test(s)) {
      var a1 = parseInt(s.slice(0, 2), 10), a2 = parseInt(s.slice(2), 10);
      if (a1 > 0 && a2 >= a1) return range(a1, a2);
    }
    var nums = [];
    var re = /(\d+)\s*[-~至]\s*(\d+)|(\d+)/g;
    var m;
    while ((m = re.exec(s)) !== null) {
      if (m[3]) nums.push(parseInt(m[3], 10));
      else {
        var a = parseInt(m[1], 10), b = parseInt(m[2], 10);
        nums = nums.concat(range(a, b));
      }
    }
    return nums.filter(function (n) { return n > 0; }).sort(function (x, y) { return x - y; });
  }

  function range(a, b) {
    var r = [];
    for (var i = a; i <= b; i++) r.push(i);
    return r;
  }

  // 'HH:MM' ± 分钟 → 'HH:MM'（越界/非法返回 ''）
  function addHM(hm, delta) {
    var m = String(hm || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return '';
    var t = parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + delta;
    if (t < 0 || t > 23 * 60 + 59) return '';
    var hh = Math.floor(t / 60), mm = t % 60;
    return (hh < 10 ? '0' + hh : '' + hh) + ':' + (mm < 10 ? '0' + mm : '' + mm);
  }

  // 由课程行真实起止时间构建节次表（timeStart[节]=该节最早 qssj、timeEnd[节]=该节最晚 jssj）：
  // ① 已观测锚点（连堂块首节 start、末节 end）原样保留；
  // ② 只有单侧锚点的节按「45 分钟一课」补另一侧；
  // ③ 完全无锚点的节回退 DEFAULT_SECTIONS（绝不跨午休等大间隙外推）。
  // 注意：绝不使用 businessHours（拖拽网格背景块，非课时表）。
  function buildSectionsFromTimes(timeStart, timeEnd, maxSec) {
    if (!maxSec || maxSec < 1) return [];
    var out = [];
    for (var i = 1; i <= maxSec; i++) {
      var def = DEFAULT_SECTIONS[i - 1] || {};
      var s = timeStart[i] || '';
      var e = timeEnd[i] || '';
      if (s && !e) e = addHM(s, 45);
      else if (!s && e) s = addHM(e, -45);
      if (!s) s = def.s || '';
      if (!e) e = def.e || '';
      out.push({ i: i, s: s, e: e });
    }
    return out;
  }

  // 默认节次时间表（13 节，多数乘方教务学校通用，导入器页面可再改）
  var DEFAULT_SECTIONS = [
    { i: 1, s: "08:30", e: "09:10" },
    { i: 2, s: "09:20", e: "10:00" },
    { i: 3, s: "10:25", e: "11:05" },
    { i: 4, s: "11:15", e: "11:55" },
    { i: 5, s: "12:00", e: "12:40" },
    { i: 6, s: "12:50", e: "13:30" },
    { i: 7, s: "14:30", e: "15:10" },
    { i: 8, s: "15:20", e: "16:00" },
    { i: 9, s: "16:25", e: "17:05" },
    { i: 10, s: "17:15", e: "17:55" },
    { i: 11, s: "19:00", e: "19:40" },
    { i: 12, s: "19:50", e: "20:30" },
    { i: 13, s: "20:40", e: "21:20" }
  ];

  function buildSchedule(list) {
    var maxWeek = 0;
    var maxSec = maxPageSection || 0;
    list.forEach(function (c) {
      var wm = String(c.weeks || '').match(/\d+/g);
      if (wm) wm.forEach(function (x) { var n = parseInt(x, 10); if (n > maxWeek) maxWeek = n; });
      var sm = String(c.sections || '').match(/\d+/g);
      if (sm) sm.forEach(function (x) { var n = parseInt(x, 10); if (n > maxSec) maxSec = n; });
    });
    var morn, aft, night;
    if (maxSec <= 0) { morn = null; aft = null; night = null; }
    else if (maxSec <= 4) { morn = maxSec; aft = 0; night = 0; }
    else if (maxSec <= 8) { morn = 4; aft = maxSec - 4; night = 0; }
    else if (maxSec <= 12) { morn = 4; aft = 4; night = maxSec - 8; }
    else { morn = 6; aft = 4; night = maxSec - 10; }
    return {
      totalWeek: maxWeek || null,
      morningNum: morn, afternoonNum: aft, nightNum: night,
      sections: DEFAULT_SECTIONS.slice(0, Math.max(maxSec, 1))
    };
  }

  // ---- 学期代码与当前周推算 ----
  function termStart(term) {
    // term 形如 202601：学年 2026 第 1 学期（秋季，9 月初开学）
    var y = parseInt(term.slice(0, 4), 10);
    var sem = term.slice(4);
    if (sem === '01') {
      var d = new Date(y, 8, 1); // 9月1日
      var dow = d.getDay() || 7;
      return new Date(y, 8, 1 - (dow - 1)); // 包含 9/1 那周的周一
    }
    var d2 = new Date(y + 1, 2, 1); // 3月1日
    var dow2 = d2.getDay() || 7;
    return new Date(y + 1, 2, 1 - (dow2 - 1));
  }

  function guessTerm() {
    var now = new Date();
    var y = now.getFullYear(), mo = now.getMonth() + 1;
    if (mo >= 8) return y + '01';
    return (y - 1) + '02';
  }

  function getTermAndWeek() {
    // 0) 用户右键「手动钉死」的学期（独立键，最高优先级）
    try {
      var pin = localStorage.getItem('cfjw_term_manual');
      if (pin && /^\d{4,12}$/.test(pin)) return { term: pin, week: 1, fromOverride: true };
    } catch (e) { }
    // 1) 当前页面 URL 参数（实时：切换学期后优先反映页面上正在看的）
    try {
      var u = new URL(location.href);
      var t = u.searchParams.get('xnxqdm');
      var w = parseInt(u.searchParams.get('zc'), 10);
      if (t && /^\d{4,12}$/.test(t)) return { term: t, week: isNaN(w) ? 1 : w };
    } catch (e) { }
    // 2) 递归扫描嵌套 iframe 的 src 与已加载资源记录（实时，乘方门户常把课表放 iframe）
    var found = scanFramesForTerm(document, 0);
    if (found) return found;
    // 3) 当前页已发生请求的 URL 里找（performance 记录含 xnxqdm 参数）
    var pt = findTermInPerf(performance);
    if (pt) return { term: pt, week: 1 };
    // 4) 嗅探记忆兜底（仅当 URL/iframe/资源都看不到 xnxqdm 时，才用上次记的）
    try {
      var saved = localStorage.getItem('cfjw_term');
      if (saved && /^\d{4,12}$/.test(saved)) return { term: saved, week: 1, fromMemory: true };
    } catch (e) { }
    // 5) 按当前日期推算
    var term = guessTerm();
    var start = termStart(term);
    var now = new Date();
    var week = Math.floor((now - start) / (7 * 24 * 3600 * 1000)) + 1;
    if (week < 1) week = 1;
    return { term: term, week: week, guessed: true };
  }

  // ---- 被动嗅探：从教务页面真实请求中捕获学期代码并记住 ----
  // （很多乘方部署把 xnxqdm 放在 POST 载荷里，URL/iframe 扫描看不到；嗅探一次，下次提取就能用）
  (function installTermSniffer() {
    if (window.__cfjwSniffed) return;
    window.__cfjwSniffed = true;
    var KEY = 'cfjw_term';
    function remember(text) {
      if (!text || typeof text !== 'string') return;
      var m = text.match(/xnxqdm[=:]\s*["']?(\d{4,12})/i);
      if (m) { try { localStorage.setItem(KEY, m[1]); } catch (e) { } }
    }
    try {
      var oX = XMLHttpRequest.prototype.open, sX = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (m2, u2) { remember(String(u2 || '')); return oX.apply(this, arguments); };
      XMLHttpRequest.prototype.send = function (b) {
        if (typeof b === 'string') remember(b);
        else if (b && typeof b.get === 'function') { try { remember(b.get('xnxqdm') || ''); } catch (e) { } }
        return sX.apply(this, arguments);
      };
    } catch (e) { }
    try {
      if (window.fetch) {
        var oF = window.fetch;
        window.fetch = function (input, init) {
          try {
            remember(typeof input === 'string' ? input : (input && input.url) || '');
            if (init && init.body) remember(String(init.body));
          } catch (e) { }
          return oF.apply(this, arguments);
        };
      }
    } catch (e) { }
  })();

  // 从页面 DOM 读「当前选中的学期」：河南师大等把课表内嵌在 iframe、学期是页面里的下拉框，
  // xnxqdm 既不在顶层 URL、也可能不走可嗅探的 AJAX —— 只能直接读那个 select 的选中值。
  function findTermInDom(d){
    try{
      var els = d.querySelectorAll('select,input');
      for (var i = 0; i < els.length; i++){
        var el = els[i], nm = '', val = '';
        try { nm = (el.getAttribute('name')||'') + '|' + (el.getAttribute('id')||''); } catch(e){}
        try { val = el.value || ''; } catch(e){}
        if (/xnxqdm/i.test(nm)){
          var mv = String(val).match(/(\d{4,12})/);
          if (mv) return mv[1];
        }
        if (el.tagName === 'SELECT'){
          var ov = '';
          try { ov = (el.selectedIndex>=0 && el.options[el.selectedIndex]) ? String(el.options[el.selectedIndex].value||'') : ''; } catch(e){}
          if (/^20\d{2}0[12]$/.test(ov.trim())) return ov.trim();
        }
      }
    } catch(e){}
    return '';
  }

  // 递归扫 iframe：src 参数 → 各层 frame 的资源记录
  function scanFramesForTerm(d, depth) {
    if (depth > 4) return null;
    // 先读这一层页面里学期下拉框的当前选中值（内嵌课表场景最可靠）
    var dt = findTermInDom(d);
    if (dt) return { term: dt, week: 1, fromDom: true };
    var frames;
    try { frames = d.querySelectorAll('iframe,frame'); } catch (e) { return null; }
    for (var i = 0; i < frames.length; i++) {
      var fd = null, fw = null;
      try { fd = frames[i].contentDocument; fw = frames[i].contentWindow; } catch (e) { }
      // ① 先进子文档递归：内层页面的学期下拉框（findTermInDom）最权威，反映用户当前选择
      if (fd) {
        var r = scanFramesForTerm(fd, depth + 1);
        if (r) return r;
      }
      // ② 子 frame 的实时 location.href（比 src 属性新；iframe 内部导航后 src 属性会过期）
      try {
        var ih = fw && fw.location && fw.location.href;
        var im = ih && ih.match(/xnxqdm[=:](\d{4,12})/);
        if (im) {
          var imw = ih.match(/zc=(\d+)/);
          return { term: im[1], week: imw ? parseInt(imw[1], 10) : 1 };
        }
      } catch (e) { }
      // ③ 子 frame 已发生请求的资源记录
      if (fw && fw.performance) {
        var pt = findTermInPerf(fw.performance);
        if (pt) return { term: pt, week: 1 };
      }
      // ④ iframe 的 src 属性（初始值，切学期后不更新，仅作最后兜底）
      var src = '';
      try { src = frames[i].getAttribute('src') || ''; } catch (e) { }
      var m = src.match(/xnxqdm[=:]\s*["']?(\d{4,12})/);
      var mw = src.match(/zc=(\d+)/);
      if (m) return { term: m[1], week: mw ? parseInt(mw[1], 10) : 1 };
    }
    return null;
  }

  function findTermInPerf(perf) {
    try {
      var es = (perf.getEntriesByType && (perf.getEntriesByType('resource') || perf.getEntriesByType('navigation'))) || [];
      for (var i = es.length - 1; i >= 0; i--) {
        var m = (es[i].name || '').match(/xnxqdm[=:]\s*["']?(\d{4,12})/);
        if (m) return m[1];
      }
      // 也扫请求体不在线上的场景：找页面 HTML 里内嵌的 xnxqdm 初始值
    } catch (e) { }
    return '';
  }

  // ---- 乘方教务接口调用 ----
  var SKIP_KEYWORDS = ['预选阶段', '选课阶段', '选课开始', '选课结束', '选课时间', '报名阶段', '退补选阶段'];

  function sessionExpired(text) {
    return /login-form|统一身份认证/.test(text) || /"code"\s*:\s*-401/.test(text);
  }

  // 从多个候选字段里取星期 1-7：支持数字、"星期一"/"周一" 文本（河南师大用 qsxq，标准乘方用 xq）
  // 返回 { d, numeric }：数字字段是 Java DAY_OF_WEEK 编码，需上层转换；中文文本本身就是星期名
  function pickDay(r) {
    var cands = [r.qsxq, r.xq, r.jsxq, r.day];
    var map = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7 };
    for (var i = 0; i < cands.length; i++) {
      var v = cands[i];
      if (v === null || v === undefined || v === '') continue;
      var n = parseInt(v, 10);
      if (!isNaN(n) && n >= 1 && n <= 7) return { d: n, numeric: true };
      var sm = String(v).match(/([一二三四五六日天])/);
      if (sm && map[sm[1]]) return { d: map[sm[1]], numeric: false };
    }
    return { d: 0, numeric: false };
  }

  // 从节次字段组合出节次列表：河南师大 ps/pe（起止节数字），标准乘方 jcdm2/jcdm
  function pickSections(r) {
    var ps = parseInt(r.ps, 10), pe = parseInt(r.pe, 10);
    if (!isNaN(ps) && ps > 0) {
      if (isNaN(pe) || pe < ps) pe = ps;
      if (pe - ps > 11) pe = ps; // 异常值保护
      return range(ps, pe);
    }
    return parseJcdm(r.jcdm2 != null && r.jcdm2 !== '' ? r.jcdm2 : r.jcdm);
  }

  // 解析周次串为数字数组："1,3,5,7-16" / "1-16(单)" / "1-16周(双周)" → 数组；无数字返回 null
  function parseWeekNums(raw) {
    var s = String(raw === null || raw === undefined ? '' : raw);
    if (!/\d/.test(s)) return null;
    var parity = /单/.test(s) ? '单' : (/双/.test(s) ? '双' : '');
    var nums = [];
    var re = /(\d+)\s*[-~至—]\s*(\d+)|(\d+)/g;
    var m;
    while ((m = re.exec(s)) !== null) {
      if (m[3]) nums.push(parseInt(m[3], 10));
      else {
        for (var i = parseInt(m[1], 10); i <= parseInt(m[2], 10); i++) nums.push(i);
      }
    }
    nums = nums.filter(function (w) { return w >= 1 && w <= 40; });
    if (parity === '单') nums = nums.filter(function (w) { return w % 2 === 1; });
    else if (parity === '双') nums = nums.filter(function (w) { return w % 2 === 0; });
    var uniq = [];
    nums.sort(function (a, b) { return a - b; }).forEach(function (w) { if (uniq.indexOf(w) < 0) uniq.push(w); });
    return uniq.length ? uniq : null;
  }

  function xferRow(r, week) {
    if (!r || typeof r !== 'object') return null;
    var name = cleanText(r.kcmc || r.kcName || r.courseName || '');
    if (!name) return null;
    for (var i = 0; i < SKIP_KEYWORDS.length; i++) {
      if (name.indexOf(SKIP_KEYWORDS[i]) >= 0) return null;
    }
    var pd = pickDay(r);
    // 数字字段为 Java DAY_OF_WEEK（1=周日,2=周一,…,7=周六）→ 转成 1=周一…7=周日
    var xq = pd.numeric && pd.d ? (pd.d === 1 ? 7 : pd.d - 1) : pd.d;
    var secList = pickSections(r);
    var pos = cleanText(r.zdjxcdmc || r.jxcdmc || r.cdmc || '');
    var teacher = cleanText(r.teaxms || r.teaxm || r.jsxm || '');
    if (!xq || xq < 1 || xq > 7 || !secList.length) return null;
    // 河南师大等版本行内 zc 就是整学期周次串（"1,3,5,7-16"），能解析出来就不用逐周扫描
    var weekNums = parseWeekNums(r.zc);
    if (!weekNums) weekNums = [week || 1];
    return {
      name: name,
      teacher: teacher,
      position: pos,
      day: xq,
      sections: secList.join(','),
      weekNums: weekNums,
      qssj: String(r.qssj || '').trim(),
      jssj: String(r.jssj || '').trim()
    };
  }

  function postForm(url, fields, referer) {
    var body = Object.keys(fields)
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(fields[k]); })
      .join('&');
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'application/json, text/javascript, */*; q=0.01'
      },
      credentials: 'include',
      body: body
    }).then(function (resp) {
      return resp.text().then(function (text) {
        var out = { status: resp.status, text: text, json: null };
        try { out.json = JSON.parse(text); } catch (e) { }
        return out;
      });
    });
  }

  // 学期代码 → 日期窗口（河南师大请求带 d1/d2；乘方学期 202601=秋季 202602=春季）
  function termWindow(term) {
    var y = parseInt(String(term).slice(0, 4), 10);
    if (!y) y = new Date().getFullYear();
    var sem = String(term).slice(-2);
    if (sem === '02') return { d1: y + '-12-01 00:00:00', d2: (y + 1) + '-09-30 23:59:59' };
    return { d1: y + '-07-01 00:00:00', d2: (y + 1) + '-03-31 23:59:59' };
  }

  // ---- businessHours 嗅探已整体废弃（2026-09-08 用户证伪：它是 FullCalendar 拖拽网格背景块，
  //      时长 75~125 分钟且首尾重叠，不是单节课时间。节次表改由课程行 qssj/jssj 推导，见上）。

  // 单周数据（week 传 '' 表示全学期）→ { rows, sessionExpired, notFound }
  function fetchWeek(term, week) {
    var pagePath = window.__cfjwPagePath || '/new/student/xsgrkb/week.page'; // 探测结果缓存
    var bootUrl = function () {
      var w = termWindow(term);
      return pagePath + '?szxqdm=&xnxqdm=' + term + '&yxdm=&zc=' + week + '&d1=' + encodeURIComponent(w.d1) + '&d2=' + encodeURIComponent(w.d2);
    };
    return fetch(bootUrl(), { credentials: 'include' })
      .then(function (resp) {
        if (resp.status === 404 && pagePath.indexOf('week.page') >= 0) {
          pagePath = '/new/student/xsgrkb/main.page';
          window.__cfjwPagePath = pagePath;
          return fetch(bootUrl(), { credentials: 'include' });
        }
        return resp;
      })
      .catch(function () { })
      .then(function () {
        var w = termWindow(term);
        // 对齐河南师大页面实际发送的完整参数集
        return postForm('/new/student/xsgrkb/getCalendarWeekDatas',
          { szxqdm: '', xnxqdm: term, yxdm: '', zc: week, d1: w.d1, d2: w.d2 },
          bootUrl());
      })
      .then(function (res) {
        if (!res.json) {
          return { rows: null, rawCount: 0, sample: null, sessionExpired: sessionExpired(res.text), notFound: res.status === 404 };
        }
        var j = res.json;
        if (j.code !== undefined && j.code < 0) {
          if (j.code === -401) return { rows: null, rawCount: 0, sample: null, sessionExpired: true, notFound: false };
          return { rows: [], rawCount: 0, sample: null, sessionExpired: false, notFound: false };
        }
        var raw = j.data || j.rows || [];
        if (!Array.isArray(raw)) raw = [];
        // 有效记录 = 有课程名的行（排除选课通知类）；用于诊断"接口有数据但字段不认识"
        var valid = [], sample0 = null;
        raw.forEach(function (r) {
          if (!r || typeof r !== 'object') return;
          var nm = cleanText(r.kcmc || r.kcName || r.courseName || '');
          if (!nm) return;
          if (SKIP_KEYWORDS.some(function (k) { return nm.indexOf(k) >= 0; })) return;
          valid.push(r);
          if (!sample0) sample0 = r;
        });
        var converted = valid.map(function (r) { return xferRow(r, week); }).filter(Boolean);
        return {
          rows: converted,
          rawCount: valid.length,
          dataCount: raw.length,   // 接口返回的全部记录数（哪怕字段完全不认识）
          sample: sample0 || (raw.length ? raw[0] : null),
          sessionExpired: false, notFound: false
        };
      });
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  // 整学期：优先一次请求全学期（zc=''），拿不到再逐周扫描
  async function extractChengfang(term) {
    var info = getTermAndWeek();
    term = term || info.term;
    var termSource = info.fromOverride ? '手动钉死'
      : (info.fromDom ? '页面学期下拉框' : (info.fromMemory ? '记忆' : (info.guessed ? '日期推算' : 'URL/iframe')));
    window.__cfjwTermSource = termSource;
    // 实时探测到的学期，回写记忆，保证下次一致
    try { if (!info.fromOverride && !info.fromMemory) localStorage.setItem('cfjw_term', term); } catch (e) { }
    var MAX_WEEKS = 30;
    var weekCourses = [];
    var rawTotal = 0;      // 接口返回的原始记录数（含字段不认识的）
    var sampleRow = null;  // 第一条原始记录（诊断字段名用）

    function diag() {
      var keys = sampleRow ? Object.keys(sampleRow).join(',') : '（接口未返回任何记录）';
      try { console.log('[小爱课表提取器] 接口原始记录示例：', JSON.stringify(sampleRow, null, 2)); } catch (e) { }
      return '接口返回了 ' + rawTotal + ' 条记录，但无法识别成课程。字段名：' + keys + '。完整示例记录已打印到 F12 控制台，请复制发给我';
    }

    function absorb(res) {
      if (res.dataCount) {
        rawTotal += res.dataCount;
        if (!sampleRow && res.sample) sampleRow = res.sample;
      }
    }

    // 快速路径：全学期一次拉取（河南师大等部署的行内 zc 是完整周次串）
    var all = await fetchWeek(term, '');
    if (all.sessionExpired) throw new Error('登录已失效，请重新登录教务系统后再提取');
    if (all.notFound) throw new Error('未找到乘方课表接口（week.page 和 main.page 都不存在），你的学校可能不是乘方系统或路径不同');
    absorb(all);
    if (all.rows && all.rows.length) {
      var hasMultiWeek = all.rows.some(function (c) { return c.weekNums.length > 1; });
      if (hasMultiWeek) return { courses: all.rows, term: term };
      weekCourses = all.rows; // 有数据但行内无完整周次串，继续逐周补全
    } else if (rawTotal > 0) {
      throw new Error(diag()); // 接口有记录却一条都解析不出 → 字段名不同，报诊断而非静默失败
    }
    await sleep(300);

    // 逐周扫描：连续 3 周无课则停
    var emptyRun = 0;
    for (var week = 1; week <= MAX_WEEKS; week++) {
      var res = await fetchWeek(term, week);
      if (res.sessionExpired) throw new Error('登录已失效，请重新登录教务系统后再提取');
      if (res.notFound) throw new Error('未找到乘方课表接口（week.page 和 main.page 都不存在），你的学校可能不是乘方系统或路径不同');
      absorb(res);
      if (res.rows === null) break;
      if (res.rows.length) {
        emptyRun = 0;
        weekCourses = weekCourses.concat(res.rows);
      } else {
        emptyRun++;
        if (rawTotal > 0 && emptyRun >= 2) throw new Error(diag()); // 有原始记录却全被过滤 = 字段不认
      }
      if (emptyRun >= 3) break;
      await sleep(250 + Math.random() * 350); // 限速防 WAF
    }
    if (!weekCourses.length && rawTotal > 0) throw new Error(diag());
    return { courses: weekCourses, term: term };
  }

  // 合并：同 课程名|教师|教室|星期|节次 的课程合并周次；并按真实起止时间构建节次表
  function mergeCourses(rows) {
    var map = {};
    var order = [];
    // 节次 → 真实起止时间（首节取最早 qssj，末节取最晚 jssj）
    var timeStart = {}, timeEnd = {};
    function normHM(t) {
      var hm = t && String(t).match(/(\d{1,2}):(\d{2})/);
      if (!hm) return '';
      var hh = parseInt(hm[1], 10), mm = parseInt(hm[2], 10);
      if (hh > 23 || mm > 59) return '';
      return (hh < 10 ? '0' + hh : '' + hh) + ':' + (mm < 10 ? '0' + mm : '' + mm);
    }
    rows.forEach(function (c) {
      var nums = parseJcdm(c.sections);
      if (nums.length) {
        var s = normHM(c.qssj), e = normHM(c.jssj);
        if (s) { var k0 = nums[0]; if (!timeStart[k0] || s < timeStart[k0]) timeStart[k0] = s; }
        if (e) { var k1 = nums[nums.length - 1]; if (!timeEnd[k1] || e > timeEnd[k1]) timeEnd[k1] = e; }
      }
      var key = [c.name, c.teacher, c.position, c.day, c.sections].join('|');
      if (!map[key]) {
        map[key] = {
          name: c.name, teacher: c.teacher, position: c.position,
          day: c.day, sections: c.sections, weeks: []
        };
        order.push(key);
      }
      c.weekNums.forEach(function (w) {
        if (map[key].weeks.indexOf(w) < 0) map[key].weeks.push(w);
      });
    });
    var merged = order.map(function (k) {
      var c = map[k];
      c.weeks.sort(function (a, b) { return a - b; });
      return {
        name: c.name, teacher: c.teacher, position: c.position,
        day: c.day, sections: c.sections, weeks: compressWeeks(c.weeks)
      };
    });
    var maxSec = 0;
    merged.forEach(function (c) {
      parseJcdm(c.sections).forEach(function (n) { if (n > maxSec) maxSec = n; });
    });
    maxPageSection = maxSec;
    // 节次表：由课程行自带 qssj/jssj 推导（首节 start / 末节 end 为锚点，缺口按 45 分钟课 + 10 分钟课间补），
    // 完全无法推导的节回退 DEFAULT_SECTIONS。不再使用 businessHours（拖拽网格背景块，非课时表）。
    var sections = buildSectionsFromTimes(timeStart, timeEnd, maxSec);
    return { courses: merged, sections: sections };
  }

  // 周次列表压缩：[5]→"5周"；[1..16]→"1-16周"；[1,3,5..]→"1-15周(单)"；其他→"1-3,7-8周"
  function compressWeeks(weeks) {
    if (!weeks.length) return '';
    if (weeks.length === 1) return weeks[0] + '周';
    var step2 = weeks.every(function (w, i) { return i === 0 || w === weeks[i - 1] + 2; });
    if (step2 && weeks.length >= 3) {
      return weeks[0] + '-' + weeks[weeks.length - 1] + '周(' + (weeks[0] % 2 === 1 ? '单' : '双') + ')';
    }
    var contiguous = weeks.every(function (w, i) { return i === 0 || w === weeks[i - 1] + 1; });
    if (contiguous) return weeks[0] + '-' + weeks[weeks.length - 1] + '周';
    return runJoin(weeks) + '周';
  }

  function runJoin(weeks) {
    var parts = [];
    var run = [weeks[0]];
    for (var i = 1; i < weeks.length; i++) {
      if (weeks[i] === run[run.length - 1] + 1) run.push(weeks[i]);
      else {
        parts.push(run.length > 1 ? run[0] + '-' + run[run.length - 1] : String(run[0]));
        run = [weeks[i]];
      }
    }
    parts.push(run.length > 1 ? run[0] + '-' + run[run.length - 1] : String(run[0]));
    return parts.join(',');
  }

  function removeDuplicates(list) {
    var seen = {};
    return list.filter(function (c) {
      var k = [c.name, c.teacher, c.position, c.day, c.sections, c.weeks].join('|');
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    });
  }

  // ---- 兜底：解析页面 DOM（FullCalendar 周视图），递归扫同源 iframe ----
  function collectDomDocs(d, depth, out) {
    if (depth > 4) return;
    out.push(d);
    var frames;
    try { frames = d.querySelectorAll('iframe,frame'); } catch (e) { return; }
    for (var i = 0; i < frames.length; i++) {
      var fd = null;
      try { fd = frames[i].contentDocument; } catch (e) { }
      if (fd && fd !== d) collectDomDocs(fd, depth + 1, out);
    }
  }

  function extractFromDom() {
    var out = [];
    var info = getTermAndWeek();
    var docs = [];
    collectDomDocs(document, 0, docs);
    var SEL = '.fc-event,[class*="kebiao"] .fc-content,[class*="course"]';
    docs.forEach(function (d) {
      var events;
      try { events = d.querySelectorAll(SEL); } catch (e) { return; }
      Array.prototype.forEach.call(events, function (el) {
        var title = cleanText(el.textContent);
        if (!title || title.length < 2) return;
        var dm = title.match(/周([一二三四五六日天])/);
        var sm = title.match(/(\d{1,2})[:：]\d{2}\s*[-~至]\s*(\d{1,2})/);
        if (!dm && !sm) return;
        var dmMap = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7 };
        var parts = title.split(/[\s/|]+/).filter(Boolean);
        out.push({
          name: parts[0],
          teacher: '',
          position: parts[parts.length - 1] === parts[0] ? '' : parts[parts.length - 1],
          day: dm ? dmMap[dm[1]] : 1,
          sections: '1',
          weeks: info.week + '周'
        });
      });
    });
    return removeDuplicates(out);
  }

  function extractSchedule() {
    return extractChengfang().then(function (res) {
      if (res.error) throw new Error(res.error);
      var merged = mergeCourses(res.courses);
      courses = removeDuplicates(merged.courses);
      if (!courses.length) {
        var dom = extractFromDom();
        if (dom.length) {
          courses = dom;
          showToast('⚠ 接口未返回课程，已从页面渲染结果提取（建议核对周次）');
        }
      }
      if (!courses.length) return { courses: [], schedule: {}, term: res.term, host: (location && location.hostname) || "" };
      var sched = buildSchedule(courses);
      if (merged.sections && merged.sections.length) sched.sections = merged.sections;
      return { courses: courses, schedule: sched, term: res.term, host: (location && location.hostname) || "" };
    });
  }

  // ---- UI ----
  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { }, function () { fallbackCopy(text); });
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { }
    document.body.removeChild(ta);
  }

  function showToast(text, duration) {
    var old = document.querySelector('#__cfjw_extract_toast');
    if (old) old.remove();
    var t = document.createElement('div');
    t.id = '__cfjw_extract_toast';
    t.textContent = text;
    Object.assign(t.style, {
      position: 'fixed', left: '50%', bottom: '80px',
      transform: 'translateX(-50%)', zIndex: '999999999',
      background: '#222', color: '#fff', padding: '12px 20px',
      borderRadius: '10px', fontSize: '15px', maxWidth: '80vw',
      boxShadow: '0 4px 15px rgba(0,0,0,.3)'
    });
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, duration || 4000);
  }

  function createButton() {
    if (document.querySelector('#__cfjw_extract_btn')) return;
    var btn = document.createElement('button');
    btn.id = '__cfjw_extract_btn';
    btn.textContent = '📚 提取课表';
    Object.assign(btn.style, {
      position: 'fixed', right: '20px', bottom: '20px',
      zIndex: '999999999', padding: '12px 18px', border: 'none',
      borderRadius: '10px', background: '#1677ff', color: '#fff',
      fontSize: '15px', fontWeight: 'bold', cursor: 'pointer',
      boxShadow: '0 4px 12px rgba(0,0,0,.25)'
    });
    btn.onclick = function () {
      btn.disabled = true;
      btn.textContent = '⏳ 提取整学期…';
      extractSchedule().then(function (result) {
        btn.disabled = false;
        if (result && result.courses && result.courses.length) {
          btn.textContent = '✅ 已复制 ' + result.courses.length + ' 条';
          copyToClipboard(JSON.stringify(result, null, 2));
          showToast('✅ 已复制 ' + result.courses.length + ' 条课表到剪贴板（学期 ' + result.term + '，来源：' + (window.__cfjwTermSource || '?') + '）');
          showResult(result);
        } else {
          btn.textContent = '❌ 没找到课程';
          showToast('❌ 学期 ' + ((result && result.term) || '?') + '（来源：' + (window.__cfjwTermSource || '?') + '）下未查到课程。请确认已在教务页面的「学期下拉框」选中目标学期后再提取；或右键这个「提取课表」按钮 → 手动钉死学期代码（如 ' + guessTerm() + '）', 10000);
        }
        setTimeout(function () { btn.textContent = '📚 提取课表'; }, 4000);
      }).catch(function (e) {
        btn.disabled = false;
        btn.textContent = '❌ 提取出错';
        showToast('❌ ' + (e.message || e));
        setTimeout(function () { btn.textContent = '📚 提取课表'; }, 4000);
      });
    };
    // 右键按钮：手动指定/清除学期代码（不用控制台的兜底入口）
    btn.oncontextmenu = function (ev) {
      ev.preventDefault();
      var info = getTermAndWeek();
      var pin = '';
      try { pin = localStorage.getItem('cfjw_term_manual') || ''; } catch (e) { }
      var v = prompt(
        '手动钉死学期代码（xnxqdm，留空 = 取消钉死、按当前页面自动识别）。\n' +
        '当前将使用学期：' + info.term + (pin ? '（已钉死 ' + pin + '）' : '（自动识别）'),
        pin || info.term);
      if (v === null) return;
      v = v.trim();
      try {
        if (v) { localStorage.setItem('cfjw_term_manual', v); localStorage.setItem('cfjw_term', v); }
        else { localStorage.removeItem('cfjw_term_manual'); localStorage.removeItem('cfjw_term'); }
      } catch (e) { }
      showToast(v ? '✅ 已钉死学期 ' + v + '，左键点按钮开始提取' : '✅ 已取消钉死，将按当前页面自动识别学期');
    };
    document.body.appendChild(btn);
  }

  function showResult(result) {
    var box = document.querySelector('#__cfjw_result_box');
    if (box) box.remove();
    box = document.createElement('div');
    box.id = '__cfjw_result_box';
    var list = result.courses.slice(0, 6);
    var html = '<div style="font-weight:600;margin-bottom:6px">已提取 ' + result.courses.length + ' 条课程</div>';
    list.forEach(function (c) {
      html += '<div style="font-size:12px;opacity:.9;line-height:1.5">· ' +
        c.name + ' · 周' + c.day + ' · 第' + c.sections + '节 · ' + (c.weeks || '?') + '</div>';
    });
    if (result.courses.length > list.length) {
      html += '<div style="font-size:12px;opacity:.7;margin-top:4px">等 ' + result.courses.length + ' 条</div>';
    }
    var sched = result.schedule || {};
    html += '<div style="font-size:12px;opacity:.85;margin-top:8px;border-top:1px solid #555;padding-top:6px">';
    html += '学期=' + (result.term || '?') +
      ' · 总周数=' + (sched.totalWeek || '?') +
      ' · 上午/下午/晚上=' + (sched.morningNum != null ? (sched.morningNum + '/' + sched.afternoonNum + '/' + sched.nightNum) : '?');
    html += '</div>';
    var origin = (document.querySelector('script[data-cfjw-base]') || {}).dataset &&
      document.querySelector('script[data-cfjw-base]').dataset.cfjwBase;
    if (origin) {
      html += '<a href="' + origin + '/#paste" target="_blank" ' +
        'style="display:inline-block;margin-top:10px;padding:7px 14px;background:#1677ff;color:#fff;border-radius:6px;text-decoration:none;font-size:13px">↗ 打开小爱课表导入器粘贴</a>';
    }
    html += '<div style="font-size:11px;opacity:.6;margin-top:6px">课表 JSON 已复制到剪贴板，直接到导入器粘贴即可</div>';

    box.innerHTML = html;
    Object.assign(box.style, {
      position: 'fixed', right: '20px', bottom: '80px',
      zIndex: '999999999', padding: '14px 16px',
      background: '#1f1f1f', color: '#fff',
      borderRadius: '10px', maxWidth: '320px',
      boxShadow: '0 6px 20px rgba(0,0,0,.4)',
      fontSize: '13px', lineHeight: '1.5'
    });
    document.body.appendChild(box);
    setTimeout(function () { if (box.parentNode) box.remove(); }, 15000);
  }

  // 油猴脚本会注入到每个同源 iframe（乘方门户通常 3 层：主页+桌面+课表），
  // 嗅探器保留在所有框架（才能捕获课表 iframe 里的 xnxqdm 请求），
  // 但按钮只在最外层窗口显示一个，避免右下角叠出多个。
  function isTopFrame() {
    try { return window.top === window.self; } catch (e) { return true; } // 跨域访问失败按顶层处理
  }
  if (isTopFrame()) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', createButton);
    } else {
      createButton();
    }
  }

  // 调试入口
  window.__cfjwExtract = extractSchedule;
})();
