import { expiresAt, reportState, watchReportExpiry } from "./forums/reportLifecycle.js";

// Maintain a Leaflet layer for active verified warnings. Reports at identical
// coordinates share a marker but retain separate popup entries.
export function createWarningLayer({ map, L }) {
    const layer = L.layerGroup().addTo(map);
    const markers = new Map();
    let latestReports = [], latestCached = false;
    const icon = L.divIcon({ className: "verified-warning-marker", html: '<span aria-hidden="true">!</span>', iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -19] });
    const control = L.control({ position: "bottomleft" });
    const status = document.createElement("div");
    status.className = "map-warning-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.textContent = "Loading verified warnings…";
    control.onAdd = () => { L.DomEvent.disableClickPropagation(status); L.DomEvent.disableScrollPropagation(status); return status; };
    control.addTo(map);
    function node(tag, text, className) {
        const element = document.createElement(tag);
        element.textContent = text;
        if (className) element.className = className;
        return element;
    }
    const date = timestamp => timestamp?.toDate?.().toLocaleString() || "Time unavailable";
    function valid(report) {
        const point = report.location;
        return report.category === "Alert" && report.verification?.status === "approved" && !report.pending && reportState(report) === "active"
            && typeof point?.latitude === "number" && Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90
            && typeof point?.longitude === "number" && Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180;
    }
    function popup(reports) {
        // Build DOM nodes with textContent so report text cannot become HTML.
        const container = node("section", "", "warning-popup");
        container.setAttribute("aria-label", "Verified warning details");
        for (const report of reports) {
            const article = node("article", "");
            const count = report.confirmationCount || 0;
            article.append(node("p", "Verified warning", "warning-popup-badge"), node("h3", report.title),
                node("p", report.location.label, "warning-popup-location"), node("p", report.body, "warning-popup-body"),
                node("p", `${count} user confirmation${count === 1 ? "" : "s"}`, "warning-popup-meta"),
                node("p", `Reported by ${report.name} · ${date(report.createdAt)}`, "warning-popup-meta"),
                node("p", `Approved by ${report.verification.verifierName} · ${date(report.verification.approvedAt)}`, "warning-popup-meta"),
                node("p", `Expires ${new Date(expiresAt(report)).toLocaleString()}`, "warning-popup-meta"));
            container.append(article);
        }
        return container;
    }
    const view = {
        setReports(reports, cached = false) {
            latestReports = reports; latestCached = cached;
            const groups = new Map();
            for (const report of reports.filter(valid)) {
                const key = `${report.location.latitude},${report.location.longitude}`;
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key).push(report);
            }
            // Reconcile by coordinate, preserving existing markers when a
            // report changes and removing them on resolution or expiry.
            for (const [key, marker] of markers) if (!groups.has(key)) { layer.removeLayer(marker); markers.delete(key); }
            for (const [key, items] of groups) {
                const title = items.length === 1 ? `Verified warning: ${items[0].title}` : `${items.length} verified warnings at ${items[0].location.label}`;
                let marker = markers.get(key);
                if (!marker) {
                    marker = L.marker([items[0].location.latitude, items[0].location.longitude], { icon, title, keyboard: true, zIndexOffset: 1000 })
                        .bindPopup(popup(items), { minWidth: 220, maxWidth: 320, maxHeight: 300 }).addTo(layer);
                    markers.set(key, marker);
                } else marker.setPopupContent(popup(items));
                const element = marker.getElement();
                if (element) { element.setAttribute("title", title); element.setAttribute("aria-label", title); }
            }
            const count = [...groups.values()].reduce((sum, items) => sum + items.length, 0);
            status.textContent = `${count} verified warning${count === 1 ? "" : "s"}${cached ? " · Saved data; reconnecting…" : ""}`;
            expiry.refresh();
        },
        setStatus(message) { status.textContent = message; },
        clear() { latestReports = []; layer.clearLayers(); markers.clear(); expiry.refresh(); },
        dispose() { expiry.dispose(); layer.remove(); control.remove(); markers.clear(); }
    };
    const expiry = watchReportExpiry(() => latestReports, () => view.setReports(latestReports, latestCached));
    return view;
}
