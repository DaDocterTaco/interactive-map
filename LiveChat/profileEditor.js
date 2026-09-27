import { AVATARS, ACTIVITIES, initials, normalizeProfile } from './profileModel.js';

const node = (tag, css = '', text) => { const el = document.createElement(tag); el.className = css; if (text != null) el.textContent = text; return el; };
const button = (text, css, action) => { const el = node('button', css, text); el.type = 'button'; if (action) el.addEventListener('click', action); return el; };
export function profileIcon(name, path = './assets/icons/') {
    const icon = node('span', 'cp-icon'); icon.setAttribute('aria-hidden', 'true');
    icon.style.setProperty('--cp-icon', `url("${new URL(`${path}${name}.svg`, import.meta.url).href}")`); return icon;
}
export function paintProfileAvatar(target, profile) {
    target.replaceChildren();
    if (Object.hasOwn(AVATARS, profile?.avatar) && profile.avatar !== 'initials') target.append(profileIcon(profile.avatar, './assets/profile-icons/'));
    else target.textContent = initials(profile?.displayName);
}

export function mountProfileEditor({ content, footer, profile, onSave, onCancel }) {
    let saving = false, closed = false, pendingClose = null;
    let interests = [...(profile.interests || [])];
    const form = node('form', 'cp-editor-form'); form.id = 'cp-edit-form';
    const column = node('div', 'cp-fields'), tabs = node('div', 'cp-edit-tabs');
    tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Profile sections'); column.append(tabs);
    const panels = [], tabButtons = [];
    function selectPanel(index, focus = false) {
        panels.forEach((panel, i) => { panel.hidden = i !== index; tabButtons[i].setAttribute('aria-selected', String(i === index)); tabButtons[i].tabIndex = i === index ? 0 : -1; });
        if (focus) tabButtons[index].focus();
    }
    const section = (title, subtitle, iconName, tabName, key) => {
        const block = node('section', 'cp-edit-section'), heading = node('div', 'cp-section-heading'), copy = node('div');
        const index = panels.length, tab = button(tabName, 'cp-edit-tab', () => selectPanel(index));
        tab.prepend(profileIcon(iconName)); tab.id = `cp-tab-${key}`; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', `cp-panel-${key}`);
        block.id = `cp-panel-${key}`; block.dataset.panel = key; block.setAttribute('role', 'tabpanel'); block.setAttribute('aria-labelledby', tab.id);
        tab.addEventListener('keydown', event => {
            let next = index;
            if (event.key === 'ArrowRight') next = (index + 1) % tabButtons.length;
            else if (event.key === 'ArrowLeft') next = (index + tabButtons.length - 1) % tabButtons.length;
            else if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = tabButtons.length - 1;
            else return;
            event.preventDefault(); selectPanel(next, true);
        });
        tabs.append(tab); tabButtons.push(tab); panels.push(block);
        heading.append(profileIcon(iconName)); copy.append(node('h3', '', title), node('p', '', subtitle)); heading.append(copy); block.append(heading); column.append(block); return block;
    };
    const label = (title, key, max, multiline = false) => {
        const wrap = node('label', 'cp-label'), caption = node('span', 'cp-field-caption', title), input = node(multiline ? 'textarea' : 'input');
        input.id = `cp-edit-${key}`; input.name = key; input.maxLength = max; input.value = profile[key] || ''; if (!multiline) input.type = 'text';
        wrap.append(caption, input); return { wrap, caption, input };
    };
    const basics = section('The basics', 'A name and a little personality.', 'users', 'About you', 'about');
    const identity = node('div', 'cp-identity'), editorAvatar = node('span', 'cp-avatar cp-editor-avatar'), picker = node('fieldset', 'cp-icon-picker');
    editorAvatar.setAttribute('aria-hidden', 'true'); picker.append(node('legend', '', 'Make it yours'));
    const choices = node('div', 'cp-icon-options');
    for (const [id, title] of Object.entries(AVATARS)) {
        const option = node('label', 'cp-avatar-option'), input = node('input'); input.type = 'radio'; input.name = 'avatar'; input.value = id; input.checked = id === (profile.avatar || 'initials'); input.setAttribute('aria-label', title === 'Initials' ? 'Use initials' : title);
        option.title = title; option.append(input);
        const art = node('span', 'cp-avatar-option-art');
        if (id === 'initials') art.textContent = initials(profile.displayName); else art.append(profileIcon(id, './assets/profile-icons/'));
        option.append(art); choices.append(option);
    }
    picker.append(choices, node('p', 'cp-avatar-hint', 'Choose your campus icon.')); identity.append(editorAvatar, picker); basics.append(identity);
    const names = node('div', 'cp-name-grid'), name = label('Display name', 'displayName', 40), major = label('Major', 'major', 80);
    name.input.required = true; name.input.autocomplete = 'nickname'; name.input.placeholder = 'Your name'; major.input.placeholder = 'e.g. Computer Science';
    names.append(name.wrap, major.wrap); basics.append(names);
    const bio = label('About you', 'bio', 280, true), bioCount = node('small', 'cp-field-count'); bioCount.id = 'cp-bio-count'; bioCount.setAttribute('aria-hidden', 'true'); bio.input.setAttribute('aria-describedby', bioCount.id); bio.input.placeholder = 'What would you want a new friend to know?'; bio.caption.append(bioCount); basics.append(bio.wrap);

    const hobbyBlock = section('Find your common ground.', 'A few things you love can start a conversation.', 'controller', 'Interests', 'interests');
    const hobbyLabel = node('label', 'cp-sr', 'Add an interest'); hobbyLabel.htmlFor = 'cp-interest-input';
    const composer = node('div', 'cp-interest-composer'), selected = node('div', 'cp-interest-tags'), entry = node('div', 'cp-interest-entry'), interestInput = node('input');
    interestInput.id = 'cp-interest-input'; interestInput.placeholder = 'Add an interest'; interestInput.maxLength = 206; interestInput.autocomplete = 'off';
    const add = button('Add', 'cp-add-interest', () => commitInterests()); entry.append(interestInput, add); composer.append(selected, entry);
    const hobbyMeta = node('div', 'cp-hobby-meta'), interestCount = node('span'), interestError = node('p', 'cp-field-error'); interestError.id = 'cp-interest-error'; interestError.setAttribute('role', 'status');
    const hobbyHint = node('span', '', 'Enter or comma to add'); hobbyHint.id = 'cp-interest-hint'; interestInput.setAttribute('aria-describedby', `${hobbyHint.id} ${interestError.id}`);
    hobbyMeta.append(hobbyHint, interestCount); hobbyBlock.append(hobbyLabel, composer, hobbyMeta, interestError);
    const suggestions = node('div', 'cp-suggestions'); suggestions.setAttribute('aria-label', 'Suggested interests');
    for (const text of ['Music', 'Gaming', 'Fitness', 'Art', 'Reading', 'Hiking', 'Photography', 'Technology']) {
        const choice = button(text, 'cp-suggestion', () => {
            const index = interests.findIndex(item => item.toLowerCase() === text.toLowerCase());
            if (index >= 0) interests.splice(index, 1); else if (interests.length < 8) interests.push(text); else { interestError.textContent = 'You can add up to 8 interests. Remove one to add another.'; return; }
            interestError.textContent = ''; renderInterests(); update();
        }); choice.prepend(profileIcon('plus-lg')); choice.dataset.interest = text; suggestions.append(choice);
    }
    hobbyBlock.append(node('p', 'cp-suggestion-label', 'Pick a few favorites'), suggestions);

    const meetupBlock = section('Your kind of plans.', 'Let people know what you’d be up for.', 'cup-hot', 'Meetups', 'meetups');
    const activityChoices = node('fieldset', 'cp-activity-options'); activityChoices.append(node('legend', 'cp-sr', 'Meetup preferences'));
    for (const [id, text] of Object.entries(ACTIVITIES)) {
        const option = node('label', 'cp-activity-option'), input = node('input'); input.type = 'checkbox'; input.name = 'activity'; input.value = id; input.checked = (profile.meetupActivities || []).includes(id);
        const check = node('span', 'cp-choice-check'); check.append(profileIcon('check2')); check.setAttribute('aria-hidden', 'true');
        const copy = node('span', 'cp-activity-copy'); copy.append(node('strong', '', text), node('small', '', {coffee:'A quick catch-up',food:'Find a lunch buddy',chat:'Good company'}[id]));
        input.setAttribute('aria-label', text);
        option.append(input, profileIcon(id === 'coffee' ? 'cup-hot' : id === 'food' ? 'tools-kitchen-2' : 'chat', id === 'food' ? '../Events/icons/' : './assets/icons/'), copy, check); activityChoices.append(option);
    }
    meetupBlock.append(activityChoices);
    const toggle = node('label', 'cp-discovery'), checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.name = 'meetupOpen'; checkbox.checked = profile.meetupOpen === true; checkbox.setAttribute('role', 'switch');
    const toggleCopy = node('span', 'cp-discovery-copy'); toggleCopy.append(node('strong', '', 'Open to meeting people'), node('small', '', 'Show my profile in Meet people.')); checkbox.setAttribute('aria-label', 'Show me in Meet people');
    toggle.append(toggleCopy, checkbox); meetupBlock.append(toggle);

    const preview = node('details', 'cp-preview'); preview.open = true;
    const summary = node('summary', 'cp-preview-summary', 'Your profile preview'); summary.append(profileIcon('chevron-right')); preview.append(summary);
    const previewInner = node('div', 'cp-preview-inner'), previewTop = node('div', 'cp-preview-heading'); previewTop.append(node('span', 'cp-eyebrow', 'Profile preview'), node('span', 'cp-preview-live', 'Live'));
    const card = node('article', 'cp-preview-card'); card.setAttribute('aria-label', 'Preview of your public profile');
    const cover = node('div', 'cp-preview-cover'), previewAvatar = node('div', 'cp-avatar cp-preview-avatar'); previewAvatar.setAttribute('aria-hidden', 'true');
    cover.append(node('span', 'cp-eyebrow', 'FIU community'), profileIcon('building')); card.append(cover, previewAvatar);
    const cardBody = node('div', 'cp-preview-card-body'), previewName = node('h3'), previewMajor = node('p', 'cp-preview-major'), previewBio = node('p', 'cp-preview-bio');
    const openBadge = node('span', 'cp-availability'); openBadge.append(profileIcon('people-fill'), node('span', '', 'Open to meeting people'));
    const previewInterests = node('div', 'cp-tags'), previewActivities = node('div', 'cp-preview-activities');
    cardBody.append(previewName, previewMajor, openBadge, previewBio, previewInterests, previewActivities); card.append(cardBody);
    const privacy = node('div', 'cp-privacy-note'); privacy.append(profileIcon('users'), node('p', '', 'Visible to signed-in Panthers. Share only what feels right.'));
    previewInner.append(previewTop, card, privacy); preview.append(previewInner);
    const narrow = matchMedia('(max-width: 760px)'); preview.open = !narrow.matches; preview.tabIndex = narrow.matches ? -1 : 0;
    const onSize = event => { preview.open = !event.matches; preview.tabIndex = event.matches ? -1 : 0; }; narrow.addEventListener('change', onSize);
    selectPanel(0); form.append(column, preview); content.append(form);
    form.addEventListener('invalid', event => { const panel = event.target.closest('[role=tabpanel]'); if (panel) selectPanel(panels.indexOf(panel)); }, true);

    const footerRow = node('div', 'cp-editor-footer'), saveState = node('span', 'cp-save-state'), actions = node('div', 'cp-footer-actions');
    const cancel = button('Cancel', 'cp-secondary', () => requestClose(onCancel)), save = button('Save changes', 'cp-primary'); save.type = 'submit'; save.setAttribute('form', form.id);
    actions.append(cancel, save); footerRow.append(saveState, actions);
    const feedback = node('p', 'cp-save-feedback'); feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite');
    const discard = node('div', 'cp-discard'); discard.hidden = true; discard.setAttribute('role', 'group'); discard.setAttribute('aria-label', 'Unsaved profile changes');
    const keep = button('Keep editing', 'cp-secondary', () => { pendingClose = null; discard.hidden = true; cancel.focus(); });
    discard.append(node('span', '', 'Discard your unsaved changes?'), keep, button('Discard changes', 'cp-danger', () => { const exit = pendingClose; pendingClose = null; exit?.(); }));
    footer.append(feedback, discard, footerRow);
    const values = () => ({ displayName: name.input.value, major: major.input.value, bio: bio.input.value, interests: [...interests], avatar: form.elements.avatar.value, meetupOpen: checkbox.checked, meetupActivities: [...form.querySelectorAll('[name=activity]:checked')].map(input => input.value) });
    const original = JSON.stringify(values());
    const dirty = () => original !== JSON.stringify(values()) || !!interestInput.value.trim();
    function requestClose(exit) {
        if (saving) return;
        if (!dirty()) { exit(); return; }
        pendingClose = exit; discard.hidden = false; keep.focus();
    }
    function renderInterests() {
        selected.replaceChildren();
        for (const text of interests) {
            const chip = node('span', 'cp-edit-tag', text), remove = button('', 'cp-remove-interest', () => { interests = interests.filter(item => item !== text); renderInterests(); update(); interestInput.focus(); });
            remove.setAttribute('aria-label', `Remove ${text}`); remove.append(profileIcon('x-lg')); chip.append(remove); selected.append(chip);
        }
        selected.hidden = !interests.length; interestCount.textContent = `${interests.length} / 8 interests`;
        for (const choice of suggestions.children) { const chosen = interests.some(item => item.toLowerCase() === choice.dataset.interest.toLowerCase()); choice.setAttribute('aria-pressed', String(chosen)); choice.querySelector('.cp-icon').replaceWith(profileIcon(chosen ? 'check2' : 'plus-lg')); }
    }
    function commitInterests() {
        if (saving) return false;
        const incoming = interestInput.value.split(',').map(item => item.trim()).filter(Boolean);
        const merged = [...interests];
        for (const item of incoming) { if (item.length > 24) { interestError.textContent = 'Keep each interest to 24 characters or fewer.'; interestInput.setAttribute('aria-invalid', 'true'); return false; } if (!merged.some(existing => existing.toLowerCase() === item.toLowerCase())) merged.push(item); }
        if (merged.length > 8) { interestError.textContent = 'You can add up to 8 interests. Remove one to add another.'; interestInput.setAttribute('aria-invalid', 'true'); return false; }
        interests = merged; interestInput.value = ''; interestInput.removeAttribute('aria-invalid'); interestError.textContent = ''; renderInterests(); update(); return true;
    }
    interestInput.addEventListener('keydown', event => { if (!event.isComposing && (event.key === 'Enter' || event.key === ',')) { event.preventDefault(); commitInterests(); } });
    interestInput.addEventListener('input', () => { interestError.textContent = ''; interestInput.removeAttribute('aria-invalid'); });
    function update() {
        const current = values(); paintProfileAvatar(editorAvatar, current); paintProfileAvatar(previewAvatar, current);
        choices.querySelector('.cp-avatar-option-art').textContent = initials(current.displayName);
        previewName.textContent = current.displayName.trim() || 'Your name'; previewMajor.textContent = current.major.trim() || 'Your major';
        previewBio.textContent = current.bio.trim() || 'A little about you goes here.'; previewBio.classList.toggle('is-placeholder', !current.bio.trim());
        previewInterests.replaceChildren(...current.interests.map(text => node('span', 'cp-tag', text)));
        previewActivities.replaceChildren();
        if (current.meetupActivities.length) previewActivities.append(node('span', 'cp-eyebrow', 'Up for'), node('p', '', current.meetupActivities.map(id => ACTIVITIES[id]).join(' · ')));
        openBadge.hidden = !current.meetupOpen; bioCount.textContent = `${current.bio.length} / 280`;
        saveState.textContent = dirty() ? 'Unsaved changes' : profile.updatedAt ? 'You’re up to date' : 'Only your name is required';
        saveState.dataset.dirty = String(dirty()); save.disabled = saving || !dirty(); add.disabled = saving || !interestInput.value.trim();
        feedback.textContent = ''; name.input.setCustomValidity('');
    }
    form.addEventListener('input', update); form.addEventListener('change', update);
    form.addEventListener('submit', async event => {
        event.preventDefault(); if (saving) return; if (!commitInterests()) { selectPanel(1); interestInput.focus(); return; }
        let normalized;
        try { normalized = normalizeProfile(values()); } catch (error) { feedback.textContent = error.message; if (!name.input.value.trim()) { name.input.setCustomValidity('Enter a display name.'); name.input.reportValidity(); } return; }
        saving = true; save.disabled = true; save.textContent = 'Saving…'; cancel.disabled = true; form.setAttribute('aria-busy', 'true'); saveState.textContent = 'Saving your profile'; feedback.textContent = '';
        for (const control of form.querySelectorAll('input,textarea,button')) control.disabled = true;
        try { await onSave(normalized); }
        catch (error) { feedback.textContent = error?.code === 'permission-denied' ? 'We couldn’t save your profile. Your changes are still here—please try again.' : error?.message || 'Could not save your profile. Please try again.'; }
        finally {
            saving = false; if (closed) return; save.textContent = 'Save changes'; save.disabled = false; cancel.disabled = false; form.removeAttribute('aria-busy');
            for (const control of form.querySelectorAll('input,textarea,button')) control.disabled = false;
            add.disabled = !interestInput.value.trim();
            saveState.textContent = 'Unsaved changes';
        }
    });
    renderInterests(); update();
    return { requestClose, destroy() { closed = true; narrow.removeEventListener('change', onSize); } };
}
