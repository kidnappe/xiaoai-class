// 前端 & 提取脚本逻辑测试（无浏览器环境模拟）
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

let pass = 0, failn = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { failn++; console.log('  ✘ ' + name + (detail ? '  → ' + detail : '')); }
}

// ---- 最小 DOM 模拟 ----
const els = {};
function makeEl(id) {
  return {
    id, value: '', textContent: '', innerHTML: '', checked: false, disabled: false,
    text: '', href: '', src: '', style: {}, dataset: {},
    classList: { add() {}, remove() {}, contains() { return false; } },
    addEventListener() {}, appendChild() {}, scrollIntoView() {}, click() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    insertBefore() {}, closest() { return { remove() {} }; },
  };
}
global.window = global;
global.location = { href: 'https://jxgl.wyu.edu.cn/new/student/xsgrkb/week.page?xnxqdm=202601&zc=5', origin: 'https://jxgl.wyu.edu.cn', pathname: '/new/student/xsgrkb/week.page' };
global.document = {
  hidden: true, readyState: 'complete', body: makeEl('body'), firstChild: null,
  getElementById(id) { return els[id] || (els[id] = makeEl(id)); },
  createElement(tag) { return makeEl('new-' + tag); },
  addEventListener() {},
  querySelector(sel) { if (sel === '#netBanner') return null; return null; },
  querySelectorAll() { return []; },
  createTreeWalker() { return { nextNode() { return null; } }; },
};
global.NodeFilter = { SHOW_TEXT: 4 };
global.localStorage = { getItem() { return null; }, setItem() {} };
global.fetch = async (url, opt) => {
  // 模拟教务接口：返回乘方 getCalendarWeekDatas 格式
  if (String(url).includes('getCalendarWeekDatas')) {
    const rows = [
      { kcmc: '高等数学A', xq: '1', jcdm2: '01,02', jxcdmc: 'D201', teaxms: '张三', qssj: '2026-08-24 08:30', zc: 5 },
      { kcmc: '大学英语', xq: '2', jcdm: '0304', zdjxcdmc: 'B302', teaxm: '李四', qsrq: '2026-08-25', jsrq: '2026-08-25', zc: 5 },
      { kcmc: '选课阶段通知', xq: '1', jcdm2: '05', zc: 5 },
    ];
    return { json: async () => ({ code: 0, data: rows }), text: async () => JSON.stringify({ code: 0, data: rows }), status: 200 };
  }
  if (String(url).includes('getDatesOfWeek')) {
    return { json: async () => [
      { xqmc: '1', rq: '2026-08-24' }, { xqmc: '2', rq: '2026-08-25' }, { xqmc: '3', rq: '2026-08-26' },
      { xqmc: '4', rq: '2026-08-27' }, { xqmc: '5', rq: '2026-08-28' }, { xqmc: '6', rq: '2026-08-29' }, { xqmc: '7', rq: '2026-08-30' },
    ]};
  }
  if (String(url).includes('/api/')) {
    return { json: async () => ({ ok: true, data: { visits: 1 } }) };
  }
  return { status: 200, text: async () => '', json: async () => ({}) };
};

// ---- 载入 index.html 的内联脚本并执行（顶层 await 转 IIFE）----
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf-8');
const inline = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1];
// 提供全局 $ / 状态，模拟页面加载完成后的可调用函数集
const sandbox = {};
const fn = new Function('window', 'document', 'location', 'navigator', 'localStorage', 'fetch', 'setInterval', 'NodeFilter',
  inline + `
  return { parseJcdm, cfRowsToCourses, normalizeWeeks, compressWeekNums, mergeWeekCourses, localParseSchedule, buildSchedule, jiaowuUrl, makeBookmarklet, isHtuHost, expandWeekInput, findConflicts, detectSeason, parseTimetableGrid };`);
const api = fn(global.window, global.document, global.location, global.navigator, global.localStorage, global.fetch, () => 0, global.NodeFilter);

// 1. 节次代码解析（乘方教务三种格式）
check('parseJcdm "01,02"', api.parseJcdm('01,02').join(',') === '1,2', api.parseJcdm('01,02'));
check('parseJcdm "0304"', api.parseJcdm('0304').join(',') === '3,4', api.parseJcdm('0304'));
check('parseJcdm "9-10"', api.parseJcdm('9-10').join(',') === '9,10', api.parseJcdm('9-10'));
check('parseJcdm 数组', api.parseJcdm([5, 6, 7]).join(',') === '5,6,7');

