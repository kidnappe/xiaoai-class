// Cloudflare Worker 入口：复用 functions/api/[[path]].js 的全部后端逻辑
// 用途：前端静态页部署到 GitHub Pages，后端部署到 Worker，再用 ?api= 指过来。
// 部署：wrangler deploy -c worker/wrangler.toml
import { onRequestGet, onRequestPost, onRequestOptions } from "../functions/api/[[path]].js";

function cors(passthrough) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Sid",
  };
  return new Response(passthrough ? null : JSON.stringify({ ok: false, error: "不支持的方法" }), {
    status: passthrough ? 204 : 405,
    headers,
  });
}

export default {
  async fetch(request, env, ctx) {
    const method = String(request.method || "GET").toUpperCase();
    const context = { request, env, ctx };
    try {
      if (method === "GET") return await onRequestGet(context);
      if (method === "POST" || method === "PUT") return await onRequestPost(context);
      if (method === "OPTIONS") return await onRequestOptions(context);
      return cors(false);
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: "服务器内部错误：" + (e && e.message) }), {
        status: 500,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }
  },
};
