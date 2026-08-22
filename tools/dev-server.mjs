/**
 * 로컬 개발 서버.
 *   ANTHROPIC_API_KEY=sk-ant-... npm run dev
 * 그다음 http://localhost:5173 을 연다.
 *
 * 정적 파일을 서빙하고, /api/** 는 배포용과 똑같은 핸들러로 넘긴다.
 * (Vercel 이 api/ 아래 파일을 경로로 매핑하는 방식을 그대로 흉내낸다)
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT || 5173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const handlerCache = new Map();

/** /api/push/subscribe -> api/push/subscribe.js (Vercel 과 같은 규칙) */
async function loadApiHandler(pathname) {
  const rel = pathname.replace(/^\/api\//, '');
  // 경로 탈출과 비공개 파일(_ 로 시작) 차단
  if (!/^[a-zA-Z0-9/_-]+$/.test(rel) || rel.includes('..') || rel.split('/').some((p) => p.startsWith('_'))) {
    return null;
  }
  if (handlerCache.has(rel)) return handlerCache.get(rel);

  for (const candidate of [`../api/${rel}.js`, `../api/${rel}/index.js`]) {
    try {
      const mod = await import(candidate);
      if (typeof mod.default === 'function') {
        handlerCache.set(rel, mod.default);
        return mod.default;
      }
    } catch (err) {
      if (err?.code !== 'ERR_MODULE_NOT_FOUND') throw err;
    }
  }
  handlerCache.set(rel, null);
  return null;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.startsWith('/api/')) {
    try {
      const handler = await loadApiHandler(url.pathname);
      if (!handler) {
        res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ error: `그런 엔드포인트가 없습니다: ${url.pathname}` }));
      }
      req.body = await readBody(req);
      req.query = Object.fromEntries(url.searchParams);
      shimVercelResponse(res);
      return handler(req, res);
    } catch (err) {
      console.error('[dev]', url.pathname, err);
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: String(err?.message || err) }));
    }
  }

  let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (path === '/' || path.endsWith('/')) path += 'index.html';

  const file = join(ROOT, path);
  if (!file.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end('forbidden');
  }

  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    const data = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(data);
  } catch {
    const html = await readFile(join(ROOT, 'index.html'));
    res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-store' });
    res.end(html);
  }
});

/** Vercel 런타임이 붙여 주는 res.status()/res.json() 을 로컬에서도 흉내 낸다. */
function shimVercelResponse(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (obj) => {
    if (!res.headersSent) res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
    return res;
  };
  res.send = (data) => {
    res.end(data);
    return res;
  };
  return res;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 2_000_000) reject(new Error('body too large'));
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

server.listen(PORT, () => {
  console.log(`헤뤼싀 → http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('※ ANTHROPIC_API_KEY 가 없습니다. 대화는 안 되지만 화면은 볼 수 있습니다.');
  }
});