// 2. 乘方原始行 → 标准课程
{
  const rows = [
    { kcmc: '高等数学A', xq: '1', jcdm2: '01,02', jxcdmc: 'D201', teaxms: '张三', zc: 5 },
    { kcmc: '大学英语', xq: '2', jcdm: '0304', zdjxcdmc: 'B302', teaxm: '李四', zc: 5 },
    { kcmc: '无效行无节次', xq: '1', jcdm2: '', zc: 5 },
    { kcmc: '', xq: '1', jcdm2: '01', zc: 5 },
    { kcmc: '选课阶段', xq: '1', jcdm2: '01', zc: 5 },
  ];
  const r = api.cfRowsToCourses(rows);
  // xq:'1' 是 Java DAY_OF_WEEK（1=周日），映射后 day=7；xq:'2'（周一）映射后 day=1
  check('cfRowsToCourses 过滤+转换', r.courses.length === 2 && r.courses[0].day === 7 && r.courses[0].sections === '1,2' && r.courses[1].teacher === '李四' && r.courses[1].position === 'B302',
    JSON.stringify(r.courses));
  check('cfRowsToCourses 按 zc 生成周次', r.courses[0].weeks === '5周', r.courses[0].weeks);
  check('cfRowsToCourses 有周次信息', r.hasWeekInfo === true);
}
{
  // 数据集部分行带 zc：缺失行继承全局 zc
  const mixed = api.cfRowsToCourses([
    { kcmc: 'A', xq: '1', jcdm2: '01', zc: 8 },
    { kcmc: 'B', xq: '2', jcdm2: '02' },
  ]);
  check('cfRowsToCourses 全局 zc 继承', mixed.courses.length === 2 && mixed.courses[1].weeks === '8周' && mixed.hasWeekInfo === true,
    JSON.stringify(mixed.courses));
  // 完全无周次信息：回退 1-16周 并给出警告标志
  const none = api.cfRowsToCourses([{ kcmc: 'C', xq: '3', jcdm2: '03' }]);
  check('cfRowsToCourses 无周次回退+警告位', none.courses[0].weeks === '1-16周' && none.hasWeekInfo === false);
}

// 3. 多周合并 + 周次压缩
{
  const list = [];
  for (let w = 1; w <= 16; w++) {
    list.push({ name: '高数', teacher: '张', position: 'D201', day: 1, sections: '1,2', weeks: w + '周' });
  }
  const odd = [];
  for (let w = 1; w <= 15; w += 2) odd.push({ name: '英语', teacher: '李', position: 'B302', day: 2, sections: '3,4', weeks: w + '周' });
  const merged = api.mergeWeekCourses(list.concat(odd));
  const g = merged.find(c => c.name === '高数');
  const e = merged.find(c => c.name === '英语');
  check('mergeWeekCourses 连续周压缩', g.weeks === '1-16周', g.weeks);
  check('mergeWeekCourses 单周压缩', e.weeks === '1-15周(单)', e.weeks);
}

// 4. compressWeekNums 边界
check('compressWeekNums 混合区间', api.compressWeekNums([1, 2, 3, 8, 9]) === '1-3,8-9周', api.compressWeekNums([1, 2, 3, 8, 9]));

// 5. 文字行解析（用户粘贴文本）
{
  const text = '周一 第1-2节 高等数学 张三 教1-101 1-16周\n周二 第3-4节 大学英语 李四 外语楼302 1-16周(单)';
  const courses = api.localParseSchedule(text);
  check('localParseSchedule', courses.length === 2 && courses[0].day === 1 && courses[0].sections === '1,2' && courses[1].weeks === '1-16周(单)',
    JSON.stringify(courses));
}

// 6. normalizeWeeks
check('normalizeWeeks 单周', api.normalizeWeeks('1-16(周)单') === '1-16周(单)', api.normalizeWeeks('1-16(周)单'));
check('normalizeWeeks 列表', api.normalizeWeeks('1,3,5(周)') === '1,3,5周', api.normalizeWeeks('1,3,5(周)'));

// 7. 乘方教务 URL 生成
els['jwHostInput'] = { value: 'jxgl.myschool.edu.cn' };
check('jiaowuUrl 课表页', api.jiaowuUrl('semester') === 'https://jxgl.myschool.edu.cn/new/student/xsgrkb/week.page', api.jiaowuUrl('semester'));
check('jiaowuUrl 登录页', api.jiaowuUrl('login') === 'https://jxgl.myschool.edu.cn/new/welcome.page');

