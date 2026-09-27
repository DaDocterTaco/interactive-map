/** Keep a chat sheet inside the visible viewport, including the on-screen keyboard. */
export function mountChatViewport(panel) {
    const view = panel.ownerDocument?.defaultView || window;
    const viewport = view.visualViewport;
    const stopScroll = view.CampusInput?.preserveScroll(panel.querySelector('#message-list'));
    const properties = ["--chat-viewport-height", "--chat-viewport-offset"];
    const attributes = ["data-compact-height", "data-tight-height"];
    const previousStyles = properties.map(name => ({
        name,
        value: panel.style.getPropertyValue(name),
        priority: panel.style.getPropertyPriority(name)
    }));
    const previousAttributes = attributes.map(name => [name, panel.getAttribute(name)]);
    let disposed = false;
    let hasUnzoomedSize = false;

    function refresh() {
        if (disposed) return;
        const unzoomed = !viewport || !Number.isFinite(viewport.scale) || Math.abs(viewport.scale - 1) < 0.01;
        // Pinch zoom should magnify the existing layout rather than squeeze it into
        // the smaller zoomed viewport. Keep the last non-zoomed size until it ends.
        if (!unzoomed && hasUnzoomedSize) return;
        const shared = view.CampusInput?.getViewport();
        const visualHeight = shared?.height ?? (unzoomed && viewport ? viewport.height : undefined);
        const height = Number.isFinite(visualHeight) && visualHeight > 0 ? visualHeight : view.innerHeight;
        if (!Number.isFinite(height) || height <= 0) return;
        const visualOffset = shared?.offset ?? (unzoomed && viewport ? viewport.offsetTop : 0);
        const offset = Number.isFinite(visualOffset) ? Math.max(0, visualOffset) : 0;
        panel.style.setProperty(properties[0], `${height}px`);
        panel.style.setProperty(properties[1], `${offset}px`);
        // The keyboard changes available space, not the device size. Keep
        // chrome sizing stable while the content area contracts.
        const layoutHeight = shared?.keyboard ? shared.baseline : height;
        panel.setAttribute(attributes[0], String(layoutHeight <= 600));
        panel.setAttribute(attributes[1], String(layoutHeight <= 450));
        hasUnzoomedSize = true;
    }

    view.addEventListener("campus-input-viewport", refresh);
    viewport?.addEventListener("resize", refresh);
    viewport?.addEventListener("scroll", refresh);
    view.addEventListener("resize", refresh);
    refresh();

    return {
        refresh,
        dispose() {
            if (disposed) return;
            disposed = true;
            stopScroll?.();
            view.removeEventListener("campus-input-viewport", refresh);
            viewport?.removeEventListener("resize", refresh);
            viewport?.removeEventListener("scroll", refresh);
            view.removeEventListener("resize", refresh);
            for (const { name, value, priority } of previousStyles) {
                if (value) panel.style.setProperty(name, value, priority);
                else panel.style.removeProperty(name);
            }
            for (const [name, value] of previousAttributes) {
                if (value === null) panel.removeAttribute(name);
                else panel.setAttribute(name, value);
            }
        }
    };
}
