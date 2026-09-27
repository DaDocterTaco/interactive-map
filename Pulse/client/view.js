// Presentation only. All matching, membership and writes remain in the existing client.
export const iconMarkup = name => `<span class="pulse-icon pulse-i-${name}" aria-hidden="true"></span>`;
export function iconNode(name) {
  const node = document.createElement('span');
  node.className = `pulse-icon pulse-i-${name}`; node.setAttribute('aria-hidden', 'true'); return node;
}
const i = iconMarkup;
const button = (key, text, icon, classes = 'pulse-primary') => `<button type="button" class="${classes}" data-${key}>${icon ? i(icon) : ''}<span data-button-label>${text}</span></button>`;
const mapPanel = key => `<div class="pulse-mini-map" data-${key}-map role="img" aria-label="Campus meeting locations"><p class="pulse-map-fallback">${i('map')}<span>Meeting locations are loading…</span></p></div>`;

export const pulseMarkup = `
<div class="pulse-surface">
  <header class="pulse-top">
    <div class="pulse-brand"><span class="pulse-mark">${i('wave-sine')}</span><div><strong id="pulse-title">Campus Pulse</strong><small>FIU · Modesto A. Maidique</small></div></div>
    <span class="pulse-header-state" data-header-state hidden></span>
    <div class="pulse-header-actions"><button type="button" class="pulse-icon-button" data-theme aria-label="Switch to dark mode">${i('moon')}</button><button type="button" class="pulse-icon-button pulse-close" aria-label="Close Pulse">${i('x')}</button></div>
  </header>
  <p class="pulse-network" data-network hidden role="status"></p>
  <div class="pulse-error" data-error hidden role="alert">${i('info-circle')}<span data-error-text></span><button type="button" class="pulse-icon-button" data-dismiss-error aria-label="Dismiss error">${i('x')}</button></div>
  <p class="pulse-demo" data-demo hidden></p>
  <div class="pulse-body">
    <section class="pulse-stage pulse-simple-stage" data-stage="signin">
      <div class="pulse-simple-content"><span class="pulse-orbit">${i('wave-sine')}</span><p class="pulse-eyebrow">Coffee · Food · A chat</p><h2>Meet other Panthers during your break.</h2><p class="pulse-subtitle">Pulse finds 1–3 other students and suggests a place on campus to meet in person. You choose whether to join.</p>
        <form data-signin><label class="pulse-field"><span>What should your group call you?</span><input name="displayName" autocomplete="nickname" maxlength="40" required placeholder="Your first name"></label><button class="pulse-primary pulse-wide" type="submit" data-join><span data-button-label>Continue</span>${i('arrow-right')}</button></form><p class="pulse-fine">Uses your campus chat identity. You choose when to be available.</p>
      </div>
    </section>
    <section class="pulse-stage pulse-simple-stage" data-stage="loading" hidden>
      <div class="pulse-simple-content"><span class="pulse-orbit is-loading">${i('wave-sine')}</span><h2>Getting things ready…</h2><p class="pulse-subtitle">Restoring your meetup and meeting spots.</p>${button('retry', 'Try again', 'refresh', 'pulse-secondary')}</div>
    </section>
    <section class="pulse-stage pulse-simple-stage" data-stage="unavailable" hidden>
      <div class="pulse-simple-content"><span class="pulse-orbit">${i('users')}</span><p class="pulse-eyebrow">FIU · MMC</p><h2>Good company<br>is on its way.</h2><p class="pulse-subtitle">Live meetups haven’t opened on this campus yet. We’re checking the meeting spots.</p><p class="pulse-note">You haven’t joined a queue or missed a meetup.</p>${button('setup-retry', 'Check availability again', 'refresh', 'pulse-secondary')}</div>
    </section>
    <section class="pulse-stage" data-stage="idle" hidden>
      <div class="pulse-stage-scroll pulse-setup-grid">
        <div class="pulse-intro-pane">
          <h2>Find your people.</h2><p class="pulse-subtitle pulse-intro-description">Meet a few Panthers during your break.</p>
          <p class="pulse-note" data-idle-note hidden></p>
          <form data-optin id="pulse-optin">
            <fieldset><legend>What sounds good?</legend><span class="pulse-choice-help">Pick one or more</span><div class="pulse-activities">
              <label class="pulse-choice"><input type="checkbox" name="activity" value="coffee" checked><span>${i('coffee')}<strong>Coffee</strong><b class="pulse-choice-check">${i('check')}</b></span></label>
              <label class="pulse-choice"><input type="checkbox" name="activity" value="food"><span>${i('tools-kitchen-2')}<strong>Food</strong><b class="pulse-choice-check">${i('check')}</b></span></label>
              <label class="pulse-choice"><input type="checkbox" name="activity" value="chat"><span>${i('message-circle')}<strong>Hang out</strong><b class="pulse-choice-check">${i('check')}</b></span></label>
            </div></fieldset>
            <div class="pulse-columns"><label class="pulse-field"><span>Free for</span><span class="pulse-select"><select name="minutes"><option value="30">30 minutes</option><option value="45" selected>45 minutes</option><option value="60">1 hour</option><option value="90">90 minutes</option></select>${i('chevron-down')}</span></label>
              <label class="pulse-field"><span>Walk up to</span><span class="pulse-select"><select name="walk"><option value="5">5 minutes</option><option value="10">10 minutes</option><option value="15">15 minutes</option></select>${i('chevron-down')}</span></label></div>
            <label class="pulse-field pulse-start-field"><span>Starting near <small>Check or change</small></span><span class="pulse-select"><select name="startingSpot"><option value="">Loading meeting spots…</option></select>${i('chevron-down')}</span></label>
            ${button('location', 'Use my location', 'map-pin', 'pulse-text-button')}
            <p class="pulse-privacy">${i('lock')}<span data-location-note>Your starting point stays private.</span></p>
            <p class="pulse-note" data-catalog hidden></p>
          </form>
        </div>
        <aside class="pulse-context"><h3>Meet somewhere familiar</h3>${mapPanel('catalog')}<div class="pulse-venue-list" data-venues></div><p class="pulse-fine">Possible meeting spots. Your group’s plan picks the place.</p></aside>
      </div>
      <footer class="pulse-footer"><p><span>2–4 people · You choose whether to join.</span></p><button class="pulse-primary" type="submit" form="pulse-optin" data-find><span data-button-label>Find my group</span>${i('arrow-right')}</button></footer>
    </section>
    <section class="pulse-stage pulse-simple-stage" data-stage="waiting" hidden>
      <div class="pulse-simple-content pulse-waiting-content"><div class="pulse-search-status" role="status"><span class="pulse-search-spinner" aria-hidden="true">${i('loader-2')}</span><span class="pulse-search-active">Searching for a group</span><span class="pulse-search-offline">Waiting for connection</span><span class="pulse-search-attention">Search needs attention</span></div><h2>Finding your people…</h2>
        <div class="pulse-info">${i('info-circle')}<p><strong>We’ll let you know when there’s a match.</strong><span>Keep this tab open while you explore.</span></p></div>
        ${button('explore', 'Keep exploring', 'arrow-right', 'pulse-primary pulse-wide pulse-keep-exploring')}
        <div class="pulse-wait-detail"><span>${i('coffee')}<span data-wait-activities></span></span><span>${i('clock')}<strong data-wait-timer></strong></span><span>${i('walk')}<span data-wait-walk></span></span></div>
        <div class="pulse-wait-location">${i('map-pin')}<div><small>Starting near</small><strong data-wait-location></strong></div></div>
        ${button('cancel', 'Stop looking', null, 'pulse-secondary pulse-wide')}
      </div>
    </section>
    <section class="pulse-stage" data-stage="proposal" hidden>
      <div class="pulse-proposal-topbar"><span>A plan for your free time</span><div class="pulse-countdown" data-countdown>${i('clock')}<span>Time to decide</span><strong data-proposal-timer role="timer"></strong></div></div>
      <div class="pulse-stage-scroll pulse-proposal-grid"><div class="pulse-plan-pane"><h2 data-proposal-title>A plan for your free time.</h2><p class="pulse-subtitle" data-proposal-summary></p><div data-proposal-spot></div><h3>Your proposed group</h3><ul class="pulse-people" data-proposal-people></ul><p class="pulse-note pulse-response-note" data-response-note hidden></p></div>
        <aside class="pulse-context pulse-proposal-context">${mapPanel('proposal')}<p class="pulse-fine">Meeting point preview</p>${button('proposal-map-button', 'Show on campus map', 'map', 'pulse-secondary pulse-wide')}</aside>
      </div>
      <footer class="pulse-footer pulse-proposal-footer"><p><strong>At least two people need to accept.</strong><span>Confirms when everyone responds or time runs out.</span></p><div class="pulse-actions" data-response-actions>${button('decline', 'Pass', null, 'pulse-secondary')}${button('accept', 'I’m in', 'check')}</div>${button('withdraw', 'Withdraw my response', null, 'pulse-secondary')}</footer>
    </section>
    <section class="pulse-stage pulse-meetup-stage" data-stage="meetup" hidden>
      <div class="pulse-meetup-mobile-summary">${i('map-pin')}<div><strong data-mobile-venue></strong><small data-mobile-plan></small></div><button type="button" class="pulse-icon-button" data-meetup-map-button aria-label="Show meeting point on map">${i('map')}</button></div>
      <div class="pulse-tabs" role="tablist" aria-label="Meetup view"><button type="button" id="pulse-details-tab" role="tab" aria-controls="pulse-details-panel" aria-selected="true" data-tab="details">Details</button><button type="button" id="pulse-chat-tab" role="tab" aria-controls="pulse-chat-panel" aria-selected="false" tabindex="-1" data-tab="chat">Chat<span class="pulse-unread" data-unread hidden></span></button></div>
      <div class="pulse-meetup-grid">
        <div class="pulse-meetup-details" id="pulse-details-panel" data-details-panel><span class="pulse-badge" data-meetup-badge></span><h2 data-meetup-title></h2><p class="pulse-subtitle" data-meetup-summary></p><div data-meetup-spot></div><h3>Your group</h3><ul class="pulse-people" data-meetup-people></ul>
          <div data-arrival>${button('checkin', 'I’m here', 'map-pin', 'pulse-primary pulse-wide')}<label class="pulse-toggle"><input type="checkbox" data-auto><span>Check me in automatically<small>Optional. Works while this page is visible.</small></span></label><p class="pulse-fine" data-auto-status>Precise location is never shown to your group.</p></div>
          ${button('leave', 'Leave meetup', 'logout', 'pulse-text-button pulse-leave')}
          <div class="pulse-leave-confirm" data-leave-confirm hidden><strong>Leave this meetup?</strong><p>Your group will see that you’ve left.</p><div class="pulse-actions">${button('stay', 'Stay', null, 'pulse-secondary')}${button('confirm-leave', 'Leave meetup', null, 'pulse-danger')}</div></div>
          ${button('new', 'Find another meetup', 'arrow-right', 'pulse-primary pulse-wide')}
        </div>
        <section class="pulse-chat" id="pulse-chat-panel" data-chat><header class="pulse-chat-header"><h3>Meetup chat</h3><div class="pulse-chat-members"><span class="pulse-avatar-stack" data-chat-avatars></span><span data-chat-members>Only your group can read this.</span></div></header>
          <div class="pulse-conversation"><div class="pulse-messages" role="log" aria-label="Meetup messages" aria-live="polite" aria-relevant="additions" data-messages></div><button type="button" class="pulse-new-messages" data-new-messages hidden>New messages ${i('arrow-right')}</button></div>
          <p class="pulse-chat-arrivals" data-chat-arrivals role="status" hidden></p>
          <div class="pulse-mobile-arrival" data-mobile-arrival>${i('map-pin')}<span data-mobile-arrival-label>Arrived?</span>${button('mobile-checkin', 'I’m here', null, 'pulse-secondary')}</div>
          <div class="pulse-chat-footer"><p class="pulse-chat-expiry">${i('lock')}<span data-chat-expiry></span></p><form class="pulse-compose" data-compose><label><span class="pulse-sr">Message your group</span><textarea name="message" rows="1" maxlength="2000" placeholder="Message your group…" required></textarea></label><button type="submit" class="pulse-primary" data-send aria-label="Send message">${i('send')}<span data-button-label>Send</span></button></form><p class="pulse-message-status" data-message-status role="status"></p></div>
        </section>
        <div class="pulse-chat-closed" data-chat-closed hidden>${i('lock')}<h3>This conversation has closed.</h3><p>Your meetup has ended. There’s always time for another connection.</p></div>
      </div>
    </section>
  </div>
  <p class="pulse-toast" data-toast role="status" hidden></p>
  <p class="pulse-sr" role="status" aria-live="polite" data-announcement></p>
</div>`;
