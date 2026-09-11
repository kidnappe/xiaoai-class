// 提取脚本核心逻辑测试（parseJcdm / compressWeeks / mergeCourses / getTermAndWeek / termStart）
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

function makeEl() {
  return {
    value: '', textContent: '', innerHTML: '', style: {}, dataset: {}, disabled: false, textContent2: '',
    classList: { add() {}, remove() {}, contains() { return false; } },
    addEventListener() {}, appendChild() {}, setAttribute() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    getAttribute() { return null; },
  };
}

let src = fs.readFileSync(path.join(root, 'tools', 'cf_extractor.js'), 'utf-8');
// 注入测试出口
src = src.replace('window.__cfjwExtract = extractSchedule;',
  'window.__cfjwExtract = extractSchedule; window.__internals = { parseJcdm, compressWeeks, mergeCourses, getTermAndWeek, termStart, xferRow, extractSchedule, extractChengfang, buildSectionsFromTimes, findTermInDom, scanFramesForTerm };');

const win = {};
const doc = {
  readyState: 'complete', body: makeEl(), firstChild: null,
  getElementById() { return makeEl(); },
  createElement() { return makeEl(); },
  addEventListener() {},
  querySelector() { return null; },
  querySelectorAll() { return []; },
};
const location = { href: 'https://jxgl.wyu.edu.cn/new/student/xsgrkb/week.page?xnxqdm=202601&zc=5', origin: 'https://jxgl.wyu.edu.cn' };
const navigator = { clipboard: { writeText: async () => {} } };
globalThis.location = location;
new Function('window', 'document', 'location', 'navigator', 'fetch', 'URLSearchParams', 'URL', 'setTimeout', 'Promise', src)(
  win, doc, location, navigator, async () => { throw new Error('network disabled in test'); }, URLSearchParams, URL, setTimeout, Promise);
const t = win.__internals;
check('出口注入', !!t);

// 节次格式全谱系
check('parseJcdm 09,10', t.parseJcdm('09,10').join(',') === '9,10');
check('parseJcdm 0910', t.parseJcdm('0910').join(',') === '9,10');
check('parseJcdm 1-3', t.parseJcdm('1-3').join(',') === '1,2,3');
check('parseJcdm 数组', t.parseJcdm([2, 3, 4]).join(',') === '2,3,4');
check('parseJcdm 空', t.parseJcdm('').length === 0 && t.parseJcdm(null).length === 0);

// 周次压缩
check('compressWeeks 连续', t.compressWeeks([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]) === '1-16周');
check('compressWeeks 单周', t.compressWeeks([1, 3, 5, 7, 9, 11, 13, 15]) === '1-15周(单)', t.compressWeeks([1, 3, 5, 7, 9, 11, 13, 15]));
check('compressWeeks 双周', t.compressWeeks([2, 4, 6, 8, 10, 12, 14, 16]) === '2-16周(双)', t.compressWeeks([2, 4, 6, 8, 10, 12, 14, 16]));
check('compressWeeks 混合', t.compressWeeks([1, 2, 3, 7, 8]) === '1-3,7-8周', t.compressWeeks([1, 2, 3, 7, 8]));
check('compressWeeks 单值', t.compressWeeks([5]) === '5周');

