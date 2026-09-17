/**
 * 小爱课表导入器 · 乘方教务版 - Cloudflare Pages Function（一体化业务后端）
 * 部署：仓库根目录 functions/api/[[path]].js → Pages 项目自动部署到 *.pages.dev
 *
 * 路由（catch-all 匹配 /api/* 下任意路径）：
 *   GET  /api/ping                          心跳
 *   GET  /api/state                         状态
 *   GET  /api/visit                         访问计数
 *   GET  /api/tables                        课表列表
 *   GET  /api/table?ctId=                   获取课表课程
 *   GET  /api/jiaowu_extractor.js           乘方教务提取脚本（书签注入用）
 *   GET  /api/jiaowu_userscript.js          油猴脚本（带 @match 头）
 *   POST /api/connect                       凭据识别 + 验证 + 创建会话
 *   POST /api/create_table                  新建课表
 *   POST /api/parse                         解析 JSON
 *   POST /api/ai_parse                      AI 兜底解析（需配 AI_API_KEY）
 *   POST /api/import                        导入课程 + 同步设置
 *   POST /api/delete                        删除课程
 *   POST /api/clear                         清空课表
 */

// ============ 常量 ============
const STYLES = [
  ["#00A6F2", "#E5F4FF"], ["#FC6B50", "#FDEBDE"],
  ["#3CB3C8", "#DEFBF8"], ["#7D7AEA", "#EDEDFF"],
  ["#FF9900", "#FCEBCD"], ["#EF5B75", "#FFEFF0"],
  ["#5B8EFF", "#EAF1FF"], ["#F067BB", "#FFEDF8"],
  ["#29BBAA", "#E2F8F3"], ["#CBA713", "#FFF8C8"],
  ["#B967E3", "#F9EDFF"], ["#6E8ADA", "#F3F2FD"],
];
const BASE = "https://i.ai.mi.com/course-multi-auth";
const SWITCH_BASE = "https://i.xiaomixiaoai.com/course-multi-auth";
const WEEKDAY_MAP = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "天": 7, "日": 7 };
const RANGE_RE = /(\d+)\s*(?:-|至|~)\s*(\d+)(?:[\s周\(（\)）]*(单|双)[\s周\(（\)）]*)?|(\d+)/g;

