// This deferred script mounts the buttons before chat and class search initialize.
const actionBar = document.createElement('nav');
actionBar.id = 'action-bar';
actionBar.className = 'action-bar';
actionBar.setAttribute('aria-label', 'Campus actions');
actionBar.innerHTML = `
    <button id="action-bar-handle" class="action-bar-handle" type="button" aria-controls="action-bar-actions" aria-expanded="false" aria-label="Expand campus actions"><span class="action-bar-grip" aria-hidden="true"></span><span class="action-bar-hint">Swipe up for options</span></button>
    <div id="action-bar-actions" class="action-bar-actions">
        <button id="open-location" type="button"><span class="action-bar-icon" aria-hidden="true">◎</span><span class="action-bar-copy"><strong>Locate me</strong><small id="location-status" role="status" aria-live="polite">Find your position on campus.</small></span></button>
        <button id="stop-location" type="button" hidden><span class="action-bar-icon" aria-hidden="true">◌</span><span class="action-bar-copy"><strong>Stop location</strong><small>Turn off live location tracking</small></span></button>
        <button id="open-class" type="button" aria-haspopup="dialog" aria-controls="class-dialog"><span class="action-bar-icon" aria-hidden="true">▣</span><span class="action-bar-copy"><strong>Classes</strong><small>Find a class on the map</small></span></button>
        <button id="open-chat" type="button" aria-haspopup="dialog" aria-controls="chat-panel" disabled><span class="action-bar-icon" aria-hidden="true">◌</span><span class="action-bar-copy"><strong>Live chat</strong><small>Talk with other Panthers</small></span></button>
        <button id="open-assistant" type="button" aria-controls="chat-container" aria-expanded="false"><span class="action-bar-icon" aria-hidden="true">✦</span><span class="action-bar-copy"><strong>Assistant</strong><small>Ask about campus and events</small></span></button>
    </div>`;
document.querySelector('.app-shell').append(actionBar);

const actionBarHandle = actionBar.querySelector('#action-bar-handle');
const actionBarHint = actionBarHandle.querySelector('.action-bar-hint');
let collapsedBarHeight = actionBar.offsetHeight;
let barDrag = null;
let ignoreHandleClick = false;

function expandedBarHeight() {
    return Math.min(360, Math.max(collapsedBarHeight + 80, window.innerHeight * .55), window.innerHeight - 60);
}

function setActionBarOpen(open) {
    actionBar.style.setProperty('--expanded-bar-height', `${expandedBarHeight()}px`);
    actionBar.style.height = '';
    actionBar.classList.toggle('is-expanded', open);
    actionBarHandle.setAttribute('aria-expanded', String(open));
    actionBarHandle.setAttribute('aria-label', open ? 'Collapse campus actions' : 'Expand campus actions');
    actionBarHint.textContent = open ? 'Swipe down to close' : 'Swipe up for options';
}

actionBarHandle.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    collapsedBarHeight = actionBar.classList.contains('is-expanded') ? collapsedBarHeight : actionBar.offsetHeight;
    actionBar.style.setProperty('--expanded-bar-height', `${expandedBarHeight()}px`);
    barDrag = { id: event.pointerId, y: event.clientY, height: actionBar.offsetHeight };
    actionBar.classList.add('is-dragging');
    actionBarHandle.setPointerCapture(event.pointerId);
});
actionBarHandle.addEventListener('pointermove', event => {
    if (!barDrag || event.pointerId !== barDrag.id) return;
    const height = Math.max(collapsedBarHeight, Math.min(expandedBarHeight(), barDrag.height + barDrag.y - event.clientY));
    actionBar.style.height = `${height}px`;
});
actionBarHandle.addEventListener('pointerup', event => {
    if (!barDrag || event.pointerId !== barDrag.id) return;
    const distance = barDrag.y - event.clientY;
    const height = actionBar.offsetHeight;
    barDrag = null;
    actionBar.classList.remove('is-dragging');
    if (Math.abs(distance) > 15) {
        // Keep the release frame so the sheet can animate to its final position.
        void actionBar.offsetHeight;
        setActionBarOpen(Math.abs(distance) > 40 ? distance > 0 : height > (collapsedBarHeight + expandedBarHeight()) / 2);
        ignoreHandleClick = true;
        setTimeout(() => { ignoreHandleClick = false; }, 0);
    } else {
        actionBar.style.height = '';
    }
});
actionBarHandle.addEventListener('pointercancel', () => {
    barDrag = null;
    actionBar.classList.remove('is-dragging');
    actionBar.style.height = '';
    setActionBarOpen(actionBar.classList.contains('is-expanded'));
});
actionBarHandle.addEventListener('click', () => {
    if (!ignoreHandleClick) setActionBarOpen(!actionBar.classList.contains('is-expanded'));
});
actionBar.querySelector('.action-bar-actions').addEventListener('click', event => {
    const button = event.target.closest('button');
    // Keep permission, GPS progress, and error feedback visible while locating.
    if (button && !['open-location', 'stop-location'].includes(button.id)) setActionBarOpen(false);
});
window.addEventListener('resize', () => {
    if (!actionBar.classList.contains('is-expanded')) collapsedBarHeight = actionBar.offsetHeight;
    setActionBarOpen(actionBar.classList.contains('is-expanded'));
});
document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && actionBar.classList.contains('is-expanded')) setActionBarOpen(false);
});
