// 构建脚本：将 tools/cf_extractor.js 注入到 functions/api/[[path]].js 的占位符
// 用法：node scripts/build_functions.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const extractorPath = path.join(root, 'tools', 'cf_extractor.js');
const funcPath = path.join(root, 'functions', 'api', '[[path]].js');
const userscriptPath = path.join(root, 'tools', 'cf_kebiao_extractor.user.js');

const extractorCode = fs.readFileSync(extractorPath, 'utf-8');
let funcCode = fs.readFileSync(funcPath, 'utf-8');

// 转义 JS 模板字面量内容（反斜杠、反引号、${）
function esc(str) {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${')
    .replace(/\r\n/g, '\\n')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

const placeholder = '"__CF_EXTRACTOR_JS_PLACEHOLDER__"';
const replacement = '`' + esc(extractorCode) + '`';

if (!funcCode.includes(placeholder)) {
  // 已注入过：还原占位符再注入（幂等）
  const m = funcCode.match(/const CF_EXTRACTOR_JS = (`(?:[^\\`]|\\.)*`);/s);
  if (!m) {
    console.error('错误：未找到占位符或已注入内容，无法处理');
    process.exit(1);
  }
  funcCode = funcCode.slice(0, m.index)
    + 'const CF_EXTRACTOR_JS = ' + placeholder + ';'
    + funcCode.slice(m.index + m[0].length);
}

funcCode = funcCode.split(placeholder).join(replacement);

fs.writeFileSync(funcPath, funcCode, 'utf-8');

// 同步产出一份独立可用的油猴脚本（纯静态托管场景）
const header = `// ==UserScript==
// @name         乘方教务课表提取器 - 标准格式
// @namespace    https://tampermonkey.net/
// @version      1.4.1
// @description  从「小爱课表导入器·乘方教务版」内置提供：节次时间按课程行 qssj/jssj 推导（45 分钟课+10 分钟课间），导入小爱时间更准；businessHours 嗅探已废弃
// @match        *://*.edu.cn/*
// @match        *://*/*new/*
// @run-at       document-idle
// ==/UserScript==

`;
fs.writeFileSync(userscriptPath, header + extractorCode, 'utf-8');

console.log('✅ 已将乘方教务提取脚本注入到 Cloudflare Functions');
console.log('   functions/api/[[path]].js  ← 内联脚本');
console.log('   tools/cf_kebiao_extractor.user.js  ← 独立油猴脚本');
console.log(`   脚本大小: ${(extractorCode.length / 1024).toFixed(1)} KB`);