// 乘方教务提取脚本正文（构建时由 scripts/build_functions.js 从 tools/cf_extractor.js 注入）
const CF_EXTRACTOR_JS = `// ==/CHENGFANG EXTRACTOR==\n// 由「小爱课表导入器 · 乘方教务版」内置提供（脚本版本 1.4.1）\n// 兼容：油猴脚本 / Bookmarklet 直接 <script> 注入到乘方教务页面\n// 用途：登录后，在任意教务页面点击右下角「📚 提取课表」按钮 → 提取整学期课表 JSON 并复制到剪贴板\n// 节次时间表：从课程行自带的 qssj/jssj（连堂块）直接推导单节时间（45 分钟一课 + 10 分钟课间）；\n//             businessHours 是 FullCalendar 拖拽网格背景块，不是课时表，已弃用。\n\n(function () {\n  'use strict';\n\n  var courses = [];\n  var maxPageSection = 0;\n\n  function cleanText(text) {\n    return (text || '')\n      .replace(/&nbsp;/g, '')\n      .replace(/ /g, ' ')\n      .replace(/\\s+/g, ' ')\n      .trim();\n  }\n\n  // "1-16(周)" / "1-16(周)单" / "1,3,5(周)" → "1-16周(单)" / "1,3,5周"\n  function normalizeWeeks(weekText) {\n    weekText = cleanText(weekText);\n    if (!weekText) return '';\n    var m = weekText.match(/[\\d]+(?:\\s*[-—~,，]\\s*\\d+)*/);\n    var base = m ? m[0] : weekText;\n    base = base.replace(/\\s+/g, '')\n      .replace(/[—–]/g, '-')\n      .replace(/[，~]/g, ',')\n      .replace(/,+$/, '')\n      .replace(/周+$/, '');\n    var suffix = '';\n    if (/单/.test(weekText)) suffix = '(单)';\n    else if (/双/.test(weekText)) suffix = '(双)';\n    return base + '周' + suffix;\n  }\n\n  // 解析节次代码："09,10" / "9-10" / "0910" / 数组 [9,10] → [9,10]\n  function parseJcdm(jcdm) {\n    if (jcdm === null || jcdm === undefined) return [];\n    if (Array.isArray(jcdm)) {\n      return jcdm\n        .map(function (x) { return parseInt(x, 10); })\n        .filter(function (n) { return !isNaN(n) && n > 0; })\n        .sort(function (a, b) { return a - b; });\n    }\n    var s = String(jcdm).trim();\n    if (!s) return [];\n    // 4 位连写（如 "0910" 表示 9-10 节）\n    if (/^\\d{4}$/.test(s)) {\n      var a1 = parseInt(s.slice(0, 2), 10), a2 = parseInt(s.slice(2), 10);\n      if (a1 > 0 && a2 >= a1) return range(a1, a2);\n    }\n    var nums = [];\n    var re = /(\\d+)\\s*[-~至]\\s*(\\d+)|(\\d+)/g;\n    var m;\n    while ((m = re.exec(s)) !== null) {\n      if (m[3]) nums.push(parseInt(m[3], 10));\n      else {\n        var a = parseInt(m[1], 10), b = parseInt(m[2], 10);\n        nums = nums.concat(range(a, b));\n      }\n    }\n    return nums.filter(function (n) { return n > 0; }).sort(function (x, y) { return x - y; });\n  }\n\n  function range(a, b) {\n    var r = [];\n    for (var i = a; i <= b; i++) r.push(i);\n    return r;\n  }\n\n  // 'HH:MM' ± 分钟 → 'HH:MM'（越界/非法返回 ''）\n  function addHM(hm, delta) {\n    var m = String(hm || '').match(/^(\\d{1,2}):(\\d{2})$/);\n    if (!m) return '';\n    var t = parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + delta;\n    if (t < 0 || t > 23 * 60 + 59) return '';\n    var hh = Math.floor(t / 60), mm = t % 60;\n    return (hh < 10 ? '0' + hh : '' + hh) + ':' + (mm < 10 ? '0' + mm : '' + mm);\n  }\n\n  // 由课程行真实起止时间构建节次表（timeStart[节]=该节最早 qssj、timeEnd[节]=该节最晚 jssj）：\n  // ① 已观测锚点（连堂块首节 start、末节 end）原样保留；\n  // ② 只有单侧锚点的节按「45 分钟一课」补另一侧；\n  // ③ 完全无锚点的节回退 DEFAULT_SECTIONS（绝不跨午休等大间隙外推）。\n  // 注意：绝不使用 businessHours（拖拽网格背景块，非课时表）。\n  function buildSectionsFromTimes(timeStart, timeEnd, maxSec) {\n    if (!maxSec || maxSec < 1) return [];\n    var out = [];\n    for (var i = 1; i <= maxSec; i++) {\n      var def = DEFAULT_SECTIONS[i - 1] || {};\n      var s = timeStart[i] || '';\n      var e = timeEnd[i] || '';\n      if (s && !e) e = addHM(s, 45);\n      else if (!s && e) s = addHM(e, -45);\n      if (!s) s = def.s || '';\n      if (!e) e = def.e || '';\n      out.push({ i: i, s: s, e: e });\n    }\n    return out;\n  }\n\n  // 默认节次时间表（13 节，多数乘方教务学校通用，导入器页面可再改）\n  var DEFAULT_SECTIONS = [\n    { i: 1, s: "08:30", e: "09:10" },\n    { i: 2, s: "09:20", e: "10:00" },\n    { i: 3, s: "10:25", e: "11:05" },\n    { i: 4, s: "11:15", e: "11:55" },\n    { i: 5, s: "12:00", e: "12:40" },\n    { i: 6, s: "12:50", e: "13:30" },\n    { i: 7, s: "14:30", e: "15:10" },\n    { i: 8, s: "15:20", e: "16:00" },\n    { i: 9, s: "16:25", e: "17:05" },\n    { i: 10, s: "17:15", e: "17:55" },\n    { i: 11, s: "19:00", e: "19:40" },\n    { i: 12, s: "19:50", e: "20:30" },\n    { i: 13, s: "20:40", e: "21:20" }\n  ];\n\n  function buildSchedule(list) {\n    var maxWeek = 0;\n    var maxSec = maxPageSection || 0;\n    list.forEach(function (c) {\n      var wm = String(c.weeks || '').match(/\\d+/g);\n      if (wm) wm.forEach(function (x) { var n = parseInt(x, 10); if (n > maxWeek) maxWeek = n; });\n      var sm = String(c.sections || '').match(/\\d+/g);\n      if (sm) sm.forEach(function (x) { var n = parseInt(x, 10); if (n > maxSec) maxSec = n; });\n    });\n    var morn, aft, night;\n    if (maxSec <= 0) { morn = null; aft = null; night = null; }\n    else if (maxSec <= 4) { morn = maxSec; aft = 0; night = 0; }\n    else if (maxSec <= 8) { morn = 4; aft = maxSec - 4; night = 0; }\n    else if (maxSec <= 12) { morn = 4; aft = 4; night = maxSec - 8; }\n    else { morn = 6; aft = 4; night = maxSec - 10; }\n    return {\n      totalWeek: maxWeek || null,\n      morningNum: morn, afternoonNum: aft, nightNum: night,\n      sections: DEFAULT_SECTIONS.slice(0, Math.max(maxSec, 1))\n    };\n  }\n\n  // ---- 学期代码与当前周推算 ----\n  function termStart(term) {\n    // term 形如 202601：学年 2026 第 1 学期（秋季，9 月初开学）\n    var y = parseInt(term.slice(0, 4), 10);\n    var sem = term.slice(4);\n    if (sem === '01') {\n      var d = new Date(y, 8, 1); // 9月1日\n      var dow = d.getDay() || 7;\n      return new Date(y, 8, 1 - (dow - 1)); // 包含 9/1 那周的周一\n    }\n    var d2 = new Date(y + 1, 2, 1); // 3月1日\n    var dow2 = d2.getDay() || 7;\n    return new Date(y + 1, 2, 1 - (dow2 - 1));\n  }\n\n  function guessTerm() {\n    var now = new Date();\n    var y = now.getFullYear(), mo = now.getMonth() + 1;\n    if (mo >= 8) return y + '01';\n    return (y - 1) + '02';\n  }\n\n  function getTermAndWeek() {\n    // 0) 用户右键「手动钉死」的学期（独立键，最高优先级）\n    try {\n      var pin = localStorage.getItem('cfjw_term_manual');\n      if (pin && /^\\d{4,12}$/.test(pin)) return { term: pin, week: 1, fromOverride: true };\n    } catch (e) { }\n    // 1) 当前页面 URL 参数（实时：切换学期后优先反映页面上正在看的）\n    try {\n      var u = new URL(location.href);\n      var t = u.searchParams.get('xnxqdm');\n      var w = parseInt(u.searchParams.get('zc'), 10);\n      if (t && /^\\d{4,12}$/.test(t)) return { term: t, week: isNaN(w) ? 1 : w };\n    } catch (e) { }\n    // 2) 递归扫描嵌套 iframe 的 src 与已加载资源记录（实时，乘方门户常把课表放 iframe）\n    var found = scanFramesForTerm(document, 0);\n    if (found) return found;\n    // 3) 当前页已发生请求的 URL 里找（performance 记录含 xnxqdm 参数）\n    var pt = findTermInPerf(performance);\n    if (pt) return { term: pt, week: 1 };\n    // 4) 嗅探记忆兜底（仅当 URL/iframe/资源都看不到 xnxqdm 时，才用上次记的）\n    try {\n      var saved = localStorage.getItem('cfjw_term');\n      if (saved && /^\\d{4,12}$/.test(saved)) return { term: saved, week: 1, fromMemory: true };\n    } catch (e) { }\n    // 5) 按当前日期推算\n    var term = guessTerm();\n    var start = termStart(term);\n    var now = new Date();\n    var week = Math.floor((now - start) / (7 * 24 * 3600 * 1000)) + 1;\n    if (week < 1) week = 1;\n    return { term: term, week: week, guessed: true };\n  }\n\n  // ---- 被动嗅探：从教务页面真实请求中捕获学期代码并记住 ----\n  // （很多乘方部署把 xnxqdm 放在 POST 载荷里，URL/iframe 扫描看不到；嗅探一次，下次提取就能用）\n  (function installTermSniffer() {\n    if (window.__cfjwSniffed) return;\n    window.__cfjwSniffed = true;\n    var KEY = 'cfjw_term';\n    function remember(text) {\n      if (!text || typeof text !== 'string') return;\n      var m = text.match(/xnxqdm[=:]\\s*["']?(\\d{4,12})/i);\n      if (m) { try { localStorage.setItem(KEY, m[1]); } catch (e) { } }\n    }\n    try {\n      var oX = XMLHttpRequest.prototype.open, sX = XMLHttpRequest.prototype.send;\n      XMLHttpRequest.prototype.open = function (m2, u2) { remember(String(u2 || '')); return oX.apply(this, arguments); };\n      XMLHttpRequest.prototype.send = function (b) {\n        if (typeof b === 'string') remember(b);\n        else if (b && typeof b.get === 'function') { try { remember(b.get('xnxqdm') || ''); } catch (e) { } }\n        return sX.apply(this, arguments);\n      };\n    } catch (e) { }\n    try {\n      if (window.fetch) {\n        var oF = window.fetch;\n        window.fetch = function (input, init) {\n          try {\n            remember(typeof input === 'string' ? input : (input && input.url) || '');\n            if (init && init.body) remember(String(init.body));\n          } catch (e) { }\n          return oF.apply(this, arguments);\n        };\n      }\n    } catch (e) { }\n  })();\n\n  // 从页面 DOM 读「当前选中的学期」：河南师大等把课表内嵌在 iframe、学期是页面里的下拉框，\n  // xnxqdm 既不在顶层 URL、也可能不走可嗅探的 AJAX —— 只能直接读那个 select 的选中值。\n  function findTermInDom(d){\n    try{\n      var els = d.querySelectorAll('select,input');\n      for (var i = 0; i < els.length; i++){\n        var el = els[i], nm = '', val = '';\n        try { nm = (el.getAttribute('name')||'') + '|' + (el.getAttribute('id')||''); } catch(e){}\n        try { val = el.value || ''; } catch(e){}\n        if (/xnxqdm/i.test(nm)){\n          var mv = String(val).match(/(\\d{4,12})/);\n          if (mv) return mv[1];\n        }\n        if (el.tagName === 'SELECT'){\n          var ov = '';\n          try { ov = (el.selectedIndex>=0 && el.options[el.selectedIndex]) ? String(el.options[el.selectedIndex].value||'') : ''; } catch(e){}\n          if (/^20\\d{2}0[12]$/.test(ov.trim())) return ov.trim();\n        }\n      }\n    } catch(e){}\n    return '';\n  }\n\n  // 递归扫 iframe：src 参数 → 各层 frame 的资源记录\n  function scanFramesForTerm(d, depth) {\n    if (depth > 4) return null;\n    // 先读这一层页面里学期下拉框的当前选中值（内嵌课表场景最可靠）\n    var dt = findTermInDom(d);\n    if (dt) return { term: dt, week: 1, fromDom: true };\n    var frames;\n    try { frames = d.querySelectorAll('iframe,frame'); } catch (e) { return null; }\n    for (var i = 0; i < frames.length; i++) {\n      var fd = null, fw = null;\n      try { fd = frames[i].contentDocument; fw = frames[i].contentWindow; } catch (e) { }\n      // ① 先进子文档递归：内层页面的学期下拉框（findTermInDom）最权威，反映用户当前选择\n      if (fd) {\n        var r = scanFramesForTerm(fd, depth + 1);\n        if (r) return r;\n      }\n      // ② 子 frame 的实时 location.href（比 src 属性新；iframe 内部导航后 src 属性会过期）\n      try {\n        var ih = fw && fw.location && fw.location.href;\n        var im = ih && ih.match(/xnxqdm[=:](\\d{4,12})/);\n        if (im) {\n          var imw = ih.match(/zc=(\\d+)/);\n          return { term: im[1], week: imw ? parseInt(imw[1], 10) : 1 };\n        }\n      } catch (e) { }\n      // ③ 子 frame 已发生请求的资源记录\n      if (fw && fw.performance) {\n        var pt = findTermInPerf(fw.performance);\n        if (pt) return { term: pt, week: 1 };\n      }\n      // ④ iframe 的 src 属性（初始值，切学期后不更新，仅作最后兜底）\n      var src = '';\n      try { src = frames[i].getAttribute('src') || ''; } catch (e) { }\n      var m = src.match(/xnxqdm[=:]\\s*["']?(\\d{4,12})/);\n      var mw = src.match(/zc=(\\d+)/);\n      if (m) return { term: m[1], week: mw ? parseInt(mw[1], 10) : 1 };\n    }\n    return null;\n  }\n\n  function findTermInPerf(perf) {\n    try {\n      var es = (perf.getEntriesByType && (perf.getEntriesByType('resource') || perf.getEntriesByType('navigation'))) || [];\n      for (var i = es.length - 1; i >= 0; i--) {\n        var m = (es[i].name || '').match(/xnxqdm[=:]\\s*["']?(\\d{4,12})/);\n        if (m) return m[1];\n      }\n      // 也扫请求体不在线上的场景：找页面 HTML 里内嵌的 xnxqdm 初始值\n    } catch (e) { }\n    return '';\n  }\n\n  // ---- 乘方教务接口调用 ----\n  var SKIP_KEYWORDS = ['预选阶段', '选课阶段', '选课开始', '选课结束', '选课时间', '报名阶段', '退补选阶段'];\n\n  function sessionExpired(text) {\n    return /login-form|统一身份认证/.test(text) || /"code"\\s*:\\s*-401/.test(text);\n  }\n\n  // 从多个候选字段里取星期 1-7：支持数字、"星期一"/"周一" 文本（河南师大用 qsxq，标准乘方用 xq）\n  // 返回 { d, numeric }：数字字段是 Java DAY_OF_WEEK 编码，需上层转换；中文文本本身就是星期名\n  function pickDay(r) {\n    var cands = [r.qsxq, r.xq, r.jsxq, r.day];\n    var map = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7 };\n    for (var i = 0; i < cands.length; i++) {\n      var v = cands[i];\n      if (v === null || v === undefined || v === '') continue;\n      var n = parseInt(v, 10);\n      if (!isNaN(n) && n >= 1 && n <= 7) return { d: n, numeric: true };\n      var sm = String(v).match(/([一二三四五六日天])/);\n      if (sm && map[sm[1]]) return { d: map[sm[1]], numeric: false };\n    }\n    return { d: 0, numeric: false };\n  }\n\n  // 从节次字段组合出节次列表：河南师大 ps/pe（起止节数字），标准乘方 jcdm2/jcdm\n  function pickSections(r) {\n    var ps = parseInt(r.ps, 10), pe = parseInt(r.pe, 10);\n    if (!isNaN(ps) && ps > 0) {\n      if (isNaN(pe) || pe < ps) pe = ps;\n      if (pe - ps > 11) pe = ps; // 异常值保护\n      return range(ps, pe);\n    }\n    return parseJcdm(r.jcdm2 != null && r.jcdm2 !== '' ? r.jcdm2 : r.jcdm);\n  }\n\n  // 解析周次串为数字数组："1,3,5,7-16" / "1-16(单)" / "1-16周(双周)" → 数组；无数字返回 null\n  function parseWeekNums(raw) {\n    var s = String(raw === null || raw === undefined ? '' : raw);\n    if (!/\\d/.test(s)) return null;\n    var parity = /单/.test(s) ? '单' : (/双/.test(s) ? '双' : '');\n    var nums = [];\n    var re = /(\\d+)\\s*[-~至—]\\s*(\\d+)|(\\d+)/g;\n    var m;\n    while ((m = re.exec(s)) !== null) {\n      if (m[3]) nums.push(parseInt(m[3], 10));\n      else {\n        for (var i = parseInt(m[1], 10); i <= parseInt(m[2], 10); i++) nums.push(i);\n      }\n    }\n    nums = nums.filter(function (w) { return w >= 1 && w <= 40; });\n    if (parity === '单') nums = nums.filter(function (w) { return w % 2 === 1; });\n    else if (parity === '双') nums = nums.filter(function (w) { return w % 2 === 0; });\n    var uniq = [];\n    nums.sort(function (a, b) { return a - b; }).forEach(function (w) { if (uniq.indexOf(w) < 0) uniq.push(w); });\n    return uniq.length ? uniq : null;\n  }\n\n  function xferRow(r, week) {\n    if (!r || typeof r !== 'object') return null;\n    var name = cleanText(r.kcmc || r.kcName || r.courseName || '');\n    if (!name) return null;\n    for (var i = 0; i < SKIP_KEYWORDS.length; i++) {\n      if (name.indexOf(SKIP_KEYWORDS[i]) >= 0) return null;\n    }\n    var pd = pickDay(r);\n    // 数字字段为 Java DAY_OF_WEEK（1=周日,2=周一,…,7=周六）→ 转成 1=周一…7=周日\n    var xq = pd.numeric && pd.d ? (pd.d === 1 ? 7 : pd.d - 1) : pd.d;\n    var secList = pickSections(r);\n    var pos = cleanText(r.zdjxcdmc || r.jxcdmc || r.cdmc || '');\n    var teacher = cleanText(r.teaxms || r.teaxm || r.jsxm || '');\n    if (!xq || xq < 1 || xq > 7 || !secList.length) return null;\n    // 河南师大等版本行内 zc 就是整学期周次串（"1,3,5,7-16"），能解析出来就不用逐周扫描\n    var weekNums = parseWeekNums(r.zc);\n    if (!weekNums) weekNums = [week || 1];\n    return {\n      name: name,\n      teacher: teacher,\n      position: pos,\n      day: xq,\n      sections: secList.join(','),\n      weekNums: weekNums,\n      qssj: String(r.qssj || '').trim(),\n      jssj: String(r.jssj || '').trim()\n    };\n  }\n\n  function postForm(url, fields, referer) {\n    var body = Object.keys(fields)\n      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(fields[k]); })\n      .join('&');\n    return fetch(url, {\n      method: 'POST',\n      headers: {\n        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',\n        'X-Requested-With': 'XMLHttpRequest',\n        'Accept': 'application/json, text/javascript, */*; q=0.01'\n      },\n      credentials: 'include',\n      body: body\n    }).then(function (resp) {\n      return resp.text().then(function (text) {\n        var out = { status: resp.status, text: text, json: null };\n        try { out.json = JSON.parse(text); } catch (e) { }\n        return out;\n      });\n    });\n  }\n\n  // 学期代码 → 日期窗口（河南师大请求带 d1/d2；乘方学期 202601=秋季 202602=春季）\n  function termWindow(term) {\n    var y = parseInt(String(term).slice(0, 4), 10);\n    if (!y) y = new Date().getFullYear();\n    var sem = String(term).slice(-2);\n    if (sem === '02') return { d1: y + '-12-01 00:00:00', d2: (y + 1) + '-09-30 23:59:59' };\n    return { d1: y + '-07-01 00:00:00', d2: (y + 1) + '-03-31 23:59:59' };\n  }\n\n  // ---- businessHours 嗅探已整体废弃（2026-09-08 用户证伪：它是 FullCalendar 拖拽网格背景块，\n  //      时长 75~125 分钟且首尾重叠，不是单节课时间。节次表改由课程行 qssj/jssj 推导，见上）。\n\n  // 单周数据（week 传 '' 表示全学期）→ { rows, sessionExpired, notFound }\n  function fetchWeek(term, week) {\n    var pagePath = window.__cfjwPagePath || '/new/student/xsgrkb/week.page'; // 探测结果缓存\n    var bootUrl = function () {\n      var w = termWindow(term);\n      return pagePath + '?szxqdm=&xnxqdm=' + term + '&yxdm=&zc=' + week + '&d1=' + encodeURIComponent(w.d1) + '&d2=' + encodeURIComponent(w.d2);\n    };\n    return fetch(bootUrl(), { credentials: 'include' })\n      .then(function (resp) {\n        if (resp.status === 404 && pagePath.indexOf('week.page') >= 0) {\n          pagePath = '/new/student/xsgrkb/main.page';\n          window.__cfjwPagePath = pagePath;\n          return fetch(bootUrl(), { credentials: 'include' });\n        }\n        return resp;\n      })\n      .catch(function () { })\n      .then(function () {\n        var w = termWindow(term);\n        // 对齐河南师大页面实际发送的完整参数集\n        return postForm('/new/student/xsgrkb/getCalendarWeekDatas',\n          { szxqdm: '', xnxqdm: term, yxdm: '', zc: week, d1: w.d1, d2: w.d2 },\n          bootUrl());\n      })\n      .then(function (res) {\n        if (!res.json) {\n          return { rows: null, rawCount: 0, sample: null, sessionExpired: sessionExpired(res.text), notFound: res.status === 404 };\n        }\n        var j = res.json;\n        if (j.code !== undefined && j.code < 0) {\n          if (j.code === -401) return { rows: null, rawCount: 0, sample: null, sessionExpired: true, notFound: false };\n          return { rows: [], rawCount: 0, sample: null, sessionExpired: false, notFound: false };\n        }\n        var raw = j.data || j.rows || [];\n        if (!Array.isArray(raw)) raw = [];\n        // 有效记录 = 有课程名的行（排除选课通知类）；用于诊断"接口有数据但字段不认识"\n        var valid = [], sample0 = null;\n        raw.forEach(function (r) {\n          if (!r || typeof r !== 'object') return;\n          var nm = cleanText(r.kcmc || r.kcName || r.courseName || '');\n          if (!nm) return;\n          if (SKIP_KEYWORDS.some(function (k) { return nm.indexOf(k) >= 0; })) return;\n          valid.push(r);\n          if (!sample0) sample0 = r;\n        });\n        var converted = valid.map(function (r) { return xferRow(r, week); }).filter(Boolean);\n        return {\n          rows: converted,\n          rawCount: valid.length,\n          dataCount: raw.length,   // 接口返回的全部记录数（哪怕字段完全不认识）\n          sample: sample0 || (raw.length ? raw[0] : null),\n          sessionExpired: false, notFound: false\n        };\n      });\n  }\n\n  function sleep(ms) {\n    return new Promise(function (resolve) { setTimeout(resolve, ms); });\n  }\n\n  // 整学期：优先一次请求全学期（zc=''），拿不到再逐周扫描\n  async function extractChengfang(term) {\n    var info = getTermAndWeek();\n    term = term || info.term;\n    var termSource = info.fromOverride ? '手动钉死'\n      : (info.fromDom ? '页面学期下拉框' : (info.fromMemory ? '记忆' : (info.guessed ? '日期推算' : 'URL/iframe')));\n    window.__cfjwTermSource = termSource;\n    // 实时探测到的学期，回写记忆，保证下次一致\n    try { if (!info.fromOverride && !info.fromMemory) localStorage.setItem('cfjw_term', term); } catch (e) { }\n    var MAX_WEEKS = 30;\n    var weekCourses = [];\n    var rawTotal = 0;      // 接口返回的原始记录数（含字段不认识的）\n    var sampleRow = null;  // 第一条原始记录（诊断字段名用）\n\n    function diag() {\n      var keys = sampleRow ? Object.keys(sampleRow).join(',') : '（接口未返回任何记录）';\n      try { console.log('[小爱课表提取器] 接口原始记录示例：', JSON.stringify(sampleRow, null, 2)); } catch (e) { }\n      return '接口返回了 ' + rawTotal + ' 条记录，但无法识别成课程。字段名：' + keys + '。完整示例记录已打印到 F12 控制台，请复制发给我';\n    }\n\n    function absorb(res) {\n      if (res.dataCount) {\n        rawTotal += res.dataCount;\n        if (!sampleRow && res.sample) sampleRow = res.sample;\n      }\n    }\n\n    // 快速路径：全学期一次拉取（河南师大等部署的行内 zc 是完整周次串）\n    var all = await fetchWeek(term, '');\n    if (all.sessionExpired) throw new Error('登录已失效，请重新登录教务系统后再提取');\n    if (all.notFound) throw new Error('未找到乘方课表接口（week.page 和 main.page 都不存在），你的学校可能不是乘方系统或路径不同');\n    absorb(all);\n    if (all.rows && all.rows.length) {\n      var hasMultiWeek = all.rows.some(function (c) { return c.weekNums.length > 1; });\n      if (hasMultiWeek) return { courses: all.rows, term: term };\n      weekCourses = all.rows; // 有数据但行内无完整周次串，继续逐周补全\n    } else if (rawTotal > 0) {\n      throw new Error(diag()); // 接口有记录却一条都解析不出 → 字段名不同，报诊断而非静默失败\n    }\n    await sleep(300);\n\n    // 逐周扫描：连续 3 周无课则停\n    var emptyRun = 0;\n    for (var week = 1; week <= MAX_WEEKS; week++) {\n      var res = await fetchWeek(term, week);\n      if (res.sessionExpired) throw new Error('登录已失效，请重新登录教务系统后再提取');\n      if (res.notFound) throw new Error('未找到乘方课表接口（week.page 和 main.page 都不存在），你的学校可能不是乘方系统或路径不同');\n      absorb(res);\n      if (res.rows === null) break;\n      if (res.rows.length) {\n        emptyRun = 0;\n        weekCourses = weekCourses.concat(res.rows);\n      } else {\n        emptyRun++;\n        if (rawTotal > 0 && emptyRun >= 2) throw new Error(diag()); // 有原始记录却全被过滤 = 字段不认\n      }\n      if (emptyRun >= 3) break;\n      await sleep(250 + Math.random() * 350); // 限速防 WAF\n    }\n    if (!weekCourses.length && rawTotal > 0) throw new Error(diag());\n    return { courses: weekCourses, term: term };\n  }\n\n  // 合并：同 课程名|教师|教室|星期|节次 的课程合并周次；并按真实起止时间构建节次表\n  function mergeCourses(rows) {\n    var map = {};\n    var order = [];\n    // 节次 → 真实起止时间（首节取最早 qssj，末节取最晚 jssj）\n    var timeStart = {}, timeEnd = {};\n    function normHM(t) {\n      var hm = t && String(t).match(/(\\d{1,2}):(\\d{2})/);\n      if (!hm) return '';\n      var hh = parseInt(hm[1], 10), mm = parseInt(hm[2], 10);\n      if (hh > 23 || mm > 59) return '';\n      return (hh < 10 ? '0' + hh : '' + hh) + ':' + (mm < 10 ? '0' + mm : '' + mm);\n    }\n    rows.forEach(function (c) {\n      var nums = parseJcdm(c.sections);\n      if (nums.length) {\n        var s = normHM(c.qssj), e = normHM(c.jssj);\n        if (s) { var k0 = nums[0]; if (!timeStart[k0] || s < timeStart[k0]) timeStart[k0] = s; }\n        if (e) { var k1 = nums[nums.length - 1]; if (!timeEnd[k1] || e > timeEnd[k1]) timeEnd[k1] = e; }\n      }\n      var key = [c.name, c.teacher, c.position, c.day, c.sections].join('|');\n      if (!map[key]) {\n        map[key] = {\n          name: c.name, teacher: c.teacher, position: c.position,\n          day: c.day, sections: c.sections, weeks: []\n        };\n        order.push(key);\n      }\n      c.weekNums.forEach(function (w) {\n        if (map[key].weeks.indexOf(w) < 0) map[key].weeks.push(w);\n      });\n    });\n    var merged = order.map(function (k) {\n      var c = map[k];\n      c.weeks.sort(function (a, b) { return a - b; });\n      return {\n        name: c.name, teacher: c.teacher, position: c.position,\n        day: c.day, sections: c.sections, weeks: compressWeeks(c.weeks)\n      };\n    });\n    var maxSec = 0;\n    merged.forEach(function (c) {\n      parseJcdm(c.sections).forEach(function (n) { if (n > maxSec) maxSec = n; });\n    });\n    maxPageSection = maxSec;\n    // 节次表：由课程行自带 qssj/jssj 推导（首节 start / 末节 end 为锚点，缺口按 45 分钟课 + 10 分钟课间补），\n    // 完全无法推导的节回退 DEFAULT_SECTIONS。不再使用 businessHours（拖拽网格背景块，非课时表）。\n    var sections = buildSectionsFromTimes(timeStart, timeEnd, maxSec);\n    return { courses: merged, sections: sections };\n  }\n\n  // 周次列表压缩：[5]→"5周"；[1..16]→"1-16周"；[1,3,5..]→"1-15周(单)"；其他→"1-3,7-8周"\n  function compressWeeks(weeks) {\n    if (!weeks.length) return '';\n    if (weeks.length === 1) return weeks[0] + '周';\n    var step2 = weeks.every(function (w, i) { return i === 0 || w === weeks[i - 1] + 2; });\n    if (step2 && weeks.length >= 3) {\n      return weeks[0] + '-' + weeks[weeks.length - 1] + '周(' + (weeks[0] % 2 === 1 ? '单' : '双') + ')';\n    }\n    var contiguous = weeks.every(function (w, i) { return i === 0 || w === weeks[i - 1] + 1; });\n    if (contiguous) return weeks[0] + '-' + weeks[weeks.length - 1] + '周';\n    return runJoin(weeks) + '周';\n  }\n\n  function runJoin(weeks) {\n    var parts = [];\n    var run = [weeks[0]];\n    for (var i = 1; i < weeks.length; i++) {\n      if (weeks[i] === run[run.length - 1] + 1) run.push(weeks[i]);\n      else {\n        parts.push(run.length > 1 ? run[0] + '-' + run[run.length - 1] : String(run[0]));\n        run = [weeks[i]];\n      }\n    }\n    parts.push(run.length > 1 ? run[0] + '-' + run[run.length - 1] : String(run[0]));\n    return parts.join(',');\n  }\n\n  function removeDuplicates(list) {\n    var seen = {};\n    return list.filter(function (c) {\n      var k = [c.name, c.teacher, c.position, c.day, c.sections, c.weeks].join('|');\n      if (seen[k]) return false;\n      seen[k] = true;\n      return true;\n    });\n  }\n\n  // ---- 兜底：解析页面 DOM（FullCalendar 周视图），递归扫同源 iframe ----\n  function collectDomDocs(d, depth, out) {\n    if (depth > 4) return;\n    out.push(d);\n    var frames;\n    try { frames = d.querySelectorAll('iframe,frame'); } catch (e) { return; }\n    for (var i = 0; i < frames.length; i++) {\n      var fd = null;\n      try { fd = frames[i].contentDocument; } catch (e) { }\n      if (fd && fd !== d) collectDomDocs(fd, depth + 1, out);\n    }\n  }\n\n  function extractFromDom() {\n    var out = [];\n    var info = getTermAndWeek();\n    var docs = [];\n    collectDomDocs(document, 0, docs);\n    var SEL = '.fc-event,[class*="kebiao"] .fc-content,[class*="course"]';\n    docs.forEach(function (d) {\n      var events;\n      try { events = d.querySelectorAll(SEL); } catch (e) { return; }\n      Array.prototype.forEach.call(events, function (el) {\n        var title = cleanText(el.textContent);\n        if (!title || title.length < 2) return;\n        var dm = title.match(/周([一二三四五六日天])/);\n        var sm = title.match(/(\\d{1,2})[:：]\\d{2}\\s*[-~至]\\s*(\\d{1,2})/);\n        if (!dm && !sm) return;\n        var dmMap = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7 };\n        var parts = title.split(/[\\s/|]+/).filter(Boolean);\n        out.push({\n          name: parts[0],\n          teacher: '',\n          position: parts[parts.length - 1] === parts[0] ? '' : parts[parts.length - 1],\n          day: dm ? dmMap[dm[1]] : 1,\n          sections: '1',\n          weeks: info.week + '周'\n        });\n      });\n    });\n    return removeDuplicates(out);\n  }\n\n  function extractSchedule() {\n    return extractChengfang().then(function (res) {\n      if (res.error) throw new Error(res.error);\n      var merged = mergeCourses(res.courses);\n      courses = removeDuplicates(merged.courses);\n      if (!courses.length) {\n        var dom = extractFromDom();\n        if (dom.length) {\n          courses = dom;\n          showToast('⚠ 接口未返回课程，已从页面渲染结果提取（建议核对周次）');\n        }\n      }\n      if (!courses.length) return { courses: [], schedule: {}, term: res.term, host: (location && location.hostname) || "" };\n      var sched = buildSchedule(courses);\n      if (merged.sections && merged.sections.length) sched.sections = merged.sections;\n      return { courses: courses, schedule: sched, term: res.term, host: (location && location.hostname) || "" };\n    });\n  }\n\n  // ---- UI ----\n  function copyToClipboard(text) {\n    if (navigator.clipboard && navigator.clipboard.writeText) {\n      navigator.clipboard.writeText(text).then(function () { }, function () { fallbackCopy(text); });\n    } else {\n      fallbackCopy(text);\n    }\n  }\n\n  function fallbackCopy(text) {\n    var ta = document.createElement('textarea');\n    ta.value = text;\n    ta.style.cssText = 'position:fixed;left:-9999px;top:0;';\n    document.body.appendChild(ta);\n    ta.select();\n    try { document.execCommand('copy'); } catch (e) { }\n    document.body.removeChild(ta);\n  }\n\n  function showToast(text, duration) {\n    var old = document.querySelector('#__cfjw_extract_toast');\n    if (old) old.remove();\n    var t = document.createElement('div');\n    t.id = '__cfjw_extract_toast';\n    t.textContent = text;\n    Object.assign(t.style, {\n      position: 'fixed', left: '50%', bottom: '80px',\n      transform: 'translateX(-50%)', zIndex: '999999999',\n      background: '#222', color: '#fff', padding: '12px 20px',\n      borderRadius: '10px', fontSize: '15px', maxWidth: '80vw',\n      boxShadow: '0 4px 15px rgba(0,0,0,.3)'\n    });\n    document.body.appendChild(t);\n    setTimeout(function () { t.remove(); }, duration || 4000);\n  }\n\n  function createButton() {\n    if (document.querySelector('#__cfjw_extract_btn')) return;\n    var btn = document.createElement('button');\n    btn.id = '__cfjw_extract_btn';\n    btn.textContent = '📚 提取课表';\n    Object.assign(btn.style, {\n      position: 'fixed', right: '20px', bottom: '20px',\n      zIndex: '999999999', padding: '12px 18px', border: 'none',\n      borderRadius: '10px', background: '#1677ff', color: '#fff',\n      fontSize: '15px', fontWeight: 'bold', cursor: 'pointer',\n      boxShadow: '0 4px 12px rgba(0,0,0,.25)'\n    });\n    btn.onclick = function () {\n      btn.disabled = true;\n      btn.textContent = '⏳ 提取整学期…';\n      extractSchedule().then(function (result) {\n        btn.disabled = false;\n        if (result && result.courses && result.courses.length) {\n          btn.textContent = '✅ 已复制 ' + result.courses.length + ' 条';\n          copyToClipboard(JSON.stringify(result, null, 2));\n          showToast('✅ 已复制 ' + result.courses.length + ' 条课表到剪贴板（学期 ' + result.term + '，来源：' + (window.__cfjwTermSource || '?') + '）');\n          showResult(result);\n        } else {\n          btn.textContent = '❌ 没找到课程';\n          showToast('❌ 学期 ' + ((result && result.term) || '?') + '（来源：' + (window.__cfjwTermSource || '?') + '）下未查到课程。请确认已在教务页面的「学期下拉框」选中目标学期后再提取；或右键这个「提取课表」按钮 → 手动钉死学期代码（如 ' + guessTerm() + '）', 10000);\n        }\n        setTimeout(function () { btn.textContent = '📚 提取课表'; }, 4000);\n      }).catch(function (e) {\n        btn.disabled = false;\n        btn.textContent = '❌ 提取出错';\n        showToast('❌ ' + (e.message || e));\n        setTimeout(function () { btn.textContent = '📚 提取课表'; }, 4000);\n      });\n    };\n    // 右键按钮：手动指定/清除学期代码（不用控制台的兜底入口）\n    btn.oncontextmenu = function (ev) {\n      ev.preventDefault();\n      var info = getTermAndWeek();\n      var pin = '';\n      try { pin = localStorage.getItem('cfjw_term_manual') || ''; } catch (e) { }\n      var v = prompt(\n        '手动钉死学期代码（xnxqdm，留空 = 取消钉死、按当前页面自动识别）。\\n' +\n        '当前将使用学期：' + info.term + (pin ? '（已钉死 ' + pin + '）' : '（自动识别）'),\n        pin || info.term);\n      if (v === null) return;\n      v = v.trim();\n      try {\n        if (v) { localStorage.setItem('cfjw_term_manual', v); localStorage.setItem('cfjw_term', v); }\n        else { localStorage.removeItem('cfjw_term_manual'); localStorage.removeItem('cfjw_term'); }\n      } catch (e) { }\n      showToast(v ? '✅ 已钉死学期 ' + v + '，左键点按钮开始提取' : '✅ 已取消钉死，将按当前页面自动识别学期');\n    };\n    document.body.appendChild(btn);\n  }\n\n  function showResult(result) {\n    var box = document.querySelector('#__cfjw_result_box');\n    if (box) box.remove();\n    box = document.createElement('div');\n    box.id = '__cfjw_result_box';\n    var list = result.courses.slice(0, 6);\n    var html = '<div style="font-weight:600;margin-bottom:6px">已提取 ' + result.courses.length + ' 条课程</div>';\n    list.forEach(function (c) {\n      html += '<div style="font-size:12px;opacity:.9;line-height:1.5">· ' +\n        c.name + ' · 周' + c.day + ' · 第' + c.sections + '节 · ' + (c.weeks || '?') + '</div>';\n    });\n    if (result.courses.length > list.length) {\n      html += '<div style="font-size:12px;opacity:.7;margin-top:4px">等 ' + result.courses.length + ' 条</div>';\n    }\n    var sched = result.schedule || {};\n    html += '<div style="font-size:12px;opacity:.85;margin-top:8px;border-top:1px solid #555;padding-top:6px">';\n    html += '学期=' + (result.term || '?') +\n      ' · 总周数=' + (sched.totalWeek || '?') +\n      ' · 上午/下午/晚上=' + (sched.morningNum != null ? (sched.morningNum + '/' + sched.afternoonNum + '/' + sched.nightNum) : '?');\n    html += '</div>';\n    var origin = (document.querySelector('script[data-cfjw-base]') || {}).dataset &&\n      document.querySelector('script[data-cfjw-base]').dataset.cfjwBase;\n    if (origin) {\n      html += '<a href="' + origin + '/#paste" target="_blank" ' +\n        'style="display:inline-block;margin-top:10px;padding:7px 14px;background:#1677ff;color:#fff;border-radius:6px;text-decoration:none;font-size:13px">↗ 打开小爱课表导入器粘贴</a>';\n    }\n    html += '<div style="font-size:11px;opacity:.6;margin-top:6px">课表 JSON 已复制到剪贴板，直接到导入器粘贴即可</div>';\n\n    box.innerHTML = html;\n    Object.assign(box.style, {\n      position: 'fixed', right: '20px', bottom: '80px',\n      zIndex: '999999999', padding: '14px 16px',\n      background: '#1f1f1f', color: '#fff',\n      borderRadius: '10px', maxWidth: '320px',\n      boxShadow: '0 6px 20px rgba(0,0,0,.4)',\n      fontSize: '13px', lineHeight: '1.5'\n    });\n    document.body.appendChild(box);\n    setTimeout(function () { if (box.parentNode) box.remove(); }, 15000);\n  }\n\n  // 油猴脚本会注入到每个同源 iframe（乘方门户通常 3 层：主页+桌面+课表），\n  // 嗅探器保留在所有框架（才能捕获课表 iframe 里的 xnxqdm 请求），\n  // 但按钮只在最外层窗口显示一个，避免右下角叠出多个。\n  function isTopFrame() {\n    try { return window.top === window.self; } catch (e) { return true; } // 跨域访问失败按顶层处理\n  }\n  if (isTopFrame()) {\n    if (document.readyState === 'loading') {\n      document.addEventListener('DOMContentLoaded', createButton);\n    } else {\n      createButton();\n    }\n  }\n\n  // 调试入口\n  window.__cfjwExtract = extractSchedule;\n})();\n`;

