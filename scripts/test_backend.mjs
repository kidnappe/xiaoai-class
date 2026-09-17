// 后端路由冒烟测试：node scripts/test_backend.mjs
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const funcFile = path.join(root, 'functions', 'api', '[[path]].js');
// Cloudflare 按 ESM 解析该文件；本地 Node 默认 .js=CJS，先复制为 .mjs 再导入
const tmpMjs = path.join(os.tmpdir(), 'cf_pages_func_check_' + Date.now() + '.mjs');
fs.copyFileSync(funcFile, tmpMjs);
const mod = await import(pathToFileURL(tmpMjs).href);

function req(method, urlStr, body, sid = 'test-sid') {
  const init = { method, headers: { 'X-Sid': sid } };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  return new Request('http://localhost' + urlStr, init);
}
async function call(handler, r) {
  const resp = await handler({ request: r, env: {}, ctx: {} });
  const ct = resp.headers.get('content-type') || '';
  return { status: resp.status, ct, data: ct.includes('json') ? await resp.json() : await resp.text() };
}

let pass = 0, failn = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { failn++; console.log('  ✘ ' + name + (detail ? '  → ' + detail : '')); }
}

// 1. ping
{
  const r = await call(mod.onRequestGet, req('GET', '/api/ping'));
  check('ping', r.data.ok === true && r.data.data.time, JSON.stringify(r.data));
}
// 2. visit 计数
{
  const r1 = await call(mod.onRequestGet, req('GET', '/api/visit'));
  const r2 = await call(mod.onRequestGet, req('GET', '/api/visit'));
  check('visit 递增', r1.data.ok && r2.data.data.visits >= r1.data.data.visits, JSON.stringify([r1.data, r2.data]));
}
// 3. 提取脚本分发
{
  const r = await call(mod.onRequestGet, req('GET', '/api/jiaowu_extractor.js'));
  check('extractor 含乘方逻辑', r.ct.includes('javascript') && r.data.includes('__cfjwExtract') && r.data.includes('getCalendarWeekDatas'));
  check('extractor 正则未被转义破坏', r.data.includes('/\\d+/g'), '反斜杠丢失');
}
{
  const r = await call(mod.onRequestGet, req('GET', '/api/jiaowu_userscript.js'));
  check('userscript 头部正确', r.data.startsWith('// ==UserScript==') && r.data.includes('乘方教务课表提取器') && r.data.includes('__cfjwExtract'));
}
// 4. parse：乘方提取器输出格式
{
  const chengfangOutput = {
    courses: [
      { name: '高等数学A', teacher: '张三', position: 'D201', day: 1, sections: '1,2', weeks: '1-16周' },
      { name: '大学英语', teacher: '李四', position: 'B302', day: 2, sections: '3,4', weeks: '1-15周(单)' },
      { name: '体育', teacher: '', position: '操场', day: 3, sections: '5', weeks: '2-16周(双)' }
    ],
    schedule: { totalWeek: 16, morningNum: 4, afternoonNum: 4, nightNum: 0,
      sections: [{ i: 1, s: '08:30', e: '09:10' }, { i: 2, s: '09:20', e: '10:00' }] }
  };
  const r = await call(mod.onRequestPost, req('POST', '/api/parse', { text: JSON.stringify(chengfangOutput) }));
  const d = r.data.data || {};
  check('parse 课程数', d.count === 3, JSON.stringify(r.data).slice(0, 300));
  check('parse 周次展开', d.courses && d.courses[1].weeks === '1,3,5,7,9,11,13,15', d.courses && d.courses[1].weeks);
  check('parse weeksText 压缩', d.courses && d.courses[2].weeksText === '2-16周(双)', d.courses && d.courses[2].weeksText);
  check('parse schedule 透传', d.schedule && d.schedule.totalWeek === 16 && d.schedule.sections.length === 2, JSON.stringify(d.schedule));
  check('parse 配色', d.courses && d.courses.every(c => typeof c.styleIdx === 'number'));
}
// 5. parse：宽松字段名
{
  const loose = [
    { '课程名称': '线性代数', '教师': '王五', '教室': 'A101', '星期': '四', '节次': '第7-8节', '周次': '1至16' }
  ];
  const r = await call(mod.onRequestPost, req('POST', '/api/parse', { text: JSON.stringify(loose) }));
  const d = r.data.data || {};
  check('parse 中文宽松字段', d.count === 1 && d.courses[0].day === 4 && d.courses[0].sections === '7,8' && d.courses[0].weeks === '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16',
    JSON.stringify(d.courses && d.courses[0]));
}
// 6. parse：坏数据报错
{
  const r = await call(mod.onRequestPost, req('POST', '/api/parse', { text: 'not json' }));
  check('parse 坏输入友好报错', r.data.ok === false && /JSON/.test(r.data.error));
}
// 7. 未连接时的路由保护
{
  const r = await call(mod.onRequestGet, req('GET', '/api/tables', undefined, 'no-such-sid-' + Date.now()));
  check('tables 未连接提示', r.data.ok === false && r.data.error.includes('未连接'));
}
// 8. ai_parse 未配置密钥的提示
{
  const r = await call(mod.onRequestPost, req('POST', '/api/ai_parse', { text: '周一 第1-2节 高等数学' }));
  check('ai_parse 缺配置提示', r.data.ok === false && r.data.error.includes('AI_API_KEY'), JSON.stringify(r.data));
}
// 8.5 /api/import 的错误必须可读：曾因 phase 声明在 try 内、catch 读不到，
//     任何失败都被 ReferenceError 吞成「服务器内部错误：phase is not defined」。
{
  const r = await call(mod.onRequestPost, req('POST', '/api/import', { ctId: 1, courses: [{ name: 'x' }] }, 'no-such-sid-' + Date.now()));
  check('import 未连接时报真实原因而非 ReferenceError',
    r.data.ok === false && r.data.error.includes('未连接') && !/phase is not defined/.test(r.data.error),
    JSON.stringify(r.data));
}
// 8.6 源码层面钉死：let phase 必须出现在 /api/import 的 try 之前
{
  const src = fs.readFileSync(funcFile, 'utf8');
  const at = src.indexOf('path === "/api/import"');
  const tryAt = src.indexOf('try {', at);
  const declAt = src.indexOf('let phase', at);
  const asgnAt = src.indexOf('phase = "切换当前课表"', at);
  check('import 的 phase 声明在 try 之外',
    at >= 0 && declAt >= 0 && declAt < tryAt && asgnAt > tryAt);
}

// 9. CORS 预检
{
  const resp = await mod.onRequestOptions({ request: req('OPTIONS', '/api/parse', {}), env: {}, ctx: {} });
  check('CORS 预检', resp.status === 200 && resp.headers.get('Access-Control-Allow-Origin') === '*');
}

console.log(`\n结果：${pass} 通过 / ${failn} 失败`);
process.exit(failn ? 1 : 0);
