import { AVATARS, ACTIVITIES, initials, normalizeProfile, sharedInterests } from './profileModel.js';

const node = (tag, className, text) => { const item = document.createElement(tag); item.className = className || ''; if (text != null) item.textContent = text; return item; };
const button = (text, className, action) => { const item = node('button', className, text); item.type = 'button'; item.addEventListener('click', action); return item; };
export function paintAvatar(target, profile) { target.textContent = AVATARS[profile?.avatar] && profile.avatar !== 'initials' ? AVATARS[profile.avatar] : initials(profile?.displayName); }

export function createProfileUI({ auth, people, onMessage }) {
    const launch = button('', 'campus-profile-launch', () => void open());
    launch.id = 'open-campus-profile'; launch.setAttribute('aria-label', 'Open your profile'); launch.setAttribute('aria-haspopup', 'dialog');
    const avatar = node('span', 'cp-avatar', 'YOU'); avatar.setAttribute('aria-hidden', 'true');
    launch.append(avatar, node('span', '', 'Your profile')); document.body.append(launch);
    const dialog = node('dialog', 'cp-dialog'); dialog.id = 'campus-profile-dialog'; dialog.setAttribute('aria-labelledby', 'cp-title');
    dialog.innerHTML = '<header class="cp-header"><h2 id="cp-title">Your profile</h2><button class="cp-close" type="button" aria-label="Close profile">×</button></header><div class="cp-content"></div><p class="cp-status" role="status" aria-live="polite"></p>';
    document.body.append(dialog);
    const content = dialog.querySelector('.cp-content'), status = dialog.querySelector('.cp-status'), title = dialog.querySelector('h2');
    let user = null, own = null, stopProfile, generation = 0, request = 0, busy = false, opener = launch, screen = '', viewedUid = null;
    const message = (text = '', error = false) => { status.textContent = text; status.dataset.error = String(error); };
    const report = error => message(error?.code === 'permission-denied' ? 'Profile access is unavailable. The profile database rules may need to be updated. Your changes have not been saved.' : error?.message || 'Could not load your profile. Please try again.', true);
    function close() { if (busy) return; dialog.close(); }
    dialog.querySelector('.cp-close').addEventListener('click', close);
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    dialog.addEventListener('close', () => { request++; opener?.focus(); });
    function account(next) {
        if (next?.uid === user?.uid) { user = next; return; }
        user = next; own = null; generation++; request++; stopProfile?.();
        paintAvatar(avatar, next);
        if (dialog.open && !busy) { content.replaceChildren(); screen = ''; message('Account changed. Open your profile again.'); }
        if (next) {
            const current = generation;
            stopProfile = people.watchProfile(next.uid, profile => {
                if (current !== generation) return;
                own = profile; paintAvatar(avatar, own || user);
                if (dialog.open && screen === 'card' && viewedUid === user.uid) renderCard(own || user);
            }, error => { if (dialog.open && current === generation) report(error); });
        }
    }
    auth.watch(account);
    auth.restore().then(account).catch(() => {});
    function begin(label) { screen = ''; title.textContent = label; content.replaceChildren(); message(); }
    function field(label, name, value, max, multiline = false) {
        const wrapper = node('label', 'cp-label', label), input = node(multiline ? 'textarea' : 'input');
        input.name = name; input.maxLength = max; input.value = value || ''; if (!multiline) input.type = 'text';
        wrapper.append(input); return wrapper;
    }
    function renderEditor(profile = own || user || {}) {
        begin('Edit your profile'); screen = 'edit';
        content.append(node('p', 'cp-eyebrow', 'A little about you'), node('h3', '', 'Find your people.'), node('p', 'cp-muted', 'Give fellow Panthers a few ways to say hello.'));
        const form = node('form');
        const icons = node('fieldset'); icons.append(node('legend', '', 'Your icon'));
        const choices = node('div', 'cp-options cp-icons');
        for (const [id, label] of Object.entries(AVATARS)) {
            const option = node('label', 'cp-choice'), input = node('input'); input.type = 'radio'; input.name = 'avatar'; input.value = id;
            input.checked = id === (profile.avatar || 'initials'); input.setAttribute('aria-label', id === 'initials' ? 'Use initials' : id);
            option.append(input, node('span', '', label)); choices.append(option);
        }
        icons.append(choices); form.append(icons);
        const name = field('Name', 'displayName', profile.displayName, 40); name.querySelector('input').required = true; name.querySelector('input').autocomplete = 'nickname';
        const major = field('Major', 'major', profile.major, 80); major.querySelector('input').placeholder = 'e.g. Computer Science';
        const bio = field('About you', 'bio', profile.bio, 280, true); bio.querySelector('textarea').placeholder = 'A quick introduction, in your own words.';
        const hobbies = field('Hobbies & interests', 'interests', (profile.interests || []).join(', '), 206);
        hobbies.querySelector('input').placeholder = 'Gaming, music, hiking'; hobbies.append(node('small', '', 'Separate with commas · Up to 8 interests'));
        form.append(name, major, bio, hobbies);
        const activities = node('fieldset'); activities.append(node('legend', '', 'I’m usually up for'));
        const activityChoices = node('div', 'cp-options');
        for (const [id, label] of Object.entries(ACTIVITIES)) {
            const option = node('label', 'cp-choice'), input = node('input'); input.type = 'checkbox'; input.name = 'activity'; input.value = id; input.checked = (profile.meetupActivities || []).includes(id);
            option.append(input, node('span', '', label)); activityChoices.append(option);
        }
        activities.append(activityChoices); form.append(activities);
        const toggle = node('label', 'cp-toggle'), checkbox = node('input'); checkbox.name = 'meetupOpen'; checkbox.type = 'checkbox'; checkbox.checked = profile.meetupOpen === true;
        const copy = node('span', '', 'Show me in Meet people'); copy.append(node('small', '', 'Let people discover your profile. You still choose when to join a Pulse meetup.')); toggle.append(checkbox, copy); form.append(toggle);
        form.append(node('p', 'cp-note', 'Your name, major, bio, interests, icon, and meetup preferences are visible to signed-in users. All fields except your name are optional.'));
        const actions = node('div', 'cp-actions'), save = node('button', 'cp-primary', 'Save profile'); save.type = 'submit';
        actions.append(button('Cancel', 'cp-secondary', () => { if (!busy) own ? renderCard(own) : close(); }), save); form.append(actions); content.append(form);
        form.addEventListener('submit', async event => {
            event.preventDefault(); if (busy) return;
            let values;
            try { values = normalizeProfile({ displayName: form.elements.displayName.value, major: form.elements.major.value, bio: form.elements.bio.value,
                interests: form.elements.interests.value, avatar: form.elements.avatar.value, meetupOpen: checkbox.checked,
                meetupActivities: [...form.querySelectorAll('[name=activity]:checked')].map(input => input.value) }); }
            catch (error) { report(error); return; }
            busy = true; save.disabled = true; save.textContent = 'Saving…'; message();
            const expectedUid = user?.uid;
            try {
                const active = await auth.restore();
                if (active?.uid !== expectedUid) throw Error('Your account changed. Close and reopen your profile before saving.');
                const accountUser = await auth.join(values.displayName);
                if (expectedUid && accountUser.uid !== expectedUid) throw Error('Your account changed. Please reopen your profile.');
                account(accountUser);
                const saved = await people.saveProfileDetails(accountUser, values);
                if (user?.uid !== accountUser.uid) throw Error('Your account changed while saving. Please reopen your profile.');
                own = saved; paintAvatar(avatar, saved); renderCard(saved); message('Profile saved.');
                window.dispatchEvent(new CustomEvent('campus-profile-updated', { detail: saved }));
            } catch (error) { report(error); }
            finally { busy = false; save.disabled = false; save.textContent = 'Save profile'; }
        });
    }
    function section(label, values, common = []) {
        if (!values?.length) return;
        const area = node('section', 'cp-section'); area.append(node('h4', '', label)); const tags = node('div', 'cp-tags');
        for (const value of values) { const tag = node('span', 'cp-tag', value); tag.dataset.shared = String(common.includes(value)); tags.append(tag); }
        area.append(tags); content.append(area);
    }
    function renderCard(profile) {
        const self = profile.uid === user?.uid; begin(self ? 'Your profile' : 'Panther profile'); screen = 'card'; viewedUid = profile.uid;
        const hero = node('div', 'cp-hero'), icon = node('span', 'cp-avatar'); paintAvatar(icon, profile); icon.setAttribute('aria-hidden', 'true');
        const heading = node('div'); heading.append(node('p', 'cp-eyebrow', self ? 'This is how others see you' : 'FIU community'), node('h3', '', profile.displayName || 'Panther'));
        heading.append(node('p', 'cp-muted', profile.major || 'Major not added')); hero.append(icon, heading); content.append(hero);
        if (profile.meetupOpen) content.append(node('span', 'cp-availability', '● Open to meeting people'));
        if (profile.bio) content.append(node('p', 'cp-bio', profile.bio));
        const common = sharedInterests(own, profile);
        section('Hobbies & interests', profile.interests, self ? [] : common);
        if (!self && common.length) content.append(node('p', 'cp-note', `${common.length} shared interest${common.length === 1 ? '' : 's'} highlighted in green.`));
        section('Up for', (profile.meetupActivities || []).map(id => ACTIVITIES[id]).filter(Boolean));
        if (!profile.bio && !profile.interests?.length && !profile.major) content.append(node('p', 'cp-muted', self ? 'Add a few details to help people get to know you.' : 'This person hasn’t added more details yet.'));
        const actions = node('div', 'cp-actions');
        if (self) {
            actions.append(button('Edit profile', 'cp-primary', () => renderEditor(own || profile)), button('Meet people', 'cp-secondary', () => void directory()));
            content.append(actions, node('p', 'cp-note', 'Your activity choices prefill Campus Pulse. Open Pulse when you’re ready to meet.'));
        } else {
            actions.append(button('Back to people', 'cp-secondary', () => void directory()));
            const messageButton = button('Message', 'cp-primary', async () => {
                if (busy) return; busy = true; messageButton.disabled = true; message('Opening conversation…');
                try { await onMessage(profile); busy = false; close(); } catch (error) { report(error); }
                finally { busy = false; messageButton.disabled = false; }
            }); actions.append(messageButton); content.append(actions);
        }
    }
    async function directory() {
        begin('Meet people'); screen = 'directory'; const current = ++request;
        content.append(node('p', 'cp-eyebrow', 'A familiar interest. A new friend.'), node('h3', '', 'Meet fellow Panthers.'), node('p', 'cp-muted', 'Discover people who are open to connecting. Shared interests appear first.'));
        const search = field('Search by name', 'search', '', 40); search.querySelector('input').type = 'search'; content.append(search);
        const listing = node('div', 'cp-directory'); content.append(listing, button('Back to your profile', 'cp-search-link', () => own ? renderCard(own) : renderEditor()));
        let queryVersion = 0, timer;
        async function load(term = '') {
            const version = ++queryVersion; message('Finding people…');
            try {
                const profiles = term ? await people.searchPeople(term, user.uid) : await people.discoverPeople(user.uid);
                if (current !== request || version !== queryVersion || screen !== 'directory' || !dialog.open) return;
                profiles.sort((a, b) => sharedInterests(own, b).length - sharedInterests(own, a).length || a.displayName.localeCompare(b.displayName));
                listing.replaceChildren();
                for (const profile of profiles) {
                    const row = button('', 'cp-person', () => void open(profile.uid, { keepOpener: true }));
                    const icon = node('span', 'cp-avatar'); paintAvatar(icon, profile); const copy = node('span'); copy.append(node('strong', '', profile.displayName), node('small', '', profile.major || 'FIU community'));
                    const count = sharedInterests(own, profile).length; if (count) copy.append(node('small', '', `${count} shared interest${count === 1 ? '' : 's'}`));
                    row.append(icon, copy); listing.append(row);
                }
                message(profiles.length ? (profiles.length >= (term ? 25 : 59) ? 'Showing a selection. Search by name to find someone specific.' : '') : term ? 'No matches. Try the start of a name.' : 'No profiles to show yet. People appear here when they choose to be discoverable.');
            } catch (error) { if (current === request && version === queryVersion) report(error); }
        }
        search.querySelector('input').addEventListener('input', event => { clearTimeout(timer); queryVersion++; const term = event.target.value.trim(); timer = setTimeout(() => { if (current === request && screen === 'directory') void load(term); }, 250); });
        await load();
    }
    async function open(uid = null, { keepOpener = false } = {}) {
        if (busy) return;
        if (!keepOpener && !dialog.open) opener = document.activeElement;
        if (!dialog.open) dialog.showModal();
        begin('Your profile'); message('Loading profile…');
        try {
            const active = await auth.restore(); account(active); const current = ++request;
            if (!active) { renderEditor({}); return; }
            const profile = await people.getProfile(uid || active.uid);
            if (current !== request || !dialog.open) return;
            if (!uid || uid === active.uid) { own = profile; if (!profile.updatedAt) { renderEditor({ ...profile, displayName: active.displayName || '' }); return; } }
            renderCard(profile);
        } catch (error) { report(error); content.append(button('Try again', 'cp-secondary', () => void open(uid, { keepOpener: true }))); }
    }
    return { open };
}
