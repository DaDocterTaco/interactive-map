import { locateOnMap } from './classMotion.mjs';
import { createCatalogLoader, formatDays, formatTime, formatDate, dateRange } from './classData.mjs';

// Build the search dialog when the feature mounts; class data loads on the
// first search. Its pin stays separate from building and warning layers.
const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
};

export function mountClassSearch({ map, L }) {
    const openButton = document.getElementById('open-class');
    const dialog = document.createElement('dialog');
    dialog.id = 'class-dialog';
    dialog.setAttribute('aria-labelledby', 'class-title');
    dialog.innerHTML = `
        <header class="class-header">
            <div><p class="class-eyebrow">FIU · CAMPUS COMPANION</p><h2 id="class-title">Find your class</h2><p class="class-subtitle">A little less searching. A clearer way to class.</p></div>
            <button type="button" class="class-close" aria-label="Close class search">×</button>
        </header>
        <ol class="class-steps" aria-label="Find a class progress"><li aria-current="step"><span>1</span> Search</li><li><span>2</span> Choose a section</li><li><span>3</span> Locate</li></ol><div class="class-body">
            <p class="class-term" id="class-term">Fall 2026 · MMC</p>
            <form id="class-search-form">
                <fieldset class="class-modes"><legend>Search by</legend>
                    <label><input type="radio" name="class-mode" value="course" checked> Course</label>
                    <label><input type="radio" name="class-mode" value="id"> Class ID</label>
                </fieldset>
                <div id="class-course-fields" class="class-fields">
                    <label class="class-course-label">Course name or code<input id="class-course" placeholder="Course code or name, e.g. COT 3100" autocomplete="off" maxlength="100" required></label>
                    <details class="class-filters"><summary>Narrow your search <span>Professor or start time</span></summary><div class="class-filter-fields"><label>Professor <span class="class-optional">(optional)</span><input id="class-professor" placeholder="e.g. Whittaker" autocomplete="off" maxlength="100"></label>
                    <label>Start time <span class="class-optional">(optional)</span><input id="class-time" type="time"></label></div></details>
                </div>
                <div id="class-id-fields" hidden>
                    <label>Class ID<input id="class-id" placeholder="e.g. 84848" inputmode="numeric" pattern="[0-9]+" maxlength="12" autocomplete="off" disabled></label>
                    <p class="class-help">Use the section’s class number from your schedule, such as 84848.</p>
                </div>
                <button type="submit" class="class-search-button">Search classes</button>
            </form>
            <p id="class-results-status" role="status" aria-live="polite">Search by course or enter the class ID from your schedule.</p><div id="class-feedback" class="class-feedback"><span class="class-feedback-symbol" aria-hidden="true">⌖</span><strong>Your next class, within reach.</strong><p>Find your section to see its building and room on the campus map.</p></div>
            <div id="class-results" role="group" aria-label="Matching class sections"></div>
            <button type="button" id="class-more" hidden>Show more classes</button>
            <p class="class-data-note" id="class-data-note">Room assignments are checked against FIU 25Live. Only classes with usable MMC location data are included.</p>
        </div>
        <footer class="class-footer"><p id="class-selection">Choose a section to continue.</p><button id="locate-class" type="button" disabled>Locate on map <span aria-hidden="true">↗</span></button></footer>`;
    document.body.append(dialog);
    const journey = element('aside', null, 'class-journey');
    journey.hidden = true;
    journey.setAttribute('aria-label', 'Class location');
    journey.innerHTML = '<div class="class-journey-icon" aria-hidden="true">⌖</div><div class="class-journey-copy"><p class="class-journey-state" role="status" aria-live="polite"></p><strong class="class-journey-title"></strong><p class="class-journey-location"></p></div><div class="class-journey-actions"><button type="button" class="class-stop">Stop movement</button><button type="button" class="class-return">Back to results</button><button type="button" class="class-dismiss" aria-label="Dismiss class location">×</button></div>';
    document.body.append(journey);
    const journeyState = journey.querySelector('.class-journey-state');
    const stopButton = journey.querySelector('.class-stop');
    let cancelJourney;
    stopButton.addEventListener('click', () => { cancelJourney?.(); journey.querySelector('.class-return').focus(); });
    journey.querySelector('.class-return').addEventListener('click', () => openButton.click());
    journey.querySelector('.class-dismiss').addEventListener('click', () => { cancelJourney?.(); journey.hidden = true; openButton.focus(); });
    const find = selector => dialog.querySelector(selector);
    const form = find('#class-search-form'), results = find('#class-results'), status = find('#class-results-status');
    const locate = find('#locate-class'), selectionText = find('#class-selection'), more = find('#class-more');
    const loadCatalog = createCatalogLoader(new URL('./classes.json?v=assigned-20260926', import.meta.url));
    // revision invalidates any fetch result after edits, mode changes, or close.
    let catalog, mode = 'course', selected, selectedRadio, marker, matches = [], shown = 0, revision = 0;

    const feedback = find('#class-feedback');
    const searchButton = find('.class-search-button');
    const steps = [...dialog.querySelectorAll('.class-steps li')];
    function setStep(index) {
        steps.forEach((step, i) => {
            step.classList.toggle('is-complete', i < index);
            if (i === index) step.setAttribute('aria-current', 'step');
            else step.removeAttribute('aria-current');
        });
    }
    function showFeedback(title, message, kind = 'empty') {
        feedback.hidden = false;
        feedback.dataset.state = kind;
        feedback.replaceChildren(element('span', kind === 'loading' ? '◌' : kind === 'error' ? '!' : '⌖', 'class-feedback-symbol'), element('strong', title), element('p', message));
        feedback.firstElementChild.setAttribute('aria-hidden', 'true');
    }
    function setLoading(loading) {
        searchButton.disabled = loading;
        searchButton.textContent = loading ? 'Searching…' : 'Search classes';
        form.setAttribute('aria-busy', String(loading));
    }
    function clearResults() {
        revision++;
        results.replaceChildren(); matches = []; shown = 0; selected = null; selectedRadio = null;
        more.hidden = true; locate.disabled = true; setLoading(false); setStep(0);
        showFeedback('Ready when you are.', 'Search for a course or class ID to find your section.');
        selectionText.textContent = 'Choose a section to continue.';
        results.removeAttribute('aria-busy');
        find('.class-footer').classList.remove('has-selection');
    }
    function choose(section, location, radio) {
        selected = { section, location };
        selectedRadio?.closest('.class-card').classList.remove('is-selected');
        selectedRadio = radio; radio.checked = true;
        radio.closest('.class-card').classList.add('is-selected');
        locate.disabled = false; setStep(2);
        find('.class-footer').classList.add('has-selection');
        selectionText.textContent = `${section.course_code} · ${location.building.code}, room ${location.room}`;
    }
    function card(section) {
        // Render source data through textContent so names and room labels are
        // treated as text even if the dataset contains markup characters.
        const article = element('article', null, 'class-card');
        const label = element('label', null, 'class-card-heading');
        const radio = document.createElement('input');
        radio.setAttribute('aria-label', `${section.course_code}, section ${section.section}, ${section.instructor}, ${formatDays(section.days)}, ${formatTime(section.start_time)}`);
        radio.type = 'radio'; radio.name = 'class-result'; radio.value = section.class_id;
        const heading = element('span');
        heading.append(element('strong', `${section.course_code} · ${section.section}`), element('span', section.course_name, 'class-course-name'));
        const badge = element('span', section.assignment_verified ? 'Room verified' : 'Room unverified', section.assignment_verified ? 'class-requested class-assigned' : 'class-requested');
        if (section.assignment_verified) badge.title = `Every meeting matched FIU's assigned room. Checked ${formatDate(section.assignment_checked_at.slice(0, 10))}.`;
        label.append(radio, heading, badge);
        article.append(label, element('p', `${section.instructor} · Class ID ${section.class_id}`, 'class-professor'),
            element('p', `${formatDays(section.days)} · ${formatTime(section.start_time)} – ${formatTime(section.end_time)}`, 'class-schedule'));
        let location = section.locations[0];
        const locationText = element('p', null, 'class-location');
        const dates = element('p', null, 'class-date-range');
        const detail = element('details', null, 'class-dates');
        const datesList = element('p');
        detail.append(element('summary', 'Meeting dates'), datesList);
        function updateLocation() {
            locationText.textContent = `${location.building.name} (${location.building.code}) · Room ${location.room}`;
            dates.textContent = `${dateRange(location.dates)} · ${location.dates.length} ${location.dates.length === 1 ? 'meeting' : 'meetings'}`;
            datesList.textContent = location.dates.map(formatDate).join(' · ');
        }
        if (section.locations.length > 1) {
            const locationLabel = element('label', 'Meeting location', 'class-location-choice');
            const select = document.createElement('select');
            section.locations.forEach((item, i) => {
                const option = element('option', `${item.building.code} ${item.room} · ${dateRange(item.dates)}`);
                option.value = String(i); select.append(option);
            });
            select.addEventListener('change', () => { location = section.locations[Number(select.value)]; updateLocation(); choose(section, location, radio); });
            locationLabel.append(select); article.append(locationLabel);
        }
        updateLocation(); article.append(locationText, dates, detail);
        radio.addEventListener('change', () => choose(section, location, radio));
        article.addEventListener('click', event => {
            if (event.target.closest('input, label, select, option, details, button, a')) return;
            choose(section, location, radio); radio.focus({ preventScroll: true });
        });
        return article;
    }
    function showMore() {
        // Paginate DOM nodes locally; the catalog itself was fetched once.
        const end = Math.min(shown + 8, matches.length);
        const fragment = document.createDocumentFragment();
        for (; shown < end; shown++) fragment.append(card(matches[shown]));
        const firstNew = fragment.firstElementChild;
        results.append(fragment); more.hidden = shown === matches.length;
        more.textContent = `Show more sections (${matches.length - shown} remaining)`;
        if (shown > 8) firstNew?.querySelector('input')?.focus({ preventScroll: true });
        status.textContent = `${matches.length} ${matches.length === 1 ? 'section found' : 'sections found'}. ${shown < matches.length ? `Showing ${shown}. ` : ''}Select your section below.`;
    }
    openButton.addEventListener('click', () => {
        cancelJourney?.(); journey.hidden = true;
        if (!dialog.open) dialog.showModal();
        find(mode === 'id' ? '#class-id' : '#class-course').focus();
    });
    find('.class-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    });
    dialog.addEventListener('close', () => {
        revision++;
        if (results.hasAttribute('aria-busy')) {
            clearResults();
            status.textContent = 'Press Search classes to see matching sections.';
        }
        results.removeAttribute('aria-busy'); setLoading(false); openButton.focus();
    });
    form.addEventListener('change', event => {
        if (event.target.name !== 'class-mode') return;
        mode = event.target.value;
        find('#class-course-fields').hidden = mode !== 'course'; find('#class-id-fields').hidden = mode !== 'id';
        for (const input of find('#class-course-fields').querySelectorAll('input')) input.disabled = mode !== 'course';
        find('#class-id').disabled = mode !== 'id'; find('#class-id').required = mode === 'id';
        clearResults(); status.textContent = mode === 'id' ? 'Enter the class number from your schedule.' : 'Enter a course; add a professor or time to narrow it down.';
        find(mode === 'id' ? '#class-id' : '#class-course').focus();
    });
    form.addEventListener('input', event => {
        if (event.target.name === 'class-mode') return;
        const filters = [find('#class-professor').value.trim(), find('#class-time').value].filter(Boolean).length;
        find('.class-filters summary').firstChild.textContent = filters ? `Narrow your search · ${filters} active ` : 'Narrow your search ';
        clearResults(); status.textContent = 'Press Search classes to see matching sections.';
    });
    form.addEventListener('submit', async event => {
        event.preventDefault(); clearResults();
        const current = revision;
        const query = { mode, course: find('#class-course').value.trim(), professor: find('#class-professor').value.trim(), time: find('#class-time').value, classId: find('#class-id').value.trim() };
        if (!(mode === 'id' ? /^\d+$/.test(query.classId) : query.course)) { status.textContent = 'Enter a course or a numeric class ID.'; return; }
        status.textContent = 'Searching the MMC class catalog…'; results.setAttribute('aria-busy', 'true'); setLoading(true);
        showFeedback('Finding your class…', 'Checking sections, meeting times, and rooms.', 'loading');
        try {
            catalog = await loadCatalog();
            if (current !== revision || !dialog.open) return;
            const metadata = catalog.metadata;
            find('#class-term').textContent = `${metadata.term_name} · ${metadata.campus}`;
            const checked = metadata.assignment_checked_at || metadata.checked_at;
            find('#class-data-note').textContent = `Room assignments checked ${formatDate(checked.slice(0, 10))}, ${checked.slice(0, 4)}. Schedules may change. Only classes with usable MMC location data are included.`;
            matches = catalog.search({ ...query, term: metadata.term_code });
            results.removeAttribute('aria-busy'); setLoading(false);
            if (!matches.length) {
                status.textContent = mode === 'id'
                    ? `No class with that ID is in the ${metadata.term_name} MMC dataset. Check the class number and semester. Online classes and unavailable locations are excluded.`
                    : 'No matching classes. Try the course code, a shorter professor name, or remove the time filter. Online classes and unavailable locations are excluded.';
                showFeedback('No sections found', 'Check the course or class ID, or try removing a filter. Only mapped MMC classes are included.');
                return;
            }
            feedback.hidden = true; setStep(1);
            showMore();
            results.firstElementChild?.scrollIntoView({ block: 'nearest' });
        } catch {
            if (current !== revision) return;
            results.removeAttribute('aria-busy'); setLoading(false);
            showFeedback('We couldn’t load the catalog', 'Your search is saved. Check your connection, then search again.', 'error');
            status.textContent = 'Classes could not load. Check your connection and press Search classes to retry.';
        }
    });
    more.addEventListener('click', showMore);
    locate.addEventListener('click', () => {
        if (!selected) return;
        cancelJourney?.(); map.closePopup();
        const { section, location } = selected;
        const coordinates = [location.building.latitude, location.building.longitude];
        const popup = element('div', null, 'class-map-popup');
        popup.append(element('span', section.location_status, section.assignment_verified ? 'class-requested class-assigned' : 'class-requested'), element('h3', `${section.course_code} · ${section.section}`),
            element('p', section.course_name), element('p', `${section.instructor} · Class ID ${section.class_id}`),
            element('p', `${formatDays(section.days)} · ${formatTime(section.start_time)} – ${formatTime(section.end_time)}`),
            element('strong', `${location.building.name} (${location.building.code}) · Room ${location.room}`),
            element('p', `${catalog.metadata.term_name} · ${dateRange(location.dates)}`),
            element('p', section.assignment_verified ? `Building location · Room assignment checked ${formatDate(section.assignment_checked_at.slice(0, 10))}.` : 'Building location · Room assignment not verified.', 'class-map-note'));
        const reopen = element('button', 'Choose another class');
        reopen.type = 'button'; reopen.addEventListener('click', () => openButton.click()); popup.append(reopen);
        if (marker) marker.remove();
        marker = L.marker(coordinates, {
            icon: L.divIcon({ className: 'class-map-marker', html: '<span aria-hidden="true">⌖</span>', iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -20] }),
            title: `${section.course_code}, ${location.building.code} room ${location.room}`, zIndexOffset: 1500
        }).addTo(map).bindPopup(popup, { maxWidth: 310, autoPan: false });
        dialog.close();
        journey.hidden = false;
        journey.dataset.state = 'moving';
        journeyState.textContent = 'Gently moving to your class…';
        journey.querySelector('.class-journey-title').textContent = `${section.course_code} · ${location.building.code} ${location.room}`;
        journey.querySelector('.class-journey-location').textContent = `${location.building.name} · Room ${location.room}`;
        stopButton.hidden = false;
        cancelJourney = locateOnMap({ map, coordinates,
            reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
            onArrival() {
                journey.dataset.state = 'arrived';
                journeyState.textContent = 'Building located · Your class is pinned';
                stopButton.hidden = true;
                marker.getElement()?.classList.add('has-arrived');
            },
            onCancel() {
                journey.dataset.state = 'stopped';
                journeyState.textContent = 'Movement stopped · Your class is still pinned';
                stopButton.hidden = true;
            }
        });
    });
}