// 原始行转换
{
  const row = { kcmc: '高等数学A', xq: '2', jcdm2: '01,02', zdjxcdmc: 'D201', teaxms: '张三', qssj: '2026-08-24 08:30:00' };
  const c = t.xferRow(row, 5);
  check('xferRow 正常', c && c.name === '高等数学A' && c.day === 1 && c.sections === '1,2' && c.position === 'D201' && c.teacher === '张三' && c.weekNums[0] === 5, JSON.stringify(c));
  check('xferRow 过滤通知行', t.xferRow({ kcmc: '选课阶段', xq: '2', jcdm2: '01' }, 1) === null);
  check('xferRow 过滤无节次', t.xferRow({ kcmc: '某某', xq: '2', jcdm2: '' }, 1) === null);
  // Java DAY_OF_WEEK 映射：1=周日→7，2=周一→1，7=周六→6
  check('Java星期映射 周日', t.xferRow({ kcmc: 'X', qsxq: '1', ps: 1 }, 1).day === 7);
  check('Java星期映射 周六', t.xferRow({ kcmc: 'X', qsxq: '7', ps: 1 }, 1).day === 6);
}
{
  // 河南师大真实格式：qsxq 为 Java 星期（2=周一）、ps/pe 起止节、zc 完整周次串
  const htu = { kcmc: '高等数学', qsxq: '2', jsxq: '2', ps: '1', pe: '2', zc: '1-16', jxcdmc: '3教101', teaxms: '王老师', qssj: '08:00', jssj: '09:40' };
  const c = t.xferRow(htu, 5);
  check('xferRow 河南师大字段 qsxq/ps/pe/zc串', c && c.day === 1 && c.sections === '1,2' && c.weekNums.length === 16 && c.weekNums[0] === 1 && c.weekNums[15] === 16, JSON.stringify(c));
  const htuOdd = { kcmc: '大学英语', qsxq: '三', ps: 5, pe: 6, zc: '1,3,5,7,9,11,13,15' };
  const c2 = t.xferRow(htuOdd, 3);
  check('xferRow 中文星期+周次列表', c2 && c2.day === 3 && c2.sections === '5,6' && c2.weekNums.join(',') === '1,3,5,7,9,11,13,15', JSON.stringify(c2));
  const htuParity = { kcmc: '体育', qsxq: '5', ps: 7, pe: 8, zc: '2-16(双)' };
  const c3 = t.xferRow(htuParity, 2);
  check('xferRow 双周串', c3 && c3.weekNums.join(',') === '2,4,6,8,10,12,14,16', c3 && c3.weekNums.join(','));
}