// 每个隔离器（isolate）的会话缓存：sid -> XiaoaiApi
// 注意：Cloudflare 在不同实例间不共享内存，会话过期后需重新 connect
const SESSIONS = new Map();

// ============ 工具 ============
function uuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID().toUpperCase().replace(/-/g, "");
  }
  return "xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === "x" ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  }).toUpperCase();
}

// 对小爱的 fetch：带超时 + 瞬时失败自动重试（网络抖动/连接重置/5xx）
function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function _fetchRetry(url, init, tries, timeoutMs) {
  tries = tries || 3;
  timeoutMs = timeoutMs || 20000;
  let lastErr;
  for (let i = 0; i < tries; i++) {
    let ctrl, to;
    try {
      ctrl = new AbortController();
      to = setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, timeoutMs);
      const r = await fetch(url, Object.assign({}, init, { signal: ctrl.signal }));
      clearTimeout(to);
      if (r.status >= 500 && i < tries - 1) { lastErr = new Error("HTTP " + r.status); await _sleep(400 * (i + 1)); continue; }
      return r;
    } catch (e) {
      clearTimeout(to);
      lastErr = e;
      if (i < tries - 1) await _sleep(400 * (i + 1));
    }
  }
  throw lastErr || new Error("fetch failed");
}

