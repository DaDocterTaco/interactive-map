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
            <div><p class="class-eyebrow">FIND YOUR WAY</p><h2 id="class-title">Open Class</h2><p class="class-subtitle">Find your section, then locate its building.</p></div>
            <button type="button" class="class-close" aria-label="Close class search">×</button>
        </header>
        <div class="class-body">
            <p class="class-term" id="class-term">Fall 2026 · MMC</p>
            <form id="class-search-form">
                <fieldset class="class-modes"><legend>Search by</legend>
                    <label><input type="radio" name="class-mode" value="course" checked> Course & professor</label>
                    <label><input type="radio" name="class-mode" value="id"> Class ID</label>
                </fieldset>
                <div id="class-course-fields" class="class-fields">
                    <label class="class-course-label">Course name or code<input id="class-course" placeholder="e.g. COT 3100 or Discrete Structures" autocomplete="off" maxlength="100" required></label>
                    <label>Professor <span class="class-optional">(optional)</span><input id="class-professor" placeholder="e.g. Whittaker" autocomplete="off" maxlength="100"></label>
                    <label>Start time <span class="class-optional">(optional)</span><input id="class-time" type="time"></label>
                </div>
                <div id="class-id-fields" hidden>
                    <label>Class ID<input id="class-id" placeholder="e.g. 84848" inputmode="numeric" pattern="[0-9]+" maxlength="12" autocomplete="off" disabled></label>
                    <p class="class-help">Use the section’s class number from your schedule, such as 84848.</p>
                </div>
                <button type="submit" class="class-search-button">Search classes</button>
            </form>
            <p id="class-results-status" role="status" aria-live="polite">Search by course and professor, or use a class ID.</p>
            <div id="class-results" role="group" aria-label="Matching class sections"></div>
            <button type="button" id="class-more" hidden>Show more classes</button>
            <p class="class-data-note" id="class-data-note">Room assignments are checked against FIU 25Live. Only classes with usable MMC location data are included.</p>
        </div>
        <footer class="class-footer"><p id="class-selection">Select a class to locate it.</p><button id="locate-class" type="button" disabled>Locate class</button></footer>`;
    document.body.append(dialog);
    const find = selector => dialog.querySelector(selector);
    const form = find('#class-search-form'), results = find('#class-results'), status = find('#class-results-status');
    const locate = find('#locate-class'), selectionText = find('#class-selection'), more = find('#class-more');
    const loadCatalog = createCatalogLoader(new URL('./classes.json?v=assigned-20260926', import.meta.url));
    // revision invalidates any fetch result after edits, mode changes, or close.
    let catalog, mode = 'course', selected, selectedRadio, marker, matches = [], shown = 0, revision = 0;

    function clearResults() {
        revision++;
        results.replaceChildren(); matches = []; shown = 0; selected = null; selectedRadio = null;
        more.hidden = true; locate.disabled = true;
        selectionText.textContent = 'Select a class to locate it.';
        results.removeAttribute('aria-busy');
    }
    function choose(section, location, radio) {
        selected = { section, location };
        selectedRadio?.closest('.class-card').classList.remove('is-selected');
        selectedRadio = radio; radio.checked = true;
        radio.closest('.class-card').classList.add('is-selected');
        locate.disabled = false;
        selectionText.textContent = `${section.course_code} · ${location.building.code}, room ${location.room}`;
    }
    function card(section) {
        // Render source data through textContent so names and room labels are
        // treated as text even if the dataset contains markup characters.
        const article = element('article', null, 'class-card');
        const label = element('label', null, 'class-card-heading');
        const radio = document.createElement('input');
        radio.type = 'radio'; radio.name = 'class-result'; radio.value = section.class_id;
        const heading = element('span');
        heading.append(element('strong', `${section.course_code} · ${section.section}`), element('span', section.course_name, 'class-course-name'));
        const badge = element('span', section.location_status, section.assignment_verified ? 'class-requested class-assigned' : 'class-requested');
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
        return article;
    }
    function showMore() {
        // Paginate DOM nodes locally; the catalog itself was fetched once.
        const end = Math.min(shown + 30, matches.length);
        const fragment = document.createDocumentFragment();
        for (; shown < end; shown++) fragment.append(card(matches[shown]));
        results.append(fragment); more.hidden = shown === matches.length;
        status.textContent = `${matches.length} ${matches.length === 1 ? 'class matches' : 'classes match'}. ${shown < matches.length ? `Showing ${shown}. ` : ''}Select your section below.`;
    }
    openButton.addEventListener('click', () => {
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
        if (results.hasAttribute('aria-busy')) status.textContent = 'Press Search classes to see matching sections.';
        results.removeAttribute('aria-busy'); openButton.focus();
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
        clearResults(); status.textContent = 'Press Search classes to see matching sections.';
    });
    form.addEventListener('submit', async event => {
        event.preventDefault(); clearResults();
        const current = revision;
        const query = { mode, course: find('#class-course').value.trim(), professor: find('#class-professor').value.trim(), time: find('#class-time').value, classId: find('#class-id').value.trim() };
        if (!(mode === 'id' ? /^\d+$/.test(query.classId) : query.course)) { status.textContent = 'Enter a course or a numeric class ID.'; return; }
        status.textContent = 'Loading classes…'; results.setAttribute('aria-busy', 'true');
        try {
            catalog = await loadCatalog();
            if (current !== revision || !dialog.open) return;
            const metadata = catalog.metadata;
            find('#class-term').textContent = `${metadata.term_name} · ${metadata.campus}`;
            const checked = metadata.assignment_checked_at || metadata.checked_at;
            find('#class-data-note').textContent = `Room assignments checked ${formatDate(checked.slice(0, 10))}, ${checked.slice(0, 4)}. Schedules may change. Only classes with usable MMC location data are included.`;
            matches = catalog.search({ ...query, term: metadata.term_code });
            results.removeAttribute('aria-busy');
            if (!matches.length) {
                status.textContent = mode === 'id'
                    ? `No class with that ID is in the ${metadata.term_name} MMC dataset. Check the class number and semester. Online classes and unavailable locations are excluded.`
                    : 'No matching classes. Try the course code, a shorter professor name, or remove the time filter. Online classes and unavailable locations are excluded.';
                return;
            }
            showMore();
            results.firstElementChild?.scrollIntoView({ block: 'nearest' });
        } catch {
            if (current !== revision) return;
            results.removeAttribute('aria-busy');
            status.textContent = 'Classes could not load. Check your connection and press Search classes to retry.';
        }
    });
    more.addEventListener('click', showMore);
    locate.addEventListener('click', () => {
        if (!selected) return;
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
            icon: L.divIcon({ className: 'class-map-marker', html: '<span aria-hidden="true">C</span>', iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -20] }),
            title: `${section.course_code}, ${location.building.code} room ${location.room}`, zIndexOffset: 1500
        }).addTo(map).bindPopup(popup, { maxWidth: 310 });
        dialog.close();
        map.setView(coordinates, 18, { animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches });
        marker.openPopup();
    });
}
