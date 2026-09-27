/** Uses the host's Leaflet instance; creates no map and changes no global state. */
export function createLeafletRenderer({ map, L, color = '#255de8', fitBounds = true }) {
  if (!map || !L?.layerGroup || !L?.polyline) throw new TypeError('Supply map and L.');
  const group = L.layerGroup().addTo(map);
  let disposed = false;
  let positionMarker = null;
  let accuracyCircle = null;
  function clearPosition() {
    if (positionMarker) group.removeLayer(positionMarker);
    if (accuracyCircle) group.removeLayer(accuracyCircle);
    positionMarker = accuracyCircle = null;
  }
  return {
    show(route) {
      if (disposed) throw new Error('Renderer has been disposed.');
      group.clearLayers();
      positionMarker = accuracyCircle = null;
      const points = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
      L.polyline(points, { color: '#fff', weight: 9, opacity: 0.95, interactive: false }).addTo(group);
      const line = L.polyline(points, { color, weight: 5, opacity: 0.95, interactive: false }).addTo(group);
      for (const [index, label] of [[0, 'Mapped route start'], [points.length - 1, 'Mapped route end']]) {
        L.circleMarker(points[index], { radius: 6, color, weight: 3, fillColor: '#fff', fillOpacity: 1 })
          .bindTooltip(label).addTo(group);
      }
      if (fitBounds && line.getBounds().isValid()) map.fitBounds(line.getBounds(), { padding: [40, 40], maxZoom: 18 });
    },
    updatePosition(fix) {
      if (disposed) return;
      const coordinates = [fix.lat, fix.lng];
      if (positionMarker) positionMarker.setLatLng(coordinates);
      else positionMarker = L.circleMarker(coordinates, { radius: 7, color: '#fff', weight: 3,
        fillColor: color, fillOpacity: 1 }).bindTooltip('Current location').addTo(group);
      if (L.circle && Number.isFinite(fix.accuracy)) {
        if (accuracyCircle) accuracyCircle.setLatLng(coordinates).setRadius(fix.accuracy);
        else accuracyCircle = L.circle(coordinates, { radius: fix.accuracy, color, weight: 1,
          fillColor: color, fillOpacity: 0.08, interactive: false }).addTo(group);
      }
    },
    clearPosition() { if (!disposed) clearPosition(); },
    clear() { if (!disposed) { group.clearLayers(); positionMarker = accuracyCircle = null; } },
    dispose() { if (!disposed) { group.clearLayers(); positionMarker = accuracyCircle = null; map.removeLayer(group); disposed = true; } },
  };
}
