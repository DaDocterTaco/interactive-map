import { restoreUser, watchUser } from "./chatAuth.js";
import { watchVerifiedWarnings } from "./warningService.js";
import { createWarningLayer } from "./warningMarkers.js";

// Connect the map layer only while a chat identity is signed in. The generation
// counter ignores snapshots from subscriptions replaced during an auth change.
export function mountMapWarnings({ map, L }) {
    const view = createWarningLayer({ map, L });
    let stopped = false, generation = 0, stopUser, stopWarnings;
    // Reuse the chat's saved identity. A first-time visitor can join via Open chat.
    restoreUser().then(() => {
        if (stopped) return;
        stopUser = watchUser(user => {
            if (stopped) return;
            const current = ++generation;
            stopWarnings?.(); stopWarnings = null; view.clear();
            if (!user) { view.setStatus("Open chat to see verified warnings"); return; }
            view.setStatus("Loading verified warnings…");
            stopWarnings = watchVerifiedWarnings((reports, cached) => {
                if (!stopped && current === generation) view.setReports(reports, cached);
            }, () => {
                if (stopped || current !== generation) return;
                view.clear(); view.setStatus("Warnings unavailable. Refresh to reconnect.");
            });
        });
    }).catch(() => { if (!stopped) view.setStatus("Warnings unavailable. Open chat to reconnect."); });
    const dispose = () => {
        if (stopped) return;
        stopped = true; generation++; stopWarnings?.(); stopUser?.(); view.dispose(); map.off("unload", dispose);
    };
    map.on("unload", dispose);
    return { dispose };
}
