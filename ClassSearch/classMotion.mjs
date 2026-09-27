// A single interruptible camera transition. Zoom moves monotonically toward
// its target (no flyTo zoom-out arc); UI stays stationary throughout.
export function locateOnMap({ map, coordinates, center = coordinates, zoom = 18,
    reducedMotion = false, onArrival, onCancel, duration = 2800,
    requestFrame = requestAnimationFrame, cancelFrame = cancelAnimationFrame,
    now = () => performance.now() }) {
    let active = true, frame, driving = false;
    const container = map.getContainer();
    const snap = map.options.zoomSnap;
    // Leaflet.stop() rounds fractional zoom when zoomSnap is enabled.
    // Temporarily disable it before stopping to avoid an abrupt last jump.
    map.options.zoomSnap = 0;
    map.stop();
    zoom = Math.min(zoom, map.getMaxZoom());
    const startCenter = map.getCenter(), startZoom = map.getZoom();
    const cleanup = () => {
        cancelFrame(frame);
        map.options.zoomSnap = snap;
        map.off('moveend', externalMove);
        container.removeEventListener('pointerdown', cancel);
        container.removeEventListener('wheel', cancel);
        container.removeEventListener('keydown', keyCancel);
    };
    const cancel = () => {
        if (!active) return;
        active = false; map.stop(); cleanup(); onCancel?.();
    };
    const keyCancel = event => {
        if (['Escape','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','+','-','='].includes(event.key)) cancel();
    };
    const externalMove = () => { if (!driving) cancel(); };
    const setView = (point, level) => {
        driving = true;
        map.setView(point, level, { animate: false });
        driving = false;
    };
    const finish = () => {
        if (!active) return;
        setView(center, zoom); active = false; cleanup(); onArrival?.();
    };
    map.options.zoomSnap = 0;
    if (reducedMotion || (map.distance(startCenter, center) < 5 && Math.abs(startZoom-zoom)<.01)) {
        finish(); return cancel;
    }
    container.addEventListener('pointerdown', cancel, { passive: true });
    container.addEventListener('wheel', cancel, { passive: true });
    container.addEventListener('keydown', keyCancel);
    map.on('moveend', externalMove);
    map.options.zoomSnap = 0;
    const from = map.project(startCenter, zoom), to = map.project(center, zoom);
    const started = now();
    function tick(time) {
        if (!active) return;
        const t = Math.min(1, Math.max(0, (time - started) / duration));
        // Quintic smoothstep: zero velocity and acceleration at both ends.
        const eased = t*t*t*(t*(t*6-15)+10);
        if (t === 1) { finish(); return; }
        const position = map.unproject([from.x+(to.x-from.x)*eased, from.y+(to.y-from.y)*eased], zoom);
        setView(position, startZoom+(zoom-startZoom)*eased);
        frame = requestFrame(tick);
    }
    frame = requestFrame(tick);
    return cancel;
}
