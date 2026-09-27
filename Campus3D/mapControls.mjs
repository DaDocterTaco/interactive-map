// Compact disclosures share the map adapter's existing action handlers.
export function createMapControls(toolbar) {
  const icon = name => `<span class="cu-icon" aria-hidden="true" style="--icon:url('${new URL(`CampusUI/icons/${name}.svg`, document.baseURI).href}')"></span>`;
  toolbar.innerHTML = `
    <div class="campus-tools-row">
      <div class="campus-view-control">
        <button type="button" class="campus-view-knob" aria-label="Choose map view, current view 2D" aria-expanded="false" aria-controls="campus-view-choices"><span class="campus-current-view">2D</span>${icon('chevron-down')}</button>
        <div id="campus-view-choices" class="campus-view-switch" role="group" aria-label="Map view" hidden>
          <button type="button" data-action="3d" aria-pressed="false">3D</button>
          <button type="button" data-action="2d" aria-pressed="true">2D</button>
        </div>
      </div>
      <button type="button" class="campus-tools-knob" aria-label="Map tools" title="Map tools" aria-expanded="false" aria-controls="campus-tools-menu">${icon('adjustments-horizontal')}</button>
    </div>
    <div id="campus-tools-menu" class="campus-tools-menu" hidden>
      <div class="campus-tools-shortcuts">
        <button type="button" class="campus-recenter-action">${icon('navigation')}<span>Recenter</span></button>
        <button type="button" class="campus-settings-action" aria-expanded="false" aria-controls="campus-map-settings">${icon('adjustments-horizontal')}<span>Map settings</span></button>
      </div>
      <section id="campus-map-settings" class="campus-map-settings" aria-label="Map settings" hidden>
        <button type="button" class="campus-settings-back">${icon('arrow-left')}<span>Map settings</span></button>
        <div class="campus-options-actions"><button type="button" data-action="home">View campus</button><button type="button" data-action="north">${icon('navigation')}<span>Face north</span></button><button type="button" data-action="top">Top view</button></div>
        <div class="campus-orbit"><button type="button" data-action="left" aria-label="Rotate left">${icon('arrow-left')}</button><button type="button" data-action="right" aria-label="Rotate right">${icon('arrow-right')}</button><button type="button" data-action="tilt">Tilt</button><button type="button" data-action="in" aria-label="Zoom in">${icon('plus')}</button><button type="button" data-action="out" aria-label="Zoom out">${icon('minus')}</button></div>
        <p>Drag to move · Pinch or scroll to zoom.<br>Right-drag to rotate in 3D.</p><p>Approximate building heights.<br>Exterior navigation only.</p><p>Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> · ODbL</p>
      </section>
    </div>
    <p role="status" class="campus-load" hidden></p>`;
  const view = toolbar.querySelector('.campus-view-control');
  const viewKnob = toolbar.querySelector('.campus-view-knob');
  const choices = toolbar.querySelector('.campus-view-switch');
  const toolsKnob = toolbar.querySelector('.campus-tools-knob');
  const menu = toolbar.querySelector('.campus-tools-menu');
  const shortcuts = toolbar.querySelector('.campus-tools-shortcuts');
  const settings = toolbar.querySelector('.campus-map-settings');
  const settingsAction = toolbar.querySelector('.campus-settings-action');
  const events = new AbortController();
  const listen = (target, event, callback) => target.addEventListener(event, callback, {signal: events.signal});
  let open = null;

  function setSettings(expanded, focus = false) {
    shortcuts.hidden = expanded;
    settings.hidden = !expanded;
    settingsAction.setAttribute('aria-expanded', String(expanded));
    menu.classList.toggle('is-settings', expanded);
    if (focus) (expanded ? toolbar.querySelector('.campus-settings-back') : settingsAction).focus({preventScroll:true});
  }
  function close({restoreFocus = false} = {}) {
    const trigger = open === 'view' ? viewKnob : toolsKnob;
    open = null;
    view.classList.remove('is-open');
    viewKnob.hidden = false;
    choices.hidden = true;
    menu.hidden = true;
    viewKnob.setAttribute('aria-expanded', 'false');
    toolsKnob.setAttribute('aria-expanded', 'false');
    setSettings(false);
    if (restoreFocus) trigger.focus({preventScroll:true});
  }
  function expand(which) {
    if (open === which) { close({restoreFocus:true}); return; }
    close();
    open = which;
    if (which === 'view') {
      view.classList.add('is-open');
      viewKnob.hidden = true;
      choices.hidden = false;
      viewKnob.setAttribute('aria-expanded', 'true');
      choices.querySelector('[aria-pressed="true"]').focus({preventScroll:true});
    } else {
      menu.hidden = false;
      toolsKnob.setAttribute('aria-expanded', 'true');
      shortcuts.querySelector('button').focus({preventScroll:true});
    }
  }
  listen(viewKnob, 'click', () => expand('view'));
  listen(toolsKnob, 'click', () => expand('tools'));
  listen(settingsAction, 'click', () => setSettings(true, true));
  listen(toolbar.querySelector('.campus-settings-back'), 'click', () => setSettings(false, true));
  listen(toolbar.querySelector('.campus-recenter-action'), 'click', () => {
    close({restoreFocus:true});
    document.getElementById('cu-recenter')?.click();
  });
  listen(toolbar, 'click', event => {
    if (event.target.closest('[data-action="2d"], [data-action="3d"]')) close({restoreFocus:true});
  });
  listen(document, 'pointerdown', event => { if (!toolbar.contains(event.target)) close(); });
  listen(toolbar, 'focusout', event => { if (event.relatedTarget && !toolbar.contains(event.relatedTarget)) close(); });
  listen(toolbar, 'keydown', event => {
    if (event.key === 'Escape' && open) {
      event.preventDefault(); event.stopPropagation(); close({restoreFocus:true});
    } else if (open === 'view' && ['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {
      event.preventDefault();
      const buttons = [...choices.querySelectorAll('button')];
      const index = buttons.indexOf(document.activeElement);
      buttons[event.key === 'Home' ? 0 : event.key === 'End' ? 1 : (index + 1) % 2].focus();
    } else if (open === 'tools' && ['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
      event.preventDefault();
      const buttons = [...(settings.hidden ? shortcuts : settings).querySelectorAll('button:not(:disabled)')].filter(button => !button.closest('[hidden]'));
      const index = buttons.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
  });
  listen(window, 'campus-panel-layout', () => { if (document.getElementById('campus-sheet')?.dataset.snap === 'full') close(); });
  return {
    close,
    setView(active) {
      const label = active ? '3D' : '2D';
      toolbar.querySelector('.campus-current-view').textContent = label;
      viewKnob.setAttribute('aria-label', `Choose map view, current view ${label}`);
      toolbar.querySelector('[data-action="3d"]').setAttribute('aria-pressed', String(active));
      toolbar.querySelector('[data-action="2d"]').setAttribute('aria-pressed', String(!active));
      toolbar.querySelector('.campus-orbit').hidden = !active;
      toolbar.querySelector('[data-action="top"]').disabled = !active;
      toolbar.querySelector('[data-action="north"]').disabled = !active;
    },
    dispose() { events.abort(); }
  };
}
