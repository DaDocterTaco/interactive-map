/* Share the existing appearance preference with Chat and Campus Pulse. */
(() => {
    const root = document.documentElement;
    const key = 'fiu-chat:theme';
    const system = window.matchMedia('(prefers-color-scheme: dark)');
    let preference;
    try { preference = localStorage.getItem(key); } catch { /* Tab-only preference. */ }
    const valid = value => value === 'light' || value === 'dark';
    const apply = theme => { root.dataset.chatTheme = theme; };
    apply(valid(preference) ? preference : system.matches ? 'dark' : 'light');

    function sync() {
        const dark = root.dataset.chatTheme === 'dark';
        const label = `Switch to ${dark ? 'light' : 'dark'} mode`;
        root.style.colorScheme = dark ? 'dark' : 'light';
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#09192b' : '#ffffff');
        for (const id of ['campus-theme-toggle', 'theme-toggle']) {
            const button = document.getElementById(id);
            if (!button) continue;
            button.setAttribute('aria-label', label);
            button.title = label;
            const copy = button.querySelector('[data-theme-label]');
            if (copy) copy.textContent = dark ? 'Dark mode' : 'Light mode';
            if (id === 'theme-toggle') button.setAttribute('aria-pressed', String(dark));
        }
    }
    new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['data-chat-theme'] });
    system.addEventListener('change', event => {
        try { preference = localStorage.getItem(key); } catch { /* Keep tab preference. */ }
        if (!valid(preference)) apply(event.matches ? 'dark' : 'light');
    });
    window.addEventListener('storage', event => {
        if (event.key !== key && event.key !== null) return;
        preference = event.newValue;
        apply(valid(preference) ? preference : system.matches ? 'dark' : 'light');
    });
    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('campus-theme-toggle')?.addEventListener('click', () => {
            preference = root.dataset.chatTheme === 'dark' ? 'light' : 'dark';
            try { localStorage.setItem(key, preference); } catch { /* Still works without storage. */ }
            apply(preference);
        });
        sync();
    });
})();
