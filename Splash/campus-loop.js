(() => {
  'use strict';
  if (window.CampusLoopLoading) return;
  const isPreview = document.currentScript?.hasAttribute('data-preview');
  const busyTargets = new WeakMap();
  function mount(target, {label = 'Loading…', detail = '', compact = true} = {}) {
    if (!target) return {remove() {}};
    const node = document.createElement('div');
    node.className = 'cl-loader' + (compact ? ' cl-loader--compact' : '');
    node.setAttribute('role', 'status');
    node.setAttribute('aria-live', 'polite');
    node.innerHTML = '<span class="cl-loader-mark" aria-hidden="true"></span><span class="cl-loader-copy"><span></span></span>';
    node.querySelector('.cl-loader-copy > span').textContent = label;
    if (detail) { const copy = document.createElement('span'); copy.className='cl-loader-detail'; copy.textContent=detail; node.lastElementChild.append(copy); }
    const state = busyTargets.get(target) || {count:0, before:target.getAttribute('aria-busy')};
    state.count++; busyTargets.set(target,state); target.setAttribute('aria-busy','true');
    target.prepend(node);
    let removed = false;
    return {element:node, remove() {
      if (removed) return; removed=true; node.remove();
      if (--state.count === 0) { if(state.before === null) target.removeAttribute('aria-busy'); else target.setAttribute('aria-busy',state.before); busyTargets.delete(target); }
    }};
  }
  let splash, timer, slowTimer, exitTimer, previousOverflow, dismissed = false, mapReady = false;
  let domReady = document.readyState !== 'loading';
  const started = performance.now();
  let returning = false;
  try { returning=sessionStorage.getItem('campus-loop-visited')==='1'; } catch { /* Storage can be disabled. */ }
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const minimum = reduced ? 0 : returning ? 350 : 1500;
  function message(text) { if(splash && !dismissed) splash.querySelector('.cl-status').textContent=text; }
  function dismiss(immediate = false) {
    if (dismissed) return;
    dismissed=true; clearTimeout(timer); clearTimeout(slowTimer); clearTimeout(exitTimer);
    document.removeEventListener('DOMContentLoaded', onDOMReady);
    document.removeEventListener('toggle', onDialogToggle, true);
    try { sessionStorage.setItem('campus-loop-visited','1'); } catch { /* No persistence required. */ }
    if(!splash)return;
    const node=splash;
    const remove=()=>{if(node.open)node.close();node.remove();document.documentElement.style.overflow=previousOverflow;if(splash===node)splash=null;};
    if(immediate||reduced)remove();
    else { node.classList.add('cl-leaving'); exitTimer=setTimeout(remove,480); }
  }
  function maybeReady() {
    if (dismissed||isPreview||!domReady||!mapReady) return;
    clearTimeout(exitTimer);
    message('Your campus is ready');
    exitTimer=setTimeout(()=>dismiss(),Math.max(0,minimum-(performance.now()-started)));
  }
  function ready() {mapReady=true;maybeReady();}
  function onDOMReady() {domReady=true;maybeReady();}
  function onDialogToggle(event) {
    // Deep links may intentionally open a feature dialog during startup.
    if(event.target!==splash&&event.target instanceof HTMLDialogElement&&event.target.open) dismiss(true);
  }
  function show() {
    splash=document.createElement('dialog'); splash.className='cl-splash'; splash.tabIndex=-1;
    splash.setAttribute('aria-labelledby','cl-title'); splash.setAttribute('aria-describedby','cl-tagline');
    splash.innerHTML=`
      <div class="cl-scene" aria-hidden="true">
        <div class="cl-map-art"></div><div class="cl-route-art"></div>
        <span class="cl-map-label cl-library">Library</span><span class="cl-map-label cl-quad">The Quad</span>
      </div>
      <div class="cl-nav-mark" aria-hidden="true"></div>
      <div class="cl-brand-copy">
        <h1 id="cl-title" class="cl-title">Campus<br>Loop</h1>
        <p id="cl-tagline" class="cl-tagline">Good things are just<br>around the corner.</p>
      </div>
      <div class="cl-status-area"><p class="cl-status" role="status" aria-live="polite">Finding your campus…</p><div class="cl-progress" aria-hidden="true"></div></div>
      <footer class="cl-bottom"><button type="button" class="cl-skip">${isPreview?'Explore campus':'Continue to campus'}</button><span class="cl-campus"><strong>FIU</strong><span aria-hidden="true"> · </span>Miami</span></footer>`;
    previousOverflow=document.documentElement.style.overflow;
    document.documentElement.style.overflow='hidden';
    document.body.append(splash);
    splash.querySelector('.cl-skip').addEventListener('click',()=>isPreview?location.assign('../'):dismiss(true));
    splash.addEventListener('cancel',event=>{event.preventDefault();dismiss(true);});
    splash.showModal(); splash.focus({preventScroll:true});
    document.addEventListener('DOMContentLoaded',onDOMReady,{once:true});
    document.addEventListener('toggle',onDialogToggle,true);
    if(!isPreview) {
      slowTimer=setTimeout(()=>message('Taking a little longer. You can continue below.'),5500);
      // A failed CDN, model, or feature must never lock the app behind a splash.
      timer=setTimeout(()=>dismiss(),10000);
    }
  }
  window.CampusLoopLoading=Object.freeze({mount,ready,message,dismiss});
  function boot() {if(dismissed)return;try {show();} catch {dismiss(true);}}
  if(document.body)boot();
  else {
    // Start as soon as the body exists, before remote styles or map scripts settle.
    const observer=new MutationObserver(()=>{if(document.body){observer.disconnect();boot();}});
    observer.observe(document.documentElement,{childList:true});
  }
})();