// 合并 + 节次表由课程行 qssj/jssj 推导
{
  const rows = [];
  for (let w = 1; w <= 16; w++) {
    rows.push({ name: '高数', teacher: '张', position: 'D201', day: 1, sections: '1,2', weekNums: [w], qssj: '08:00', jssj: '09:40' });
  }
  for (let w = 1; w <= 16; w += 2) {
    rows.push({ name: '英语', teacher: '李', position: 'B302', day: 2, sections: '3,4', weekNums: [w], qssj: '10:10', jssj: '11:50' });
  }
  for (let w = 9; w <= 16; w++) {
    rows.push({ name: '毛概', teacher: '王', position: 'C101', day: 3, sections: '9,10', weekNums: [w], qssj: '20:00', jssj: '21:40' });
  }
  const m = t.mergeCourses(rows);
  const g = m.courses.find(c => c.name === '高数');
  const e = m.courses.find(c => c.name === '英语');
  const mg = m.courses.find(c => c.name === '毛概');
  check('merge 总数', m.courses.length === 3);
  check('merge 连续', g.weeks === '1-16周', g.weeks);
  check('merge 单周', e.weeks === '1-15周(单)', e.weeks);
  check('merge 尾段', mg.weeks === '9-16周', mg.weeks);
  check('merge 记录最大节次', mg.sections === '9,10');
  // 大课块（占两节次）→ 首节取块首 qssj、末节取块末 jssj，单节 45 分钟 + 10 分钟课间推导
  const sec = i => m.sections.find(s => s.i === i);
  check('节次表 块首=1 45分钟课', sec(1).s === '08:00' && sec(1).e === '08:45', JSON.stringify(sec(1)));
  check('节次表 块末 反推起点', sec(2).s === '08:55' && sec(2).e === '09:40', JSON.stringify(sec(2)));
  check('节次表 第3节块首', sec(3).s === '10:10' && sec(3).e === '10:55', JSON.stringify(sec(3)));
  // 第 5-8 节无任何锚点 → 回退默认表（绝不跨大间隙外推）
  check('节次表 无锚点节回退默认', sec(5).s === '12:00' && sec(9).s === '20:00' && sec(10).s === '20:55', JSON.stringify([sec(5), sec(9), sec(10)]));
}
{
  // 河南师大权威作息（用户 4.4 推导表）：全 10 节都能从真实连堂块覆盖，不依赖任何猜测表
  const blocks = [
    ['1,2', '08:00', '09:40'], ['3,4', '10:10', '11:50'], ['5,6', '15:00', '16:40'],
    ['7,8', '17:10', '18:50'], ['9,10', '20:00', '21:40'],
  ];
  const rows = blocks.map((b, i) => ({ name: 'K' + i, teacher: '', position: 'r', day: i + 1, sections: b[0], weekNums: [1], qssj: b[1], jssj: b[2] }));
  const m = t.mergeCourses(rows);
  const expect = [
    ['08:00', '08:45'], ['08:55', '09:40'], ['10:10', '10:55'], ['11:05', '11:50'], ['15:00', '15:45'],
    ['15:55', '16:40'], ['17:10', '17:55'], ['18:05', '18:50'], ['20:00', '20:45'], ['20:55', '21:40'],
  ];
  const ok = expect.every((p, i) => m.sections[i] && m.sections[i].s === p[0] && m.sections[i].e === p[1]);
  check('节次表 河南师大 10 节全推导', m.sections.length === 10 && ok, JSON.stringify(m.sections));
}
{
  // 单节次课（非大课）→ qssj/jssj 直接作为该节起止
  const m = t.mergeCourses([{ name: '实验', teacher: '', position: 'r', day: 1, sections: '6', weekNums: [1], qssj: '14:55', jssj: '16:40' }]);
  const s6 = m.sections.find(s => s.i === 6);
  check('节次表 单节课直接用起止', s6.s === '14:55' && s6.e === '16:40', JSON.stringify(s6));
}
{
  // 完全没有 qssj/jssj → 全表回退默认
  const m = t.mergeCourses([{ name: '无时间课', teacher: '', position: 'r', day: 1, sections: '1,2', weekNums: [1] }]);
  check('节次表 无时间回退默认', m.sections[0].s === '08:30' && m.sections[1].s === '09:20', JSON.stringify(m.sections));
  // businessHours 嗅探已废弃：即便 window.__cfjwBiz 有值也不再影响节次表
  win.__cfjwBiz = [{ i: 1, s: '07:00', e: '07:45' }];
  const m2 = t.mergeCourses([{ name: '课', teacher: '', position: 'r', day: 1, sections: '1', weekNums: [1] }]);
  check('businessHours 已废弃不再参与', m2.sections[0].s === '08:30', JSON.stringify(m2.sections[0]));
  delete win.__cfjwBiz;
}
{
  // buildSectionsFromTimes 直接单测：只有 start 侧锚点也补 e=s+45
  const secs = t.buildSectionsFromTimes({ 2: '09:00' }, {}, 2);
  check('buildSectionsFromTimes 单侧补全', secs[1].s === '09:00' && secs[1].e === '09:45', JSON.stringify(secs));
  check('buildSectionsFromTimes maxSec=0 返回空', t.buildSectionsFromTimes({}, {}, 0).length === 0);
}
{
  // 河南师大快速路径：一条记录自带完整周次串 + 同一课程不同周记录混合，去重不重复计数
  const rows = [
    { name: '高数', teacher: '', position: '101', day: 1, sections: '1,2', weekNums: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16], qssj: '08:00' },
    { name: '高数', teacher: '', position: '101', day: 1, sections: '1,2', weekNums: [3,5,7], qssj: '08:00' },
    { name: '英语', teacher: '', position: '302', day: 3, sections: '5,6', weekNums: [2,4,6,8], qssj: '14:00' },
  ];
  const m = t.mergeCourses(rows);
  check('merge 同键周次并集去重', m.courses.length === 2 && m.courses[0].weeks === '1-16周' && m.courses[1].weeks === '2-8周(双)',
    JSON.stringify(m.courses.map(c => c.weeks)));
}

