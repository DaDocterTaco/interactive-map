import '../CampusUI/mobileInput.js';
import * as people from "./people.js";
import { renderAppearance, logoInitials } from "./groupAppearance.js";

// Chat info is a navigation layer. Existing member, logo, and deletion
// controllers retain their own actions and permission checks.
export function mountChatInfo({ user }) {
    const el = id => document.getElementById(id);
    const panel = el("chat-info-panel"), events = new AbortController();
    const listen = (id, event, callback, capture = false) => el(id)?.addEventListener(event, callback, { signal: events.signal, capture });
    let current = null, disposed = false, generation = 0, memberVersion = 0;
    let stopMembers, watchedId = null, ownerId = null, origin = null, restoreFocus = true;
    let page = "overview", childOrigin = null;
    const isGroup = () => Boolean(current && current.visibility !== "direct" && !current.deletedAt);
    const isOwner = () => isGroup() && current.creatorId === user.uid;
    const key = group => group?.id || "Campus Chat";

    function stopWatching() {
        generation++; memberVersion++;
        stopMembers?.(); stopMembers = null; watchedId = null; ownerId = null;
    }
    function setPage(next, moveFocus = true) {
        page = next === "settings" && isGroup() ? "settings" : "overview";
        el("chat-info-overview").hidden = page !== "overview";
        el("chat-info-settings-page").hidden = page !== "settings";
        el("chat-info-back").hidden = page !== "settings";
        el("chat-info-title").textContent = page === "settings" ? "Chat settings" : current?.visibility === "direct" ? "Contact info" : current ? "Group info" : "Campus Chat";
        if (moveFocus) el(page === "settings" ? "chat-info-back" : "chat-info-settings").focus();
    }
    function render() {
        const group = isGroup(), owner = isOwner(), direct = current?.visibility === "direct";
        const name = current?.name || "Campus Chat";
        const avatar = el("chat-info-avatar");
        if (current) renderAppearance(avatar, current);
        else {
            avatar.replaceChildren(); avatar.className = "avatar campus-avatar";
            const icon = document.createElement("span"); icon.className = "icon icon-people"; avatar.appendChild(icon);
        }
        el("chat-info-name").textContent = name;
        el("chat-info-description").textContent = direct ? "Direct message" : group ? current.visibility === "private" ? "Private group" : "Public group" : "Everyone on campus";
        el("show-members").hidden = !group;
        el("chat-info-settings").hidden = !group;
        el("chat-info-settings-hint").textContent = owner ? "Details, appearance, and deletion" : "Access and group details";
        for (const id of ["customize-group", "group-settings"]) { el(id).hidden = !owner; el(id).disabled = !owner; }
        el("chat-info-owner-note").hidden = !group || owner;
        el("chat-info-access").textContent = current?.visibility === "private" ? "Password or member approval" : "Anyone can join";
        let created;
        try { created = current?.createdAt?.toDate?.(); } catch { /* A pending timestamp has no date yet. */ }
        el("chat-info-created-row").hidden = !(created instanceof Date && Number.isFinite(created.getTime()));
        el("chat-info-created").textContent = el("chat-info-created-row").hidden ? "" : created.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
        el("open-chat-info")?.setAttribute("aria-label", `${name} information`);
        el("open-chat-info")?.setAttribute("aria-haspopup", "dialog");
        setPage(page, false);
    }
    async function loadOwner() {
        const id = current?.creatorId;
        if (!isGroup() || !id || ownerId === id) return;
        ownerId = id;
        if (id === user.uid) { el("chat-info-owner").textContent = `${user.displayName || "You"} (you)`; return; }
        const version = generation;
        el("chat-info-owner").textContent = "Loading…";
        try {
            const profile = await people.getProfile(id);
            if (!disposed && panel.open && version === generation && current?.creatorId === id) el("chat-info-owner").textContent = profile.displayName;
        } catch {
            if (!disposed && panel.open && version === generation && current?.creatorId === id) el("chat-info-owner").textContent = `User ${id.slice(-6)}`;
        }
    }
    function watchDetails() {
        if (!panel.open || !isGroup() || disposed) return;
        loadOwner();
        const id = current.id;
        if (watchedId === id) return;
        watchedId = id;
        el("chat-info-member-count").textContent = "Loading members…";
        el("chat-info-member-preview").replaceChildren();
        const version = generation;
        stopMembers = people.watchMembers(id, async memberIds => {
            if (disposed || !panel.open || version !== generation || current?.id !== id) return;
            const members = [...new Set(memberIds)], revision = ++memberVersion;
            el("chat-info-member-count").textContent = `${members.length} member${members.length === 1 ? "" : "s"}`;
            el("chat-info-status").textContent = "";
            el("chat-info-member-preview").replaceChildren();
            // Only the visible preview needs profiles. Opening Members loads the full list.
            const previews = await Promise.all(members.slice(0, 3).map(async uid => {
                try { return uid === user.uid ? user : await people.getProfile(uid); }
                catch { return { uid, displayName: `User ${uid.slice(-6)}` }; }
            }));
            if (disposed || !panel.open || version !== generation || revision !== memberVersion || current?.id !== id) return;
            for (const person of previews) {
                const avatar = document.createElement("span"); avatar.className = "avatar";
                avatar.textContent = logoInitials(person.displayName); avatar.title = person.displayName;
                el("chat-info-member-preview").appendChild(avatar);
            }
        }, () => {
            if (disposed || !panel.open || version !== generation || current?.id !== id) return;
            memberVersion++; el("chat-info-member-count").textContent = "View members";
            el("chat-info-member-preview").replaceChildren();
            el("chat-info-status").textContent = "Member preview unavailable. Open Members to try again.";
        });
    }
    function open(event) {
        if (disposed || current?.deletedAt) return;
        origin = event?.currentTarget || el("open-chat-info");
        restoreFocus = true;
        page = "overview"; render();
        el("chat-info-status").textContent = "";
        if (el("chat-options")) el("chat-options").hidden = true;
        el("chat-more")?.setAttribute("aria-expanded", "false");
        if (!panel.open) window.CampusInput.showModal(panel);
        el("close-chat-info").focus();
        watchDetails();
    }
    listen("open-chat-info", "click", open);
    listen("chat-info-menu", "click", open);
    listen("close-chat-info", "click", () => panel.close());
    listen("chat-info-settings", "click", () => { if (isGroup()) setPage("settings"); });
    listen("chat-info-back", "click", () => setPage("overview"));
    listen("chat-info-panel", "close", () => {
        stopWatching(); childOrigin = null;
        if (!disposed && restoreFocus) (origin?.id === "chat-info-menu" ? el("open-chat-info") : origin)?.focus();
    });
    for (const [trigger, child] of [["show-members", "members-panel"], ["customize-group", "appearance-panel"], ["group-settings", "group-settings-panel"]]) {
        listen(trigger, "click", event => {
            if (!panel.open || !isGroup() || (trigger !== "show-members" && !isOwner())) {
                event.preventDefault(); event.stopImmediatePropagation(); return;
            }
            childOrigin = { trigger, child, id: current.id };
        }, true);
        listen(child, "close", () => {
            if (panel.open && childOrigin?.child === child && childOrigin.id === current?.id) {
                const target = el(childOrigin.trigger);
                if (!target.hidden && !target.disabled) target.focus();
                childOrigin = null;
            }
        });
    }
    function setConversation(group) {
        if (disposed) return;
        const changed = key(current) !== key(group) || Boolean(group?.deletedAt);
        if (changed) {
            restoreFocus = false;
            if (panel.open) panel.close(); else stopWatching();
            page = "overview";
        }
        current = group;
        render(); watchDetails();
    }
    render();
    return {
        setConversation,
        refresh(group = current) { setConversation(group); },
        dispose() {
            disposed = true; stopWatching(); events.abort();
            if (panel.open) panel.close();
        }
    };
}
