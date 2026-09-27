/* Shared focus policy. Native taps and hardware-keyboard navigation stay native. */
(() => {
    if (window.CampusInput) return;
    const mobileQuery = matchMedia('(pointer: coarse), (max-width: 700px)');
    const root = document.documentElement;
    const textTypes = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number']);
    const isTextField = node => Boolean(node && (node.tagName === 'TEXTAREA' ||
        (node.tagName === 'INPUT' && textTypes.has(node.type)) || node.isContentEditable));
    const isMobile = () => mobileQuery.matches;

    function focus(node, options = { preventScroll: true }) {
        if (!node || (isMobile() && isTextField(node))) return false;
        node.focus(options);
        return true;
    }

    // The browser can focus the first input during showModal/show even without
    // an autofocus attribute. Choose a heading before those native steps run.
    function showModal(dialog) {
        if (!isMobile()) { dialog.showModal(); return; }
        if (isTextField(document.activeElement)) document.activeElement.blur();
        const existing = [...dialog.querySelectorAll('[autofocus]')];
        const candidates = [...dialog.querySelectorAll('h1,h2,h3'), ...dialog.querySelectorAll('button')];
        const target = candidates.find(node => {
            if (node.disabled) return false;
            for (let parent = node; parent && parent !== dialog; parent = parent.parentElement) {
                const style = getComputedStyle(parent);
                if (parent.hidden || parent.inert || style.display === 'none' || style.visibility === 'hidden') return false;
            }
            return true;
        }) || dialog;
        const oldTab = target.getAttribute('tabindex');
        existing.forEach(node => node.removeAttribute('autofocus'));
        target.setAttribute('tabindex', '-1');
        target.setAttribute('autofocus', '');
        try { dialog.showModal(); focus(target); }
        finally {
            target.removeAttribute('autofocus');
            existing.forEach(node => node.setAttribute('autofocus', ''));
            if (oldTab === null) target.removeAttribute('tabindex');
            else target.setAttribute('tabindex', oldTab);
        }
    }

    let frame = 0, baseline = innerHeight, lastWidth = innerWidth;
    let state = { height: innerHeight, offset: 0, inset: 0, keyboard: false, baseline };
    const viewport = window.visualViewport;
    function keepInputVisible() {
        const input = document.activeElement;
        if (!state.keyboard || !isTextField(input)) return;
        // Scroll only the input's own content, never the map or the whole page.
        for (let parent = input.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
            if (!/(auto|scroll)/.test(getComputedStyle(parent).overflowY) || parent.scrollHeight <= parent.clientHeight) continue;
            const rect = input.getBoundingClientRect(), bounds = parent.getBoundingClientRect();
            const top = Math.max(bounds.top, state.offset) + 12;
            const bottom = Math.min(bounds.bottom, state.offset + state.height) - 12;
            if (rect.bottom > bottom) parent.scrollTop += Math.min(rect.bottom - bottom, rect.top - top);
            else if (rect.top < top) parent.scrollTop -= top - rect.top;
        }
    }
    function refresh() {
        frame = 0;
        // Pinch zoom must magnify the UI instead of triggering a keyboard layout.
        if (viewport && Math.abs(viewport.scale - 1) > .01) return;
        const height = viewport?.height || innerHeight;
        const offset = Math.max(0, viewport?.offsetTop || 0);
        const editing = isTextField(document.activeElement);
        if (Math.abs(lastWidth - innerWidth) > 80) baseline = innerHeight;
        lastWidth = innerWidth;
        if (!state.keyboard && !editing) baseline = Math.max(height, innerHeight);
        else baseline = Math.max(baseline, innerHeight, height);
        const keyboard = isMobile() && (editing || state.keyboard) && baseline - height > Math.max(100, baseline * .18);
        if (!keyboard && !editing) baseline = Math.max(height, innerHeight);
        state = { height, offset, inset: Math.max(0, innerHeight - height - offset), keyboard, baseline };
        root.dataset.mobileInput = String(isMobile());
        root.dataset.keyboardOpen = String(keyboard);
        root.dataset.keyboardCompact = String(keyboard && height < 360);
        root.style.setProperty('--mobile-viewport-height', `${height}px`);
        root.style.setProperty('--mobile-viewport-top', `${offset}px`);
        root.style.setProperty('--keyboard-inset', `${state.inset}px`);
        window.dispatchEvent(new CustomEvent('campus-input-viewport', { detail: state }));
        if (keyboard) requestAnimationFrame(keepInputVisible);
    }
    function schedule() { if (!frame) frame = requestAnimationFrame(refresh); }
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    document.addEventListener('focusin', schedule);
    document.addEventListener('focusout', schedule);
    mobileQuery.addEventListener('change', schedule);

    function preserveScroll(node) {
        if (!node) return () => {};
        let height = node.clientHeight, top = node.scrollTop;
        let atEnd = node.scrollHeight - top - height < 32;
        const remember = () => {
            // A resize can itself generate a scroll event; retain the position
            // from before that resize until the observer has adjusted it.
            if (height !== node.clientHeight) return;
            top = node.scrollTop;
            atEnd = node.scrollHeight - top - height < 32;
        };
        const observer = new ResizeObserver(() => {
            if (!node.clientHeight || height === node.clientHeight) return;
            height = node.clientHeight;
            node.scrollTop = atEnd ? node.scrollHeight : top;
            top = node.scrollTop;
        });
        node.addEventListener('scroll', remember, { passive: true });
        observer.observe(node);
        return () => { observer.disconnect(); node.removeEventListener('scroll', remember); };
    }

    // Cancel native invalid-field autofocus on phones, but keep an accessible,
    // field-specific error and the browser's normal validation/submission rules.
    let errorId = 0;
    const errors = new WeakMap();
    document.addEventListener('invalid', event => {
        const input = event.target;
        if (!isMobile() || !isTextField(input)) return;
        event.preventDefault();
        if (errors.has(input)) { errors.get(input).note.textContent = input.validationMessage; return; }
        const note = document.createElement('p');
        note.id = `campus-input-error-${++errorId}`;
        note.className = 'campus-input-error'; note.setAttribute('role', 'alert');
        note.textContent = input.validationMessage;
        const described = input.getAttribute('aria-describedby'), invalid = input.getAttribute('aria-invalid');
        input.setAttribute('aria-describedby', [described, note.id].filter(Boolean).join(' '));
        input.setAttribute('aria-invalid', 'true'); input.after(note);
        errors.set(input, { note, described, invalid });
    }, true);
    document.addEventListener('input', event => {
        const input = event.target, error = errors.get(input);
        if (!error) return;
        error.note.remove(); errors.delete(input);
        for (const [name, value] of [['aria-describedby', error.described], ['aria-invalid', error.invalid]]) {
            if (value === null) input.removeAttribute(name); else input.setAttribute(name, value);
        }
    });
    window.CampusInput = { focus, showModal, isMobile, isTextField, preserveScroll, getViewport: () => state };
    refresh();
})();
