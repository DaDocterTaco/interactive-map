export type Mode = 'walk' | 'bike' | 'scooter';
export type Point = { lat: number; lng: number };
export type Location = Point | { latitude: number; longitude: number } | { lat: number; lon: number }
  | string | [number, number] | GeolocationPosition
  | { coords: Location } | { fix: Location } | { location: Location } | { position: Location }
  | { building: Location } | { latLng: Location } | { getLatLng(): Location }
  | { type: 'Point'; coordinates: number[] } | { type: 'Feature'; geometry: Location };
export type Resolver = (input: unknown, options?: { signal?: AbortSignal }) => Promise<Point>;
export type Place = Point & { id?: string; name?: string; abbreviation?: string; aliases?: string[] };
export type ArrayOrder = 'latlng' | 'lnglat';
export function normalizeLocation(input: unknown, options?: { arrayOrder?: ArrayOrder }): Point;
export function createLocationResolver(options?: { places?: Place[]; arrayOrder?: ArrayOrder;
  resolveText?: (text: string, options: { signal?: AbortSignal }) => Promise<Location> }): Resolver;
export function createCampusLocationResolver(options?: { catalogUrl?: string | URL; fetchImpl?: typeof fetch;
  arrayOrder?: ArrayOrder; resolveText?: (text: string, options: { signal?: AbortSignal }) => Promise<Location> }): Resolver;
export type RouteRequest = {
  from: Location;
  to: Location;
  mode?: Mode;
  preference?: 'fastest' | 'shortest';
  avoidSteps?: boolean;
  allowUnverifiedRiding?: boolean;
  maxSnapMeters?: number;
  speeds?: Partial<Record<Mode, number>>;
  blockedLinkIds?: string[];
};
export type Route = {
  provider: string;
  mode: Mode;
  preference: 'fastest' | 'shortest';
  distanceMeters: number;
  durationSeconds: number;
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  endpoints: Record<'from' | 'to', { requested: Point; snapped: Point; offsetMeters: number }>;
  steps: { name: string; kind: string; activity: Mode | 'dismount'; distanceMeters: number; durationSeconds: number }[];
  linkIds: string[];
  warnings: string[];
  estimate: true;
  metadata: Record<string, unknown>;
};
export type Provider = { id?: string; getRoute(request: RouteRequest, options?: { signal?: AbortSignal }): Promise<Route> };
export type Navigation = Provider & { clearCache(): void; resolveLocation: Resolver };
export type Renderer = { show(route: Route): void; clear(): void; dispose(): void;
  updatePosition?(position: LiveFix): void; clearPosition?(): void };
export type RouteState = { status: 'idle' | 'loading' } | { status: 'ready'; route: Route } | { status: 'error'; error: Error };
export class NavigationError extends Error { code: string; constructor(code: string, message: string); }
export const DEFAULT_SPEEDS: Readonly<Record<Mode, number>>;
export function createNavigation(options?: { provider?: Provider; cacheSize?: number; resolveLocation?: Resolver }): Navigation;
export function createCampusProvider(options?: { graphUrl?: string | URL; fetchImpl?: typeof fetch }): Provider;
export type GraphProfile = {
  kind: string;
  name?: string;
  sourceWayId?: number;
  rough?: boolean;
  access: { walk: 'travel' | 'no'; bike: 'travel' | 'dismount' | 'unverified' | 'no'; scooter: 'travel' | 'dismount' | 'unverified' | 'no' };
  direction?: Partial<Record<Mode, -1 | 0 | 1>>;
};
export type Graph = { schemaVersion: 1; nodes: [number, number][]; links: [number, number, number][]; profiles: GraphProfile[]; metadata?: Record<string, unknown> };
export function createGraphProvider(graph: Graph): Provider;
export function createLeafletRenderer(options: { map: unknown; L: unknown; color?: string; fitBounds?: boolean }): Renderer;
export function createRouteController(options: { navigation: Provider; renderer?: Renderer; onState?: (state: RouteState) => void }): {
  route(request: RouteRequest): Promise<Route | null>;
  clear(): void;
  dispose(): void;
};
export type LiveFix = Point & { accuracy: number; timestamp: number };
export type Progress = { snapped: Point; distanceFromRouteMeters: number; distanceTravelledMeters: number;
  remainingDistanceMeters: number; remainingDurationSeconds: number; fractionComplete: number; discontinuous: boolean };
export type LiveSettings = {
  staleAfterMs?: number; maxAccuracyMeters?: number; offRouteMeters?: number;
  offRouteConfirmations?: number; rerouteIntervalMs?: number; arrivalMeters?: number;
  arrivalAccuracyMeters?: number; arrivalConfirmations?: number; maxProgressSpeedMps?: number;
};
export type LiveState = {
  status: 'idle' | 'resolving' | 'waiting_location' | 'routing' | 'navigating' | 'rerouting' | 'arrived' | 'error' | 'stopped';
  active: boolean; locationStatus: string; destination: Point | null; position: LiveFix | null;
  route: Route | null; progress: Progress | null; offRoute: boolean;
  error: { code: string; message: string } | null; rerouteCount: number;
};
export type LiveNavigation = {
  start(request: Omit<RouteRequest, 'from'> & { from?: Location }): Promise<LiveState>;
  updatePosition(position: GeolocationPosition | LiveFix | { latitude: number; longitude: number; accuracy: number; timestamp: number } | { fix: LiveFix }): boolean;
  invalidateLocation(reason?: string): void;
  refresh(options?: Omit<Partial<RouteRequest>, 'from' | 'to'>): Promise<LiveState>;
  getState(): LiveState;
  subscribe(listener: (state: LiveState) => void): () => void;
  stop(): void;
  dispose(): void;
};
export function createLiveNavigation(options: { navigation: Provider & { resolveLocation?: Resolver }; renderer?: Renderer;
  onState?: (state: LiveState) => void; settings?: LiveSettings; now?: () => number;
  setTimer?: (fn: () => void, delay: number) => unknown; clearTimer?: (id: unknown) => void }): LiveNavigation;
export function createBrowserLocationSource(options: { live: LiveNavigation; geolocation?: Geolocation;
  secureContext?: boolean; document?: Document; window?: Window }): {
  start(): boolean; stop(): void; dispose(): void; getState(): { tracking: boolean; disposed: boolean };
};
