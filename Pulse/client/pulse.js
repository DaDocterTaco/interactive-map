import { createPulseClient } from './service.js';
import { currentPosition, startArrival } from './arrival.js';
import { millis, usableSpot } from '../shared/policy.js';
import { campusReadiness, canStartPulse, activePulseState, needsPulseSync, connectionMessage, isConnectionFailure } from './readiness.js';

const activities = { coffee: 'Coffee', food: 'Food', chat: 'Hang out' };
const clock = value => new Date(millis(value)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };

export function mountPulse({ app, auth, map, L, campusId = 'mmc', demoLabel = '' }) {
  if (document.getElementById('pulse-dialog')) throw Error('Pulse is already mounted.');
  const client = createPulseClient(app, campusId);
  const launch = el('button', 'pulse-launch');
  launch.type = 'button'; launch.id = 'open-pulse'; launch.setAttribute('aria-haspopup', 'dialog'); launch.setAttribute('aria-controls', 'pulse-dialog');
  launch.innerHTML = '<span class="pulse-signal" aria-hidden="true">∿</span><span>Campus Pulse<small data-launch-status>Make time for someone new</small></span>';
  (document.querySelector('.app-shell') || document.body).append(launch);
  const action = el('button'); action.type = 'button'; action.setAttribute('aria-haspopup', 'dialog'); action.setAttribute('aria-controls', 'pulse-dialog');
  action.innerHTML = '<span class="action-bar-icon" aria-hidden="true">∿</span><span class="action-bar-copy"><strong>Campus Pulse</strong><small>Find a spontaneous meetup</small></span>';
  document.getElementById('action-bar-actions')?.prepend(action);
  const dialog = el('dialog', 'pulse-dialog'); dialog.id = 'pulse-dialog'; dialog.setAttribute('aria-labelledby', 'pulse-title');
  dialog.innerHTML = `
    <header class="pulse-top"><div class="pulse-brand"><span class="pulse-mark" aria-hidden="true">∿</span><span id="pulse-title">Campus Pulse</span></div><button type="button" class="pulse-close" aria-label="Close Pulse">×</button></header>
    <p class="pulse-network" data-network hidden role="status"></p>
    <p class="pulse-error" data-error hidden role="alert"></p>
    <div class="pulse-body">
      <p class="pulse-note" data-demo hidden></p>
      <section data-stage="signin"><p class="pulse-eyebrow">FIU · Modesto A. Maidique</p><h2>A little free time.<br>A new connection.</h2><p class="pulse-subtitle">Coffee, a bite, or a conversation. Find a small group of Panthers with time to meet.</p>
        <form data-signin><label class="pulse-field"><span>What should your group call you?</span><input name="displayName" autocomplete="nickname" maxlength="40" required placeholder="Your first name"></label><button class="pulse-primary pulse-wide" type="submit">Continue</button></form><p class="pulse-fine">Uses your campus chat identity. You choose when to be available.</p></section>
      <section data-stage="loading" hidden><p class="pulse-eyebrow">Campus Pulse</p><h2>Getting things ready…</h2><p class="pulse-subtitle">Restoring your meetup and meeting spots.</p><button type="button" class="pulse-secondary" data-retry>Try again</button></section>
      <section data-stage="unavailable" hidden><p class="pulse-eyebrow">FIU · Modesto A. Maidique</p><h2>Pulse is getting ready.</h2><p class="pulse-subtitle">Live meetups haven’t opened on this campus yet. We’re preparing the service and checking the meeting spots.</p><p class="pulse-note">You haven’t joined a queue or missed a meetup. There’s nothing you need to reconnect.</p><button type="button" class="pulse-secondary pulse-wide" data-setup-retry>Check availability again</button></section>
      <section data-stage="idle" hidden><p class="pulse-eyebrow">FIU · Modesto A. Maidique</p><h2>Got a little<br>time to spare?</h2><p class="pulse-subtitle">Make it a coffee, a bite, or a good conversation.</p><p class="pulse-note" data-idle-note hidden></p>
        <form data-optin>
          <fieldset><legend>I’m up for</legend><div class="pulse-activities">
            <label class="pulse-choice"><input type="checkbox" name="activity" value="coffee" checked><span><b aria-hidden="true">☕</b>Coffee</span></label>
            <label class="pulse-choice"><input type="checkbox" name="activity" value="food"><span><b aria-hidden="true">🍴</b>Food</span></label>
            <label class="pulse-choice"><input type="checkbox" name="activity" value="chat"><span><b aria-hidden="true">💬</b>Hang out</span></label>
          </div></fieldset>
          <div class="pulse-columns"><label class="pulse-field"><span>I’m free for</span><select name="minutes"><option value="30">30 minutes</option><option value="45" selected>45 minutes</option><option value="60">1 hour</option><option value="90">90 minutes</option></select></label>
          <label class="pulse-field"><span>I can walk up to</span><select name="walk"><option value="5" selected>5 minutes</option><option value="10">10 minutes</option><option value="15">15 minutes</option></select></label></div>
          <label class="pulse-field"><span>I’m starting near</span><select name="startingSpot"><option value="">Loading meeting spots…</option></select></label>
          <button class="pulse-text-button" type="button" data-location>◎ Use my current location</button><p class="pulse-fine" data-location-note>Your starting point stays private.</p>
          <p class="pulse-note" data-catalog hidden></p>
          <button class="pulse-primary pulse-wide" style="margin-top:22px" type="submit" data-find>Find my group</button>
        </form><p class="pulse-fine">Meet 2–4 people, including you. Plans leave a five-minute buffer; check your own next-class travel time.</p></section>
      <section data-stage="waiting" hidden><p class="pulse-eyebrow">You’re available</p><div class="pulse-orbit" aria-hidden="true">∿</div><h2>A good connection<br>takes a moment.</h2><p class="pulse-subtitle">Looking for people nearby with shared interests and enough time to meet. Keep this page visible for new plans.</p><div class="pulse-wait-detail"><span data-wait-activities></span><strong data-wait-timer></strong></div><p class="pulse-fine">No group yet. You can stop looking whenever you need.</p><button type="button" class="pulse-secondary pulse-wide" style="margin-top:24px" data-cancel>Stop looking</button></section>
      <section data-stage="proposal" hidden><span class="pulse-badge" data-kind="proposal" data-proposal-timer></span><h2>A plan for your<br>free time.</h2><p class="pulse-subtitle" data-proposal-summary></p><div data-proposal-spot></div><h3>Your proposed group</h3><ul class="pulse-people" data-proposal-people></ul><p class="pulse-note" data-response-note hidden></p><div class="pulse-actions"><button class="pulse-secondary" type="button" data-decline>Pass</button><button class="pulse-primary" type="button" data-accept>I’m in</button></div><button class="pulse-text-button" type="button" data-withdraw hidden>Withdraw my response</button><p class="pulse-fine">The plan confirms after everyone responds or the timer ends, with at least two people accepting.</p></section>
      <section data-stage="meetup" hidden><span class="pulse-badge" data-meetup-badge></span><h2 data-meetup-title></h2><p class="pulse-subtitle" data-meetup-summary></p><div data-meetup-spot></div><h3>Your group</h3><ul class="pulse-people" data-meetup-people></ul>
        <div data-arrival><button class="pulse-primary pulse-wide" type="button" data-checkin>I’m here</button><label class="pulse-toggle"><input type="checkbox" data-auto><span>Check me in automatically when I arrive<br><small class="pulse-fine">Optional. Works while this page is visible.</small></span></label><p class="pulse-fine" data-auto-status>Precise location is never shown to your group.</p></div>
        <section class="pulse-chat" data-chat><h3>Meetup chat</h3><p class="pulse-fine" data-chat-expiry></p><div class="pulse-messages" role="log" aria-label="Meetup messages" aria-live="polite" aria-relevant="additions" data-messages></div><form class="pulse-compose" data-compose><label><span class="pulse-sr">Message your group</span><textarea name="message" rows="1" maxlength="2000" placeholder="Say hello to your group…" required></textarea></label><button type="submit" class="pulse-primary" data-send>Send</button></form><p class="pulse-fine" data-message-status role="status"></p></section>
        <button type="button" class="pulse-text-button" data-leave style="margin-top:20px">Leave this meetup</button><button type="button" class="pulse-secondary pulse-wide" data-new hidden style="margin-top:20px">Find another meetup</button>
      </section>
      <p class="pulse-sr" role="status" aria-live="polite" data-announcement></p>
    </div>`;
  document.body.append(dialog);
  const $ = name => dialog.querySelector(`[data-${name}]`);
  const optinForm = $('optin'), signinForm = $('signin'), compose = $('compose');
  let user = null, state = null, campus = null, availability = null, proposal = null, meetup = null, spots = [], checkIns = [], messages = [];
  let signedReady = false, stateReady = false, spotsReady = false, busy = false, disposed = false, epoch = 0, currentStage = '';
  let primaryUnsubs = [], memberUnsubs = [], groupUnsubs = [], proposalId = null, meetupId = null, marker = null, markerKey = '', recent = true;
  let autoStop = null, autoKey = '', locationMode = 'spot', suppressRecentId = null, requestId = null, lastPoll = 0, polling = false, serverStale = false;
  let messageSignature = '', scrollAtEnd = true, stageKey = '', lastOpener = launch;

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
    $('error').textContent = known[code] || error?.message || 'Something went wrong. Please try again.';
    $('error').hidden = false;
  };
  const clearError = () => { $('error').hidden = true; };
  const network = () => {
    const message = connectionMessage({ online: navigator.onLine, stale: serverStale, active: activePulseState(state) });
    $('network').hidden = !message; $('network').textContent = message;
  };
  const stopAuto = () => { autoStop?.(); autoStop = null; autoKey = ''; };
  const clearGroup = () => { groupUnsubs.forEach(fn => fn()); groupUnsubs = []; stopAuto(); proposalId = null; meetupId = null; proposal = null; meetup = null; checkIns = []; messages = []; messageSignature = ''; };
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
  async function perform(operation) {
    if (busy) return;
    if (!navigator.onLine) { showError(Error('Reconnect before continuing.')); return; }
    busy = true; clearError(); render(); const ownEpoch = epoch;
    try { return await operation(); } catch (error) { if (ownEpoch === epoch) showError(error); }
    finally { if (ownEpoch === epoch) { busy = false; render(); } }
  }
  const invoke = (actionName, input = {}) => perform(async () => {
    const ownEpoch = epoch, result = await client.action(actionName, input);
    // Removal can revoke the meetup listener before the private-state listener catches up.
    // Apply the trusted result immediately instead of leaving a dead subscription onscreen.
    if (ownEpoch === epoch && ['leave', 'cancel'].includes(actionName)) {
      state = { ...state, ...result }; subscribeGroup(); clearError(); render();
    }
    return result;
  });
  function open(event) { lastOpener = event?.currentTarget || launch; if (!dialog.open) dialog.showModal(); render(); void poll(true); }
  const restoreFocus = () => {
    const target = lastOpener === action && !document.getElementById('action-bar')?.classList.contains('is-expanded') ? launch : lastOpener;
    target?.focus();
  };
  function close() { dialog.close(); restoreFocus(); }
  launch.addEventListener('click', open); action.addEventListener('click', open);
  dialog.querySelector('.pulse-close').addEventListener('click', close);
  dialog.addEventListener('close', restoreFocus);
  $('auto').addEventListener('change', () => { if (!$('auto').checked) $('auto-status').textContent = 'Auto arrival is off. You can tap “I’m here” when you arrive.'; syncAuto(); });

  function renderSpot(container, plan) {
    if (!plan?.spot) { container.replaceChildren(); return; }
    const card = el('div', 'pulse-spot'); card.append(el('p', 'pulse-eyebrow', activities[plan.activity] || 'Meetup'), el('h3', '', plan.spot.name), el('p', '', plan.spot.instruction));
    const details = el('div', 'pulse-details'); details.append(el('span', '', `${clock(plan.startsAt)} – ${clock(plan.endsAt)}`));
    const walk = plan.walkingMinutes?.[user?.uid]; if (walk != null) details.append(el('span', '', `~${walk} min walk`));
    card.append(details, el('p', 'pulse-fine', 'Walking time is an estimate, not a route.'));
    const pin = el('button', 'pulse-text-button', '↗ Show meeting point on map'); pin.type = 'button';
    pin.addEventListener('click', () => { showMarker(plan, true); close(); }); card.append(pin); container.replaceChildren(card);
  }
  function showMarker(plan, center = false) {
    if (!map || !L || !plan?.spot) return;
    const key = `${plan.id}:${plan.spot.latitude}:${plan.spot.longitude}`;
    if (key !== markerKey) {
      marker?.remove(); markerKey = key;
      const popup = el('div', 'pulse-map-label'); popup.append(el('strong', '', plan.spot.name), el('p', '', plan.spot.instruction));
      marker = L.circleMarker([plan.spot.latitude, plan.spot.longitude], { radius: 13, color: '#123675', weight: 4, fillColor: '#ecc85b', fillOpacity: 1 }).addTo(map).bindPopup(popup);
    }
    if (center) { map.setView([plan.spot.latitude, plan.spot.longitude], 18); marker.openPopup(); }
  }
  function renderPeople(container, plan, isProposal) {
    const ids = isProposal ? plan.candidateIds : plan.participantIds;
    const rows = ids.map(uid => {
      const name = plan.participantNames?.[uid] || 'Student', row = el('li', 'pulse-person');
      const status = isProposal ? ({ accept: 'Accepted', decline: 'Passed' }[plan.responses?.[uid]?.decision] || 'Considering') : (checkIns.some(c => c.uid === uid) ? 'Here ✓' : 'On the way');
      row.append(el('span', 'pulse-avatar', Array.from(name)[0]?.toUpperCase() || 'P'), el('span', 'pulse-person-name', `${name}${uid === user?.uid ? ' (you)' : ''}`), el('small', '', status)); return row;
    }); container.replaceChildren(...rows);
  }
  function renderMessages() {
    const signature = JSON.stringify(messages.map(m => [m.id, m.text, m.pending, millis(m.createdAt)]));
    if (signature === messageSignature) return;
    messageSignature = signature;
    const log = $('messages'); scrollAtEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    const nodes = messages.map(message => {
      const node = el('article', 'pulse-message'); node.dataset.own = String(message.senderId === user?.uid);
      const header = el('header'); header.append(el('strong', '', meetup?.participantNames?.[message.senderId] || 'Former participant'), el('span', '', message.pending ? 'Sending…' : clock(message.createdAt)));
      node.append(header, el('p', '', message.text)); return node;
    });
    log.replaceChildren(...(nodes.length ? nodes : [el('p', 'pulse-fine', 'Your group’s conversation starts here. Say hello!')]));
    if (scrollAtEnd) log.scrollTop = log.scrollHeight;
  }
  function updateTimers() {
    const now = Date.now(), offline = !navigator.onLine;
    if (availability) $('wait-timer').textContent = `${Math.max(0, Math.ceil((millis(availability.expiresAt) - now) / 60_000))} min left`;
    if (proposal) {
      const seconds = Math.max(0, Math.ceil((millis(proposal.responseDeadline) - now) / 1000));
      $('proposal-timer').textContent = seconds ? `Respond in ${seconds}s` : 'Checking the final responses…';
      const responded = !!proposal.responses?.[user?.uid];
      $('accept').disabled = $('decline').disabled = busy || offline || !seconds || responded || proposal.status !== 'pending';
    }
    if (meetup) {
      const active = meetup.status === 'confirmed' && millis(meetup.endsAt) > now;
      const chatOpen = ['confirmed', 'ended'].includes(meetup.status) && millis(meetup.chatClosesAt) > now && meetup.participantIds.includes(user?.uid);
      $('arrival').hidden = !active; $('leave').hidden = !active; $('new').hidden = active;
      $('chat').hidden = !chatOpen;
      $('checkin').disabled = busy || offline || !active || checkIns.some(c => c.uid === user?.uid);
      $('send').disabled = busy || offline || !chatOpen;
      $('auto').disabled = !active || checkIns.some(c => c.uid === user?.uid);
      $('meetup-badge').textContent = active ? 'Your meetup is confirmed' : meetup.status === 'canceled' ? 'Meetup canceled' : 'Meetup finished';
      $('meetup-title').textContent = active ? 'See you there.' : meetup.status === 'canceled' ? 'Plans changed.' : 'Time well spent.';
      $('meetup-summary').textContent = active ? 'Your group is ready. Head over and say hello.' : meetup.status === 'canceled' ? 'Fewer than two people remain. You can start a fresh search.' : 'Your free-time session has ended. Thanks for showing up.';
    }
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
      dialog.querySelectorAll('[data-stage]').forEach(section => { section.hidden = section.dataset.stage !== target; });
      $('announcement').textContent = ({ waiting: 'You are now looking for a group.', proposal: 'A new meetup is ready for your response.', meetup: 'Your meetup has updated.', idle: 'Choose your availability to find a group.' })[target] || '';
      if (dialog.open && target !== 'loading') { const heading = dialog.querySelector(`[data-stage="${target}"] h2`); heading?.setAttribute('tabindex', '-1'); heading?.focus({ preventScroll: true }); }
    }
    launch.querySelector('[data-launch-status]').textContent = ({ waiting: 'Looking for your group', proposal: 'A plan is ready · respond', meetup: 'Your meetup', unavailable: 'Meetups are coming soon', loading: 'Make time for someone new' })[target] || 'Make time for someone new';
    signinForm.querySelector('button').disabled = busy || !navigator.onLine;
    $('find').disabled = busy || !navigator.onLine || !canStartPulse(campus, spotsReady, spots);
    $('location').disabled = !canStartPulse(campus, spotsReady, spots);
    $('cancel').disabled = $('withdraw').disabled = $('leave').disabled = busy || !navigator.onLine;
    $('wait-activities').textContent = availability?.activities?.map(a => activities[a]).join(' · ') || 'Finding shared interests';
    const notes = { 'availability-expired': 'Your free time has ended. Start again when you have another break.', canceled: 'You’ve stopped looking. Start again whenever you’re ready.', 'left-meetup': 'You’ve left the meetup.', 'meetup-canceled': 'Your group no longer has enough people to meet.' };
    $('idle-note').textContent = notes[state?.reason] || (state?.reason ? 'That plan has ended. Choose your availability to start a fresh search.' : ''); $('idle-note').hidden = !$('idle-note').textContent;
    const plan = target === 'proposal' ? proposal : target === 'meetup' ? meetup : null;
    const key = plan ? `${target}:${plan.id}:${millis(plan.startsAt)}:${millis(plan.endsAt)}` : '';
    if (key !== stageKey) { stageKey = key; if (plan) renderSpot(target === 'proposal' ? $('proposal-spot') : $('meetup-spot'), plan); }
    if (plan) showMarker(plan); else { marker?.remove(); marker = null; markerKey = ''; }
    if (proposal && target === 'proposal') {
      $('proposal-summary').textContent = `${activities[proposal.activity] || 'Meet up'} with ${proposal.candidateIds.length - 1} other ${proposal.candidateIds.length === 2 ? 'Panther' : 'Panthers'}.`;
      renderPeople($('proposal-people'), proposal, true);
      const response = proposal.responses?.[user?.uid]?.decision;
      $('response-note').hidden = !response; $('withdraw').hidden = !response;
      $('response-note').textContent = response === 'accept' ? 'You’re in. Waiting for the remaining responses.' : 'You passed. Finishing this proposal…';
    }
    if (meetup && target === 'meetup') {
      renderPeople($('meetup-people'), meetup, false);
      $('checkin').textContent = checkIns.some(c => c.uid === user?.uid) ? 'You’re here ✓' : 'I’m here';
      $('chat-expiry').textContent = `Only your group can read this chat. Closes at ${clock(meetup.chatClosesAt)}.`;
      renderMessages();
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
        if (String(error?.code).includes('permission-denied')) { messages = []; renderMessages(); void poll(true); }
        else showError(error);
      };
      groupUnsubs.push(client.watchCheckIns(m, value => { if (epoch === ownEpoch && m === meetupId) { checkIns = value; render(); } }, groupError));
      groupUnsubs.push(client.watchMessages(m, (value, cached) => {
        if (epoch !== ownEpoch || m !== meetupId) return; messages = value;
        $('message-status').textContent = cached ? 'Syncing messages…' : ''; renderMessages();
      }, groupError));
    }
  }
  function subscribeUser(next) {
    signedReady = true;
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
      const valid = spots.filter(usableSpot);
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

  signinForm.addEventListener('submit', event => { event.preventDefault(); void perform(async () => { const account = await auth.join(signinForm.elements.displayName.value.trim()); await account.getIdToken(true); subscribeUser(account); }); });
  $('location').addEventListener('click', () => void perform(async () => {
    await currentPosition(); locationMode = 'gps'; optinForm.elements.startingSpot.disabled = true;
    $('location-note').textContent = 'Using your current location. A fresh reading is taken when you start.';
    $('location').textContent = '◎ Refresh my current location';
    const manual = dialog.querySelector('[data-manual-location]') || el('button', 'pulse-text-button', 'Choose a starting spot instead');
    manual.type = 'button'; manual.dataset.manualLocation = ''; if (!manual.isConnected) {
      $('location-note').after(manual); manual.addEventListener('click', () => { locationMode = 'spot'; optinForm.elements.startingSpot.disabled = false; $('location-note').textContent = 'Your starting point stays private.'; manual.remove(); });
    }
  }));
  optinForm.addEventListener('submit', event => { event.preventDefault(); void perform(async () => {
    if (!canStartPulse(campus, spotsReady, spots)) throw Error('Pulse is not accepting new meetups here yet.');
    const selected = [...optinForm.querySelectorAll('[name="activity"]:checked')].map(input => input.value);
    if (!selected.length) throw Error('Choose at least one activity.');
    await user.getIdToken(true);
    const location = locationMode === 'gps' ? { position: await currentPosition() } : { startingSpotId: optinForm.elements.startingSpot.value };
    requestId ||= crypto.randomUUID();
    await client.action('optIn', { requestId, minutes: Number(optinForm.elements.minutes.value), maxWalkMinutes: Number(optinForm.elements.walk.value), activities: selected, ...location });
    requestId = null; recent = true; lastPoll = Date.now();
  }); });
  $('cancel').addEventListener('click', () => void invoke('cancel'));
  $('withdraw').addEventListener('click', () => void invoke('cancel'));
  $('accept').addEventListener('click', () => void invoke('respond', { proposalId, decision: 'accept' }));
  $('decline').addEventListener('click', () => void invoke('respond', { proposalId, decision: 'decline' }));
  $('checkin').addEventListener('click', () => void invoke('checkIn', { meetupId, method: 'manual' }));
  $('leave').addEventListener('click', () => void invoke('leave', { meetupId }));
  $('new').addEventListener('click', () => { suppressRecentId = meetupId; recent = false; clearGroup(); stageKey = ''; void invoke('refresh'); render(); });
  const retrySetup = () => { stateReady = false; subscribeUser(user); };
  $('retry').addEventListener('click', retrySetup);
  $('setup-retry').addEventListener('click', retrySetup);
  compose.addEventListener('submit', event => { event.preventDefault(); void perform(async () => {
    const text = compose.elements.message.value.trim(); if (!text) throw Error('Write a message first.');
    $('message-status').textContent = 'Sending…';
    try { await client.sendMessage(user.uid, meetupId, text); compose.elements.message.value = ''; $('message-status').textContent = 'Sent'; }
    catch (error) { $('message-status').textContent = 'Message was not sent. Your text is still here; reconnect and try again.'; throw error; }
  }); });
  const onVisibility = () => { syncAuto(); if (!document.hidden) void poll(true); };
  const onNetwork = () => { render(); if (navigator.onLine) void poll(true); };
  document.addEventListener('visibilitychange', onVisibility); window.addEventListener('online', onNetwork); window.addEventListener('offline', onNetwork);
  const interval = setInterval(() => { if (!document.hidden) { updateTimers(); syncAuto(); void poll(); } }, 1000);
  const unwatchAuth = auth.watch(subscribeUser);
  Promise.resolve(auth.restore()).then(account => { if (!disposed) subscribeUser(account); }).catch(error => { signedReady = true; showError(error); render(); });
  render();
  return { open, dispose() { disposed = true; epoch++; clearInterval(interval); unwatchAuth?.(); primaryUnsubs.forEach(fn => fn()); memberUnsubs.forEach(fn => fn()); clearGroup(); marker?.remove(); document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('online', onNetwork); window.removeEventListener('offline', onNetwork); dialog.remove(); launch.remove(); action.remove(); } };
}
