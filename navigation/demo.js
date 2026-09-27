import { createNavigation, createGraphProvider, createRouteController } from './index.js';

const $ = id => document.getElementById(id);
const map = $('map');
const svgNS = 'http://www.w3.org/2000/svg';
function element(name, attrs, text) {
  const node = document.createElementNS(svgNS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text) node.textContent = text;
  return node;
}
try {
  const [graph, directory, context] = await Promise.all(['campus-graph', 'demo-places', 'demo-context'].map(async name => {
    const response = await fetch(`./data/${name}.json`);
    if (!response.ok) throw new Error('Campus data could not be loaded. Refresh to retry.');
    return response.json();
  }));
  const places = new Map(directory.places.map(p => [p.id, p]));
  for (const place of places.values()) {
    for (const id of ['from', 'to']) $(id).add(new Option(`${place.id} · ${place.name}`, place.id));
  }
  $('from').value = 'GC'; $('to').value = 'GL';
  const all = context.boundary;
  const minLng = Math.min(...all.map(p => p[0])), maxLng = Math.max(...all.map(p => p[0]));
  const minLat = Math.min(...all.map(p => p[1])), maxLat = Math.max(...all.map(p => p[1]));
  const cosine = Math.cos((minLat + maxLat) / 2 * Math.PI / 180);
  const scale = Math.min(820 / ((maxLng - minLng) * cosine), 680 / (maxLat - minLat));
  const width = (maxLng - minLng) * cosine * scale, height = (maxLat - minLat) * scale;
  const xy = ([lng, lat]) => [450 - width / 2 + (lng - minLng) * cosine * scale, 380 + height / 2 - (lat - minLat) * scale];
  const line = coords => coords.map((p, i) => `${i ? 'L' : 'M'}${xy(p).join(',')}`).join(' ');
  map.append(element('path', { d: line(context.boundary) + 'Z', fill: '#e6eedf', stroke: '#d1ddc9', 'stroke-width': 2 }));
  for (const footprint of context.buildings) map.append(element('path', { d: line(footprint) + 'Z', fill: '#d8ddd2', stroke: '#bcc9b7', 'stroke-width': 1 }));
  const pathData = graph.links.map(([a, b]) => line([graph.nodes[a], graph.nodes[b]].map(([lat, lng]) => [lng, lat]))).join(' ');
  map.append(element('path', { d: pathData, stroke: '#fbfcf6', 'stroke-width': 4, fill: 'none' }));
  map.append(element('path', { d: pathData, stroke: '#b8c7b6', 'stroke-width': 1.2, fill: 'none' }));
  for (const place of places.values()) {
    const [x, y] = xy([place.lng, place.lat]);
    map.append(element('text', { x, y, 'text-anchor': 'middle' }, place.id));
  }
  const routeLayer = element('g', {}); map.append(routeLayer);
  const renderer = {
    clear() { routeLayer.replaceChildren(); },
    show(route) {
      this.clear();
      const d = line(route.geometry.coordinates);
      routeLayer.append(element('path', { d, fill: 'none', stroke: '#fff', 'stroke-width': 8 }));
      routeLayer.append(element('path', { d, fill: 'none', stroke: '#255de8', 'stroke-width': 4 }));
      for (const [p, label] of [[route.geometry.coordinates[0], 'A'], [route.geometry.coordinates.at(-1), 'B']]) {
        const [cx, cy] = xy(p);
        routeLayer.append(element('circle', { cx, cy, r: 6, fill: '#fff', stroke: '#255de8', 'stroke-width': 3 }));
        routeLayer.append(element('text', { x: cx + 11, y: cy - 8, class: 'endpoint' }, label));
      }
    },
    dispose() { this.clear(); },
  };
  const navigation = createNavigation({ provider: createGraphProvider(graph) });
  const controller = createRouteController({ navigation, renderer, onState(state) {
    $('result').hidden = state.status !== 'ready';
    $('status').dataset.error = String(state.status === 'error');
    if (state.status === 'loading') $('status').textContent = 'Finding a connected path…';
    if (state.status === 'error') { $('status').textContent = state.error.message; $('map-label').textContent = 'No route displayed'; }
    if (state.status === 'idle') $('status').textContent = 'Choose two locations.';
    if (state.status === 'ready') {
      const route = state.route;
      $('status').textContent = 'Route ready · estimates for the mapped outdoor path';
      $('time').textContent = route.durationSeconds === 0 ? '0 min' : `${Math.max(1, Math.ceil(route.durationSeconds / 60))} min`;
      $('distance').textContent = `${Math.round(route.distanceMeters)} m`;
      $('summary').textContent = `${$('from').value} → ${$('to').value} · ${$('mode').selectedOptions[0].textContent}`;
      $('map-label').textContent = `${$('from').value} → ${$('to').value}`;
      $('warnings').replaceChildren(...route.warnings.map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
      $('steps').replaceChildren(...route.steps.map(step => { const li = document.createElement('li');
        li.textContent = `${step.activity === 'dismount' ? 'Dismount and walk' : 'Follow'} ${step.name} · ${Math.round(step.distanceMeters)} m`; return li; }));
    }
  } });
  async function calculate(event) {
    event?.preventDefault();
    try {
      await controller.route({ from: places.get($('from').value), to: places.get($('to').value),
        mode: $('mode').value, preference: $('preference').value,
        allowUnverifiedRiding: $('riding').checked });
    } catch { /* Error is rendered by onState. */ }
  }
  $('route-form').addEventListener('submit', calculate);
  $('route-form').addEventListener('change', () => { controller.clear(); $('map-label').textContent = 'Find route to update'; });
  $('submit').disabled = false;
  await calculate();
  window.addEventListener('pagehide', () => controller.clear());
} catch (error) {
  $('status').textContent = error.message;
  $('status').dataset.error = 'true';
}