function pick(d) {
  if (!d || typeof d !== "object") return null;
  for (let i = 1; i < arguments.length; i++) {
    const k = arguments[i];
    if (k in d && d[k] !== null && d[k] !== "") return d[k];
  }
  return null;
}

// ---------- 周次 ----------
function expandWeeks(text) {
  const weeks = [];
  RANGE_RE.lastIndex = 0;
  let m;
  while ((m = RANGE_RE.exec(String(text))) !== null) {
    if (m[4]) {
      weeks.push(parseInt(m[4], 10));
      continue;
    }
    const start = parseInt(m[1], 10);
    const end = parseInt(m[2], 10);
    const parity = m[3];
    let rng = [];
    for (let w = start; w <= end; w++) rng.push(w);
    if (parity === "单") rng = rng.filter(w => w % 2 === 1);
    else if (parity === "双") rng = rng.filter(w => w % 2 === 0);
    weeks.push(...rng);
  }
  return weeks.join(",");
}

function compressWeeks(weeksStr) {
  let ws;
  try {
    ws = [...new Set(String(weeksStr).split(",").filter(x => x.trim()).map(x => parseInt(x, 10)))].sort((a, b) => a - b);
  } catch (e) { return String(weeksStr); }
  if (!ws.length) return "";
  if (ws.length >= 3 && ws.every((w, i) => i === 0 || w - ws[i - 1] === 2)) {
    return `${ws[0]}-${ws[ws.length - 1]}周(${ws[0] % 2 === 1 ? "单" : "双"})`;
  }
  if (ws.length >= 2 && ws.every((w, i) => i === 0 || w - ws[i - 1] === 1)) {
    return `${ws[0]}-${ws[ws.length - 1]}周`;
  }
  const parts = [];
  let run = [ws[0]];
  for (let i = 1; i < ws.length; i++) {
    if (ws[i] === run[run.length - 1] + 1) run.push(ws[i]);
    else {
      parts.push(run.length > 1 ? `${run[0]}-${run[run.length - 1]}` : String(run[0]));
      run = [ws[i]];
    }
  }
  parts.push(run.length > 1 ? `${run[0]}-${run[run.length - 1]}` : String(run[0]));
  return "第" + parts.join("、") + "周";
}

