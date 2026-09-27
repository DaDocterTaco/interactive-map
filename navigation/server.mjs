import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const entries = ['index.html', 'demo.js', 'demo.css', 'index.js', 'geometry.js', 'graphProvider.js',
  'leafletRenderer.js', 'locations.js', 'routeProgress.js', 'liveNavigation.js', 'browserLocationSource.js',
  'data/campus-places.json', 'data/campus-graph.json', 'data/demo-places.json', 'data/demo-context.json'];
const allowed = new Set(entries.map(path => `/${path}`));
const types = { html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/json' };
const port = Number(process.env.PORT || 8770);
createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const path = pathname === '/' ? '/index.html' : pathname;
  if (!allowed.has(path) || !['GET', 'HEAD'].includes(request.method)) return response.writeHead(404).end();
  try {
    const body = await readFile(new URL(`.${path}`, import.meta.url));
    response.writeHead(200, { 'Content-Type': `${types[path.split('.').at(-1)]}; charset=utf-8`, 'Cache-Control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch { response.writeHead(500).end('Preview file unavailable'); }
}).listen(port, '127.0.0.1', () => console.log(`Navigation preview: http://localhost:${port}/`));
