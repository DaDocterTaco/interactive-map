import '../CampusUI/mobileInput.js';
import * as groups from "./groups.js";
import { renderAppearance } from "./groupAppearance.js";
import { mountAppearanceEditor } from "./appearanceUI.js";

function groupAvatar(group) {
    const avatar = document.createElement("span");
    renderAppearance(avatar, group);
    return avatar;
}

// The sidebar owns discovery, joining and preferences; chat.js owns messages.
export function mountGroups({ user, onSelect, onGroupUpdated, onExplore = () => {} }) {
    const el = id => document.getElementById(id);
    const events = new AbortController();
    const listen = (id, event, handler) => el(id).addEventListener(event, handler, { signal: events.signal });
    let all = [], pins = new Set(), selected = null, joining = null;
    let disposed = false, selecting = false, creating = false, passwordBusy = false, deleting = false;
    let selectionVersion = 0, joinVersion = 0, openingId = null, deleteTarget = null;
    let appearanceTarget = null, savingAppearance = false;
    let exploring = false, groupsLoaded = false, groupsError = null, stopGroups = () => {}, groupsVersion = 0;
    const memberships = new Map();
    const deletedIds = new Set();
    let joinStops = [];
    const status = text => { if (!disposed) el("groups-status").textContent = text; };
    const fail = error => error.code === "permission-denied"
        ? "Access was denied. The group may have been deleted. Try reopening chat."
        : error.message || "Could not connect to Firebase. Try again.";
    const stopJoining = () => { joinVersion++; joinStops.forEach(stop => stop()); joinStops = []; joining = null; el("join-group-password").value = ""; };
    const available = group => group && !deletedIds.has(group.id) && !groups.isClosed(group);
    const current = id => all.find(group => group.id === id && available(group));
    const canCustomize = group => available(group) && group.creatorId === user.uid
        && ["public", "private"].includes(group.visibility) && group.id !== "Campus Chat" && !group.id.startsWith("dm:");
    const createAppearance = mountAppearanceEditor("create-logo", {
        getName: () => el("group-name").value,
        onBusy: busy => { el("create-group-submit").disabled = creating || busy; }
    });
    const editAppearance = mountAppearanceEditor("edit-logo", {
        getName: () => appearanceTarget?.name || "Group",
        onBusy: busy => { el("appearance-save").disabled = savingAppearance || busy; }
    });

    function select(group) {
        if (disposed) return;
        selectionVersion++;
        selected = group;
        closeExplore();
        el("chat-panel").setAttribute("data-mobile-view", "conversation");
        render();
        onSelect(group);
    }
    function render() {
        if (disposed) return;
        // Discovery is separate from the user's confirmed memberships. A pin
        // never grants access or makes an unjoined group appear in this list.
        const search = el("chat-search").value.trim().toLowerCase();
        el("campus-chat-choice").setAttribute("aria-current", String(!selected));
        el("pinned-groups").replaceChildren();
        el("other-groups").replaceChildren();
        const visible = all.filter(group => available(group) && memberships.get(group.id)?.state === "joined" && group.name.toLowerCase().includes(search))
            .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
        const states = [...memberships.values()];
        el("groups-empty").textContent = visible.length ? "" : groupsError ? "Groups unavailable. Retry in Explore."
            : !groupsLoaded || states.some(item => item.state === "checking") ? "Loading your groups…"
            : states.some(item => item.state === "error") ? "Some groups could not load. Retry in Explore."
            : search ? "No matching groups." : "Find your next group in Explore.";
        for (const group of visible) {
            const row = document.createElement("div");
            row.className = "group-row" + (group.visibility === "private" ? " private" : "");
            const button = document.createElement("button");
            button.type = "button";
            button.className = "chat-choice" + (group.visibility === "private" ? " private-chat" : "");
            button.setAttribute("aria-current", String(selected?.id === group.id));
            button.title = group.name;
            const copy = document.createElement("span");
            copy.className = "chat-choice-copy";
            const title = document.createElement("strong");
            title.textContent = group.name;
            const detail = document.createElement("span");
            detail.textContent = group.visibility === "private" ? "Private" : "Public";
            copy.append(title, detail);
            button.append(groupAvatar(group), copy);
            button.addEventListener("click", () => openGroup(group, button));
            const pin = document.createElement("button");
            pin.type = "button";
            pin.className = "pin-button";
            const pinIcon = document.createElement("span");
            pinIcon.className = pins.has(group.id) ? "icon icon-pin-fill" : "icon icon-pin";
            pinIcon.setAttribute("aria-hidden", "true");
            pin.appendChild(pinIcon);
            pin.setAttribute("aria-pressed", String(pins.has(group.id)));
            pin.setAttribute("aria-label", `${pins.has(group.id) ? "Unpin" : "Pin"} ${group.name}`);
            pin.title = pins.has(group.id) ? "Unpin chat" : "Pin chat";
            pin.addEventListener("click", async () => {
                pin.disabled = true;
                pin.setAttribute("aria-busy", "true");
                try { await groups.setPinned(user.uid, group.id, !pins.has(group.id)); status(""); }
                catch (error) { status(fail(error)); pin.disabled = false; }
                finally { pin.setAttribute("aria-busy", "false"); }
            });
            row.append(button, pin);
            el(pins.has(group.id) ? "pinned-groups" : "other-groups").appendChild(row);
        }
        el("pinned-heading").hidden = !el("pinned-groups").children.length;
        el("other-heading").hidden = !el("other-groups").children.length;
        renderExplore();
    }

    function closeExplore({ focus = false } = {}) {
        if (!exploring) return;
        // Closing discovery is navigation: a slow join may still finish on the
        // server, but must not drag the user back into that conversation.
        selectionVersion++;
        exploring = false;
        el("explore-groups").setAttribute("aria-expanded", "false");
        onExplore(false);
        if (focus) el("explore-groups").focus();
    }
    function restoreExploreFocus(groupId) {
        if (!exploring || disposed || !groupId || ["join-group-panel", "create-group-panel", "appearance-panel", "group-settings-panel"].some(id => el(id).open)) return;
        // Re-rendering an action's loading state detaches its old focus target.
        // Restore that target only if the user has not focused another control.
        const active = document.activeElement;
        if (active && active !== document.body && !el("explore-results").contains(active)) return;
        const action = [...el("explore-results").querySelectorAll("button[data-explore-group]")]
            .find(button => button.getAttribute("data-explore-group") === groupId);
        if (action && !action.disabled) action.focus({ preventScroll: true });
    }
    function renderExplore() {
        if (disposed) return;
        const search = el("explore-search").value.trim().toLowerCase();
        const filter = el("explore-filter").value || "all";
        const visible = all.filter(group => available(group) && group.name.toLowerCase().includes(search)
            && (filter === "all" || group.visibility === filter))
            .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
        const failed = groupsError || [...memberships.values()].some(item => item.state === "error");
        el("explore-retry").hidden = !failed;
        el("explore-empty").hidden = !!visible.length;
        el("explore-empty").textContent = groupsError ? "We couldn’t load groups. Try again."
            : !groupsLoaded ? "Loading groups…"
            : search || filter !== "all" ? "No groups match. Try another search or filter."
            : "No groups yet. Create one with New chat.";
        const fragment = document.createDocumentFragment();
        for (const group of visible) {
            const membership = memberships.get(group.id)?.state || "checking";
            const card = document.createElement("article");
            card.className = "explore-card" + (group.visibility === "private" ? " explore-card-private" : "");
            const heading = document.createElement("div"); heading.className = "explore-card-heading";
            const name = document.createElement("h3"); name.textContent = group.name;
            heading.append(groupAvatar(group), name);
            const detail = document.createElement("p"); detail.className = "explore-card-detail";
            detail.textContent = group.visibility === "private" ? "Private · Password or approval" : "Public · Open to everyone";
            const footer = document.createElement("div"); footer.className = "explore-card-footer";
            const state = document.createElement("span"); state.className = "explore-card-state";
            state.textContent = membership === "joined" ? "Joined" : membership === "error" ? "Couldn’t check access" : "";
            const action = document.createElement("button"); action.type = "button"; action.className = "explore-card-action";
            action.textContent = openingId === group.id ? "Opening…" : membership === "joined" ? "Open chat"
                : membership === "error" ? "Retry" : membership === "checking" ? "Checking…"
                : group.visibility === "private" ? "Request to join" : "Join group";
            action.disabled = membership === "checking" || selecting;
            action.setAttribute("aria-label", `${action.textContent} ${group.name}`);
            action.setAttribute("data-explore-group", group.id);
            action.setAttribute("aria-busy", String(openingId === group.id || membership === "checking"));
            action.addEventListener("click", () => membership === "error" ? retryMembership(group) : openGroup(group, action));
            footer.append(state, action); card.append(heading, detail, footer); fragment.appendChild(card);
        }
        const focusedGroup = document.activeElement?.getAttribute("data-explore-group");
        el("explore-results").replaceChildren(fragment);
        if (exploring && focusedGroup) {
            const replacement = [...el("explore-results").querySelectorAll("button[data-explore-group]")]
                .find(button => button.getAttribute("data-explore-group") === focusedGroup);
            if (replacement && !replacement.disabled) replacement.focus({ preventScroll: true });
        }
    }
    function updateMembership(groupId, entry, exists) {
        if (disposed || memberships.get(groupId) !== entry || !current(groupId)) return;
        entry.state = exists ? "joined" : "available";
        entry.error = null;
        if (exists && joining?.id === groupId) {
            const group = current(groupId);
            stopJoining(); el("join-group-panel").close(); select(group);
        } else if (!exists && selected?.id === groupId) {
            select(null); status("You no longer have access to that group.");
        }
        render();
        if (entry.returnFocus) { restoreExploreFocus(groupId); entry.returnFocus = false; }
    }
    function watchMembership(group, returnFocus = false) {
        const entry = { state: "checking", error: null, stop: () => {}, returnFocus };
        memberships.set(group.id, entry);
        entry.stop = groups.watchMembership(group.id, user.uid, exists => updateMembership(group.id, entry, exists), error => {
            if (disposed || memberships.get(group.id) !== entry || !current(group.id)) return;
            entry.state = "error"; entry.error = error;
            el("explore-status").textContent = "Some group memberships couldn’t be checked. Try again."; render();
            if (entry.returnFocus) { restoreExploreFocus(group.id); entry.returnFocus = false; }
            if (joining?.id === group.id) el("join-group-status").textContent = fail(error);
        });
    }
    function retryMembership(group) {
        const returnFocus = document.activeElement?.getAttribute("data-explore-group") === group.id;
        memberships.get(group.id)?.stop();
        watchMembership(group, returnFocus); render();
    }
    function reconcileMemberships() {
        for (const [id, entry] of memberships) if (!current(id)) { entry.stop(); memberships.delete(id); }
        for (const group of all) if (available(group) && !memberships.has(group.id)) watchMembership(group);
    }
    function confirmedJoin(group) {
        if (!memberships.has(group.id)) watchMembership(group);
        updateMembership(group.id, memberships.get(group.id), true);
    }
    listen("explore-groups", "click", () => {
        if (disposed) return;
        exploring = true; selectionVersion++;
        el("explore-groups").setAttribute("aria-expanded", "true");
        el("explore-status").textContent = "";
        el("chat-panel").setAttribute("data-mobile-view", "conversation");
        renderExplore(); onExplore(true); window.CampusInput.focus(el("explore-search"));
    });
    listen("close-explore", "click", () => closeExplore({ focus: true }));
    listen("explore-search", "input", renderExplore);
    listen("explore-filter", "change", renderExplore);
    listen("explore-retry", "click", () => {
        el("explore-status").textContent = "";
        if (groupsError) startGroups();
        for (const group of all) if (available(group) && memberships.get(group.id)?.state === "error") retryMembership(group);
    });
    async function openGroup(group, button) {
        if (selecting || disposed) return;
        selecting = true;
        openingId = group.id;
        const returnFocus = document.activeElement === button;
        const version = ++selectionVersion;
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
        status(""); el("explore-status").textContent = ""; renderExplore();
        try {
            if (!current(group.id)) throw Error("This group has been deleted.");
            const member = await groups.isMember(group.id, user.uid);
            if (disposed || version !== selectionVersion) return;
            const latest = current(group.id);
            if (!latest) throw Error("This group has been deleted.");
            if (member || latest.visibility === "public") {
                await groups.joinGroup(latest, user);
                if (disposed || version !== selectionVersion) return;
                const joined = current(group.id);
                if (!joined) throw Error("This group has been deleted.");
                confirmedJoin(joined);
                select(joined);
            } else showPassword(latest);
            status("");
        } catch (error) { if (version === selectionVersion) { status(fail(error)); el("explore-status").textContent = fail(error); } }
        finally {
            selecting = false;
            if (openingId === group.id) openingId = null;
            button.disabled = false;
            button.setAttribute("aria-busy", "false");
            renderExplore();
            if (returnFocus) restoreExploreFocus(group.id);
        }
    }
    function showPassword(group) {
        // The shared membership listener handles approvals even after this
        // dialog closes. This scoped listener only observes request status.
        stopJoining();
        joining = group;
        const version = joinVersion;
        el("join-group-title").textContent = `Join ${group.name}`;
        el("join-group-status").textContent = "";
        el("request-group-access").disabled = false;
        window.CampusInput.showModal(el("join-group-panel"));
        window.CampusInput.focus(el("join-group-password"));
        joinStops.push(groups.watchMyRequest(group.id, user.uid, request => {
            if (disposed || version !== joinVersion || joining?.id !== group.id) return;
            el("request-group-access").disabled = request?.status === "pending" || request?.status === "accepted";
            el("join-group-status").textContent = request?.status === "pending" ? "Request sent. Waiting for a member to accept or deny."
                : request?.status === "denied" ? "Your request was denied. You can try a password or request again."
                : request?.status === "accepted" ? "Request accepted. Opening chat..." : "";
        }, error => { if (!disposed && version === joinVersion) el("join-group-status").textContent = fail(error); }));
    }

    listen("campus-chat-choice", "click", () => select(null));
    listen("chat-search", "input", render);
    listen("cancel-join-group", "click", () => el("join-group-panel").close());
    listen("join-group-panel", "close", () => {
        const returnId = joining?.id;
        stopJoining(); restoreExploreFocus(returnId);
    });
    listen("join-group-form", "submit", async event => {
        event.preventDefault();
        if (!joining || passwordBusy) return;
        const group = joining, version = joinVersion;
        passwordBusy = true;
        el("join-group-submit").disabled = true;
        el("join-group-status").textContent = "Checking password...";
        try {
            await groups.joinGroup(group, user, el("join-group-password").value);
            if (!disposed && version === joinVersion && joining?.id === group.id) {
                const latest = current(group.id);
                stopJoining(); el("join-group-panel").close();
                if (latest) { confirmedJoin(latest); select(latest); } else status("That group was deleted. Choose another chat.");
            }
        } catch (error) {
            if (!disposed && version === joinVersion && joining?.id === group.id) el("join-group-status").textContent = error.code === "permission-denied"
                ? "Incorrect password, or this group was deleted. You can also request access." : fail(error);
        } finally { passwordBusy = false; if (!disposed) el("join-group-submit").disabled = false; }
    });
    listen("request-group-access", "click", async () => {
        if (!joining) return;
        const group = joining, version = joinVersion;
        el("request-group-access").disabled = true;
        el("join-group-status").textContent = "Sending request...";
        try { await groups.requestAccess(group, user); }
        catch (error) {
            if (!disposed && version === joinVersion && joining?.id === group.id) { el("join-group-status").textContent = fail(error); el("request-group-access").disabled = false; }
        }
    });

    function passwordField() {
        const privateGroup = el("group-visibility").value === "private";
        el("create-password-field").hidden = !privateGroup;
        el("group-password").required = privateGroup;
        if (!privateGroup) el("group-password").value = "";
    }
    listen("new-chat", "click", () => {
        el("create-group-form").reset(); passwordField();
        createAppearance.reset();
        el("create-group-error").textContent = "";
        window.CampusInput.showModal(el("create-group-panel")); window.CampusInput.focus(el("group-name"));
    });
    listen("group-visibility", "change", passwordField);
    listen("group-name", "input", () => createAppearance.updateName());
    listen("cancel-create-group", "click", () => el("create-group-panel").close());
    listen("create-group-panel", "close", () => { el("group-password").value = ""; createAppearance.reset(); });
    listen("create-group-panel", "cancel", event => { if (creating) event.preventDefault(); });
    listen("create-group-form", "submit", async event => {
        event.preventDefault();
        if (creating) return;
        creating = true;
        el("create-group-submit").disabled = true;
        el("cancel-create-group").disabled = true;
        el("create-group-error").textContent = "Creating group...";
        createAppearance.setDisabled(true);
        try {
            const group = await groups.createGroup(user, {
                name: el("group-name").value, visibility: el("group-visibility").value,
                password: el("group-password").value, appearance: createAppearance.value()
            });
            if (disposed) return;
            if (!available(group) || all.some(item => item.id === group.id && !available(item))) throw Error("This group has been deleted.");
            if (!all.some(item => item.id === group.id)) all.push(group);
            confirmedJoin(group);
            el("create-group-panel").close(); select(group);
        } catch (error) { if (!disposed) el("create-group-error").textContent = fail(error); }
        finally { creating = false; if (!disposed) { createAppearance.setDisabled(false); el("create-group-submit").disabled = false; el("cancel-create-group").disabled = false; } }
    });

    listen("customize-group", "click", () => {
        if (disposed || savingAppearance || !selected) return;
        const group = current(selected.id);
        if (!canCustomize(group)) return;
        appearanceTarget = group;
        editAppearance.reset(group.appearance);
        el("appearance-group-name").textContent = group.name;
        el("appearance-error").textContent = "";
        window.CampusInput.showModal(el("appearance-panel"));
        el("edit-logo-kind").focus();
    });
    listen("appearance-cancel", "click", () => { if (!savingAppearance) el("appearance-panel").close(); });
    listen("appearance-panel", "cancel", event => { if (savingAppearance) event.preventDefault(); });
    listen("appearance-panel", "close", () => { appearanceTarget = null; editAppearance.reset(); });
    listen("appearance-form", "submit", async event => {
        event.preventDefault();
        if (disposed || savingAppearance || !appearanceTarget || !el("appearance-panel").open) return;
        const group = current(appearanceTarget.id);
        if (!canCustomize(group)) { el("appearance-error").textContent = "Only the owner of an existing group can change its logo."; return; }
        let appearance;
        try { appearance = editAppearance.value(); }
        catch (error) { el("appearance-error").textContent = error.message; return; }
        savingAppearance = true; editAppearance.setDisabled(true);
        el("appearance-save").disabled = true; el("appearance-cancel").disabled = true;
        el("appearance-save").textContent = "Saving…"; el("appearance-form").setAttribute("aria-busy", "true");
        el("appearance-error").textContent = "";
        try {
            await groups.saveGroupAppearance(group.id, user, appearance);
            if (disposed || appearanceTarget?.id !== group.id || !canCustomize(current(group.id))) return;
            all = all.map(item => item.id === group.id ? { ...item, appearance } : item);
            refresh(); el("appearance-panel").close(); status("Group logo updated.");
        } catch (error) {
            if (!disposed && appearanceTarget?.id === group.id) el("appearance-error").textContent = `Logo not saved. ${fail(error)}`;
        } finally {
            savingAppearance = false;
            if (!disposed) {
                editAppearance.setDisabled(false); el("appearance-save").disabled = false; el("appearance-cancel").disabled = false;
                el("appearance-save").textContent = "Save logo"; el("appearance-form").setAttribute("aria-busy", "false");
            }
        }
    });
    listen("group-settings", "click", () => {
        if (disposed || deleting || !selected || selected.visibility === "direct") return;
        const group = current(selected.id);
        if (!group || group.creatorId !== user.uid) return;
        deleteTarget = group;
        el("group-delete-name").textContent = group.name;
        el("group-settings-error").textContent = "";
        window.CampusInput.showModal(el("group-settings-panel"));
        el("cancel-group-settings").focus();
    });
    listen("cancel-group-settings", "click", () => { if (!deleting) el("group-settings-panel").close(); });
    listen("group-settings-panel", "cancel", event => { if (deleting) event.preventDefault(); });
    listen("group-settings-panel", "close", () => { deleteTarget = null; });
    listen("group-settings-form", "submit", async event => {
        event.preventDefault();
        if (disposed || deleting || !deleteTarget || !el("group-settings-panel").open) return;
        const group = current(deleteTarget.id);
        if (!group || group.visibility === "direct" || group.creatorId !== user.uid) {
            el("group-settings-error").textContent = "Only the owner of an existing group can delete it.";
            return;
        }
        deleting = true;
        el("save-group-settings").disabled = true;
        el("cancel-group-settings").disabled = true;
        el("save-group-settings").textContent = "Deleting…";
        el("group-settings-form").setAttribute("aria-busy", "true");
        el("group-settings-error").textContent = "Deleting group…";
        try {
            await groups.deleteGroup(group.id, user);
            if (disposed) return;
            deletedIds.add(group.id);
            all = all.filter(item => item.id !== group.id);
            reconcileMemberships();
            if (selected?.id === group.id) select(null);
            if (deleteTarget?.id === group.id) el("group-settings-panel").close();
            render();
            status(`${group.name} was deleted.${selected ? "" : " You’re back in Campus Chat."}`);
        } catch (error) {
            if (!disposed && deleteTarget?.id === group.id) el("group-settings-error").textContent = `Group not deleted. ${fail(error)}`;
        } finally {
            deleting = false;
            if (!disposed) {
                el("save-group-settings").disabled = false;
                el("cancel-group-settings").disabled = false;
                el("save-group-settings").textContent = "Delete group";
                el("group-settings-form").setAttribute("aria-busy", "false");
            }
        }
    });

    function refresh() {
        if (disposed) return;
        reconcileMemberships();
        let removedName = "", returnedToCampus = false;
        if (openingId && !current(openingId)) {
            selectionVersion++;
            removedName = all.find(group => group.id === openingId)?.name || "That group";
            openingId = null;
        }
        if (selected && selected.visibility !== "direct") {
            const group = current(selected.id);
            if (group) { selected = group; onGroupUpdated(group); }
            else { removedName = selected.name; returnedToCampus = true; select(null); }
        }
        if (joining && !current(joining.id)) {
            removedName = joining.name;
            el("join-group-panel").close();
        }
        if (appearanceTarget && !canCustomize(current(appearanceTarget.id))) {
            const missing = !current(appearanceTarget.id), name = appearanceTarget.name;
            el("appearance-panel").close();
            if (missing) removedName = name;
            else status("Only the group owner can change this logo.");
        }
        if (deleteTarget && !current(deleteTarget.id)) {
            removedName = deleteTarget.name;
            el("group-settings-panel").close();
        } else if (deleteTarget && current(deleteTarget.id).creatorId !== user.uid) {
            el("group-settings-panel").close();
            status("Only the group owner can delete this group.");
        }
        if (removedName) status(`${removedName} was deleted.${returnedToCampus ? " You’re back in Campus Chat." : " Choose another chat."}`);
        render();
    }
    function startGroups() {
        const version = ++groupsVersion;
        stopGroups(); groupsError = null; groupsLoaded = false;
        stopGroups = groups.watchGroups(data => { if (!disposed && groupsVersion === version) { groupsLoaded = true; groupsError = null; all = data; refresh(); } }, error => {
            if (!disposed && groupsVersion === version) { groupsError = error; el("explore-status").textContent = fail(error); render(); }
        });
        render();
    }
    const stops = [
        groups.watchPins(user.uid, data => { pins = data; render(); }, error => status(fail(error)))
    ];
    startGroups();
    el("new-chat").disabled = false;
    el("explore-groups").disabled = false;
    return {
        selectExternal: select,
        closeExplore,
        isExploring: () => exploring,
        renderAppearance,
        dispose() {
            closeExplore(); disposed = true; selectionVersion++; events.abort(); stopGroups(); stops.forEach(stop => stop()); stopJoining();
            for (const entry of memberships.values()) entry.stop(); memberships.clear();
            createAppearance.dispose(); editAppearance.dispose();
            for (const id of ["create-group-panel", "join-group-panel", "group-settings-panel", "appearance-panel"]) if (el(id).open) el(id).close();
            el("new-chat").disabled = true;
            el("explore-groups").disabled = true;
        }
    };
}