// ---------- 课程字段 ----------
function parseDay(v) {
  if (v === null || v === undefined) throw new Error("缺少星期字段 day");
  if (typeof v === "number") return v;
  const s = String(v).trim();
  if (/^\d+$/.test(s)) {
    const d = parseInt(s, 10);
    if (d < 1 || d > 7) throw new Error(`星期 day=${d} 超出 1-7`);
    return d;
  }
  const m = /[一二三四五六七天日]/.exec(s);
  if (!m) throw new Error(`无法识别星期 ${JSON.stringify(v)}`);
  return WEEKDAY_MAP[m[0]];
}

function parseSections(v) {
  if (v === null || v === undefined) throw new Error("缺少节次字段 sections");
  let nums = [];
  if (Array.isArray(v)) {
    nums = v.map(x => parseInt(String(x).trim(), 10));
  } else {
    const s = String(v);
    const re = /(\d+)\s*[-~至]\s*(\d+)|(\d+)/g;
    let m;
    while ((m = re.exec(s)) !== null) {
      if (m[3]) nums.push(parseInt(m[3], 10));
      else {
        const a = parseInt(m[1], 10), b = parseInt(m[2], 10);
        for (let i = a; i <= b; i++) nums.push(i);
      }
    }
  }
  nums = [...new Set(nums.filter(n => n > 0))].sort((a, b) => a - b);
  if (!nums.length) throw new Error(`无法识别节次 ${JSON.stringify(v)}`);
  return nums.join(",");
}

