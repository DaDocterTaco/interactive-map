// Pending reports expire after 24 hours. Verification starts a fresh 24-hour
// display window; rejected, resolved, and expired reports retain their history.
export const WARNING_LIFETIME_MS = 24 * 60 * 60 * 1000;
export function expiresAt(report) {
    const anchor = report?.verification?.approvedAt || report?.createdAt;
    const created = anchor?.toMillis?.() ?? anchor?.toDate?.().getTime();
    return Number.isFinite(created) ? created + WARNING_LIFETIME_MS : 0;
}
export function reportState(report, now = Date.now()) {
    if (report?.rejection) return "rejected";
    if (report?.resolution?.status === "resolved") return "resolved";
    return expiresAt(report) <= now ? "expired" : "active";
}
export function alertStatus(report, now = Date.now()) {
    if (!report) return "pending";
    const state = reportState(report, now);
    if (state !== "active") return state;
    if (report.verification?.status === "approved") return "approved";
    if (report.detailRequest && !report.clarification) return "needs_details";
    return "pending";
}
export const alertLabels = { pending: "Under review", needs_details: "Needs details", approved: "Verified", rejected: "Rejected", resolved: "Resolved", expired: "Out of date" };
export function visibleOnMap(report, now = Date.now()) {
    const point = report?.location;
    return report?.category === "Alert" && !report.pending && alertStatus(report, now) === "approved"
        && Number.isFinite(point?.latitude) && Math.abs(point.latitude) <= 90
        && Number.isFinite(point?.longitude) && Math.abs(point.longitude) <= 180;
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
