import { iconMarkup } from './view.js';
import { backgroundState } from './background-state.js';

export function createBackgroundPulse({ dialog, launch, open, getState }) {
  const card = document.createElement('aside');
  card.id = 'pulse-background'; card.className = 'pulse-background'; card.hidden = true;
  card.setAttribute('aria-label', 'Campus Pulse status');
  // A non-modal popover keeps the card visible without intercepting map/tab use.
  if (typeof card.showPopover === 'function') card.setAttribute('popover', 'manual');
  card.innerHTML = `<span class="pulse-background-mark">${iconMarkup('wave-sine')}</span><div class="pulse-background-copy"><div role="status" aria-live="polite" aria-atomic="true"><strong data-background-title></strong><p data-background-detail></p></div><span class="pulse-background-time" role="timer" aria-live="off" hidden></span></div><button type="button" class="pulse-background-open"></button>`;
  document.body.append(card);
  const title = card.querySelector('[data-background-title]'), detail = card.querySelector('[data-background-detail]'), time = card.querySelector('[role=timer]'), button = card.querySelector('button');
  let disposed = false, frame, previousFocus, titlePrefix = '', tabBadge, hubLabel, hubOriginal, pendingCloseCleanup;
  const text = (node, value) => { if (node && node.textContent !== value) node.textContent = value; };
  function hide() {
    if (card.hasAttribute('popover') && card.matches(':popover-open')) card.hidePopover();
    card.hidden = true;
  }
  function isVisible() {
    if (!dialog.open || dialog.closest('[hidden],[inert]') || document.hidden) return false;
    if (dialog.dataset.embedded && window.CampusUI?.getState().snap === 'peek') return false;
    return !!dialog.getClientRects().length;
  }
  function update() {
    if (disposed) return;
    const model = backgroundState(getState()), visible = isVisible();
    const attention = model?.kind === 'found' && !visible;
    launch.dataset.attention = String(attention);
    // The current app's shared navigation hides the original floating launcher.
    // Keep its Community entry useful while retaining the standalone launcher.
    const communityTab = document.getElementById('tab-community');
    if (communityTab && !tabBadge) {
      tabBadge = document.createElement('span'); tabBadge.className = 'pulse-tab-badge'; tabBadge.textContent = '1'; tabBadge.setAttribute('aria-hidden', 'true'); tabBadge.hidden = true; communityTab.append(tabBadge);
    }
    if (tabBadge) { if (tabBadge.hidden === attention) tabBadge.hidden = !attention; communityTab?.setAttribute('aria-description', attention ? 'Campus Pulse: a group is ready for your response.' : ''); }
    if (!hubLabel) { hubLabel = document.querySelector('#community-home [data-community=pulse] small'); hubOriginal = hubLabel?.textContent; }
    if (hubLabel) text(hubLabel, model?.label || hubOriginal);
    const prefix = attention ? '[Pulse] Group found · ' : '';
    if (prefix !== titlePrefix) { const base = titlePrefix && document.title.startsWith(titlePrefix) ? document.title.slice(titlePrefix.length) : document.title; document.title = prefix + base; titlePrefix = prefix; }
    if (!model || visible) { hide(); return; }

    card.dataset.state = model.kind;
    text(title, model.title); text(detail, model.detail); text(button, model.action);
    time.hidden = model.seconds == null;
    text(time, model.seconds == null ? '' : `${model.seconds}s to respond`);
    card.dataset.urgent = String(model.seconds != null && model.seconds <= 10);

    // Content outside a modal dialog is inert, even in the top layer. Mount the
    // notification in the active modal so it stays clickable over profile/forms.
    const focusedModal = document.activeElement?.closest('dialog:modal');
    const modals = [...document.querySelectorAll('dialog:modal')];
    const host = focusedModal || modals.at(-1) || document.body;
    if (card.parentElement !== host) { hide(); host.append(card); }
    card.hidden = false;
    if (card.hasAttribute('popover') && !card.matches(':popover-open')) card.showPopover();
  }
  const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
  button.addEventListener('click', () => {
    // Remember the user's actual place, not a button hidden when Pulse opens.
    const opener = previousFocus?.isConnected ? previousFocus : launch;
    const go = () => {
      if (disposed) return;
      const modal = card.closest('dialog:modal') || [...document.querySelectorAll('dialog:modal')].at(-1);
      if (modal && modal !== dialog) {
        // Respect the current editor's cancel/unsaved-change guard. Never force
        // a modal closed or leave the embedded Pulse page behind an inert layer.
        pendingCloseCleanup?.();
        const afterClose = () => { pendingCloseCleanup = null; queueMicrotask(go); };
        pendingCloseCleanup = () => modal.removeEventListener('close', afterClose);
        modal.addEventListener('close', afterClose, { once: true });
        if (typeof modal.requestClose === 'function') modal.requestClose();
        else if (modal.dispatchEvent(new Event('cancel', { cancelable: true }))) modal.close();
        if (modal.open) { pendingCloseCleanup(); pendingCloseCleanup = null; }
        return;
      }
      hide(); open({ currentTarget: opener }); update();
    };
    go();
  });
  const onFocus = event => { if (!card.contains(event.target) && !dialog.contains(event.target)) previousFocus = event.target; };
  document.addEventListener('focusin', onFocus);
  const observer = new MutationObserver(records => {
    if (records.some(r => !card.contains(r.target) && (r.type === 'attributes' || [...r.addedNodes, ...r.removedNodes].some(n => n !== card && (n.nodeName === 'DIALOG' || n.querySelector?.('dialog')))))) schedule();
  });
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open', 'hidden', 'inert', 'data-snap'] });
  window.addEventListener('campus-tab-change', schedule);
  window.addEventListener('campus-panel-layout', schedule);
  document.addEventListener('visibilitychange', schedule);
  return { update, isVisible, dispose() {
    disposed = true; cancelAnimationFrame(frame); pendingCloseCleanup?.(); observer.disconnect(); hide(); card.remove(); tabBadge?.remove();
    if (hubLabel?.isConnected) text(hubLabel, hubOriginal);
    document.getElementById('tab-community')?.removeAttribute('aria-description');
    if (titlePrefix && document.title.startsWith(titlePrefix)) document.title = document.title.slice(titlePrefix.length);
    document.removeEventListener('focusin', onFocus); window.removeEventListener('campus-tab-change', schedule); window.removeEventListener('campus-panel-layout', schedule); document.removeEventListener('visibilitychange', schedule);
  } };
}