function parseWeeks(v) {
  if (v === null || v === undefined) throw new Error("缺少周次字段 weeks");
  let w;
  if (Array.isArray(v)) w = v.map(x => parseInt(x, 10)).join(",");
  else {
    w = expandWeeks(String(v));
    if (!w) w = String(v).trim();
  }
  if (!w || !/^\d+(,\d+)*$/.test(w)) throw new Error(`无法识别周次 ${JSON.stringify(v)}`);
  return w;
}

function normalizeCourses(raw) {
  let items = [];
  if (Array.isArray(raw)) items = raw;
  else if (raw && typeof raw === "object") {
    for (const k of ["courses", "courseInfos", "list", "data", "result", "课表", "课程"]) {
      const v = raw[k];
      if (Array.isArray(v)) { items = v; break; }
      if (v && typeof v === "object") {
        for (const k2 of ["courses", "courseInfos", "list", "data"]) {
          if (Array.isArray(v[k2])) { items = v[k2]; break; }
        }
        if (items.length) break;
      }
    }
    if (!items.length && pick(raw, "name", "courseName", "课程") != null) items = [raw];
  }
  const courses = [], errors = [];
  const colorMap = {};
  let paletteIdx = 0;
  items.forEach((it, idx) => {
    try {
      if (!it || typeof it !== "object") throw new Error("不是 JSON 对象");
      let name = pick(it, "name", "courseName", "course", "课程名", "课程", "课程名称", "title", "subject");
      if (!name) throw new Error("缺少课程名 name");
      name = String(name).trim();
      const teacher = String(pick(it, "teacher", "teacherName", "teacher_name", "老师", "教师") || "").trim();
      const position = String(pick(it, "position", "place", "room", "location", "地点", "教室", "位置") || "").trim();
      const day = parseDay(pick(it, "day", "weekday", "weekDay", "dayOfWeek", "day_of_week", "星期", "周几"));
      const sections = parseSections(pick(it, "sections", "section", "sectionList", "jie", "节次", "节数"));
      const weeks = parseWeeks(pick(it, "weeks", "week", "zhou", "周次", "周"));
      if (!(name in colorMap)) {
        colorMap[name] = paletteIdx % 12;
        paletteIdx++;
      }
      courses.push({
        name, teacher, position,
        day, sections, weeks,
        styleIdx: colorMap[name],
        weeksText: compressWeeks(weeks),
      });
    } catch (e) {
      errors.push(`第 ${idx + 1} 条：${e.message}`);
    }
  });
  return [courses, errors];
}

function toInt(v) {
  if (v === null || v === undefined) return null;
  const n = parseInt(String(v).trim(), 10);
  return isNaN(n) ? null : n;
}

function normalizeSchedule(raw) {
  const sched = { morningNum: null, afternoonNum: null, nightNum: null, totalWeek: null, sections: null, host: null };
  if (!raw || typeof raw !== "object") return sched;
  let src = raw.schedule || raw.setting;
  if (!src || typeof src !== "object") src = {};
  sched.host = String(raw.host || (src.host) || "").trim() || null;

  const pickAll = function () {
    for (const d of [src, raw]) {
      for (let i = 0; i < arguments.length; i++) {
        const k = arguments[i];
        if (k in d && d[k] !== null && d[k] !== "") return d[k];
      }
    }
    return null;
  };

  sched.morningNum = toInt(pickAll("morningNum", "morning_num", "上午节数", "上午"));
  sched.afternoonNum = toInt(pickAll("afternoonNum", "afternoon_num", "下午节数", "下午"));
  sched.nightNum = toInt(pickAll("nightNum", "night_num", "eveningNum", "晚上节数", "晚上"));
  sched.totalWeek = toInt(pickAll("totalWeek", "total_week", "总周数", "周数"));
  let secs = pickAll("sections", "sectionTimes", "节次时间", "时间表");
  if (secs !== null && secs !== undefined) {
    if (typeof secs === "string") {
      try { secs = JSON.parse(secs); } catch (e) { secs = null; }
    }
    if (Array.isArray(secs)) {
      const out = [];
      for (const it of secs) {
        if (!it || typeof it !== "object") continue;
        let i = it.i != null ? it.i : (it.index != null ? it.index : it["节次"]);
        let s = it.s != null ? it.s : (it.start != null ? it.start : (it.sTime != null ? it.sTime : it["开始"]));
        let e = it.e != null ? it.e : (it.end != null ? it.end : (it.eTime != null ? it.eTime : it["结束"]));
        const ni = parseInt(i, 10);
        if (isNaN(ni) || s == null) continue;
        out.push({ i: ni, s: String(s).trim(), e: e == null ? "" : String(e).trim() });
      }
      if (out.length) sched.sections = out;
    }
  }
  return sched;
}

// ---------- 凭据识别 ----------
function extractCredentials(text) {
  const looksLikeAuth = s => typeof s === "string" && (s.startsWith("DO-TOKEN") || s.startsWith("AO-TOKEN"));
  let raw = null;
  try {
    raw = JSON.parse(text);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) raw = null;
  } catch (e) { raw = null; }
  const jsonGet = function () {
    if (raw) {
      for (let i = 0; i < arguments.length; i++) {
        const k = arguments[i];
        if (k in raw && raw[k] !== null && raw[k] !== "") return String(raw[k]).trim();
      }
    }
    return null;
  };
  const regexFind = function () {
    for (let i = 0; i < arguments.length; i++) {
      const n = arguments[i];
      const m = new RegExp(`["']?${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']?\\s*[:=]\\s*["']([^"']+)["']`).exec(text);
      if (m) return m[1].trim();
    }
    return null;
  };

  let appId = jsonGet("appId", "app_id", "appid") || regexFind("appId", "app_id", "appid");
  let serviceToken = jsonGet("serviceToken", "service_token", "accessToken", "access_token")
    || regexFind("serviceToken", "service_token", "accessToken", "access_token");
  let deviceId = jsonGet("deviceId", "device_id", "deviceid", "deviceIdNew")
    || regexFind("deviceId", "device_id", "deviceid", "deviceIdNew");

  const auth = jsonGet("authorization", "Authorization") || regexFind("authorization", "Authorization");
  if (auth && looksLikeAuth(auth)) {
    serviceToken = auth;
    if (!appId) {
      const m = /(?:dev_)?app_id:\s*([^,\s]+)/i.exec(auth);
      if (m) appId = m[1].trim();
    }
    if (!deviceId) {
      const m = /scope_data:([A-Za-z0-9+/=]+)/.exec(auth);
      if (m) {
        try {
          const json = atob(m[1]);
          const scope = JSON.parse(json);
          if (scope && scope.d) deviceId = String(scope.d);
        } catch (e) { /* 忽略 */ }
      }
    }
  }
  return [appId, serviceToken, deviceId];
}

// ============ XiaoaiApi ============
class XiaoaiApi {
  constructor(appId, serviceToken, deviceId) {
    this.appId = appId;
    this.serviceToken = serviceToken;
    this.deviceId = deviceId;
  }

  _authorization() {
    if (this.serviceToken.startsWith("DO-TOKEN") || this.serviceToken.startsWith("AO-TOKEN")) {
      return this.serviceToken;
    }
    const json = JSON.stringify({ d: this.deviceId });
    const scope = btoa(json);
    return `AO-TOKEN-V1 dev_app_id:${this.appId},access_token:${this.serviceToken},scope_data:${scope}`;
  }

  _headers(withRequestId) {
    const h = {
      "Authorization": this._authorization(),
      "Content-Type": "application/json",
      "Accept": "*/*",
      "User-Agent": "Mozilla/5.0 (Linux; Android 16; wv) AppleWebKit/537.36 Mobile Safari/537.36",
      "X-Requested-With": "com.xiaomi.aischedule",
      "Origin": "https://i.ai.mi.com",
      "Referer": "https://i.ai.mi.com/h5/precache/ai-schedule/",
    };
    if (withRequestId) h["RequestId"] = uuid();
    return h;
  }

