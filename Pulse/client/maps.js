import { iconMarkup } from './view.js';

// Real venue coordinates and the same OpenStreetMap source as Class Search.
// The preview never draws a walking route or shows the user's GPS position.
export function createMapPreviews({ L, dialog }) {
  const previews = new Map();
  let disposed = false;
  const observer = new ResizeObserver(() => {
    for (const entry of previews.values()) if (entry.host.clientWidth && entry.host.clientHeight) {
      entry.map.invalidateSize({ animate: false });
      if (entry.bounds) entry.map.fitBounds(entry.bounds, { paddingTopLeft: [65, 65], paddingBottomRight: [65, 30], maxZoom: entry.count === 1 ? 18 : 16, animate: false });
    }
  });
  function render(name, spots, selectedId) {
    if (!L || disposed) return;
    const host = dialog.querySelector(`[data-${name}-map]`);
    if (!host || !host.clientWidth || !host.clientHeight || !spots.length) return;
    let entry = previews.get(name);
    if (!entry) {
      host.replaceChildren();
      const canvas = document.createElement('div'); canvas.setAttribute('aria-hidden', 'true'); host.append(canvas);
      const preview = L.map(canvas, { zoomControl: false, attributionControl: true, dragging: false, scrollWheelZoom: false, doubleClickZoom: false,
        boxZoom: false, keyboard: false, touchZoom: false, zoomAnimation: false, fadeAnimation: false });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' }).addTo(preview);
      entry = { host, map: preview, group: L.layerGroup().addTo(preview), signature: '' }; previews.set(name, entry); observer.observe(host);
    }
    const signature = JSON.stringify(spots.map(s => [s.id, s.name, s.latitude, s.longitude])) + selectedId;
    if (entry.signature !== signature) {
      entry.signature = signature; entry.group.clearLayers();
      const positions = [];
      for (const spot of spots) {
        if (!Number.isFinite(spot.latitude) || !Number.isFinite(spot.longitude)) continue;
        const position = [spot.latitude, spot.longitude]; positions.push(position);
        const icon = L.divIcon({ className: 'pulse-map-pin', html: iconMarkup('map-pin'), iconSize: [34, 34], iconAnchor: [17, 29] });
        const label = document.createElement('span'); label.textContent = spot.name.split(' · ')[0];
        L.marker(position, { icon, interactive: false, keyboard: false, opacity: selectedId && selectedId !== spot.id ? .6 : 1 })
          .bindTooltip(label, { permanent: true, direction: spot.id === 'pond-benches' ? 'left' : spot.id === 'gc-cafe-bustelo' ? 'right' : 'top', offset: spot.id === 'chick-fil-a' ? [0, -24] : [0, -10] }).addTo(entry.group);
      }
      if (positions.length) { entry.bounds = L.latLngBounds(positions); entry.count = positions.length; }
      host.setAttribute('aria-label', `Meeting location preview: ${spots.map(s => s.name).join(', ')}`);
    }
    requestAnimationFrame(() => {
      if (!disposed && host.clientWidth && entry.bounds) { entry.map.invalidateSize({ animate: false }); entry.map.fitBounds(entry.bounds, { paddingTopLeft: [65, 65], paddingBottomRight: [65, 30], maxZoom: entry.count === 1 ? 18 : 16, animate: false }); }
    });
  }
  return { render, dispose() { disposed = true; observer.disconnect(); for (const entry of previews.values()) entry.map.remove(); previews.clear(); } };
}
