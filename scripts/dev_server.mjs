// 本地开发服务器：node scripts/dev_server.mjs [端口]
// 静态托管 index.html，并把 /api/* 直接转发给 Cloudflare Functions 逻辑
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const PORT = parseInt(process.argv[2] || '8787', 10);

// Cloudflare 按 ESM 解析，本地复制为 .mjs 导入
const funcFile = path.join(root, 'functions', 'api', '[[path]].js');
const tmpMjs = path.join(os.tmpdir(), 'cf_pages_func_dev_' + Date.now() + '.mjs');
fs.copyFileSync(funcFile, tmpMjs);
const mod = await import(pathToFileURL(tmpMjs).href);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function ts() { return new Date().toLocaleTimeString('zh-CN', { hour12: false }) + '.' + String(new Date().getMilliseconds()).padStart(3, '0'); }
function log(...a) { console.log(ts(), ...a); }
function clip(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + '…(' + s.length + ')' : s; }

const server = http.createServer(async (req, res) => {
  const path0 = (req.url || '/').split('?')[0];
  const isApi = path0.startsWith('/api/');
  try {
    let body;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const chunks = [];
      for await (const ch of req) chunks.push(ch);
      body = Buffer.concat(chunks);
    }
    const url = 'http://localhost:' + PORT + (req.url || '/');
    const headers = {};
    for (let i = 0; i < req.rawHeaders.length; i += 2) headers[req.rawHeaders[i]] = req.rawHeaders[i + 1];

    // 优先走 /api/ 函数路由
    if (isApi) {
      const sid = headers['X-Sid'] || headers['x-sid'] || '(无)';
      let brief = '';
      if (body && body.length) {
        try {
          const j = JSON.parse(body.toString('utf8'));
          if (path0 === '/api/import') brief = ` ctId=${j.ctId} courses=${(j.courses || []).length} clearFirst=${!!j.clearFirst} sync=${!!j.syncSettings} schedule=${j.schedule ? 'Y' : 'N'}`;
          else if (path0 === '/api/parse') brief = ` textLen=${(j.text || '').length}`;
          else if (path0 === '/api/connect') brief = ` raw=${(j.raw || '').length} appId=${!!j.appId} token=${!!j.serviceToken} dev=${!!j.deviceId}`;
          else brief = ` bodyLen=${body.length}`;
        } catch (e) { brief = ` body(非JSON,${body.length}B)`; }
      }
      const quiet = path0 === '/api/ping';   // 心跳不刷屏
      if (!quiet) log(`→ ${req.method} ${path0}  sid=${sid}${brief}`);
      const init = { method: req.method, headers };
      if (body !== undefined && body.length) init.body = body;
      const request = new Request(url, init);
      const handler = req.method === 'POST' ? mod.onRequestPost
        : req.method === 'OPTIONS' ? mod.onRequestOptions
        : mod.onRequestGet;
      const t0 = Date.now();
      const cfResp = await handler({ request, env: {}, ctx: {} });
      const buf = Buffer.from(await cfResp.arrayBuffer());
      let respBrief = '';
      try {
        const rj = JSON.parse(buf.toString('utf8'));
        if (rj.ok === false) respBrief = ` ✗ ${clip(rj.error, 300)}`;
        else if (path0 === '/api/import') respBrief = ` ✓ imported=${rj.data && rj.data.imported} deleted=${rj.data && rj.data.deleted} synced=${rj.data && rj.data.synced} syncErr=${clip((rj.data && rj.data.syncError) || '-', 120)} courseInfos=${clip(JSON.stringify((rj.data && rj.data.courseInfos) || []), 300)}`;
        else if (path0 === '/api/parse') respBrief = ` ✓ count=${rj.data && rj.data.count} errors=${(rj.data && rj.data.errors || []).length}`;
        else respBrief = ` ✓ ${clip(JSON.stringify(rj.data), 160)}`;
      } catch (e) { respBrief = ` (非JSON ${buf.length}B)`; }
      if (!quiet) log(`← ${req.method} ${path0}  ${cfResp.status}  ${Date.now() - t0}ms${respBrief}`);
      res.writeHead(cfResp.status, Object.fromEntries(cfResp.headers.entries()));
      res.end(buf);
      return;
    }

    // 静态文件
    let fp = decodeURIComponent((req.url || '/').split('?')[0]);
    if (fp === '/') fp = '/index.html';
    const abs = path.join(root, fp.replace(/^\/+/, ''));
    if (!abs.startsWith(root) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
      log(`→ 404 ${req.method} ${path0}`);
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache', 'Expires': '0',
    });
    fs.createReadStream(abs).pipe(res);
  } catch (e) {
    log(`!! 500 ${req.method} ${path0}  ${e && e.stack ? e.stack : e}`);
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: e.message }));
  }
});

server.listen(PORT, () => {
  console.log(`✅ 本地预览已启动: http://localhost:${PORT}`);
  console.log(`   API 前缀: http://localhost:${PORT}/api/ping`);
  console.log(`   提取脚本: http://localhost:${PORT}/api/jiaowu_extractor.js`);
  console.log('   注意：小爱接口(i.ai.mi.com)在本地与线上一致；如需公网访问用 cloudflared/ngrok 隧道。');
});