  async _http(method, url, body, withRequestId) {
    const init = { method, headers: this._headers(withRequestId) };
    if (body !== undefined && body !== null) init.body = JSON.stringify(body);
    let resp;
    try {
      resp = await _fetchRetry(url, init);
    } catch (e) {
      throw new Error(`网络请求失败：${e.message}`);
    }
    const text = await resp.text();
    if (resp.status === 401 || resp.status === 500) {
      throw new Error(`认证失效（HTTP ${resp.status}），请重新在小爱课表页面复制凭据`);
    }
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
    }
    let data;
    try { data = JSON.parse(text); } catch (e) {
      throw new Error(`响应不是 JSON：${text.slice(0, 200)}`);
    }
    const code = data.code !== undefined ? data.code : -1;
    if (code !== 0 && code !== 200) {
      throw new Error(`接口返回 code=${code} ${data.desc || data.msg || ""}`);
    }
    return data;
  }

  // 切换"当前使用课表"（小爱读写都绑定当前课表，导到别的课表前必须先切过去）
  async switchTable(fromCtId, toCtId) {
    if (fromCtId === toCtId) return { skipped: true };
    const h = {
      "Authorization": this._authorization(),
      "Content-Type": "application/json",
      "Accept": "*/*",
      "User-Agent": "Mozilla/5.0 (Linux; Android 16; wv) AppleWebKit/537.36 Mobile Safari/537.36",
      "X-Requested-With": "com.miui.voiceassist",
      "Origin": "https://i.xiaomixiaoai.com",
      "Referer": "https://i.xiaomixiaoai.com/h5/precache/ai-schedule/",
      "RequestId": uuid(),
    };
    let resp;
    try {
      resp = await _fetchRetry(`${SWITCH_BASE}/table_switch`, {
        method: "POST", headers: h,
        body: JSON.stringify({ fromCtId, toCtId, sourceName: "course-app-miui" }),
      });
    } catch (e) { throw new Error(`切换课表网络失败：${e.message}`); }
    const text = await resp.text();
    let data; try { data = JSON.parse(text); } catch (e) { throw new Error(`切换课表响应非 JSON：${text.slice(0, 160)}`); }
    const code = data.code !== undefined ? data.code : -1;
    if (code !== 0 && code !== 200) throw new Error(`切换课表失败 code=${code} ${data.desc || data.msg || ""}`);
    return data;
  }

  listTables() {
    const q = new URLSearchParams({
      requestId: uuid(),
      sourceName: "course-app-aiSchedule",
    }).toString();
    return this._http("GET", `${BASE}/tables?${q}`).then(data => {
      const out = [];
      for (const t of (data.data || [])) {
        out.push({ id: t.id, name: t.name || "未命名", current: t.current || 0 });
      }
      return out;
    });
  }

  getTable(ctId) {
    const q = new URLSearchParams({
      ctId: String(ctId),
      requestId: uuid(),
      sourceName: "course-app-aiSchedule",
    }).toString();
    return this._http("GET", `${BASE}/table?${q}`).then(data => data.data || {});
  }

  createTable(name) {
    return this._http("POST", `${BASE}/table`, {
      name, current: 0, sourceName: "course-app-aiSchedule",
    }).then(data => parseInt(data.data, 10));
  }

  async batchCreateCourses(ctId, courses) {
    const payload = courses.map(c => ({
      name: c.name || "",
      position: c.position || "",
      teacher: c.teacher || "",
      day: parseInt(c.day, 10),
      sections: c.sections || "",
      style: c.style || `{"color":"${STYLES[0][0]}","background":"${STYLES[0][1]}"}`,
      weeks: c.weeks || "",
    }));
    const total = payload.length;
    const rawResponses = [];
    for (let i = 0; i < total; i += 100) {
      const chunk = payload.slice(i, i + 100);
      const data = await this._http("POST", `${BASE}/courseInfos`, {
        ctId, courses: chunk, sourceName: "course-app-aiSchedule",
      }, true);
      rawResponses.push({
        offset: i,
        code: data && data.code,
        status: data && data.status,
        desc: data && (data.desc || data.msg),
        dataKeys: data && data.data ? Object.keys(data.data) : [],
      });
      if (data.status === -1) {
        throw new Error(`批量创建失败：课程参数不合法（第 ${i + 1} 条起）`);
      }
    }
    return { total, rawResponses };
  }

  deleteCourse(ctId, cId) {
    return this._http("DELETE", `${BASE}/courseInfo`, {
      ctId, cId, sourceName: "course-app-aiSchedule",
    });
  }

  async updateTableSettings(ctId, name, schedule) {
    const cur = await this.getTable(ctId) || {};
    let setting = cur.setting || {};
    if (typeof setting !== "object" || setting === null) setting = {};
    for (const k of ["morningNum", "afternoonNum", "nightNum", "totalWeek"]) {
      const v = schedule[k];
      if (v !== null && v !== undefined && v !== "") {
        const n = parseInt(v, 10);
        if (!isNaN(n)) setting[k] = n;
      }
    }
    const sections = schedule.sections;
    if (sections && Array.isArray(sections)) {
      setting.sections = JSON.stringify(sections);
    }
    const tableName = name || cur.name || "未命名";
    return this._http("PUT", `${BASE}/table`, {
      ctId, name: tableName, sourceName: "course-app-aiSchedule", setting,
    });
  }
}

// ============ 响应辅助 ============
function ok(data) {
  return json({ ok: true, data });
}
function fail(error, extra) {
  return json({ ok: false, error: String(error || "请求失败"), ...(extra || {}) });
}
function json(obj) {
  return new Response(JSON.stringify(obj), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Sid",
    },
  });
}

function getSession(sid) { return SESSIONS.get(sid); }
function setSession(sid, api) { SESSIONS.set(sid, api); }
function requireApi(sid) {
  const api = getSession(sid);
  if (!api) throw new Error("未连接，请先点「连接」按钮");
  return api;
}

// 油猴脚本头部（乘方教务版）
function buildUserscript(jsBody) {
  return `// ==UserScript==
// @name         乘方教务课表提取器 - 标准格式
// @namespace    https://tampermonkey.net/
// @version      1.4.1
// @description  从「小爱课表导入器·乘方教务版」内置提供：登录后任意教务页面出现「提取课表」按钮；节次时间按课程行 qssj/jssj 推导（businessHours 嗅探已废弃）
// @match        *://*.edu.cn/*
// @match        *://*/*new/*
// @run-at       document-idle
// ==/UserScript==

${jsBody}`;
}

// 访问计数：优先 KV（绑定名 COUNTER_KV），否则退化为 isolate 内存计数
async function bumpVisit(env) {
  try {
    if (env && env.COUNTER_KV && typeof env.COUNTER_KV.get === "function") {
      const cur = parseInt(await env.COUNTER_KV.get("visits") || "0", 10) || 0;
      const next = cur + 1;
      await env.COUNTER_KV.put("visits", String(next));
      return next;
    }
  } catch (e) { /* KV 未配置或失败，退回内存 */ }
  VISIT_MEM += 1;
  return VISIT_MEM;
}
let VISIT_MEM = 0;

// AI 兜底解析：调 OpenAI 兼容接口，把课表文字转标准 JSON
async function aiParse(text, env) {
  const key = env && env.AI_API_KEY;
  if (!key) {
    throw new Error("服务端未配置 AI 兜底解析（AI_API_KEY）。建议改用教务页书签提取，或按提示格式粘贴课程 JSON。");
  }
  const base = (env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = env.AI_MODEL || "gpt-4o-mini";
  const sys = "你是中国大学课程表解析器。用户会粘贴教务系统课表页面的文字或HTML。请输出纯JSON（不要markdown代码块），格式：" +
    '{"courses":[{"name":"课程名","teacher":"教师","position":"教室","day":1,"sections":"1,2","weeks":"1-16周(单)"}],' +
    '"schedule":{"morningNum":4,"afternoonNum":4,"nightNum":0,"totalWeek":16}}。' +
    "day为1-7（周一到周日）；sections为逗号分隔的节次数字；weeks格式如 1-16周、1-16周(单)、1,3,5周。无法识别的行跳过。只输出JSON。";
  const resp = await fetch(base + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: String(text).slice(0, 20000) },
      ],
    }),
  });
  if (!resp.ok) throw new Error("AI 接口返回 HTTP " + resp.status);
  const data = await resp.json();
  let content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";
  content = content.replace(/```json|```/g, "").trim();
  const s = content.indexOf("{"), e = content.lastIndexOf("}");
  if (s < 0 || e <= s) throw new Error("AI 未返回有效 JSON");
  let obj;
  try { obj = JSON.parse(content.slice(s, e + 1)); } catch (ex) {
    throw new Error("AI 返回的 JSON 解析失败：" + ex.message);
  }
  const [courses, errors] = normalizeCourses(obj);
  if (!courses.length) throw new Error("AI 解析后没有有效课程：" + errors.slice(0, 3).join("；"));
  const schedule = obj && obj.schedule ? normalizeSchedule(obj) : null;
  return { courses, schedule, errors };
}

