import '../../CampusUI/mobileInput.js';
import * as service from "./forumService.js?v=alerts-20260927-1";
import { expiresAt, reportState, alertStatus, alertLabels, visibleOnMap, watchReportExpiry } from "./reportLifecycle.js?v=alerts-20260927-1";

// Alert-specific composer and thread controls. The location picker is its own
// Leaflet map, independent of the campus map and warning marker layer.
let leafletLoading;
function leaflet() {
    // The standalone chat page does not load Leaflet until a user needs it.
    if (window.L) return Promise.resolve(window.L);
    if (!leafletLoading) leafletLoading = new Promise((resolve, reject) => {
        const css = document.createElement("link"); css.rel = "stylesheet";
        css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        css.integrity = "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="; css.crossOrigin = "";
        document.head.append(css);
        const script = document.createElement("script");
        script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
        script.integrity = "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo="; script.crossOrigin = "";
        script.onload = () => resolve(window.L);
        script.onerror = () => { leafletLoading = null; reject(Error("Location picker unavailable. Enter coordinates below.")); };
        document.head.append(script);
    });
    return leafletLoading;
}

export function mountAlerts({ user }) {
    const $ = id => document.getElementById(id), events = new AbortController();
    const on = (id, type, fn) => $(id).addEventListener(type, fn, { signal: events.signal });
    const mobile = matchMedia("(max-width: 900px)");
    let map, marker, preview, previewMarker, observer, buildings, disposed = false, disabled = false, visible = false;
    let post = null, stopConfirmation, version = 0, confirmed = null, busy = false, verifier = false, previewVersion = 0;
    const expiry = watchReportExpiry(() => post ? [post] : [], controls);
    const locationFields = ["alert-location-label", "alert-latitude", "alert-longitude"];
    let buildingsLoading, locationVersion = 0;
    const shortDate = value => value?.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) || "Just now";
    const stamp = value => value?.toMillis?.() ?? value?.toDate?.().getTime() ?? 0;
    const relative = value => { const minutes = Math.max(0, Math.floor((Date.now() - stamp(value)) / 60000)); return minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.floor(minutes / 60)} hr ago` : shortDate(new Date(stamp(value))); };
    const feedback = (id, message, state = "error") => { $(id).textContent = message; $(id).dataset.state = state; };
    function coordinates() {
        const latitude = $("alert-latitude").value.trim(), longitude = $("alert-longitude").value.trim();
        return { label: $("alert-location-label").value, latitude: latitude === "" ? NaN : Number(latitude), longitude: longitude === "" ? NaN : Number(longitude) };
    }
    function suggestedLocation(latitude, longitude) {
        let nearest, distance = Infinity;
        for (const building of buildings || []) {
            const metres = Math.hypot((building.latitude - latitude) * 111320, (building.longitude - longitude) * 111320 * Math.cos(latitude * Math.PI / 180));
            if (metres < distance) { nearest = building; distance = metres; }
        }
        // Building data contains center points, not entrance or boundary shapes.
        return nearest && distance <= 200 ? `Near ${nearest.full_name}`.slice(0, 120) : `Map location (${latitude.toFixed(5)}, ${longitude.toFixed(5)})`;
    }
    async function selectPoint(point) {
        if (disposed || disabled || !visible) return;
        const token = ++locationVersion, latitude = point.lat, longitude = point.wrap().lng;
        $("alert-latitude").value = latitude.toFixed(6); $("alert-longitude").value = longitude.toFixed(6);
        $("alert-building").value = "";
        $("alert-location-label").value = suggestedLocation(latitude, longitude);
        previewPoint();
        $("alert-longitude").dispatchEvent(new Event("change", { bubbles: true }));
        if (!buildings) {
            await loadBuildings();
            // A slow lookup must never replace a newer pin or the user's own text.
            if (disposed || disabled || !visible || token !== locationVersion) return;
            $("alert-location-label").value = suggestedLocation(latitude, longitude);
            $("alert-location-label").dispatchEvent(new Event("change", { bubbles: true }));
        }
    }
    function previewPoint() {
        const point = coordinates(), valid = Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90 && Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180;
        if (!valid) { marker?.remove(); marker = null; $("alert-picker-status").textContent = "Choose a building or select a spot on the map."; return; }
        if (map) {
            if (marker) marker.setLatLng([point.latitude, point.longitude]);
            else marker = window.L.marker([point.latitude, point.longitude], { title: "Selected report location", draggable: true }).addTo(map).on("dragend", () => selectPoint(marker.getLatLng()));
        }
        $("alert-picker-status").textContent = "Location selected. You can edit the place or landmark above.";
    }
    async function loadBuildings() {
        if (buildings) return;
        if (buildingsLoading) return buildingsLoading;
        buildingsLoading = (async () => {
            try {
                const response = await fetch(new URL("../../Buildings.json", import.meta.url));
                if (!response.ok) throw Error();
                const data = await response.json(); if (disposed) return;
                buildings = data.filter(item => Number.isFinite(item.latitude) && Number.isFinite(item.longitude) && typeof item.full_name === "string" && item.full_name.trim());
                $("alert-buildings").replaceChildren(...buildings.map(item => {
                    const option = document.createElement("option"); option.value = `${item.full_name} (${item.abbreviation})`; return option;
                }));
            } catch { if (!disposed) $("alert-building").placeholder = "Building search unavailable — use the map below"; }
            finally { buildingsLoading = null; }
        })();
        return buildingsLoading;
    }
    let loadingMap;
    async function loadMap() {
        if (loadingMap) return loadingMap;
        loadingMap = (async () => {
            try {
                const L = await leaflet(); if (disposed || !visible) return;
                if (!map) {
                    map = L.map($("alert-location-map"), { scrollWheelZoom: false }).setView([25.75396, -80.37662], 16);
                    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
                    map.on("click", event => selectPoint(event.latlng));
                }
                map.invalidateSize(); previewPoint();
            } catch { if (!disposed) { feedback("alert-picker-status", "Map unavailable. Choose a building or enter coordinates."); $("alert-coordinate-options").open = true; } }
            finally { loadingMap = null; }
        })();
        return loadingMap;
    }
    async function locationPreview() {
        const token = ++previewVersion, current = post;
        if (disposed || !visibleOnMap(current) || mobile.matches) return;
        try {
            const L = await leaflet();
            if (disposed || token !== previewVersion || post?.id !== current.id || mobile.matches) return;
            if (!preview) {
                preview = L.map($("alert-preview-map"), { zoomControl: false, dragging: false, keyboard: false, touchZoom: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false });
                preview.attributionControl.setPrefix(false);
                const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(preview);
                tiles.on("tileerror", () => { $("alert-preview-error").hidden = false; });
                tiles.on("tileload", () => { $("alert-preview-error").hidden = true; });
                observer = new ResizeObserver(() => { if (post && !mobile.matches && $("alert-details").offsetWidth) { preview.invalidateSize({ pan: false }); preview.setView([post.location.latitude, post.location.longitude], 18, { animate: false }); } });
                observer.observe($("alert-preview-map"));
            }
            const point = [current.location.latitude, current.location.longitude];
            preview.invalidateSize({ pan: false }); preview.setView(point, 18, { animate: false });
            if (previewMarker) previewMarker.setLatLng(point); else previewMarker = L.marker(point, { interactive: false, keyboard: false }).addTo(preview);
        } catch { if (!disposed && token === previewVersion) $("alert-preview-error").hidden = false; }
    }
    function history() {
        const container = $("alert-review-history"); container.replaceChildren();
        for (const [title, event, body] of [["Reviewer requested details", post?.detailRequest, post?.detailRequest?.reason], ["Reporter added details", post?.clarification, post?.clarification?.body], [post?.verification ? "Verification withdrawn" : "Report rejected", post?.rejection, post?.rejection?.reason]]) {
            if (!event) continue;
            const section = document.createElement("div"), heading = document.createElement("strong"), text = document.createElement("p"), meta = document.createElement("small");
            heading.textContent = title; text.textContent = body; meta.textContent = `${event.name || post.name} · ${shortDate(event.at?.toDate?.())}`; section.append(heading, text, meta); container.append(section);
        }
        container.hidden = !container.children.length;
    }
    function controls() {
        const status = alertStatus(post), open = !!post && reportState(post) === "active", ready = !!post && !post.pending && !busy;
        const owner = post?.authorId === user.uid, shownOnMap = visibleOnMap(post);
        $("alert-confirm").hidden = !open || owner;
        $("alert-confirm").disabled = !ready || confirmed === null;
        $("alert-confirm").textContent = busy ? "Saving…" : confirmed ? "Undo my observation" : "I saw this too";
        $("alert-confirm").setAttribute("aria-pressed", String(confirmed === true));
        $("alert-review-controls").hidden = !verifier || owner || !open;
        $("alert-approve").hidden = !verifier || owner || !open || !!post?.verification || status === "needs_details";
        $("alert-request-details").hidden = !!post?.verification || !!post?.detailRequest;
        $("alert-reject").textContent = post?.verification ? "Withdraw verification" : "Reject report";
        $("alert-clarify-fields").hidden = !owner || status !== "needs_details";
        for (const id of ["alert-approve", "alert-request-details", "alert-reject", "alert-review-note", "alert-clarify", "alert-clarification", "alert-resolve", "alert-resolution-note"]) $(id).disabled = !ready;
        $("alert-resolve-fields").hidden = !open || !(verifier || owner);
        $("alert-owner-note").hidden = !open || !owner;
        $("alert-preview").hidden = !shownOnMap; $("alert-map-mobile").hidden = !shownOnMap;
        if (!post) return;
        $("alert-details").dataset.state = status;
        $("alert-verification").textContent = post.pending ? "Saving…" : alertLabels[status];
        $("alert-verification").dataset.approved = String(status === "approved" && !post.pending);
        $("alert-freshness").textContent = `${post.verification ? "Checked" : "Reported"} ${relative(post.verification?.approvedAt || post.createdAt)}`;
        const checkedAt = stamp(post.verification?.approvedAt || post.createdAt);
        $("alert-freshness").title = checkedAt ? shortDate(new Date(checkedAt)) : "Just now";
        $("alert-status-explanation").textContent = status === "pending" ? "Waiting for review. This report is not on the campus map yet." : status === "needs_details" ? "A reviewer needs more information. This report is not on the map." : status === "rejected" ? "This report is not on the map. Read the reviewer's explanation below." : status === "expired" ? "No longer current. Removed from the map; this does not mean the issue is fixed." : status === "resolved" ? "This issue was marked resolved and removed from the map." : "";
        $("alert-status-explanation").hidden = status === "approved";
        $("alert-attribution").textContent = post.verification ? `Verified by ${post.verification.verifierName}` : `Reported by ${post.name}`;
        $("alert-lifecycle").textContent = status === "resolved" ? `Resolved by ${post.resolution.resolvedName} · ${shortDate(post.resolution.resolvedAt?.toDate?.())}${post.resolution.note ? `\n${post.resolution.note}` : ""}` : ["approved", "pending", "needs_details"].includes(status) ? `${status === "approved" ? "Current until" : "Review window ends"} ${shortDate(new Date(expiresAt(post)))}` : "Kept in report history. If you have new information, submit a new report.";
    }
    function render(data) {
        const next = data?.category === "Alert" ? data : null;
        if (post?.id !== next?.id) {
            version++; previewVersion++; stopConfirmation?.(); stopConfirmation = null; confirmed = null; busy = false;
            for (const id of ["alert-confirm-status", "alert-approval-status", "alert-resolution-status", "alert-clarify-status"]) $(id).textContent = "";
            for (const id of ["alert-review-note", "alert-resolution-note", "alert-clarification"]) $(id).value = "";
            $("alert-resolve-fields").open = false;
            if (next && next.authorId !== user.uid) {
                const token = version;
                stopConfirmation = service.watchConfirmation(next.id, user.uid, (exists, pending) => { if (!disposed && token === version) { confirmed = pending ? null : exists; controls(); } }, () => { if (!disposed && token === version) feedback("alert-confirm-status", "Observations unavailable. Reopen the report to retry."); });
            }
        }
        post = next; $("alert-details").hidden = !post;
        if (post) {
            $("alert-location-display").textContent = post.location?.label || "Location unavailable";
            $("alert-impact-text").textContent = post.body;
            $("alert-count").textContent = post.confirmationCount ? `${post.confirmationCount} observation${post.confirmationCount === 1 ? "" : "s"} · Not a verification` : "No observations yet";
            history();
        }
        controls(); expiry.refresh(); locationPreview();
    }
    async function perform(id, operation, success) {
        if (!post || post.pending || busy) return;
        const token = version; busy = true; controls(); feedback(id, "Saving…", "loading");
        try { await operation(); if (!disposed && token === version) feedback(id, success, "success"); }
        catch (error) { if (!disposed && token === version) feedback(id, `Not saved. ${error.message}`); }
        finally { if (!disposed && token === version) { busy = false; controls(); } }
    }
    on("alert-confirm", "click", () => { if (confirmed !== null && post && post.authorId !== user.uid && reportState(post) === "active") { const value = !confirmed; return perform("alert-confirm-status", () => service.setConfirmation(user, post.id, value), value ? "Your observation was added." : "Your observation was removed."); } });
    on("alert-approve", "click", () => { if (verifier) return perform("alert-approval-status", () => service.approveReport(user, post.id), "Verified. This alert is now on the campus map."); });
    for (const [id, action] of [["alert-reject", "reject"], ["alert-request-details", "request_details"]]) on(id, "click", () => {
        if (!verifier || !post) return;
        const reason = $("alert-review-note").value.trim(); if (!reason) { feedback("alert-approval-status", "Add an explanation for the reporter first."); window.CampusInput.focus($("alert-review-note")); return; }
        return perform("alert-approval-status", () => service.reviewReport(user, post.id, action, reason, !!post.verification), action === "reject" ? "Decision saved. The report is off the map." : "Details requested. The reporter can respond here.");
    });
    on("alert-clarify", "click", () => perform("alert-clarify-status", () => service.clarifyReport(user, post.id, $("alert-clarification").value), "Details sent. Waiting for review."));
    on("alert-resolve", "click", () => perform("alert-resolution-status", () => service.resolveReport(user, post.id, $("alert-resolution-note").value), "Resolved. Removed from the active map."));
    on("alert-share", "click", () => $("forum-copy-link").click());
    for (const id of ["alert-map-mobile", "alert-map-desktop"]) on(id, "click", () => {
        if (!visibleOnMap(post)) return;
        if (document.body.dataset.alertMapReady === "true") window.dispatchEvent(new CustomEvent("fiu-alert-locate", { detail: { id: post.id } }));
        else { const url = new URL("../../index.html", import.meta.url); url.searchParams.set("alert", post.id); location.href = url.href; }
    });
    window.addEventListener("fiu-alert-locate-failed", () => feedback("alert-confirm-status", "This alert is no longer available on the map. Check its latest status."), { signal: events.signal });
    on("alert-building", "change", async () => {
        if (disposed || disabled || !visible) return;
        const token = ++locationVersion;
        await loadBuildings();
        if (disposed || disabled || !visible || token !== locationVersion) return;
        const value = $("alert-building").value.trim().toLowerCase();
        const building = buildings?.find(item => [`${item.full_name} (${item.abbreviation})`, item.full_name, item.abbreviation].some(text => text?.toLowerCase() === value));
        if (!building) return;
        $("alert-location-label").value = building.full_name; $("alert-latitude").value = building.latitude; $("alert-longitude").value = building.longitude;
        $("alert-longitude").dispatchEvent(new Event("change", { bubbles: true }));
        await loadMap(); if (disposed || !visible || token !== locationVersion) return; map?.setView([building.latitude, building.longitude], 17); previewPoint();
    });
    for (const id of ["alert-location-label", "alert-building"]) on(id, "input", () => { locationVersion++; });
    for (const id of ["alert-latitude", "alert-longitude"]) { on(id, "input", () => { locationVersion++; previewPoint(); }); on(id, "invalid", () => { $("alert-coordinate-options").open = true; }); }
    mobile.addEventListener("change", locationPreview, { signal: events.signal });
    const minute = setInterval(() => { if (!disposed && post) controls(); }, 60000);
    const stopVerifier = service.watchVerifier(user.uid, enabled => { if (!disposed) { verifier = enabled; controls(); } }, () => { if (!disposed) { verifier = false; controls(); } });
    return {
        setComposer(value) { visible = value; if (!value) locationVersion++; $("alert-location-fields").hidden = !value; for (const id of locationFields) { $(id).required = value; $(id).disabled = !value || disabled; } for (const id of ["alert-issue-type", "alert-building"]) $(id).disabled = !value || disabled; if (value) { loadBuildings(); loadMap(); } },
        location: coordinates,
        setDisabled(value) { disabled = value; if (value) locationVersion++; for (const id of [...locationFields, "alert-building", "alert-issue-type"]) $(id).disabled = value || !visible; marker?.dragging?.[value ? "disable" : "enable"](); },
        reset() { locationVersion++; for (const id of [...locationFields, "alert-building"]) $(id).value = ""; marker?.remove(); marker = null; $("alert-coordinate-options").open = false; },
        render,
        dispose() { disposed = true; version++; previewVersion++; events.abort(); clearInterval(minute); stopConfirmation?.(); stopVerifier(); expiry.dispose(); observer?.disconnect(); map?.remove(); preview?.remove(); }
    };
}