// 8. 书签脚本生成
{
  const b = api.makeBookmarklet('https://tool.example/#');
  check('makeBookmarklet 注入提取脚本', b.startsWith('javascript:') && b.includes('api/jiaowu_extractor.js') && b.includes('data-cfjw-base'), b.slice(0, 120));
}

// 9. buildSchedule 节数推断
{
  const s = api.buildSchedule([{ sections: '11,12', weeks: '1-20周' }], 12);
  check('buildSchedule 晚自习节数', s.nightNum === 4 && s.morningNum === 4 && s.totalWeek === 20, JSON.stringify(s));
  check('buildSchedule 无时间→默认表', s.sections[0].s === '08:30' && s.sections.length === 12, JSON.stringify(s.sections[0]));
}

// 10. 智能提取：从乘方行的 qssj/jssj 推导节次表（河南师大 45 分钟课 + 10 分钟课间）
{
  const rows = [
    { kcmc: '高等数学', xq: '2', ps: '1', pe: '2', zc: '1-16', jxcdmc: 'D201', teaxms: '张', qssj: '08:00:00', jssj: '09:40:00' },
    { kcmc: '大学英语', xq: '3', ps: '3', pe: '4', zc: '1-16', jxcdmc: 'B302', teaxms: '李', qssj: '10:10:00', jssj: '11:50:00' },
    { kcmc: '毛概', xq: '4', ps: '9', pe: '10', zc: '1-16', jxcdmc: 'C101', teaxms: '王', qssj: '20:00:00', jssj: '21:40:00' },
  ];
  const res = api.cfRowsToCourses(rows);
  const sched = api.buildSchedule(res.courses, res.maxSec, { s: res.timeStart, e: res.timeEnd });
  const sec = i => sched.sections.find(x => x.i === i);
  check('智能提取 锚点采集', res.timeStart[1] === '08:00' && res.timeEnd[2] === '09:40', JSON.stringify(res.timeStart) + '/' + JSON.stringify(res.timeEnd));
  check('智能提取 大课块推导单节', sec(1).s === '08:00' && sec(1).e === '08:45' && sec(2).s === '08:55' && sec(2).e === '09:40',
    JSON.stringify([sec(1), sec(2)]));
  check('智能提取 无锚点节回退默认', sec(5).s === '12:00', JSON.stringify(sec(5)));
}

// 11. 河南师大官方作息：仅河南师大域名显示夏/冬令时按钮
{
  check('isHtuHost 命中河南师大', api.isHtuHost('jwc.htu.edu.cn') === true && api.isHtuHost('htu.edu.cn') === true);
  check('isHtuHost 排除他校', api.isHtuHost('jxgl.wyu.edu.cn') === false && api.isHtuHost('htu.edu.cn.evil.com') === false && api.isHtuHost('') === false);
}

// 12. 预览编辑：周次输入 → 展开为发给小爱的数字串
{
  check('expandWeekInput 区间', api.expandWeekInput('1-4周') === '1,2,3,4', api.expandWeekInput('1-4周'));
  check('expandWeekInput 单周', api.expandWeekInput('1-5周(单)') === '1,3,5', api.expandWeekInput('1-5周(单)'));
  check('expandWeekInput 列表', api.expandWeekInput('2,4,6') === '2,4,6', api.expandWeekInput('2,4,6'));
  check('expandWeekInput 已展开透传', api.expandWeekInput('1,2,3') === '1,2,3');
  check('expandWeekInput 非法返回 null', api.expandWeekInput('第x周') === null && api.expandWeekInput('') === null);
}

// 13. 导入前冲突校验：同星期+节次相交+周次相交才算冲突
{
  const mk = (name, day, sections, weeks) => ({ name, day, sections, weeks });
  const clash = api.findConflicts([
    mk('A', 1, '1,2', '1-16周'),
    mk('B', 1, '2,3', '1-16周'),   // 与 A 在第2节+周次相交
  ]);
  check('冲突 检出同格相交', clash.bad.size === 2 && clash.pairs.length >= 1, JSON.stringify([...clash.bad]));
  const alt = api.findConflicts([
    mk('A', 1, '1,2', '1-15周(单)'),
    mk('B', 1, '1,2', '2-16周(双)'),  // 同格但周次互斥（单/双）
  ]);
  check('冲突 单双周不算冲突', alt.bad.size === 0, JSON.stringify([...alt.bad]));
  const diff = api.findConflicts([
    mk('A', 1, '1,2', '1-16周'),
    mk('B', 2, '1,2', '1-16周'),     // 不同星期
  ]);
  check('冲突 不同星期不冲突', diff.bad.size === 0);
  const none = api.findConflicts([mk('A', 1, '1,2', '1-16周')]);
  check('冲突 单课无冲突', none.bad.size === 0);
}