// ============ 路由 ============
async function handleApi(method, path, request, sid, env) {
  // CORS 预检
  if (method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Sid",
      },
    });
  }

  // GET 路由
  if (method === "GET") {
    if (path === "/api/ping") {
      return ok({ time: new Date().toUTCString().slice(17, 25), share: true });
    }
    if (path === "/api/visit") {
      return ok({ visits: await bumpVisit(env) });
    }
    if (path === "/api/state") {
      const api = getSession(sid);
      return ok({ connected: !!api, creds: null, publicUrl: null, port: null });
    }
    if (path === "/api/jiaowu_extractor.js") {
      const body = (env && env.CF_JS) || CF_EXTRACTOR_JS || "// 未配置提取脚本";
      return new Response(body, {
        headers: {
          "Content-Type": "application/x-javascript; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-cache",
        },
      });
    }
    if (path === "/api/jiaowu_userscript.js") {
      const body = (env && env.CF_JS) || CF_EXTRACTOR_JS || "";
      return new Response(buildUserscript(body), {
        headers: {
          "Content-Type": "application/x-javascript; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-cache",
        },
      });
    }
    if (path === "/api/tables") {
      try {
        const api = requireApi(sid);
        const tables = await api.listTables();
        return ok(tables);
      } catch (e) { return fail(e.message); }
    }
    if (path === "/api/table") {
      try {
        const api = requireApi(sid);
        const url = new URL(request.url);
        const ctId = parseInt(url.searchParams.get("ctId"), 10);
        if (isNaN(ctId)) return fail("缺少 ctId 参数");
        const data = await api.getTable(ctId);
        const courses = data.courses || [];
        const out = [];
        for (const c of courses) {
          const cid = c.id != null ? c.id : c.cId;
          if (cid === null || cid === undefined) continue;
          out.push({
            id: cid,
            name: c.name || "",
            teacher: c.teacher || "",
            position: c.position || "",
            day: c.day,
            sections: c.sections || "",
            weeks: c.weeks || "",
            weeksText: compressWeeks(c.weeks || ""),
          });
        }
        out.sort((a, b) => (a.day || 0) - (b.day || 0)
          || parseInt(String(a.sections).split(",")[0] || "0", 10) - parseInt(String(b.sections).split(",")[0] || "0", 10));
        return ok({ courses: out });
      } catch (e) { return fail(e.message); }
    }
    if (path === "/api/jiaowu_captcha" || path === "/api/jiaowu_login" || path === "/api/jiaowu_fetch") {
      return fail("公网部署不支持教务直登，请改用「📚 复制提取书签」按钮在教务页面提取课表");
    }
    return fail("not found");
  }

  // POST 路由
  if (method === "POST") {
    let body;
    try { body = await request.json(); } catch (e) { body = {}; }

    if (path === "/api/connect") {
      try {
        const raw = String(body.raw || "");
        let appId = String(body.appId || "").trim();
        let token = String(body.serviceToken || "").trim();
        let device = String(body.deviceId || "").trim();
        if (raw) {
          const [e1, e2, e3] = extractCredentials(raw);
          appId = appId || e1 || "";
          token = token || e2 || "";
          device = device || e3 || "";
        }
        const credsOut = { appId: appId || "", serviceToken: token || "", deviceId: device || "" };
        if (!appId || !token || !device) {
          const missing = [];
          if (!appId) missing.push("appId");
          if (!token) missing.push("serviceToken");
          if (!device) missing.push("deviceId");
          return fail(`凭据不完整，缺少：${missing.join("、")}（可把整段 Debug JSON 直接粘贴到上方大框自动提取）`, { extracted: credsOut });
        }
        try {
          const api = new XiaoaiApi(appId, token, device);
          const tables = await api.listTables();
          setSession(sid, api);
          return ok({ tables, extracted: credsOut });
        } catch (e) {
          return fail(e.message, { extracted: credsOut });
        }
      } catch (e) { return fail(e.message); }
    }

    if (path === "/api/create_table") {
      try {
        const api = requireApi(sid);
        const name = String(body.name || "").trim();
        if (!name) return fail("课表名不能为空");
        const ctId = await api.createTable(name);
        return ok({ ctId });
      } catch (e) { return fail(e.message); }
    }

    if (path === "/api/parse") {
      try {
        const text = String(body.text || "").trim();
        if (!text) return fail("请先粘贴课程 JSON");
        let s = -1, e = -1;
        for (const [open, close] of [["[", "]"], ["{", "}"]]) {
          const i = text.indexOf(open);
          const j = text.lastIndexOf(close);
          if (i >= 0 && j > i && (s === -1 || i < s)) { s = i; e = j; }
        }
        if (s === -1) return fail("未找到 JSON 内容（需要以 [ 或 { 开头的数组/对象）");
        let raw;
        try { raw = JSON.parse(text.slice(s, e + 1)); } catch (ex) {
          return fail(`JSON 解析失败：${ex.message}`);
        }
        const [courses, errors] = normalizeCourses(raw);
        if (!courses.length) return fail(`没有解析出任何有效课程：${errors.slice(0, 3).join("；")}`);
        const schedule = raw && typeof raw === "object" && !Array.isArray(raw) ? normalizeSchedule(raw) : null;
        return ok({ courses, errors, count: courses.length, schedule });
      } catch (e) { return fail(e.message); }
    }

    if (path === "/api/ai_parse") {
      try {
        const text = String(body.text || "").trim();
        if (!text) return fail("请先粘贴课表内容");
        const r = await aiParse(text, env);
        return ok(r);
      } catch (e) { return fail(e.message); }
    }

    if (path === "/api/import") {
      // phase 必须声明在 try 之外：832 行的 catch 与 try 是平级作用域，
      // 放里面的话 catch 永远读不到它，任何真实错误都会被 ReferenceError 吞掉。
      let phase = "参数校验";
      try {
        const api = requireApi(sid);
        const ctId = parseInt(body.ctId, 10);
        if (isNaN(ctId)) return fail("缺少 ctId");
        const courses = body.courses || [];
        if (!courses.length) return fail("没有课程可导入");
        // 小爱读写绑定"当前使用课表"：目标不是当前就先切过去（导后保持该课表为在用，下拉选择才有意义）
        phase = "切换当前课表";
        let switched = false, switchErr = null;
        try {
          const tbls = await api.listTables();
          const cur = tbls.find(t => t.current);
          const prevCurrent = cur ? cur.id : null;
          if (prevCurrent != null && prevCurrent !== ctId) {
            await api.switchTable(prevCurrent, ctId);
            switched = true;
          }
        } catch (e) { switchErr = e.message; }
        for (const c of courses) {
          const [fg, bg] = STYLES[(c.styleIdx || 0) % 12];
          c.style = `{"color":"${fg}","background":"${bg}"}`;
        }
        let deleted = 0;
        if (body.clearFirst) {
          phase = "清空旧课程";
          const existing = (await api.getTable(ctId)).courses || [];
          for (const c of existing) {
            const cid = c.id != null ? c.id : c.cId;
            if (cid !== null && cid !== undefined) {
              await api.deleteCourse(ctId, cid);
              deleted++;
            }
          }
        }
        let n, rawResponses;
        phase = "写入课程";
        try {
          const r = await api.batchCreateCourses(ctId, courses);
          n = r.total; rawResponses = r.rawResponses;
        } catch (e) {
          const em = (e && e.message) || String(e);
          if (/601|overlap/i.test(em)) {
            return fail("导入被小爱拒绝：课程时间相互重叠（code 601）。该课表里已有课程，请勾选「导入前清空该课表」后重试（会先删掉课表现有课程），或改导入到一个空课表；若已勾选仍报此错，说明本次这些课里有两门占用了相同的 星期+节次+周次，小爱不允许重叠。", { overlap: true });
          }
          throw e;
        }
        let synced = false;
        let syncErr = null;
        const schedule = body.schedule;
        if (body.syncSettings && schedule && typeof schedule === "object") {
          const hasValue = Object.values(schedule).some(v => v !== null && v !== undefined && v !== "");
          if (hasValue) {
            phase = "同步课表设置";
            try {
              await api.updateTableSettings(ctId, null, schedule);
              synced = true;
            } catch (e) {
              syncErr = e.message;
            }
          }
        }
        // 不在服务端额外回读（前端导入后会自己再查一次，避免多一次到小爱的请求拖慢/卡住导入）
        return ok({
          imported: n, deleted, synced, syncError: syncErr,
          ctId, switched, switchError: switchErr, courseInfos: rawResponses,
        });
      } catch (e) { return fail((phase ? ("[" + phase + "] ") : "") + ((e && e.message) || e)); }
    }

    if (path === "/api/delete") {
      try {
        const api = requireApi(sid);
        const ctId = parseInt(body.ctId, 10);
        if (isNaN(ctId)) return fail("缺少 ctId");
        const cIds = body.cIds || [];
        for (const cid of cIds) {
          await api.deleteCourse(ctId, parseInt(cid, 10));
        }
        return ok({ deleted: cIds.length });
      } catch (e) { return fail(e.message); }
    }

    if (path === "/api/clear") {
      try {
        const api = requireApi(sid);
        const ctId = parseInt(body.ctId, 10);
        if (isNaN(ctId)) return fail("缺少 ctId");
        const existing = (await api.getTable(ctId)).courses || [];
        for (const c of existing) {
          const cid = c.id != null ? c.id : c.cId;
          if (cid !== null && cid !== undefined) {
            await api.deleteCourse(ctId, cid);
          }
        }
        return ok({ deleted: existing.length });
      } catch (e) { return fail(e.message); }
    }

    if (path === "/api/jiaowu_login" || path === "/api/jiaowu_fetch") {
      return fail("公网部署不支持教务直登，请改用「📚 复制提取书签」按钮");
    }

    return fail("not found");
  }

  return fail(`不支持 ${method} 请求`);
}

// ============ Pages Function 入口 ============
// catch-all 路由：/api/[[path]] 匹配 /api/ 下任意深度路径
async function dispatch(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  const sid = request.headers.get("X-Sid") || "default";
  try {
    return await handleApi(request.method, path, request, sid, env);
  } catch (e) {
    return fail(`服务器内部错误：${e.message}`);
  }
}

export async function onRequestGet(context) {
  return dispatch(context.request, context.env, context.ctx);
}
export async function onRequestPost(context) {
  return dispatch(context.request, context.env, context.ctx);
}
export async function onRequestOptions(context) {
  return dispatch(context.request, context.env, context.ctx);
}
