import { appearanceColors, appearanceIcons, logoInitials, validateAppearance, renderAppearance, prepareLogo } from "./groupAppearance.js";

export function mountAppearanceEditor(prefix, { getName, onBusy = () => {} }) {
    const el = suffix => document.getElementById(`${prefix}-${suffix}`);
    const events = new AbortController();
    let draft, image = "", uploadVersion = 0, busy = false, disabled = false, customText = false, disposed = false;
    const bind = (element, event, callback) => element.addEventListener(event, callback, { signal: events.signal });
    const controls = () => el("editor").querySelectorAll("button,input,select");
    const syncDisabled = () => {
        for (const control of controls()) control.disabled = disabled || busy || (control === el("text") && el("kind").value !== "initials");
    };
    function update() {
        const kind = el("kind").value;
        draft = { kind, color: draft?.color || "blue", ...(kind === "initials" ? { text: el("text").value.trim().toUpperCase() } : kind === "icon" ? { icon: draft?.icon || "people-fill" } : { image }) };
        el("initials-field").hidden = kind !== "initials"; el("icons").hidden = kind !== "icon"; el("image-field").hidden = kind !== "image";
        el("colors").hidden = kind === "image";
        renderAppearance(el("preview"), { name: getName() || "Group", appearance: draft });
        for (const button of el("colors").children) button.setAttribute("aria-pressed", String(button.dataset.color === draft.color));
        for (const button of el("icons").children) button.setAttribute("aria-pressed", String(button.dataset.icon === draft.icon));
        syncDisabled();
    }
    for (const color of appearanceColors) {
        const button = document.createElement("button"); button.type = "button"; button.className = `logo-color logo-${color}`;
        button.dataset.color = color; button.setAttribute("aria-label", `${color} logo color`); button.title = color;
        bind(button, "click", () => { draft.color = color; update(); }); el("colors").appendChild(button);
    }
    for (const icon of appearanceIcons) {
        const button = document.createElement("button"); button.type = "button"; button.className = "logo-icon-choice"; button.dataset.icon = icon;
        const label = icon.replace(/-fill$/, "").replaceAll("-", " "); button.setAttribute("aria-label", label); button.title = label;
        const symbol = document.createElement("span"); symbol.className = "group-symbol"; symbol.setAttribute("data-symbol", icon); symbol.setAttribute("aria-hidden", "true"); button.appendChild(symbol);
        bind(button, "click", () => { draft.icon = icon; update(); }); el("icons").appendChild(button);
    }
    bind(el("kind"), "change", () => { el("error").textContent = ""; update(); });
    bind(el("text"), "input", () => { customText = true; update(); });
    bind(el("file"), "change", async () => {
        const file = el("file").files[0]; if (!file) return;
        const version = ++uploadVersion; busy = true; onBusy(true); el("error").textContent = "Preparing image…";
        for (const control of controls()) control.disabled = true;
        try { const result = await prepareLogo(file); if (!disposed && version === uploadVersion) { image = result; update(); el("error").textContent = "Image ready. It will be saved with your group."; } }
        catch (error) { if (!disposed && version === uploadVersion) el("error").textContent = error.message || "Could not read this image."; }
        finally { if (!disposed && version === uploadVersion) { busy = false; onBusy(false); syncDisabled(); el("file").value = ""; } }
    });
    function reset(appearance) {
        uploadVersion++; busy = false; disabled = false; onBusy(false); customText = Boolean(appearance);
        try { draft = validateAppearance(appearance); } catch { draft = { kind: "initials", color: "blue", text: logoInitials(getName()) }; }
        image = draft.image || ""; el("kind").value = draft.kind; el("text").value = draft.text || logoInitials(getName()); el("file").value = ""; el("error").textContent = "";
        for (const control of controls()) control.disabled = false; update();
    }
    reset();
    return {
        reset,
        value() { if (busy) throw Error("Wait for the image to finish preparing."); return validateAppearance(draft); },
        updateName() { if (!customText) el("text").value = logoInitials(getName()); update(); },
        setDisabled(value) { disabled = value; syncDisabled(); },
        dispose() { disposed = true; uploadVersion++; events.abort(); }
    };
}
