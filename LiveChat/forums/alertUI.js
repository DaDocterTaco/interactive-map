import * as service from "./forumService.js";

let leafletLoading;
function leaflet() {
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
    const $ = id => document.getElementById(id);
    const events = new AbortController();
    const on = (id, event, fn) => $(id).addEventListener(event, fn, { signal: events.signal });
    let map, marker, disposed = false, disabled = false, visible = false, mapLoading;
    let post = null, stopConfirmation, version = 0, confirmed = null, confirming = false;
    let verifier = false, approving = false;
    const locationFields = ["alert-location-label", "alert-latitude", "alert-longitude"];
    function coordinates() {
        const latitude = $("alert-latitude").value.trim(), longitude = $("alert-longitude").value.trim();
        return { label: $("alert-location-label").value, latitude: latitude === "" ? NaN : Number(latitude), longitude: longitude === "" ? NaN : Number(longitude) };
    }
    function previewPoint() {
        const point = coordinates();
        if (!Number.isFinite(point.latitude) || Math.abs(point.latitude) > 90 || !Number.isFinite(point.longitude) || Math.abs(point.longitude) > 180) {
            marker?.remove(); marker = null;
            $("alert-picker-status").textContent = "Click a spot on the picker, or enter valid coordinates below.";
            return;
        }
        if (map) {
            if (marker) marker.setLatLng([point.latitude, point.longitude]);
            else marker = window.L.circleMarker([point.latitude, point.longitude], { radius: 9, color: "#a35a00", fillColor: "#e89e32", fillOpacity: .8 }).addTo(map);
        }
        $("alert-picker-status").textContent = `Selected: ${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}`;
    }
    async function loadMap() {
        if (mapLoading) return mapLoading;
        mapLoading = (async () => {
            try {
                const L = await leaflet();
                if (disposed) return;
                // This is a separate form picker; it never touches the main map.
                if (!map) {
                    map = L.map($("alert-location-map"), { scrollWheelZoom: false }).setView([25.75396, -80.37662], 16);
                    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
                    map.on("click", event => {
                        if (disabled || !visible) return;
                        $("alert-latitude").value = event.latlng.lat.toFixed(6);
                        $("alert-longitude").value = event.latlng.wrap().lng.toFixed(6);
                        previewPoint();
                    });
                }
                if (visible) { map.invalidateSize(); previewPoint(); }
            } catch (error) { if (!disposed) $("alert-picker-status").textContent = error.message; }
            finally { mapLoading = null; }
        })();
        return mapLoading;
    }
    function controls() {
        $("alert-confirm").hidden = !post || post.authorId === user.uid;
        $("alert-confirm").disabled = !post || post.pending || confirmed === null || confirming;
        $("alert-confirm").textContent = confirmed ? "Withdraw my confirmation" : "I can confirm this";
        $("alert-approve").hidden = !verifier || !post || post.authorId === user.uid || post.verification?.status === "approved";
        $("alert-approve").disabled = !verifier || !post || post.pending || approving;
    }
    function render(postData) {
        const next = postData?.category === "Alert" ? postData : null;
        if (post?.id !== next?.id) {
            version++; stopConfirmation?.(); stopConfirmation = null; confirmed = null;
            $("alert-confirm-status").textContent = "";
            $("alert-approval-status").textContent = "";
            if (next && next.authorId !== user.uid) {
                const epoch = version;
                stopConfirmation = service.watchConfirmation(next.id, user.uid, (exists, pending) => {
                    if (disposed || epoch !== version) return;
                    confirmed = pending ? null : exists; controls();
                }, error => {
                    if (disposed || epoch !== version) return;
                    confirmed = null; controls(); $("alert-confirm-status").textContent = "Could not load your confirmation. Reopen this alert to retry.";
                });
            }
        }
        post = next;
        $("alert-details").hidden = !post;
        if (post) {
            $("alert-location-display").textContent = `${post.location.label} · ${post.location.latitude.toFixed(6)}, ${post.location.longitude.toFixed(6)}`;
            $("alert-count").textContent = post.confirmationCount ? `${post.confirmationCount} user confirmation${post.confirmationCount === 1 ? "" : "s"}` : "No confirmations yet";
            $("alert-owner-note").hidden = post.authorId !== user.uid;
            const approval = post.verification;
            const approved = approval?.status === "approved";
            $("alert-verification").dataset.approved = String(approved && !post.pending);
            $("alert-verification").textContent = approved
                ? (post.pending ? "Syncing approval…" : `Verified by ${approval.verifierName} · ${approval.approvedAt?.toDate?.().toLocaleString() || "Just now"}`)
                : "Awaiting review by an authorized verifier";
        }
        controls();
    }
    on("alert-confirm", "click", async () => {
        if (!post || post.authorId === user.uid || post.pending || confirmed === null || confirming) return;
        const id = post.id, epoch = version, value = !confirmed;
        confirming = true; controls(); $("alert-confirm-status").textContent = "Saving confirmation...";
        try {
            await service.setConfirmation(user, id, value);
            if (!disposed && epoch === version) $("alert-confirm-status").textContent = value ? "Your confirmation was saved." : "Your confirmation was withdrawn.";
        } catch (error) {
            if (!disposed && epoch === version) $("alert-confirm-status").textContent = `Not saved. ${error.message}`;
        } finally { confirming = false; if (!disposed) controls(); }
    });
    on("alert-approve", "click", async () => {
        if (!verifier || !post || post.pending || approving || post.authorId === user.uid || post.verification?.status === "approved") return;
        const id = post.id, epoch = version;
        approving = true; controls(); $("alert-approval-status").textContent = "Saving approval…";
        try {
            await service.approveReport(user, id);
            if (!disposed && epoch === version) $("alert-approval-status").textContent = "Report approved.";
        } catch (error) {
            if (!disposed && epoch === version) $("alert-approval-status").textContent = `Approval not saved. ${error.message}`;
        } finally { approving = false; if (!disposed) controls(); }
    });
    const stopVerifier = service.watchVerifier(user.uid, enabled => {
        if (disposed) return;
        verifier = enabled; controls();
    }, () => { if (!disposed) { verifier = false; controls(); } });
    for (const id of ["alert-latitude", "alert-longitude"]) on(id, "input", previewPoint);
    return {
        setComposer(value) {
            visible = value; $("alert-location-fields").hidden = !value;
            for (const id of locationFields) { $(id).required = value; $(id).disabled = !value || disabled; }
            if (value) loadMap();
        },
        location: coordinates,
        setDisabled(value) { disabled = value; for (const id of locationFields) $(id).disabled = value || !visible; },
        reset() { for (const id of locationFields) $(id).value = ""; marker?.remove(); marker = null; $("alert-picker-status").textContent = "Click a spot on the picker, or enter coordinates below."; },
        render,
        dispose() { disposed = true; version++; events.abort(); stopConfirmation?.(); stopVerifier(); map?.remove(); }
    };
}
