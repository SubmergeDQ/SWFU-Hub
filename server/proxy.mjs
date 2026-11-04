import { createServer, request as httpRequest } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ORIGIN_HOST = 'sdcz.swfu.edu.cn';
const ROOT = join(fileURLToPath(new URL('..', import.meta.url)), 'dist');
const PORT = Number(process.env.PORT || 5174);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

// 把前端请求原样转发到校园服务器，避免浏览器 CORS 限制
function proxyToCampus(req, res) {
  const upstream = httpRequest(
    {
      host: ORIGIN_HOST,
      port: 80,
      path: req.url,
      method: req.method,
      headers: {
        'content-type': req.headers['content-type'] || 'application/x-www-form-urlencoded',
        'content-length': req.headers['content-length'],
      },
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, {
        'content-type': upstreamRes.headers['content-type'] || 'application/json',
      });
      upstreamRes.pipe(res);
    },
  );

  upstream.on('error', () => {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ code: 502, msg: '校园服务器无响应' }));
  });

  req.pipe(upstream);
}

async function serveStatic(req, res) {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const safePath = normalize(urlPath).replace(/^([/\\])+/, '');
  let filePath = join(ROOT, safePath);

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = join(filePath, 'index.html');
  } catch {
    // SPA 路由回退到入口页
    filePath = join(ROOT, 'index.html');
  }

  try {
    const content = await readFile(filePath);
    res.writeHead(200, { 'content-type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(content);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('未找到页面');
  }
}

const server = createServer((req, res) => {
  if ((req.url || '').startsWith('/kddz/')) {
    proxyToCampus(req, res);
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`宿舍电量已启动：http://localhost:${PORT}`);
});
