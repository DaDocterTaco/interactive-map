import { iconNode } from './view.js';
import { createMapPreviews } from './maps.js';
import { millis, usableSpot } from '../shared/policy.js';

const node = (tag, cls, text) => { const n = document.createElement(tag); n.className = cls || ''; if (text != null) n.textContent = text; return n; };
const time = value => new Date(millis(value)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const activityIcon = activity => ({ coffee: 'coffee', food: 'tools-kitchen-2', chat: 'message-circle' })[activity] || 'users';
const minutes = plan => Math.max(1, Math.round((millis(plan.endsAt) - millis(plan.startsAt)) / 60000));
const place = spot => { const [name, area] = spot.name.split(' · '); return { name, area: area || (spot.id === 'pond-benches' ? 'West of Green Library' : 'FIU · MMC') }; };

// UI state lives here; Firebase membership and transitions stay in pulse.js.
export function createPresentation({ dialog, L, getState, showOnMap, getProfile, openProfile, paintAvatar }) {
  const $ = key => dialog.querySelector(`[data-${key}]`);
  const small = matchMedia('(max-width:700px)'), reduced = matchMedia('(prefers-reduced-motion:reduce)');
  const maps = createMapPreviews({ dialog, L });
  const profiles = new Map(), requests = new Set(), signatures = new WeakMap();
  let disposed = false, tab = 'details', unread = 0, group = '', toastTimer, frame, lastMessages = new Set(), messageGroup = '', catalogKey = '';
  const button = (key, label) => { const labelNode = $(key)?.querySelector('[data-button-label]'); if (labelNode) labelNode.textContent = label; };
  function toast(text) { clearTimeout(toastTimer); $('toast').textContent = text; $('toast').hidden = false; toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4200); }
  function rememberSearch(requestId, maxWalkMinutes) {
    const { user, locationMode } = getState();
    const label = locationMode === 'gps' ? 'Your private starting location' : $('optin').elements.startingSpot.selectedOptions[0]?.textContent;
    // Store only the user's chosen label, never coordinates, and tie it to this availability.
    try { sessionStorage.setItem(`pulse-search:${user.uid}`, JSON.stringify({ requestId, maxWalkMinutes, label })); } catch {}
  }
  function paint(target, uid, name) {
    target.dataset.uid = uid;
    target.dataset.tone = String([...uid].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 4);
    target.textContent = name.split(/\s+/).filter(Boolean).slice(0, 2).map(n => [...n][0]).join('').toUpperCase();
    target.setAttribute('aria-hidden', 'true');
    if (profiles.has(uid)) { if (paintAvatar) paintAvatar(target, profiles.get(uid)); return; }
    if (!getProfile || requests.has(uid)) return;
    requests.add(uid);
    Promise.resolve(getProfile(uid)).then(profile => {
      if (disposed || !profile) return;
      profiles.set(uid, profile);
      if (paintAvatar) dialog.querySelectorAll('.pulse-avatar').forEach(avatar => { if (avatar.dataset.uid === uid) paintAvatar(avatar, profile); });
    }).catch(() => {}).finally(() => requests.delete(uid));
  }
  function avatar(uid, name) { const n = node('span', 'pulse-avatar'); paint(n, uid, name); return n; }
  function renderPeople(container, plan, isProposal) {
    const { user, checkIns } = getState();
    const ids = (isProposal ? plan.candidateIds : plan.participantIds) || [];
    const signature = JSON.stringify([ids, plan.participantNames, plan.responses, checkIns.map(c => c.uid)]);
    if (signatures.get(container) === signature) return;
    signatures.set(container, signature);
    container.replaceChildren(...ids.map(uid => {
      const name = plan.participantNames?.[uid] || 'Student', row = node('li', 'pulse-person');
      const decision = plan.responses?.[uid]?.decision;
      const arrived = checkIns.some(c => c.uid === uid);
      row.dataset.status = isProposal ? decision === 'accept' ? 'accepted' : 'considering' : arrived ? 'here' : 'on-the-way';
      const label = node(openProfile ? 'button' : 'span', 'pulse-person-name', `${name}${uid === user?.uid ? ' (you)' : ''}`);
      if (openProfile) { label.type = 'button'; label.setAttribute('aria-label', `View ${name}'s profile`); label.addEventListener('click', () => void openProfile(uid)); }
      const status = node('small', '', isProposal ? ({ accept: 'Accepted', decline: 'Passed' }[decision] || 'Considering') : arrived ? 'Here' : 'On the way');
      if (row.dataset.status === 'accepted' || row.dataset.status === 'here') status.prepend(iconNode('check'));
      const copy = node('div', 'pulse-person-copy'); copy.append(label, status);
      row.append(avatar(uid, name), copy); return row;
    }));
  }
  function renderSpot(container, plan) {
    if (!plan?.spot) { container.replaceChildren(); return; }
    const { user } = getState(), { name, area } = place({ ...plan.spot, id: plan.spotId });
    const card = node('div', 'pulse-spot'), title = node('div', 'pulse-spot-title'), labels = node('div');
    labels.append(node('h3', '', name), node('p', 'pulse-spot-area', area)); title.append(iconNode(activityIcon(plan.activity)), labels);
    const details = node('div', 'pulse-details'), duration = node('span', '', `${minutes(plan)} min together`);
    duration.prepend(iconNode('clock')); details.append(duration);
    if (plan.walkingMinutes?.[user?.uid] != null) { const walk = node('span', '', `~${plan.walkingMinutes[user.uid]} min walk`); walk.prepend(iconNode('walk')); details.append(walk); }
    card.append(title, node('p', 'pulse-spot-instruction', plan.spot.instruction), details, node('p', 'pulse-spot-time', `${time(plan.startsAt)} – ${time(plan.endsAt)}`));
    const pin = node('button', 'pulse-secondary', 'Show meeting point on map'); pin.type = 'button'; pin.prepend(iconNode('map'));
    pin.addEventListener('click', () => showOnMap(plan));
    card.append(pin, node('p', 'pulse-fine', 'Walking time is an estimate. Allow time for your next class.')); container.replaceChildren(card);
  }
  function syncTabs() {
    const { meetup, user } = getState();
    const chatOpen = meetup && ['confirmed', 'ended'].includes(meetup.status) && millis(meetup.chatClosesAt) > Date.now() && meetup.participantIds.includes(user?.uid);
    $('details-panel').hidden = small.matches && tab !== 'details';
    $('chat').hidden = !chatOpen || (small.matches && tab !== 'chat');
    $('chat-closed').hidden = !!chatOpen || (small.matches && tab !== 'chat');
    for (const key of ['details', 'chat']) {
      const control = dialog.querySelector(`[data-tab=${key}]`), panel = key === 'details' ? $('details-panel') : $('chat');
      control.setAttribute('aria-selected', String(key === tab)); control.tabIndex = key === tab ? 0 : -1;
      if (small.matches) { panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', control.id); }
      else { panel.removeAttribute('role'); panel.removeAttribute('aria-labelledby'); }
    }
    if (dialog.open && (!small.matches || tab === 'chat')) unread = 0;
    $('unread').hidden = !unread; $('unread').textContent = String(unread);
    dialog.querySelector('[data-tab=chat]').setAttribute('aria-label', unread ? `Chat, ${unread} unread ${unread === 1 ? 'message' : 'messages'}` : 'Chat');
  }
  function scrollMessages() { const log = $('messages'); log.scrollTo({ top: log.scrollHeight, behavior: reduced.matches ? 'instant' : 'smooth' }); $('new-messages').hidden = true; }
  dialog.querySelectorAll('[data-tab]').forEach(control => {
    control.addEventListener('click', () => { tab = control.dataset.tab; syncTabs(); if (tab === 'chat') scrollMessages(); });
    control.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); tab = event.key === 'Home' ? 'details' : event.key === 'End' ? 'chat' : tab === 'details' ? 'chat' : 'details';
      dialog.querySelector(`[data-tab=${tab}]`).focus(); syncTabs();
    });
  });
  small.addEventListener('change', syncTabs);
  $('new-messages').addEventListener('click', scrollMessages);
  $('messages').addEventListener('scroll', () => { const log = $('messages'); if (log.scrollHeight - log.scrollTop - log.clientHeight < 60) $('new-messages').hidden = true; });
  function renderMessages() {
    const { messages, meetup, user } = getState(), log = $('messages');
    if (messageGroup !== meetup?.id) { messageGroup = meetup?.id; lastMessages = new Set(); log.replaceChildren(); signatures.delete(log); unread = 0; }
    const signature = JSON.stringify(messages.map(m => [m.id, m.text, m.pending, millis(m.createdAt)]));
    if (signatures.get(log) === signature) return;
    const first = !signatures.has(log), atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    signatures.set(log, signature);
    const existing = new Map([...log.querySelectorAll('[data-message-id]')].map(n => [n.dataset.messageId, n]));
    if (messages.length) log.querySelector('.pulse-chat-empty')?.remove();
    const ids = new Set(messages.map(m => m.id));
    for (const [id, n] of existing) if (!ids.has(id)) n.remove();
    let ownNew = false;
    for (const message of messages) {
      const own = message.senderId === user?.uid, name = meetup?.participantNames?.[message.senderId] || 'Former participant';
      let n = existing.get(message.id);
      if (!n) {
        n = node('article', 'pulse-message'); n.dataset.messageId = message.id; n.dataset.own = String(own);
        const content = node('div', 'pulse-message-content'), header = node('header'); header.append(node('strong', '', own ? 'You' : name), node('span'));
        content.append(header, node('p', '', message.text)); n.append(avatar(message.senderId, name), content); log.append(n);
        if (!first && !lastMessages.has(message.id)) {
          n.classList.add('is-new'); ownNew ||= own;
          if (!own && (!dialog.open || (small.matches && tab !== 'chat'))) unread++;
        }
      }
      n.querySelector('header > span').textContent = message.pending ? 'Sending…' : time(message.createdAt);
    }
    if (!messages.length) { const empty = node('div', 'pulse-chat-empty'); empty.append(iconNode('message-circle'), node('strong', '', 'Your conversation starts here.'), node('p', '', 'Say hello and help your group find you.')); log.replaceChildren(empty); }
    lastMessages = ids;
    if (atEnd || first || ownNew) requestAnimationFrame(() => { if (!disposed) log.scrollTop = log.scrollHeight; });
    else $('new-messages').hidden = false;
    syncTabs();
  }
  function renderCatalog(spots) {
    const select = $('optin').elements.startingSpot, valid = spots.filter(usableSpot).sort((a, b) => a.name.localeCompare(b.name));
    const key = JSON.stringify(valid.map(s => [s.id, s.name, s.activities]));
    if (key !== catalogKey) {
      catalogKey = key;
      $('venues').replaceChildren(...valid.map(spot => {
        const { name, area } = place(spot), row = node('button', 'pulse-venue'), copy = node('div');
        row.type = 'button'; row.dataset.spot = spot.id; row.setAttribute('aria-label', `Start near ${spot.name}`);
        copy.append(node('strong', '', name), node('small', '', area)); row.append(iconNode(spot.id === 'pond-benches' ? 'tree' : activityIcon(spot.activities[0])), copy, iconNode('chevron-right'));
        row.addEventListener('click', () => { dialog.querySelector('[data-manual-location]')?.click(); select.value = spot.id; select.dispatchEvent(new Event('change', { bubbles: true })); toast(`Starting near ${name}`); }); return row;
      }));
    }
    $('venues').querySelectorAll('button').forEach(row => row.setAttribute('aria-pressed', String(!select.disabled && row.dataset.spot === select.value)));
    if (dialog.open) maps.render('catalog', valid, select.disabled ? '' : select.value);
  }
  function busyButton(key, busyKey, label, loading) {
    const control = $(key); if (!control) return;
    const active = busyKey === key; control.setAttribute('aria-busy', String(active)); button(key, active ? loading : label);
    let spinner = control.querySelector('.pulse-busy-icon');
    if (active && !spinner) { spinner = iconNode('loader-2'); spinner.classList.add('pulse-busy-icon'); control.prepend(spinner); }
    if (!active) spinner?.remove();
  }
  function updateExtras(busyKey = '') {
    const { target, proposal, meetup, user, availability, spots, checkIns, locationMode } = getState();
    dialog.dataset.view = target;
    if (target === 'idle') renderCatalog(spots);
    if (target === 'waiting') {
      let saved; try { saved = JSON.parse(sessionStorage.getItem(`pulse-search:${user?.uid}`)); } catch {}
      if (saved?.requestId !== availability?.requestId) saved = null;
      $('wait-walk').textContent = saved ? `${saved.maxWalkMinutes} min walk max` : 'Your walking limit';
      $('wait-location').textContent = saved?.label || 'Your chosen starting point';
      const waitIcon = $('wait-activities').parentElement.querySelector('.pulse-icon');
      waitIcon.className = `pulse-icon pulse-i-${availability?.activities?.length === 1 ? activityIcon(availability.activities[0]) : 'users'}`;
    }
    if (proposal && target === 'proposal') {
      $('proposal-title').textContent = proposal.activity === 'chat' && proposal.spotId === 'pond-benches' ? 'Meet by the pond.' : ({ coffee: 'Coffee with a few new faces.', food: 'Good food. Better company.', chat: 'A little time to connect.' })[proposal.activity] || 'A plan for your free time.';
      $('response-actions').hidden = !!proposal.responses?.[user?.uid];
      if (dialog.open) maps.render('proposal', [{ ...proposal.spot, id: proposal.spotId }], proposal.spotId);
    }
    if (meetup && target === 'meetup') {
      if (group !== meetup.id) { group = meetup.id; tab = 'details'; unread = 0; $('leave-confirm').hidden = true; }
      const arrived = checkIns.some(c => c.uid === user?.uid), active = meetup.status === 'confirmed' && millis(meetup.endsAt) > Date.now();
      $('mobile-venue').textContent = place(meetup.spot).name;
      $('mobile-plan').textContent = `${active ? 'Confirmed' : 'Ended'} · ${minutes(meetup)} min · ~${meetup.walkingMinutes?.[user?.uid] ?? '?'} min walk`;
      $('mobile-arrival').hidden = !active;
      $('mobile-arrival-label').textContent = arrived ? 'You’re here. Say hello!' : 'Arrived at the meeting point?';
      $('mobile-checkin').hidden = arrived; $('mobile-checkin').disabled = $('checkin').disabled;
      const ids = meetup.participantIds || [], key = JSON.stringify([ids, meetup.participantNames]);
      if (signatures.get($('chat-avatars')) !== key) { signatures.set($('chat-avatars'), key); $('chat-avatars').replaceChildren(...ids.map(uid => avatar(uid, meetup.participantNames?.[uid] || 'Student'))); }
      $('chat-members').textContent = ids.map(uid => uid === user?.uid ? 'You' : meetup.participantNames?.[uid] || 'Student').join(', ');
      const arrivedNames = ids.filter(uid => checkIns.some(c => c.uid === uid)).map(uid => uid === user?.uid ? 'You' : meetup.participantNames?.[uid] || 'A group member');
      const arrivalText = arrivedNames.length ? `${arrivedNames.join(', ')} checked in` : '';
      $('chat-arrivals').hidden = !arrivalText;
      if ($('chat-arrivals').textContent !== arrivalText) $('chat-arrivals').replaceChildren(iconNode('check'), node('span', '', arrivalText));
      busyButton('checkin', busyKey, arrived ? 'You’re here' : 'I’m here', 'Checking in…');
      $('checkin').dataset.arrived = String(arrived);
      if (!active) $('leave-confirm').hidden = true;
      syncTabs();
    }
    const labels = { join: ['Continue', 'Joining…'], find: ['Find my group', 'Finding your group…'], cancel: ['Stop looking', 'Stopping…'], withdraw: ['Withdraw my response', 'Withdrawing…'], accept: ['I’m in', 'Accepting…'], decline: ['Pass', 'Passing…'], 'confirm-leave': ['Leave meetup', 'Leaving…'], send: ['Send', 'Sending…'], 'mobile-checkin': ['I’m here', 'Checking in…'], location: [locationMode === 'gps' ? 'Refresh my current location' : 'Use my current location', 'Finding your location…'] };
    for (const [key, [label, loading]] of Object.entries(labels)) busyButton(key, busyKey, label, loading);
    $('header-state').hidden = target !== 'meetup';
    const headerText = meetup?.status === 'confirmed' ? 'Meetup confirmed' : 'Meetup ended';
    if ($('header-state').textContent !== headerText) { $('header-state').replaceChildren(iconNode('check'), node('span', '', headerText)); }
  }
  function syncTheme() { const dark = document.documentElement.dataset.chatTheme === 'dark'; $('theme').setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} mode`); $('theme').replaceChildren(iconNode(dark ? 'sun' : 'moon')); }
  $('theme').addEventListener('click', () => {
    const appToggle = document.getElementById('theme-toggle');
    if (appToggle) appToggle.click();
    else { const theme = document.documentElement.dataset.chatTheme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.chatTheme = theme; try { localStorage.setItem('fiu-chat:theme', theme); } catch {} }
  });
  const themeObserver = new MutationObserver(syncTheme); themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-chat-theme'] }); syncTheme();
  function viewport() { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => {
    if (disposed) return;
    const height = window.visualViewport?.height || innerHeight;
    dialog.style.setProperty('--pulse-viewport-height', `${height}px`);
    dialog.style.setProperty('--pulse-viewport-top', `${window.visualViewport?.offsetTop || 0}px`);
    dialog.dataset.keyboard = String(innerHeight - height > 100 && !!document.activeElement?.matches('textarea,input:not([type=checkbox])'));
  }); }
  window.visualViewport?.addEventListener('resize', viewport); window.visualViewport?.addEventListener('scroll', viewport); viewport();
  $('proposal-map-button').addEventListener('click', () => showOnMap(getState().proposal));
  $('meetup-map-button').addEventListener('click', () => showOnMap(getState().meetup));
  $('stay').addEventListener('click', () => { $('leave-confirm').hidden = true; $('leave').focus(); });
  const textarea = $('compose').elements.message;
  function sizeComposer() { textarea.style.height = 'auto'; textarea.style.height = `${Math.min(120, textarea.scrollHeight)}px`; }
  textarea.addEventListener('input', sizeComposer);
  textarea.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); if (!$('send').disabled) $('compose').requestSubmit(); } });
  return { renderSpot, renderPeople, renderMessages, updateExtras, button, toast, sizeComposer, reduced, rememberSearch,
    dispose() { disposed = true; maps.dispose(); clearTimeout(toastTimer); cancelAnimationFrame(frame); themeObserver.disconnect(); small.removeEventListener('change', syncTabs); window.visualViewport?.removeEventListener('resize', viewport); window.visualViewport?.removeEventListener('scroll', viewport); }
  };
}
