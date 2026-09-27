// One interruptible journey. The popup never triggers a second automatic pan.
export function locateOnMap({ map, coordinates, reducedMotion = false, onArrival, onCancel }) {
    let active = true;
    const container = map.getContainer();
    const cleanup = () => {
        map.off('moveend', finish);
        container.removeEventListener('pointerdown', cancel);
        container.removeEventListener('wheel', cancel);
        container.removeEventListener('keydown', keyCancel);
    };
    const cancel = () => {
        if (!active) return;
        active = false;
        cleanup();
        map.stop();
        onCancel?.();
    };
    const keyCancel = event => {
        if (['Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', '+', '-', '='].includes(event.key)) cancel();
    };
    const finish = () => {
        if (!active) return;
        // Other map features can replace this flight before it reaches the class.
        if (map.distance(map.getCenter(), coordinates) > 5) { cancel(); return; }
        active = false;
        cleanup();
        onArrival?.();
    };
    map.stop();
    const zoom = Math.min(18, map.getMaxZoom());
    if (reducedMotion) {
        map.setView(coordinates, zoom, { animate: false });
        finish();
    } else if (map.distance(map.getCenter(), coordinates) < 5 && map.getZoom() === zoom) {
        finish();
    } else {
        container.addEventListener('pointerdown', cancel, { passive: true });
        container.addEventListener('wheel', cancel, { passive: true });
        container.addEventListener('keydown', keyCancel);
        map.on('moveend', finish);
        map.flyTo(coordinates, zoom, { duration: 3.2, easeLinearity: 0.15 });
    }
    return cancel;
}
