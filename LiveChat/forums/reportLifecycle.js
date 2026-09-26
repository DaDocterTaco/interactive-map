// Warning state is derived from the original server creation time. Resolved
// reports retain their history; active reports expire after 24 hours.
export const WARNING_LIFETIME_MS = 24 * 60 * 60 * 1000;
export function expiresAt(report) {
    const created = report?.createdAt?.toMillis?.() ?? report?.createdAt?.toDate?.().getTime();
    return Number.isFinite(created) ? created + WARNING_LIFETIME_MS : 0;
}
export function reportState(report, now = Date.now()) {
    if (report?.resolution?.status === "resolved") return "resolved";
    return expiresAt(report) <= now ? "expired" : "active";
}
// A deadline passing does not produce a Firestore snapshot. Recheck on a timer
// and when a suspended browser tab becomes visible again.
export function watchReportExpiry(getReports, onChange) {
    let timer, disposed = false;
    function refresh() {
        clearTimeout(timer);
        if (disposed) return;
        const now = Date.now();
        const deadlines = getReports().filter(report => report.category === "Alert" && reportState(report, now) === "active").map(expiresAt);
        if (deadlines.length) timer = setTimeout(() => { if (!disposed) { onChange(); refresh(); } }, Math.min(Math.max(1, Math.min(...deadlines) - now), 2147483647));
    }
    const visible = () => { if (!disposed && document.visibilityState !== "hidden") { onChange(); refresh(); } };
    document.addEventListener("visibilitychange", visible);
    return { refresh, dispose() { disposed = true; clearTimeout(timer); document.removeEventListener("visibilitychange", visible); } };
}
