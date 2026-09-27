// Build time only. Runtime never reads another feature's folder or calls OSM.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
const sourceRoot = process.argv[2] ? pathToFileURL(resolve(process.argv[2]) + '/') : new URL('../fiu-model/data/', root);
const raw = await readFile(new URL('osm-campus.json', sourceRoot));
const source = JSON.parse(raw);
const boundary = JSON.parse(await readFile(new URL('campus-boundary.geojson', sourceRoot)));
const official = JSON.parse(await readFile(new URL('official-building-points.json', sourceRoot)));
const ring = boundary.geometry.coordinates[0];
function inside({ lat, lon }) {
  let yes = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) yes = !yes;
  }
  return yes;
}
const allowed = new Set(['yes', 'designated', 'permissive', 'official']);
const denied = value => value !== undefined && !allowed.has(value);
const pathKinds = new Set(['footway', 'path', 'pedestrian', 'cycleway', 'steps']);
const nodes = [], links = [], profiles = [], nodeIndexes = new Map();
const nodeTags = new Map(source.elements.filter(e => e.type === 'node').map(n => [n.id, n.tags || {}]));
function blockedNode(id) {
  const t = nodeTags.get(id) || {};
  return denied(t.foot ?? t.access) || t.locked === 'yes' ||
    Object.keys(t).some(k => /^(access|foot|bicycle).*:conditional$/.test(k)) ||
    (t.barrier && !['kerb', 'bollard', 'entrance'].includes(t.barrier) && !allowed.has(t.foot));
}
const direction = value => value === '-1' ? -1 : ['yes', '1', 'true'].includes(value) ? 1 : 0;
function addNode(id, position) {
  if (!nodeIndexes.has(id)) {
    nodeIndexes.set(id, nodes.length);
    nodes.push([position.lat, position.lon]);
  }
  return nodeIndexes.get(id);
}
let excludedWays = 0;
for (const way of source.elements) {
  const t = way.tags || {};
  if (way.type !== 'way' || !pathKinds.has(t.highway)) continue;
  if (!way.geometry || !way.nodes || t.area === 'yes' || t.indoor === 'yes' || t.level ||
      denied(t.foot ?? t.access) || t.construction || t.highway === 'cycleway' && !allowed.has(t.foot) ||
      Object.keys(t).some(k => /^(access|foot|bicycle|scooter|oneway).*:conditional$/.test(k))) {
    excludedWays++; continue;
  }
  const bike = t.bicycle === 'dismount' || denied(t.bicycle ?? t.vehicle ?? t.access)
    ? 'dismount' : allowed.has(t.bicycle) || t.highway === 'cycleway' ? 'travel' : 'unverified';
  // Scooter permissions are independent of bicycle permissions.
  const scooter = denied(t.scooter ?? t.access) ? 'dismount' : allowed.has(t.scooter) ? 'travel' : 'unverified';
  const profile = {
    sourceWayId: way.id, kind: t.highway,
    ...(t.name ? { name: t.name } : {}),
    ...(t.surface && ['gravel', 'sand', 'unpaved', 'ground', 'dirt', 'grass'].includes(t.surface) ? { rough: true } : {}),
    access: { walk: 'travel', bike: t.highway === 'steps' ? 'no' : bike, scooter: t.highway === 'steps' ? 'no' : scooter },
    direction: { walk: direction(t['oneway:foot']), bike: direction(t['oneway:bicycle'] ?? t.oneway),
      scooter: direction(t['oneway:scooter'] ?? t.oneway) },
  };
  let profileIndex;
  for (let i = 1; i < way.nodes.length; i++) {
    const a = way.geometry[i - 1], b = way.geometry[i];
    if (!a || !b || blockedNode(way.nodes[i - 1]) || blockedNode(way.nodes[i])) continue;
    // Stay inside the campus; no synthetic junctions where lines visually cross.
    if (![0, 0.25, 0.5, 0.75, 1].every(f => inside({ lat: a.lat + f * (b.lat - a.lat), lon: a.lon + f * (b.lon - a.lon) }))) continue;
    const start = addNode(way.nodes[i - 1], a), end = addNode(way.nodes[i], b);
    if (start === end) continue;
    if (profileIndex === undefined) { profileIndex = profiles.length; profiles.push(profile); }
    links.push([start, end, profileIndex]);
  }
}
const metadata = {
  id: 'fiu-mmc-paths-v1', source: source.source,
  sourceSha256: createHash('sha256').update(raw).digest('hex'),
  builtAt: new Date().toISOString(), sourceTimestamp: null,
  attribution: '© OpenStreetMap contributors', license: 'ODbL-1.0',
  licenseUrl: 'https://www.openstreetmap.org/copyright',
  scope: 'Mapped outdoor paths within FIU MMC. Incomplete, unaudited routing coverage.',
};
const graph = { schemaVersion: 1, metadata, nodes, links, profiles };
const dataDir = new URL('data/', root);
await mkdir(dataDir, { recursive: true });
await writeFile(new URL('campus-graph.json', dataDir), JSON.stringify(graph));
const aliases = { GL: ['Green Library', 'Library'], GC: ['Graham Center'], PC: ['Primera Casa'] };
await writeFile(new URL('campus-places.json', dataDir), JSON.stringify({
  source: official.source, retrieved: official.retrieved,
  note: 'Building pins, not surveyed entrances. Catalog entries may be outside routing coverage.',
  places: official.points.map(p => ({ id: p.abbreviation, name: p.name,
    lat: p.lat, lng: p.lon, ...(aliases[p.abbreviation] ? { aliases: aliases[p.abbreviation] } : {}) })),
}, null, 2));
const codes = new Set(['GC', 'GL', 'PC', 'DM', 'PG1', 'SIPA', 'PPFAM', 'AHC2']);
await writeFile(new URL('demo-places.json', dataDir), JSON.stringify({
  source: official.source, retrieved: official.retrieved,
  note: 'Official building pins; not surveyed entrances.',
  places: official.points.filter(p => codes.has(p.abbreviation)).map(p => ({
    id: p.abbreviation, name: p.name, lat: p.lat, lng: p.lon,
  })),
}, null, 2));
// Display context only. Building polygons are never used to invent graph connections.
const buildings = source.elements.filter(e => e.type === 'way' && e.tags?.building &&
  e.geometry?.length >= 4 && e.geometry.some(inside)).map(e => e.geometry.map(p => [p.lon, p.lat]));
await writeFile(new URL('demo-context.json', dataDir), JSON.stringify({ boundary: ring, buildings }));
console.log(JSON.stringify({ nodes: nodes.length, links: links.length, profiles: profiles.length,
  excludedWays, graphBytes: Buffer.byteLength(JSON.stringify(graph)) }, null, 2));
