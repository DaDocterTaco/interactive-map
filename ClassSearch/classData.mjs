// Turn the bundled class snapshot into searchable sections with resolved rooms
// and building coordinates. The raw JSON stays compact by storing these once.
export const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const wordsMatch = (text, query) => normalize(query).split(/\s+/).filter(Boolean).every(word => normalize(text).includes(word));

export function createCatalog(data) {
    if (![1, 2].includes(data?.metadata?.schema_version) || !Array.isArray(data.sections)) throw new Error('Unsupported class data.');
    const courses = new Map(data.courses.map(course => [course.code, course]));
    const buildings = new Map(data.buildings.map(building => [building.code, building]));
    const rooms = new Map(data.rooms.map(room => [room.id, room]));
    const byId = new Map();
    const sections = data.sections.map(section => {
        if (byId.has(section.class_id) || !courses.has(section.course_code)) throw new Error('Invalid class identity.');
        // Several meetings can use the same room; group their exact dates so
        // the UI offers one location choice per room without losing holidays.
        const locations = new Map();
        for (const meeting of section.meetings) {
            const room = rooms.get(meeting.room_id);
            const building = room && buildings.get(room.building_code);
            if (!building || !Number.isFinite(building.latitude) || !Number.isFinite(building.longitude)) throw new Error('Invalid class location.');
            if (!locations.has(room.id)) locations.set(room.id, { ...room, building, dates: [] });
            locations.get(room.id).dates.push(...meeting.dates);
        }
        const assignmentVerified = data.metadata.schema_version === 2 && section.assignment_verified === true
            && section.location_status === 'Assigned in FIU 25Live' && Number.isFinite(Date.parse(section.assignment_checked_at));
        const result = { ...section, assignment_verified: assignmentVerified,
            location_status: assignmentVerified ? 'Assigned in FIU 25Live' : 'Assignment not verified', course_name: courses.get(section.course_code).name,
            locations: [...locations.values()].map(location => ({ ...location, dates: [...new Set(location.dates)].sort() })) };
        if (!result.locations.length) throw new Error('Missing class location.');
        byId.set(section.class_id, result);
        return result;
    });
    return {
        metadata: data.metadata,
        search({ mode = 'course', term = data.metadata.term_code, classId = '', course = '', professor = '', time = '' } = {}) {
            if (term !== data.metadata.term_code) return [];
            if (mode === 'id') {
                const id = String(classId).trim();
                if (!/^\d+$/.test(id)) return [];
                return byId.has(id) ? [byId.get(id)] : [];
            }
            if (!normalize(course)) return [];
            // A course code needs an exact match; title searches accept all
            // query words anywhere in the normalized course name.
            const code = normalize(course).replace(/[\s-]/g, '').match(/^([a-z]{2,4})(\d{4}[a-z]?)$/);
            return sections.filter(section => (code
                ? normalize(section.course_code).replace(/\s/g, '') === code[1] + code[2]
                : wordsMatch(section.course_name, course))
                && wordsMatch(section.instructor, professor)
                && (!time || section.start_time === time))
                .sort((a, b) => a.start_time.localeCompare(b.start_time) || a.course_code.localeCompare(b.course_code) || a.section.localeCompare(b.section));
        }
    };
}

export function createCatalogLoader(url, fetcher = fetch) {
    let pending;
    return () => {
        // Share one in-flight fetch across searches, but allow a retry after a
        // network or schema failure instead of caching the rejected promise.
        if (!pending) pending = fetcher(url).then(response => {
            if (!response.ok) throw new Error('Class data could not load.');
            return response.json();
        }).then(createCatalog).catch(error => { pending = null; throw error; });
        return pending;
    };
}

const dayNames = { M: 'Mon', Mo: 'Mon', T: 'Tue', Tu: 'Tue', W: 'Wed', We: 'Wed', Th: 'Thu', F: 'Fri', Fr: 'Fri', S: 'Sat', Sa: 'Sat', Su: 'Sun' };
export const formatDays = days => days.map(day => dayNames[day] || day).join(' / ');
export function formatTime(value) {
    const [hour, minute] = value.split(':').map(Number);
    return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
}
export const formatDate = date => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
export const dateRange = dates => !dates.length ? '' : dates.length === 1 ? formatDate(dates[0]) : `${formatDate(dates[0])} – ${formatDate(dates.at(-1))}`;
