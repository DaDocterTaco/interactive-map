export const sourceName = name => ({fiu_calendar: 'FIU Calendar', panther_connect: 'Panther Connect'}[name] || name);
export const localDate = value => new Intl.DateTimeFormat('en-CA', {timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date(value));
export function safeUrl(value) {
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; }
    catch { return null; }
}
export function validateFeed(feed) {
    if (feed?.schema_version !== 2 || !Array.isArray(feed.events) || !Number.isFinite(Date.parse(feed.generated_at))) throw new Error('Unsupported event data');
    const ids = new Set();
    for (const e of feed.events) {
        if (typeof e.id !== 'string' || ids.has(e.id) || typeof e.title !== 'string' || typeof e.location !== 'string' || !Array.isArray(e.sources)
            || !Number.isFinite(Date.parse(e['start time'])) || !Number.isFinite(Date.parse(e.expires_at))) throw new Error('Invalid event record');
        ids.add(e.id);
    }
    return feed;
}
export function isMappable(e) {
    // Current map covers MMC only. Published points elsewhere remain in the list.
    return e.experience !== 'virtual' && Number.isFinite(e.latitude) && Number.isFinite(e.longitude)
        && e.latitude >= 25.745 && e.latitude <= 25.77 && e.longitude >= -80.39 && e.longitude <= -80.36;
}
export function selectEvents(events, {now = Date.now(), period = 'week', query = '', source = 'all'} = {}) {
    const today = localDate(now);
    const seventh = new Date(today + 'T12:00:00Z'); seventh.setUTCDate(seventh.getUTCDate() + 7);
    const weekEnd = seventh.toISOString().slice(0, 10);
    const text = query.trim().toLowerCase();
    return events.filter(e => {
        if (Date.parse(e.expires_at) <= now) return false;
        const startDay = localDate(e['start time']);
        if (period === 'today' && startDay > today) return false;
        if (period === 'week' && startDay >= weekEnd) return false;
        if (source !== 'all' && !e.sources.some(s => s.name === source)) return false;
        return !text || [e.title, e.location, e.host, e.building_id || ''].join(' ').toLowerCase().includes(text);
    }).sort((a,b) => Date.parse(a['start time']) - Date.parse(b['start time']) || a.title.localeCompare(b.title));
}
export function eventTime(e) {
    const day = value => new Intl.DateTimeFormat('en-US', {timeZone: 'America/New_York', month: 'short', day: 'numeric'}).format(new Date(value));
    if (e.all_day) return day(e['start time']) + ' · All day';
    const spansYears = e['end time'] && localDate(e['start time']).slice(0,4) !== localDate(e['end time']).slice(0,4);
    const fmt = value => new Intl.DateTimeFormat('en-US', {timeZone: 'America/New_York', month: 'short', day: 'numeric', ...(spansYears ? {year:'numeric'} : {}), hour: 'numeric', minute: '2-digit', timeZoneName: 'short'}).format(new Date(value));
    return fmt(e['start time']) + (e['end time'] ? ' – ' + fmt(e['end time']) : ' · End time not published');
}
