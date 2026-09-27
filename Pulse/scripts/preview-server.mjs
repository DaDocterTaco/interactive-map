import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const shellRoot = process.env.PULSE_SHELL_ROOT && path.resolve(process.env.PULSE_SHELL_ROOT);
http.createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const relative = pathname === '/' ? 'preview/index.html' : pathname.slice(1);
    // Optional local shell rehearsal: only these public UI assets are exposed.
    if (shellRoot && /^CampusUI\/(shell\.js|campus\.css|fiu-logo\.png|icons\/[a-z0-9-]+\.svg|fonts\/InterVariable\.woff2)$/.test(relative)) {
      const content = await readFile(path.join(shellRoot, relative));
      response.writeHead(200, { 'Content-Type': types[path.extname(relative)], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(request.method === 'HEAD' ? undefined : content); return;
    }
    if (!/^(preview|client|shared)\/[a-zA-Z0-9_./-]+$/.test(relative) || relative.split('/').some(p => p === '..' || p.startsWith('.')) || !types[path.extname(relative)]) {
      response.writeHead(404).end(); return;
    }
    const file = path.resolve(root, relative);
    if (!file.startsWith(root)) { response.writeHead(404).end(); return; }
    const content = await readFile(file);
    response.writeHead(200, { 'Content-Type': types[path.extname(file)], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch { response.writeHead(404).end(); }
}).listen(Number(process.env.PULSE_PREVIEW_PORT || 8787), '127.0.0.1', () => console.log(`Pulse rehearsal: http://127.0.0.1:${process.env.PULSE_PREVIEW_PORT || 8787}/preview/index.html?device=1`));