// 学期与当前周推算
{
  const info = t.getTermAndWeek();
  check('URL 识别学期', info.term === '202601' && info.week === 5, JSON.stringify(info));
  const monday = t.termStart('202601');
  check('2026-01 秋季开学周一', monday.getFullYear() === 2026 && monday.getDay() === 1 &&
    ((monday.getMonth() === 8 && monday.getDate() <= 7) || (monday.getMonth() === 7 && monday.getDate() >= 25)), monday.toDateString());
  const spring = t.termStart('202502');
  check('2025-02 春季学期周一', spring.getFullYear() === 2026 && spring.getMonth() === 1 && spring.getDay() === 1, spring.toDateString());
}

// 内嵌页面：从学期下拉框 DOM 读当前学期
{
  const selDoc = { querySelectorAll: () => ([
    { tagName: 'SELECT', selectedIndex: 1, options: [{ value: '202502' }, { value: '202601' }], getAttribute: () => '' },
  ]) };
  check('findTermInDom 读选中学期', t.findTermInDom(selDoc) === '202601', t.findTermInDom(selDoc));
  const nameDoc = { querySelectorAll: () => ([
    { tagName: 'INPUT', value: '202602', getAttribute: (a) => (a === 'name' ? 'xnxqdm' : '') },
  ]) };
  check('findTermInDom 读 xnxqdm 字段', t.findTermInDom(nameDoc) === '202602', t.findTermInDom(nameDoc));
  const noneDoc = { querySelectorAll: () => ([
    { tagName: 'SELECT', selectedIndex: 0, options: [{ value: 'menu' }], getAttribute: () => '' },
  ]) };
  check('findTermInDom 非学期不误读', t.findTermInDom(noneDoc) === '', JSON.stringify(t.findTermInDom(noneDoc)));
}

// 嵌套 iframe：week.page 的 src 属性停在旧学期，但里面 select 是当前学期 → 必须读 select
{
  const weekDoc = {
    querySelectorAll: (sel) => (sel.indexOf('select') >= 0 ? [{
      tagName: 'SELECT', value: '202502', selectedIndex: 0, options: [{ value: '202502', text: '2025-2026-2' }],
      getAttribute: (a) => (a === 'name' || a === 'id' ? 'xnxqdm' : ''),
    }] : []),
  };
  const weekFrame = { getAttribute: (a) => (a === 'src' ? '/new/student/xsgrkb/week.page?xnxqdm=202601' : ''), contentDocument: weekDoc, contentWindow: { location: { href: 'https://x/week.page?xnxqdm=202601' } } };
  const mainDoc = { querySelectorAll: (sel) => (sel.indexOf('select') >= 0 ? [] : [weekFrame]) };
  const mainFrame = { getAttribute: (a) => (a === 'src' ? '/new/student/xsgrkb/main.page' : ''), contentDocument: mainDoc, contentWindow: { location: { href: 'https://x/main.page' } } };
  const topDoc = { querySelectorAll: (sel) => (sel.indexOf('select') >= 0 ? [] : [mainFrame]) };
  const r = t.scanFramesForTerm(topDoc, 0);
  check('scanFramesForTerm 递归优先读内层 select（忽略陈旧 src）', r && r.term === '202502' && r.fromDom === true, JSON.stringify(r));
}

// businessHours 相关用例已移除：2026-09-08 用户证伪，节次表改由课程行 qssj/jssj 推导（见上方用例）

console.log(`\n结果：${pass} 通过 / ${failn} 失败`);
process.exit(failn ? 1 : 0);
