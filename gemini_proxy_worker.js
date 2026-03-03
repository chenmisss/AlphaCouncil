/**
 * Cloudflare Worker 代理脚本 - 用于转发 Gemini API 请求
 * 部署方法:
 * 1. 登录 Cloudflare Dashboard -> Workers & Pages
 * 2. 创建新 Worker
 * 3. 粘贴本脚本内容
 * 4. 保存并部署
 * 5. 将获得的 Worker URL (例如 https://my-proxy.workers.dev) 填入 AlphaCouncil 的 GEMINI_BASE_URL
 */

const TARGET_HOST = 'generativelanguage.googleapis.com';

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        // 1. 处理 OPTIONS 预检请求 (CORS)
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                status: 204,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
                    'Access-Control-Max-Age': '86400',
                },
            });
        }

        // 2. 构建目标 URL
        // 将请求路径 (path) 和查询参数 (search) 原样拼接至目标域名
        const targetUrl = `https://${TARGET_HOST}${url.pathname}${url.search}`;

        // 3. 克隆请求并修改 Host 头
        const newRequest = new Request(targetUrl, {
            method: request.method,
            headers: request.headers,
            body: request.body,
        });

        // 必须移除或修改 Host 头，否则 Google 服务器可能拒绝
        // Cloudflare Worker 的 fetch 会自动处理 Host，但显式覆盖更安全
        // 注意: 在 CF Worker 中 request.headers 是只读的，需要通过 new Request 或 new Headers 修改
        // 但通常 fetch(targetUrl) 已经足够

        try {
            const response = await fetch(newRequest);

            // 4. 处理响应，添加 CORS 头以便前端/Node后端可以访问
            const newResponse = new Response(response.body, response);
            newResponse.headers.set('Access-Control-Allow-Origin', '*');

            return newResponse;
        } catch (e) {
            return new Response(JSON.stringify({ error: e.message }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    },
};
