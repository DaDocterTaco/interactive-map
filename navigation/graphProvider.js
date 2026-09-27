import { NavigationError, point, distance, project, abortIfNeeded } from './geometry.js';

const MODES = ['walk', 'bike', 'scooter'];
// Product assumptions, not measured user speeds or campus speed limits (metres/sec).
export const DEFAULT_SPEEDS = Object.freeze({ walk: 3 * 0.44704, bike: 15 * 0.44704, scooter: 15 * 0.44704 });

class MinHeap {
  items = [];
  push(item) {
    const a = this.items;
    let i = a.length;
    a.push(item);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (a[parent].priority <= item.priority) break;
      a[i] = a[parent]; i = parent;
    }
    a[i] = item;
  }
  pop() {
    const a = this.items;
    const first = a[0], last = a.pop();
    if (a.length) {
      let i = 0;
      while (i * 2 + 1 < a.length) {
        let child = i * 2 + 1;
        if (child + 1 < a.length && a[child + 1].priority < a[child].priority) child++;
        if (a[child].priority >= last.priority) break;
        a[i] = a[child]; i = child;
      }
      a[i] = last;
    }
    return first;
  }
}

/** Compact, map-independent graph. See README for the v1 schema. */
export function createGraphProvider(graph) {
  if (graph?.schemaVersion !== 1 || !Array.isArray(graph.nodes) ||
      !Array.isArray(graph.links) || !Array.isArray(graph.profiles)) {
    throw new NavigationError('INVALID_GRAPH', 'Expected a navigation graph with schemaVersion 1.');
  }
  const nodes = graph.nodes.map(([lat, lng]) => point({ lat, lng }));
  const profiles = graph.profiles.map(profile => {
    if (!profile || !MODES.every(mode => ['travel', 'dismount', 'unverified', 'no'].includes(profile.access?.[mode]))) {
      throw new NavigationError('INVALID_GRAPH', 'Every profile must declare access for all three modes.');
    }
    if (profile.access.walk === 'dismount' || profile.access.walk === 'unverified' ||
        MODES.some(mode => ![-1, 0, 1].includes(profile.direction?.[mode] ?? 0))) {
      throw new NavigationError('INVALID_GRAPH', 'Invalid direction or walking access.');
    }
    return structuredClone(profile);
  });
  const links = graph.links.map(([a, b, p], index) => {
    if (![a, b, p].every(Number.isInteger) || !nodes[a] || !nodes[b] || !profiles[p] || a === b) {
      throw new NavigationError('INVALID_GRAPH', 'A link references an invalid node or profile.');
    }
    return { a, b, profile: profiles[p], id: String(index), length: distance(nodes[a], nodes[b]) };
  });
  const metadata = structuredClone(graph.metadata || {});

  return {
    id: metadata.id || 'local-graph',
    async getRoute(request, { signal } = {}) {
      abortIfNeeded(signal);
      const from = point(request.from), to = point(request.to);
      const mode = request.mode ?? 'walk';
      const preference = request.preference ?? 'fastest';
      const speeds = { ...DEFAULT_SPEEDS, ...request.speeds };
      const maxSnapMeters = request.maxSnapMeters ?? 60;
      if (!MODES.includes(mode)) throw new NavigationError('INVALID_MODE', 'Mode must be walk, bike, or scooter.');
      if (!['fastest', 'shortest'].includes(preference) ||
          !MODES.every(m => Number.isFinite(speeds[m]) && speeds[m] > 0 && speeds[m] <= 15) ||
          !Number.isFinite(maxSnapMeters) || maxSnapMeters < 0 || maxSnapMeters > 250 ||
          (request.allowUnverifiedRiding !== undefined && typeof request.allowUnverifiedRiding !== 'boolean') ||
          (request.avoidSteps !== undefined && typeof request.avoidSteps !== 'boolean') ||
          (request.blockedLinkIds !== undefined && !Array.isArray(request.blockedLinkIds))) {
        throw new NavigationError('INVALID_OPTIONS', 'Check preference, speeds, snapping distance, and route options.');
      }
      const blocked = new Set((request.blockedLinkIds || []).map(String));
      const adjacency = new Map();
      const eligible = [];
      const add = (a, b, link, fraction) => {
        const metres = link.length * fraction;
        const arc = { to: b, link, distanceMeters: metres, durationSeconds: metres / link.speed };
        if (!adjacency.has(a)) adjacency.set(a, []);
        adjacency.get(a).push(arc);
      };
      for (const source of links) {
        const p = source.profile;
        if (blocked.has(source.id) || p.access[mode] === 'no' ||
            (p.kind === 'steps' && (request.avoidSteps || mode !== 'walk'))) continue;
        const unverified = p.access[mode] === 'unverified';
        const dismount = p.access[mode] === 'dismount' || (unverified && !request.allowUnverifiedRiding);
        // A dismount section still needs pedestrian access.
        if (dismount && p.access.walk === 'no') continue;
        const activity = dismount ? 'dismount' : mode;
        const speed = (dismount ? speeds.walk : speeds[mode]) *
          (p.kind === 'steps' ? 0.55 : p.rough ? 0.7 : 1);
        const direction = p.direction?.[dismount ? 'walk' : mode] ?? 0;
        const link = { ...source, speed, activity, unverified, direction };
        eligible.push(link);
        if (direction >= 0) add(link.a, link.b, link, 1);
        if (direction <= 0) add(link.b, link.a, link, 1);
      }
      const snap = location => {
        let best;
        for (const link of eligible) {
          const candidate = { ...project(location, nodes[link.a], nodes[link.b]), link };
          if (!best || candidate.offsetMeters < best.offsetMeters) best = candidate;
        }
        if (!best || best.offsetMeters > maxSnapMeters) {
          throw new NavigationError('OUTSIDE_NETWORK', 'This location is too far from a mapped path for this mode.');
        }
        return best;
      };
      const start = snap(from), finish = snap(to);
      // Query-local virtual nodes split the nearest segments without changing the graph.
      const START = nodes.length, FINISH = nodes.length + 1;
      const coordinates = [...nodes, start.location, finish.location];
      for (const [s, id, isStart] of [[start, START, true], [finish, FINISH, false]]) {
        const { link, t } = s;
        if (isStart) {
          if (link.direction <= 0 || t === 0) add(id, link.a, link, t);
          if (link.direction >= 0 || t === 1) add(id, link.b, link, 1 - t);
        } else {
          if (link.direction >= 0 || t === 0) add(link.a, id, link, t);
          if (link.direction <= 0 || t === 1) add(link.b, id, link, 1 - t);
        }
      }
      if (start.link.id === finish.link.id) {
        const delta = finish.t - start.t;
        if (delta === 0 || (delta > 0 && start.link.direction >= 0) || (delta < 0 && start.link.direction <= 0)) {
          add(START, FINISH, start.link, Math.abs(delta));
        }
      }
      const maxSpeed = Math.max(...Object.values(speeds));
      const heuristic = id => distance(coordinates[id], finish.location) /
        (preference === 'fastest' ? maxSpeed : 1);
      const cost = new Map([[START, 0]]), previous = new Map();
      const queue = new MinHeap();
      queue.push({ id: START, cost: 0, priority: heuristic(START) });
      while (queue.items.length) {
        abortIfNeeded(signal);
        const current = queue.pop();
        if (current.cost !== cost.get(current.id)) continue;
        if (current.id === FINISH) break;
        for (const arc of adjacency.get(current.id) || []) {
          const nextCost = current.cost + (preference === 'fastest' ? arc.durationSeconds : arc.distanceMeters);
          if (nextCost >= (cost.get(arc.to) ?? Infinity)) continue;
          cost.set(arc.to, nextCost);
          previous.set(arc.to, { from: current.id, ...arc });
          queue.push({ id: arc.to, cost: nextCost, priority: nextCost + heuristic(arc.to) });
        }
      }
      if (!previous.has(FINISH)) throw new NavigationError('NO_ROUTE', 'No connected mapped route was found for these locations and options.');
      const arcs = [];
      for (let id = FINISH; id !== START;) {
        const arc = previous.get(id); arcs.push(arc); id = arc.from;
      }
      arcs.reverse();
      const routePoints = [start.location, ...arcs.map(arc => coordinates[arc.to])];
      const path = routePoints.filter((p, i) => i === 0 || distance(routePoints[i - 1], p) > 0.001);
      if (path.length === 1) path.push({ ...path[0] });
      const steps = [];
      for (const arc of arcs.filter(a => a.distanceMeters > 0.001)) {
        const p = arc.link.profile;
        const name = p.name || (p.kind === 'steps' ? 'Steps' : 'Campus path');
        const prior = steps.at(-1);
        if (prior?.name === name && prior.activity === arc.link.activity && prior.kind === p.kind) {
          prior.distanceMeters += arc.distanceMeters;
          prior.durationSeconds += arc.durationSeconds;
        } else {
          steps.push({ name, kind: p.kind, activity: arc.link.activity,
            distanceMeters: arc.distanceMeters, durationSeconds: arc.durationSeconds });
        }
      }
      const warnings = ['Estimates cover the mapped outdoor path; indoor travel and live closures are not included.'];
      if (start.offsetMeters > 3 || finish.offsetMeters > 3) {
        warnings.push('One or both locations are off the path. Access to the path or building entrance is unverified and excluded from the distance and time.');
      }
      if (arcs.some(a => a.distanceMeters > 0 && a.link.unverified)) warnings.push(request.allowUnverifiedRiding
        ? 'Riding access is unverified on some paths. Riding times are provisional; follow posted signs and dismount where required.'
        : 'Riding access is unverified on some paths. Those sections use walking speed and require dismounting.');
      if (arcs.some(a => a.distanceMeters > 0 && a.link.activity === 'dismount')) warnings.push('This route includes walking with your bike or scooter.');
      return {
        provider: metadata.id || 'local-graph', mode, preference,
        distanceMeters: arcs.reduce((sum, a) => sum + a.distanceMeters, 0),
        durationSeconds: arcs.reduce((sum, a) => sum + a.durationSeconds, 0),
        geometry: { type: 'LineString', coordinates: path.map(p => [p.lng, p.lat]) },
        endpoints: {
          from: { requested: from, snapped: start.location, offsetMeters: start.offsetMeters },
          to: { requested: to, snapped: finish.location, offsetMeters: finish.offsetMeters },
        },
        steps, linkIds: [...new Set(arcs.filter(a => a.distanceMeters > 0).map(a => a.link.id))],
        warnings, estimate: true, metadata: structuredClone(metadata),
      };
    },
  };
}
