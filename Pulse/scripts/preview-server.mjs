import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
http.createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const relative = pathname === '/' ? 'preview/index.html' : pathname.slice(1);
    if (!/^(preview|client|shared)\/[a-zA-Z0-9_./-]+$/.test(relative) || relative.split('/').some(p => p === '..' || p.startsWith('.')) || !types[path.extname(relative)]) {
      response.writeHead(404).end(); return;
    }
    const file = path.resolve(root, relative);
    if (!file.startsWith(root)) { response.writeHead(404).end(); return; }
    const content = await readFile(file);
    response.writeHead(200, { 'Content-Type': types[path.extname(file)], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch { response.writeHead(404).end(); }
}).listen(8787, '127.0.0.1', () => console.log('Pulse rehearsal: http://127.0.0.1:8787/preview/index.html?device=1'));
