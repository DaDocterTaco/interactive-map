import { restoreUser, watchUser } from "./chatAuth.js";
import { watchVerifiedWarnings } from "./warningService.js";
import { createWarningLayer } from "./warningMarkers.js?v=alerts-20260927-1";

// Connect the map layer only while a chat identity is signed in. The generation
// counter ignores snapshots from subscriptions replaced during an auth change.
export function mountMapWarnings({ map, L }) {
    const view = createWarningLayer({ map, L });
    document.body.dataset.alertMapReady = "true";
    const nav = document.createElement("button"); nav.type = "button"; nav.className = "alert-map-return"; nav.textContent = "Back to alert"; nav.hidden = true; document.body.append(nav);
    let returnId = null, initialAlert = new URL(location.href).searchParams.get("alert");
    function openReport(id) {
        if (!id || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) return;
        const url = new URL(location.href); url.searchParams.set("forum", id); url.searchParams.delete("alert"); history.replaceState(history.state, "", url);
        nav.hidden = true; document.getElementById("open-chat")?.click();
    }
    function locate(event) {
        const id = event.detail?.id;
        if (!view.focusReport(id)) { window.dispatchEvent(new CustomEvent("fiu-alert-locate-failed")); return; }
        returnId = id; document.getElementById("chat-panel")?.close();
        const url = new URL(location.href); url.searchParams.delete("forum"); url.searchParams.delete("alert"); history.replaceState(history.state, "", url);
        nav.hidden = false; nav.focus({ preventScroll: true });
        requestAnimationFrame(() => { map.invalidateSize({ pan: false }); view.focusReport(id); });
    }
    const open = event => openReport(event.detail?.id);
    window.addEventListener("fiu-alert-locate", locate); window.addEventListener("fiu-alert-open", open);
    nav.addEventListener("click", () => openReport(returnId));
    let stopped = false, generation = 0, stopUser, stopWarnings;
    // Reuse the chat's saved identity. A first-time visitor can join via Open chat.
    restoreUser().then(() => {
        if (stopped) return;
        stopUser = watchUser(user => {
            if (stopped) return;
            const current = ++generation;
            stopWarnings?.(); stopWarnings = null; view.clear();
            if (!user) { view.setStatus("Open chat to see verified alerts"); return; }
            view.setStatus("Loading verified alerts…");
            stopWarnings = watchVerifiedWarnings((reports, cached) => {
                if (!stopped && current === generation) {
                    view.setReports(reports, cached);
                    if (initialAlert && !cached) { const id = initialAlert; initialAlert = null; if (view.focusReport(id)) locate({ detail: { id } }); else openReport(id); }
                }
            }, () => {
                if (stopped || current !== generation) return;
                view.clear(); view.setStatus("Alerts unavailable. Refresh to reconnect.");
            });
        });
    }).catch(() => { if (!stopped) view.setStatus("Alerts unavailable. Open chat to reconnect."); });
    const dispose = () => {
        if (stopped) return;
        stopped = true; generation++; stopWarnings?.(); stopUser?.(); view.dispose(); map.off("unload", dispose);
        window.removeEventListener("fiu-alert-locate", locate); window.removeEventListener("fiu-alert-open", open); nav.remove(); delete document.body.dataset.alertMapReady;
    };
    map.on("unload", dispose);
    return { dispose };
}
