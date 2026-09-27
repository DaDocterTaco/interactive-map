import { pulseMarkup, iconMarkup } from './view.js';
import { createPresentation } from './presentation.js';
import { createBackgroundPulse } from './background.js';
import { createPulseClient } from './service.js';
import { currentPosition, startArrival } from './arrival.js';
import { millis, usableSpot } from '../shared/policy.js';
import { campusReadiness, canStartPulse, activePulseState, needsPulseSync, connectionMessage, isConnectionFailure } from './readiness.js';

const activities = { coffee: 'Coffee', food: 'Food', chat: 'Hang out' };
const clock = value => new Date(millis(value)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };

export function mountPulse({ app, auth, map, L, campusId = 'mmc', demoLabel = '', getProfile, openProfile, paintAvatar }) {
  if (document.getElementById('pulse-dialog')) throw Error('Pulse is already mounted.');
  const client = createPulseClient(app, campusId);
  const launch = el('button', 'pulse-launch');
  launch.type = 'button'; launch.id = 'open-pulse'; launch.setAttribute('aria-haspopup', 'dialog'); launch.setAttribute('aria-controls', 'pulse-dialog');
  launch.innerHTML = `${iconMarkup("wave-sine")}<span>Campus Pulse<small data-launch-status>Find people for coffee, food or a chat.</small></span>`;
  (document.querySelector('.app-shell') || document.body).append(launch);
  const action = el('button'); action.type = 'button'; action.setAttribute('aria-haspopup', 'dialog'); action.setAttribute('aria-controls', 'pulse-dialog');
  action.innerHTML = `<span class="action-bar-icon">${iconMarkup("wave-sine")}</span><span class="action-bar-copy"><strong>Campus Pulse</strong><small>Find people for coffee, food or a chat.</small></span>`;
  document.getElementById('action-bar-actions')?.prepend(action);
  const dialog = el('dialog', 'pulse-dialog'); dialog.id = 'pulse-dialog'; dialog.setAttribute('aria-labelledby', 'pulse-title');
  dialog.innerHTML = pulseMarkup;
  document.body.append(dialog);
  window.CampusUI?.registerDialog(dialog,'community',{opener:'open-pulse'});
  const $ = name => dialog.querySelector(`[data-${name}]`);
  const optinForm = $('optin'), signinForm = $('signin'), compose = $('compose');
  let preferencesEdited = false, preferenceRequest = 0;
  optinForm.addEventListener('change', event => { if (event.target.name === 'activity') { preferencesEdited = true; preferenceRequest++; } });
  async function prefillPreferences() {
    if (!getProfile || preferencesEdited || activePulseState(state)) return;
    const version = ++preferenceRequest;
    try {
      const account = await auth.restore();
      if (!account) return;
      const profile = await getProfile(account.uid);
      if (disposed || version !== preferenceRequest || preferencesEdited || activePulseState(state) || user?.uid !== account.uid) return;
      if (profile.meetupActivities?.length) for (const input of optinForm.querySelectorAll('[name=activity]')) input.checked = profile.meetupActivities.includes(input.value);
    } catch { /* Saved preferences are optional; the availability form still works. */ }
  }
  const onProfileUpdate = event => { if (event.detail.uid === user?.uid) { preferencesEdited = false; void prefillPreferences(); } };
  window.addEventListener('campus-profile-updated', onProfileUpdate);
  let user = null, state = null, campus = null, availability = null, proposal = null, meetup = null, spots = [], checkIns = [], messages = [];
  let signedReady = false, stateReady = false, spotsReady = false, busy = false, disposed = false, epoch = 0, currentStage = '';
  let primaryUnsubs = [], memberUnsubs = [], groupUnsubs = [], proposalId = null, meetupId = null, marker = null, markerKey = '', recent = true;
  let autoStop = null, autoKey = '', locationMode = 'spot', suppressRecentId = null, requestId = null, lastPoll = 0, polling = false, serverStale = false;
  let stageKey = '', lastOpener = launch, busyAction = '', closeTimer, stageTimer;
  const ui = createPresentation({ dialog, L, getProfile, openProfile, paintAvatar,
    getState: () => ({ target: currentStage, user, proposal, meetup, spots, availability, checkIns, messages, locationMode }),
    showOnMap: plan => { showMarker(plan, true); close(); } });
  const background = createBackgroundPulse({ dialog, launch, open,
    getState: () => ({ user, state, availability, proposal, meetup, online: navigator.onLine, stale: serverStale }) });
  optinForm.elements.startingSpot.addEventListener('change', () => ui.updateExtras(busyAction));
  $('dismiss-error').addEventListener('click', () => clearError());

  if (demoLabel) { $('demo').textContent = demoLabel; $('demo').hidden = false; }
  const showError = error => {
    if (disposed) return;
    const code = String(error?.code || '');
    const known = {
      'functions/unavailable': 'Pulse could not connect. Check your connection and try again.',
      'functions/not-found': 'Pulse is not available on this campus yet. Please try again later.',
      'functions/internal': 'The Pulse service could not be reached or could not complete this request. Please try again later.',
      'permission-denied': 'This meetup is no longer available to your account. Refresh to see your latest plan.',
    };
    $('error-text').textContent = known[code] || error?.message || 'Something went wrong. Please try again.';
    $('error').hidden = false;
  };
  const clearError = () => { $('error').hidden = true; };
  const network = () => {
    const message = connectionMessage({ online: navigator.onLine, stale: serverStale, active: activePulseState(state) });
    $('network').hidden = !message; $('network').textContent = message;
  };
  const stopAuto = () => { autoStop?.(); autoStop = null; autoKey = ''; };
  const clearGroup = () => { groupUnsubs.forEach(fn => fn()); groupUnsubs = []; stopAuto(); proposalId = null; meetupId = null; proposal = null; meetup = null; checkIns = []; messages = []; };
  function syncAuto() {
    const active = $('auto').checked && user && state?.status === 'confirmed' && meetup?.status === 'confirmed'
      && millis(meetup.endsAt) > Date.now() && !document.hidden && navigator.onLine && !checkIns.some(c => c.uid === user.uid);
    if (!active) {
      if (autoStop && (document.hidden || !navigator.onLine)) $('auto-status').textContent = 'Auto arrival is paused until this page is visible and online.';
      stopAuto(); return;
    }
    if (autoStop && autoKey === meetup.id) return;
    stopAuto(); autoKey = meetup.id; const id = meetup.id, ownEpoch = epoch;
    autoStop = startArrival({ spot: meetup.spot, confirmedAt: millis(meetup.confirmedAt),
      onStatus: text => { if (epoch === ownEpoch && meetupId === id) $('auto-status').textContent = text; },
      onArrive: async fixes => {
        if (epoch !== ownEpoch || meetupId !== id || document.hidden) throw Error('Arrival paused.');
        await client.action('checkIn', { meetupId: id, method: 'automatic', fixes });
      } });
  }
  async function perform(operation, key = '') {
    if (busy) return;
    if (!navigator.onLine) { showError(Error('Reconnect before continuing.')); return; }
    busy = true; busyAction = key; clearError(); render(); const ownEpoch = epoch;
    try { return await operation(); } catch (error) { if (ownEpoch === epoch) showError(error); }
    finally { if (ownEpoch === epoch) { busy = false; busyAction = ''; render(); } }
  }
  const invoke = (actionName, input = {}, key = actionName) => perform(async () => {
    const ownEpoch = epoch, result = await client.action(actionName, input);
    // Removal can revoke the meetup listener before the private-state listener catches up.
    // Apply the trusted result immediately instead of leaving a dead subscription onscreen.
    if (ownEpoch === epoch && ['leave', 'cancel'].includes(actionName)) {
      state = { ...state, ...result }; subscribeGroup(); clearError(); render();
    }
    if (actionName === 'checkIn') ui.toast('You’re here. Your group has been notified.');
    return result;
  }, key);
  function open(event) {
    lastOpener = event?.currentTarget || launch; clearTimeout(closeTimer); dialog.classList.remove('is-closing');
    if (!dialog.open || dialog.dataset.embedded) dialog.showModal(); launch.setAttribute('aria-expanded', 'true'); action.setAttribute('aria-expanded', 'true');
    render();
    const heading = dialog.querySelector(`[data-stage=${currentStage}] h2`);
    if (heading?.getClientRects().length) { heading.setAttribute('tabindex', '-1'); heading.focus({ preventScroll: true }); }
    void poll(true); void prefillPreferences();
  }
  const restoreFocus = () => {
    const target = lastOpener?.getClientRects().length && !lastOpener.closest('[hidden],[inert]') ? lastOpener : document.getElementById('tab-community') || launch;
    target?.focus(); launch.setAttribute('aria-expanded', 'false'); action.setAttribute('aria-expanded', 'false'); background.update();
  };
  function close() { if (!dialog.open) return; dialog.classList.add('is-closing'); clearTimeout(closeTimer); closeTimer = setTimeout(() => { dialog.close(); dialog.classList.remove('is-closing'); }, ui.reduced.matches ? 0 : 160); }
  launch.addEventListener('click', open); action.addEventListener('click', open);
  dialog.querySelector('.pulse-close').addEventListener('click', close);
  $('explore').addEventListener('click', () => {
    close();
    if (window.CampusUI) {
      window.CampusUI.activate('explore'); window.CampusUI.closeToMap();
      lastOpener = document.getElementById('tab-explore') || launch;
    }
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', restoreFocus);
  $('auto').addEventListener('change', () => { if (!$('auto').checked) $('auto-status').textContent = 'Auto arrival is off. You can tap “I’m here” when you arrive.'; syncAuto(); });

  function showMarker(plan, center = false) {
    if (!map || !L || !plan?.spot) return;
    const key = `${plan.id}:${plan.spot.latitude}:${plan.spot.longitude}`;
    if (key !== markerKey) {
      marker?.remove(); markerKey = key;
      const popup = el('div', 'pulse-map-label'); popup.append(el('strong', '', plan.spot.name), el('p', '', plan.spot.instruction));
      marker = L.circleMarker([plan.spot.latitude, plan.spot.longitude], { radius: 13, color: '#123675', weight: 4, fillColor: '#ecc85b', fillOpacity: 1 }).addTo(map).bindPopup(popup);
    }
    if (center) { if(window.CampusApp){window.CampusUI.showMapCard('community',{title:plan.spot.name,description:plan.spot.instruction||'Meetup location',backLabel:'Back to Campus Pulse',onBack:open});window.CampusApp.camera.moveTo(plan.spot,{zoom:18});}else{map.campusExperience?.show2D();map.setView([plan.spot.latitude, plan.spot.longitude], 18);}marker.openPopup(); }
  }
  function updateTimers() {
    const now = Date.now(), offline = !navigator.onLine;
    if (availability) $('wait-timer').textContent = `${Math.max(0, Math.ceil((millis(availability.expiresAt) - now) / 60_000))} min left`;
    if (proposal) {
      const seconds = Math.max(0, Math.ceil((millis(proposal.responseDeadline) - now) / 1000));
      $('proposal-timer').textContent = seconds ? `0:${String(seconds).padStart(2, '0')}` : '0:00';
      $('proposal-timer').setAttribute('aria-label', seconds ? `${seconds} seconds to respond` : 'Checking final responses');
      $('countdown').dataset.urgent = String(seconds <= 10);
      const responded = !!proposal.responses?.[user?.uid];
      $('accept').disabled = $('decline').disabled = busy || offline || !seconds || responded || proposal.status !== 'pending';
    }
    if (meetup) {
      const active = meetup.status === 'confirmed' && millis(meetup.endsAt) > now;
      const chatOpen = ['confirmed', 'ended'].includes(meetup.status) && millis(meetup.chatClosesAt) > now && meetup.participantIds.includes(user?.uid);
      $('arrival').hidden = !active; $('leave').hidden = !active; $('new').hidden = active;
      // Presentation controls responsive Details / Chat visibility.
      $('checkin').disabled = busy || offline || !active || checkIns.some(c => c.uid === user?.uid);
      $('send').disabled = busy || offline || !chatOpen;
      $('confirm-leave').disabled = busy || offline;
      compose.elements.message.disabled = !chatOpen;
      $('auto').disabled = !active || checkIns.some(c => c.uid === user?.uid);
      $('meetup-badge').textContent = active ? 'Your meetup is confirmed' : meetup.status === 'canceled' ? 'Meetup canceled' : 'Meetup finished';
      $('meetup-title').textContent = active ? 'See you there.' : meetup.status === 'canceled' ? 'Plans changed.' : 'Time well spent.';
      $('meetup-summary').textContent = active ? 'Your group is ready. Head over and say hello.' : meetup.status === 'canceled' ? 'Fewer than two people remain. You can start a fresh search.' : 'Your free-time session has ended. Thanks for showing up.';
    }
    ui.updateExtras(busyAction);
    background.update();
  }
  function render() {
    if (disposed) return;
    network();
    const readiness = campusReadiness(campus);
    const target = !signedReady ? 'loading' : !user || !user.displayName ? 'signin'
      : readiness === 'unavailable' && !activePulseState(state) && !meetup ? 'unavailable' : readiness === 'loading' || !stateReady || !spotsReady ? 'loading'
      : state?.status === 'waiting' ? 'waiting' : state?.status === 'proposed' ? (proposal ? 'proposal' : 'loading')
      : meetup && (state?.status === 'confirmed' || recent) ? 'meetup' : state?.status === 'confirmed' ? 'loading' : 'idle';
    if (target !== currentStage) {
      currentStage = target;
      dialog.dataset.view = target; launch.dataset.state = target;
      clearTimeout(stageTimer);
      dialog.querySelectorAll('.is-entering').forEach(n => n.classList.remove('is-entering'));
      const entering = dialog.querySelector(`[data-stage=${target}]`); entering.classList.add('is-entering');
      stageTimer = setTimeout(() => entering.classList.remove('is-entering'), 300);
      dialog.querySelectorAll('[data-stage]').forEach(section => { section.hidden = section.dataset.stage !== target; });
      $('announcement').textContent = ({ waiting: 'You are now looking for a group.', proposal: 'A new meetup is ready for your response.', meetup: 'Your meetup has updated.', idle: 'Choose your availability to find a group.' })[target] || '';
      if (background.isVisible() && target !== 'loading') { const heading = dialog.querySelector(`[data-stage="${target}"] h2`); heading?.setAttribute('tabindex', '-1'); heading?.focus({ preventScroll: true }); }
    }
    launch.querySelector('[data-launch-status]').textContent = ({ waiting: 'Looking for your group', proposal: 'A plan is ready · respond', meetup: 'Your meetup', unavailable: 'Meetups are coming soon', loading: 'Find people for coffee, food or a chat.' })[target] || 'Find people for coffee, food or a chat.';
    signinForm.querySelector('button').disabled = busy || !navigator.onLine;
    $('find').disabled = busy || !navigator.onLine || !canStartPulse(campus, spotsReady, spots);
    $('location').disabled = busy || !navigator.onLine || !canStartPulse(campus, spotsReady, spots);
    $('cancel').disabled = $('withdraw').disabled = $('leave').disabled = busy || !navigator.onLine;
    $('wait-activities').textContent = availability?.activities?.map(a => activities[a]).join(' · ') || 'Finding shared interests';
    const notes = { 'availability-expired': 'Your free time has ended. Start again when you have another break.', canceled: 'You’ve stopped looking. Start again whenever you’re ready.', 'left-meetup': 'You’ve left the meetup.', 'meetup-canceled': 'Your group no longer has enough people to meet.' };
    $('idle-note').textContent = notes[state?.reason] || (state?.reason ? 'That plan has ended. Choose your availability to start a fresh search.' : ''); $('idle-note').hidden = !$('idle-note').textContent;
    const plan = target === 'proposal' ? proposal : target === 'meetup' ? meetup : null;
    const key = plan ? `${target}:${plan.id}:${millis(plan.startsAt)}:${millis(plan.endsAt)}` : '';
    if (key !== stageKey) { stageKey = key; if (plan) ui.renderSpot(target === 'proposal' ? $('proposal-spot') : $('meetup-spot'), plan); }
    if (plan) showMarker(plan); else { marker?.remove(); marker = null; markerKey = ''; }
    if (proposal && target === 'proposal') {
      $('proposal-summary').textContent = `${activities[proposal.activity] || 'Meet up'} with ${proposal.candidateIds.length - 1} other ${proposal.candidateIds.length === 2 ? 'Panther' : 'Panthers'}.`;
      ui.renderPeople($('proposal-people'), proposal, true);
      const response = proposal.responses?.[user?.uid]?.decision;
      $('response-note').hidden = !response; $('withdraw').hidden = !response;
      $('response-note').textContent = response === 'accept' ? 'You’re in. Waiting for the remaining responses.' : 'You passed. Finishing this proposal…';
    }
    if (meetup && target === 'meetup') {
      ui.renderPeople($('meetup-people'), meetup, false);
      $('chat-expiry').textContent = `Only your group can read this chat. Closes at ${clock(meetup.chatClosesAt)}.`;
      ui.renderMessages();
    }
    updateTimers(); syncAuto();
  }

  function subscribeGroup() {
    const p = state?.status === 'proposed' ? state.proposalId : null;
    const m = state?.meetupId || (['meetup-ended', 'meetup-canceled'].includes(state?.reason) && state?.lastMeetupId !== suppressRecentId ? state.lastMeetupId : null);
    if (p === proposalId && m === meetupId) return;
    clearGroup(); proposalId = p; meetupId = m; recent = true; $('auto').checked = false;
    const ownEpoch = epoch;
    if (p) groupUnsubs.push(client.watchProposal(p, value => { if (epoch !== ownEpoch || p !== proposalId) return; proposal = value; serverStale = !!value?.fromCache; render(); }, showError));
    if (m) {
      groupUnsubs.push(client.watchMeetup(m, value => {
        if (epoch !== ownEpoch || m !== meetupId) return;
        meetup = value; serverStale = !!value?.fromCache; render();
      }, error => { if (epoch === ownEpoch && m === meetupId) {
        meetup = null; stopAuto();
        // Membership revocation is a normal leave/cancel transition, not a chat error.
        if (!String(error?.code).includes('permission-denied')) showError(error);
        void poll(true); render();
      } }));
      const groupError = error => {
        if (epoch !== ownEpoch || m !== meetupId) return;
        if (String(error?.code).includes('permission-denied')) { messages = []; ui.renderMessages(); void poll(true); }
        else showError(error);
      };
      groupUnsubs.push(client.watchCheckIns(m, value => { if (epoch === ownEpoch && m === meetupId) { checkIns = value; render(); } }, groupError));
      groupUnsubs.push(client.watchMessages(m, (value, cached) => {
        if (epoch !== ownEpoch || m !== meetupId) return; messages = value;
        $('message-status').textContent = cached ? 'Syncing messages…' : ''; ui.renderMessages();
      }, groupError));
    }
  }
  function subscribeUser(next) {
    signedReady = true;
    if (user?.uid !== next?.uid) { preferencesEdited = false; preferenceRequest++; for (const input of optinForm.querySelectorAll('[name=activity]')) input.checked = input.value === 'coffee'; }
    if (user?.uid === next?.uid && stateReady) { user = next; render(); return; }
    epoch++; busy = false; primaryUnsubs.forEach(fn => fn()); primaryUnsubs = []; memberUnsubs.forEach(fn => fn()); memberUnsubs = []; clearGroup();
    user = next; state = null; campus = null; availability = null; stateReady = false; spotsReady = false; spots = []; serverStale = false; requestId = null; clearError();
    if (!next) { render(); return; }
    const ownEpoch = epoch;
    // Resolve campus setup before subscribing to private state or calling functions.
    primaryUnsubs.push(client.watchCampus(value => {
      if (epoch !== ownEpoch) return;
      campus = value;
      if (!value.fromCache && !value.exists) {
        memberUnsubs.forEach(fn => fn()); memberUnsubs = []; clearGroup();
        state = null; stateReady = false; spotsReady = false; serverStale = false; clearError();
      } else if (!value.fromCache && value.exists && !memberUnsubs.length) subscribeMember(next, ownEpoch);
      render();
    }, error => { if (epoch === ownEpoch) showError(error); }));
    render();
  }
  function subscribeMember(next, ownEpoch) {
    memberUnsubs.push(client.watchState(next.uid, value => {
      if (epoch !== ownEpoch) return;
      state = value || { status: 'idle' }; stateReady = true; serverStale = !!value?.fromCache; subscribeGroup(); render(); void poll();
    }, error => { if (epoch === ownEpoch) showError(error); }));
    memberUnsubs.push(client.watchAvailability(next.uid, value => { if (epoch === ownEpoch) { availability = value; render(); } }, showError));
    memberUnsubs.push(client.watchSpots(value => {
      if (epoch !== ownEpoch) return; spots = value; spotsReady = true;
      const select = optinForm.elements.startingSpot, previous = select.value;
      const valid = spots.filter(usableSpot).sort((a, b) => a.name.localeCompare(b.name));
      select.replaceChildren(...valid.map(spot => { const option = el('option', '', spot.name); option.value = spot.id; return option; }));
      if (!valid.length) { const option = el('option', '', 'Meeting spots are being prepared'); option.value = ''; select.append(option); }
      if (valid.some(s => s.id === previous)) select.value = previous;
      $('catalog').hidden = !!valid.length; $('catalog').textContent = 'Pulse meeting spots are being checked. Come back soon to find a group.';
      render();
    }, error => { if (epoch === ownEpoch) { showError(error); } }));
  }
  async function poll(force = false) {
    if (disposed || !user || document.hidden || !navigator.onLine || polling || busy) return;
    if (!needsPulseSync(campus, stateReady, state)) return;
    if (!force && Date.now() - lastPoll < 8000) return;
    lastPoll = Date.now(); polling = true; const ownEpoch = epoch;
    try { await client.action(state?.status === 'waiting' ? 'match' : 'refresh'); if (ownEpoch === epoch) { serverStale = false; network(); } }
    catch (error) { if (ownEpoch === epoch) { serverStale = isConnectionFailure(error); network(); if (force || !serverStale) showError(error); } }
    finally { polling = false; }
  }

  signinForm.addEventListener('submit', event => { event.preventDefault(); void perform(async () => { const account = await auth.join(signinForm.elements.displayName.value.trim()); await account.getIdToken(true); subscribeUser(account); }, 'join'); });
  $('location').addEventListener('click', () => void perform(async () => {
    await currentPosition(); locationMode = 'gps'; optinForm.elements.startingSpot.disabled = true;
    $('location-note').textContent = 'Using your current location. A fresh reading is taken when you start.';
    ui.button('location', 'Refresh my current location');
    const manual = dialog.querySelector('[data-manual-location]') || el('button', 'pulse-text-button', 'Choose a starting spot instead');
    manual.type = 'button'; manual.dataset.manualLocation = ''; if (!manual.isConnected) {
      $('location-note').closest('.pulse-privacy').after(manual); manual.addEventListener('click', () => { locationMode = 'spot'; optinForm.elements.startingSpot.disabled = false; $('location-note').textContent = 'Your starting point stays private.'; manual.remove(); ui.updateExtras(busyAction); });
    }
  }, 'location'));
  optinForm.addEventListener('submit', event => { event.preventDefault(); void perform(async () => {
    if (!canStartPulse(campus, spotsReady, spots)) throw Error('Pulse is not accepting new meetups here yet.');
    const selected = [...optinForm.querySelectorAll('[name="activity"]:checked')].map(input => input.value);
    if (!selected.length) { optinForm.querySelector('[name=activity]').focus(); throw Error('Choose at least one activity.'); }
    await user.getIdToken(true);
    const location = locationMode === 'gps' ? { position: await currentPosition() } : { startingSpotId: optinForm.elements.startingSpot.value };
    requestId ||= crypto.randomUUID();
    await client.action('optIn', { requestId, minutes: Number(optinForm.elements.minutes.value), maxWalkMinutes: Number(optinForm.elements.walk.value), activities: selected, ...location });
    ui.rememberSearch(requestId, Number(optinForm.elements.walk.value));
    requestId = null; recent = true; lastPoll = Date.now();
  }, 'find'); });
  $('cancel').addEventListener('click', () => void invoke('cancel'));
  $('withdraw').addEventListener('click', () => void invoke('cancel', {}, 'withdraw'));
  $('accept').addEventListener('click', () => void invoke('respond', { proposalId, decision: 'accept' }, 'accept'));
  $('decline').addEventListener('click', () => void invoke('respond', { proposalId, decision: 'decline' }, 'decline'));
  $('checkin').addEventListener('click', () => void invoke('checkIn', { meetupId, method: 'manual' }, 'checkin'));
  $('mobile-checkin').addEventListener('click', () => void invoke('checkIn', { meetupId, method: 'manual' }, 'mobile-checkin'));
  $('leave').addEventListener('click', () => { $('leave-confirm').hidden = false; $('stay').focus(); });
  $('confirm-leave').addEventListener('click', () => void invoke('leave', { meetupId }, 'confirm-leave'));
  $('new').addEventListener('click', () => { suppressRecentId = meetupId; recent = false; clearGroup(); stageKey = ''; void invoke('refresh'); render(); });
  const retrySetup = () => { stateReady = false; subscribeUser(user); };
  $('retry').addEventListener('click', retrySetup);
  $('setup-retry').addEventListener('click', retrySetup);
  compose.addEventListener('submit', event => { event.preventDefault(); void perform(async () => {
    const text = compose.elements.message.value.trim(); if (!text) throw Error('Write a message first.');
    $('message-status').textContent = 'Sending…';
    try { await client.sendMessage(user.uid, meetupId, text); compose.elements.message.value = ''; ui.sizeComposer(); $('message-status').textContent = 'Sent'; }
    catch (error) { $('message-status').textContent = 'Message was not sent. Your text is still here; reconnect and try again.'; throw error; }
  }, 'send'); });
  const onVisibility = () => { syncAuto(); if (!document.hidden) void poll(true); };
  const onNetwork = () => { render(); if (navigator.onLine) void poll(true); };
  document.addEventListener('visibilitychange', onVisibility); window.addEventListener('online', onNetwork); window.addEventListener('offline', onNetwork);
  const interval = setInterval(() => { if (!document.hidden) { updateTimers(); syncAuto(); void poll(); } }, 1000);
  const unwatchAuth = auth.watch(subscribeUser);
  Promise.resolve(auth.restore()).then(account => { if (!disposed) subscribeUser(account); }).catch(error => { signedReady = true; showError(error); render(); });
  render();
  return { open, dispose() { disposed = true; epoch++; clearInterval(interval); clearTimeout(closeTimer); clearTimeout(stageTimer); background.dispose(); ui.dispose(); unwatchAuth?.(); primaryUnsubs.forEach(fn => fn()); memberUnsubs.forEach(fn => fn()); clearGroup(); marker?.remove(); document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('online', onNetwork); window.removeEventListener('offline', onNetwork); window.removeEventListener('campus-profile-updated', onProfileUpdate); dialog.remove(); launch.remove(); action.remove(); } };
}