// 14. 令时按钮选中态：按当前时间表反推夏/冬
{
  const summer = [['08:00','08:45'],['08:55','09:40'],['10:10','10:55'],['11:05','11:50'],['15:00','15:45'],['15:55','16:40'],['17:10','17:55'],['18:05','18:50'],['20:00','20:45'],['20:55','21:40']];
  const winter = [['08:00','08:45'],['08:55','09:40'],['10:10','10:55'],['11:05','11:50'],['14:30','15:15'],['15:25','16:10'],['16:40','17:25'],['17:35','18:20'],['19:30','20:15'],['20:25','21:10']];
  const toSecs = t => t.map((p,i)=>({i:i+1,s:p[0],e:p[1]}));
  check('detectSeason 识别夏季', api.detectSeason(toSecs(summer)) === 'summer', api.detectSeason(toSecs(summer)));
  check('detectSeason 识别冬季', api.detectSeason(toSecs(winter)) === 'winter', api.detectSeason(toSecs(winter)));
  check('detectSeason 不匹配返回空', api.detectSeason([{i:1,s:'07:00',e:'07:45'}]) === '');
}

// 12. 教务导出的 .xls 网格 → 标准课程（合成网格，不含真实个人信息）
{
  const W = 15, blank = n => new Array(n).fill("");
  const G = [];
  G.push(["周明2026-2027-1课表", ...blank(W - 1)]);
  G.push(["周次\n日期", "第1周", ...blank(6), "第2周", ...blank(6)]);
  G.push(["", "09-07","09-08","09-09","09-10","09-11","09-12","09-13","09-14","09-15","09-16","09-17","09-18","09-19","09-20"]);
  G.push(["星期", "一","二","三","四","五","六","日","一","二","三","四","五","六","日"]);
  const s1 = ["第一大节", ...blank(W - 1)];
  s1[2] = "高等数学[理论]\r\n王老师\r\n1-0102\r\n3教101";
  s1[9] = "高等数学\r\n王老师\r\n2-0102\r\n3教101";
  G.push(s1);
  const s2 = ["第二大节", ...blank(W - 1)];
  s2[13] = "体育\r\n陈教练\r\n2-0304\r\n北操";
  G.push(s2);
  const s3 = ["第三大节", ...blank(W - 1)];
  s3[4] = "自由选课说明\r\n见教务通知";
  G.push(s3);

  const r = api.parseTimetableGrid(G);
  check('xls解析 门数与跳过数', r.courses.length === 2 && r.skipped.length === 1 && r.entries === 3,
    JSON.stringify({ n: r.courses.length, sk: r.skipped.length, en: r.entries }));
  const gao = r.courses.find(c => c.name === "高等数学");
  check('xls解析 星期/节次/跨周合并', !!gao && gao.day === 2 && gao.sections === "1,2" && gao.weeks === "1-2周",
    gao && JSON.stringify(gao));
  check('xls解析 课名去性质后缀', !!gao && gao.name === "高等数学" && gao.position === "3教101", gao && gao.name);
  const ty = r.courses.find(c => c.name === "体育");
  check('xls解析 教师/教室/周六定位', !!ty && ty.teacher === "陈教练" && ty.day === 6 && ty.sections === "3,4" && ty.weeks === "2周",
    ty && JSON.stringify(ty));
  check('xls解析 学期与最大节次', r.semester === "2026-2027-1" && r.maxSection === 4, r.semester + " / " + r.maxSection);
  const sch = api.buildSchedule(r.courses, r.maxSection, null);
  check('xls解析 生成课表设置', sch.totalWeek === 2 && sch.morningNum === 4 && sch.afternoonNum === 0,
    JSON.stringify({ tw: sch.totalWeek, m: sch.morningNum, a: sch.afternoonNum }));
  const empty = api.parseTimetableGrid([["随便一个表","a","b"],["x","y","z"]]);
  check('xls解析 非课表网格不假装成功', empty.courses.length === 0 && empty.entries === 0, JSON.stringify(empty));
}

console.log(`\n结果：${pass} 通过 / ${failn} 失败`);
process.exit(failn ? 1 : 0);
