import * as service from "./forumService.js";
import { expiresAt, reportState, watchReportExpiry } from "./reportLifecycle.js";

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
    const $ = id => document.getElementById(id);
    const events = new AbortController();
    const on = (id, event, fn) => $(id).addEventListener(event, fn, { signal: events.signal });
    let map, marker, disposed = false, disabled = false, visible = false, mapLoading;
    let post = null, stopConfirmation, version = 0, confirmed = null, confirming = false;
    let verifier = false, approving = false, resolving = false;
    const expiry = watchReportExpiry(() => post ? [post] : [], controls);
    const locationFields = ["alert-location-label", "alert-latitude", "alert-longitude"];
    const shortDate = value => value?.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) || "Just now";
    const feedback = (id, message, state = "error") => { $(id).textContent = message; $(id).dataset.state = state; };
    function coordinates() {
        const latitude = $("alert-latitude").value.trim(), longitude = $("alert-longitude").value.trim();
        return { label: $("alert-location-label").value, latitude: latitude === "" ? NaN : Number(latitude), longitude: longitude === "" ? NaN : Number(longitude) };
    }
    function previewPoint() {
        const point = coordinates();
        if (!Number.isFinite(point.latitude) || Math.abs(point.latitude) > 90 || !Number.isFinite(point.longitude) || Math.abs(point.longitude) > 180) {
            marker?.remove(); marker = null;
            $("alert-picker-status").textContent = "Select a spot on the map.";
            $("alert-picker-status").dataset.state = "ready";
            return;
        }
        if (map) {
            if (marker) marker.setLatLng([point.latitude, point.longitude]);
            else marker = window.L.circleMarker([point.latitude, point.longitude], { radius: 9, color: "#0757d8", fillColor: "#0863ff", fillOpacity: .8 }).addTo(map);
        }
        $("alert-picker-status").textContent = "Location selected";
        $("alert-picker-status").dataset.state = "success";
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
            } catch (error) { if (!disposed) { feedback("alert-picker-status", "Map unavailable. Enter coordinates below."); $("alert-coordinate-options").open = true; } }
            finally { mapLoading = null; }
        })();
        return mapLoading;
    }
    function controls() {
        // Permission hints here guide the UI; Firestore rules make the final
        // decision using server time and the current verifier role.
        const state = reportState(post), open = !!post && state === "active";
        $("alert-confirm").hidden = !open || post.authorId === user.uid;
        $("alert-confirm").disabled = !post || post.pending || confirmed === null || confirming;
        $("alert-confirm").textContent = confirming ? "Saving…" : confirmed ? "Undo confirmation" : "Confirm alert";
        $("alert-confirm").setAttribute("aria-busy", String(confirming));
        $("alert-approve").hidden = !verifier || !open || post.authorId === user.uid || post.verification?.status === "approved";
        $("alert-approve").disabled = !verifier || !post || post.pending || approving;
        $("alert-approve").textContent = approving ? "Verifying…" : "Verify alert";
        $("alert-approve").setAttribute("aria-busy", String(approving));
        $("alert-resolve-fields").hidden = !open || !(verifier || post.authorId === user.uid);
        $("alert-resolve").disabled = !open || post.pending || resolving;
        $("alert-resolve").textContent = resolving ? "Saving…" : "Mark resolved";
        $("alert-resolve").setAttribute("aria-busy", String(resolving));
        $("alert-resolution-note").disabled = !open || post.pending || resolving;
        if (post) {
            const resolution = post.resolution;
            $("alert-owner-note").hidden = !open || post.authorId !== user.uid;
            const approved = post.verification?.status === "approved";
            $("alert-details").dataset.state = state === "active" ? approved ? "approved" : "pending" : state;
            $("alert-verification").dataset.approved = String(approved && !post.pending);
            $("alert-verification").textContent = state === "resolved" ? "Resolved" : state === "expired" ? "Expired"
                : approved ? post.pending ? "Saving verification…" : `Verified by ${post.verification.verifierName}` : "Needs review";
            $("alert-lifecycle").textContent = state === "resolved"
                ? `${post.pending ? "Saving resolution…" : `${resolution.resolvedName} · ${shortDate(resolution.resolvedAt?.toDate?.())}`}${resolution.note ? `\n${resolution.note}` : ""}`
                : state === "expired" ? "Kept for reference."
                : `Expires ${shortDate(new Date(expiresAt(post)))}`;
        }
    }
    function render(postData) {
        // Restart the viewer's confirmation listener only when the selected
        // report changes, not on every parent snapshot update.
        const next = postData?.category === "Alert" ? postData : null;
        if (post?.id !== next?.id) {
            version++; stopConfirmation?.(); stopConfirmation = null; confirmed = null;
            $("alert-confirm-status").textContent = "";
            $("alert-approval-status").textContent = "";
            $("alert-resolution-status").textContent = "";
            $("alert-resolution-note").value = "";
            $("alert-resolve-fields").open = false;
            if (next && next.authorId !== user.uid) {
                const epoch = version;
                stopConfirmation = service.watchConfirmation(next.id, user.uid, (exists, pending) => {
                    if (disposed || epoch !== version) return;
                    confirmed = pending ? null : exists; controls();
                }, error => {
                    if (disposed || epoch !== version) return;
                    confirmed = null; controls(); feedback("alert-confirm-status", "Confirmation unavailable. Reopen this alert to retry.");
                });
            }
        }
        post = next;
        $("alert-details").hidden = !post;
        if (post) {
            $("alert-location-display").textContent = post.location.label;
            $("alert-location-display").title = `${post.location.latitude.toFixed(6)}, ${post.location.longitude.toFixed(6)}`;
            $("alert-count").textContent = `${post.confirmationCount || 0} confirmation${post.confirmationCount === 1 ? "" : "s"}`;
            $("alert-owner-note").hidden = post.authorId !== user.uid;
        }
        controls();
        expiry.refresh();
    }
    on("alert-confirm", "click", async () => {
        if (!post || reportState(post) !== "active" || post.authorId === user.uid || post.pending || confirmed === null || confirming) return;
        const id = post.id, epoch = version, value = !confirmed;
        confirming = true; controls(); feedback("alert-confirm-status", "", "loading");
        try {
            await service.setConfirmation(user, id, value);
            if (!disposed && epoch === version) feedback("alert-confirm-status", value ? "Confirmation added." : "Confirmation withdrawn.", "success");
        } catch (error) {
            if (!disposed && epoch === version) feedback("alert-confirm-status", `Not saved. ${error.message}`);
        } finally { confirming = false; if (!disposed) controls(); }
    });
    on("alert-approve", "click", async () => {
        if (!verifier || !post || reportState(post) !== "active" || post.pending || approving || post.authorId === user.uid || post.verification?.status === "approved") return;
        const id = post.id, epoch = version;
        approving = true; controls(); feedback("alert-approval-status", "", "loading");
        try {
            await service.approveReport(user, id);
            if (!disposed && epoch === version) feedback("alert-approval-status", "Alert verified.", "success");
        } catch (error) {
            if (!disposed && epoch === version) feedback("alert-approval-status", `Verification not saved. ${error.message}`);
        } finally { approving = false; if (!disposed) controls(); }
    });
    on("alert-resolve", "click", async () => {
        if (!post || reportState(post) !== "active" || post.pending || resolving || !(verifier || post.authorId === user.uid)) return;
        const id = post.id, epoch = version, note = $("alert-resolution-note").value;
        resolving = true; controls(); feedback("alert-resolution-status", "", "loading");
        try {
            await service.resolveReport(user, id, note);
            if (!disposed && epoch === version) { feedback("alert-resolution-status", "Alert resolved.", "success"); $("alert-resolution-note").value = ""; }
        } catch (error) {
            if (!disposed && epoch === version) feedback("alert-resolution-status", `Resolution not saved. ${error.message}`);
        } finally { resolving = false; if (!disposed) controls(); }
    });
    const stopVerifier = service.watchVerifier(user.uid, enabled => {
        if (disposed) return;
        verifier = enabled; controls();
    }, () => { if (!disposed) { verifier = false; controls(); } });
    for (const id of ["alert-latitude", "alert-longitude"]) {
        on(id, "input", previewPoint);
        // Native validation must be able to focus required fields in a disclosure.
        on(id, "invalid", () => { $("alert-coordinate-options").open = true; });
    }
    return {
        setComposer(value) {
            visible = value; $("alert-location-fields").hidden = !value;
            for (const id of locationFields) { $(id).required = value; $(id).disabled = !value || disabled; }
            if (value) loadMap();
        },
        location: coordinates,
        setDisabled(value) { disabled = value; for (const id of locationFields) $(id).disabled = value || !visible; },
        reset() { for (const id of locationFields) $(id).value = ""; marker?.remove(); marker = null; $("alert-coordinate-options").open = false; $("alert-picker-status").textContent = "Select a spot on the map."; $("alert-picker-status").dataset.state = "ready"; },
        render,
        dispose() { disposed = true; version++; events.abort(); stopConfirmation?.(); stopVerifier(); expiry.dispose(); map?.remove(); }
    };
}
