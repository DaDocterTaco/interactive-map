import * as groups from "./groups.js";

// The sidebar owns discovery, joining and preferences; chat.js owns messages.
export function mountGroups({ user, onSelect, onGroupUpdated }) {
    const el = id => document.getElementById(id);
    const events = new AbortController();
    const listen = (id, event, handler) => el(id).addEventListener(event, handler, { signal: events.signal });
    let all = [], pins = new Set(), selected = null, joining = null;
    let disposed = false, selecting = false, creating = false, passwordBusy = false;
    let joinStops = [];
    const status = text => { el("groups-status").textContent = text; };
    const fail = error => error.code === "permission-denied"
        ? "Access was denied. The group may have closed. Try reopening chat."
        : error.message || "Could not connect to Firebase. Try again.";
    const stopJoining = () => { joinStops.forEach(stop => stop()); joinStops = []; joining = null; el("join-group-password").value = ""; };

    function select(group) {
        if (disposed) return;
        selected = group;
        render();
        onSelect(group);
    }
    function render() {
        // Search filters only currently open groups. Pins affect placement,
        // while Campus Chat is a fixed choice outside this dynamic list.
        const search = el("chat-search").value.trim().toLowerCase();
        el("campus-chat-choice").setAttribute("aria-current", String(!selected));
        el("pinned-groups").replaceChildren();
        el("other-groups").replaceChildren();
        const visible = all.filter(group => !groups.isClosed(group) && group.name.toLowerCase().includes(search))
            .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
        el("groups-empty").textContent = visible.length ? "" : search ? "No matching groups." : "No open groups yet.";
        for (const group of visible) {
            const row = document.createElement("div");
            row.className = "group-row" + (group.visibility === "private" ? " private" : "");
            const button = document.createElement("button");
            button.type = "button";
            button.className = "chat-choice" + (group.visibility === "private" ? " private-chat" : "");
            button.setAttribute("aria-current", String(selected?.id === group.id));
            const title = document.createElement("strong");
            title.textContent = group.name;
            const detail = document.createElement("span");
            detail.textContent = `${group.visibility === "private" ? "Private" : "Public"} · ${group.idleHours}h idle limit`;
            button.append(title, detail);
            button.addEventListener("click", () => openGroup(group));
            const pin = document.createElement("button");
            pin.type = "button";
            pin.className = "pin-button";
            pin.textContent = pins.has(group.id) ? "★" : "☆";
            pin.setAttribute("aria-pressed", String(pins.has(group.id)));
            pin.setAttribute("aria-label", `${pins.has(group.id) ? "Unpin" : "Pin"} ${group.name}`);
            pin.title = pins.has(group.id) ? "Unpin chat" : "Pin chat";
            pin.addEventListener("click", async () => {
                pin.disabled = true;
                try { await groups.setPinned(user.uid, group.id, !pins.has(group.id)); status(""); }
                catch (error) { status(fail(error)); pin.disabled = false; }
            });
            row.append(button, pin);
            el(pins.has(group.id) ? "pinned-groups" : "other-groups").appendChild(row);
        }
    }
    async function openGroup(group) {
        if (selecting || disposed) return;
        selecting = true;
        status("Opening group...");
        try {
            if (groups.isClosed(group)) throw Error("This group has closed after inactivity.");
            if (await groups.isMember(group.id, user.uid)) { await groups.joinGroup(group, user); select(group); }
            else if (group.visibility === "public") { await groups.joinGroup(group, user); select(group); }
            else if (!disposed) showPassword(group);
            status("");
        } catch (error) { status(fail(error)); }
        finally { selecting = false; }
    }
    function showPassword(group) {
        // Watch both the request and membership because a member can approve
        // access while this visitor still has the password dialog open.
        stopJoining();
        joining = group;
        el("join-group-title").textContent = `Join ${group.name}`;
        el("join-group-status").textContent = "";
        el("request-group-access").disabled = false;
        el("join-group-panel").showModal();
        el("join-group-password").focus();
        joinStops.push(groups.watchMyRequest(group.id, user.uid, request => {
            if (joining?.id !== group.id) return;
            el("request-group-access").disabled = request?.status === "pending" || request?.status === "accepted";
            el("join-group-status").textContent = request?.status === "pending" ? "Request sent. Waiting for a member to accept or deny."
                : request?.status === "denied" ? "Your request was denied. You can try a password or request again."
                : request?.status === "accepted" ? "Request accepted. Opening chat..." : "";
        }, error => { el("join-group-status").textContent = fail(error); }));
        joinStops.push(groups.watchMembership(group.id, user.uid, exists => {
            if (!exists || joining?.id !== group.id) return;
            // Membership can arrive through either the password or an approval.
            stopJoining();
            el("join-group-panel").close();
            select(all.find(item => item.id === group.id) || group);
        }, error => { el("join-group-status").textContent = fail(error); }));
    }

    listen("campus-chat-choice", "click", () => select(null));
    listen("chat-search", "input", render);
    listen("cancel-join-group", "click", () => el("join-group-panel").close());
    listen("join-group-panel", "close", stopJoining);
    listen("join-group-form", "submit", async event => {
        event.preventDefault();
        if (!joining || passwordBusy) return;
        const group = joining;
        passwordBusy = true;
        el("join-group-submit").disabled = true;
        el("join-group-status").textContent = "Checking password...";
        try {
            await groups.joinGroup(group, user, el("join-group-password").value);
            if (joining?.id === group.id) { stopJoining(); el("join-group-panel").close(); select(group); }
        } catch (error) {
            if (joining?.id === group.id) el("join-group-status").textContent = error.code === "permission-denied"
                ? "Incorrect password, or this group has closed. You can also request access." : fail(error);
        } finally { passwordBusy = false; el("join-group-submit").disabled = false; }
    });
    listen("request-group-access", "click", async () => {
        if (!joining) return;
        const group = joining;
        el("request-group-access").disabled = true;
        el("join-group-status").textContent = "Sending request...";
        try { await groups.requestAccess(group, user); }
        catch (error) {
            if (joining?.id === group.id) { el("join-group-status").textContent = fail(error); el("request-group-access").disabled = false; }
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
        el("create-group-error").textContent = "";
        el("create-group-panel").showModal(); el("group-name").focus();
    });
    listen("group-visibility", "change", passwordField);
    listen("cancel-create-group", "click", () => el("create-group-panel").close());
    listen("create-group-panel", "close", () => { el("group-password").value = ""; });
    listen("create-group-panel", "cancel", event => { if (creating) event.preventDefault(); });
    listen("create-group-form", "submit", async event => {
        event.preventDefault();
        if (creating) return;
        creating = true;
        el("create-group-submit").disabled = true;
        el("cancel-create-group").disabled = true;
        el("create-group-error").textContent = "Creating group...";
        try {
            const group = await groups.createGroup(user, {
                name: el("group-name").value, visibility: el("group-visibility").value,
                password: el("group-password").value, idleHours: el("group-idle-hours").value
            });
            if (!all.some(item => item.id === group.id)) all.push(group);
            el("create-group-panel").close(); select(group);
        } catch (error) { el("create-group-error").textContent = fail(error); }
        finally { creating = false; el("create-group-submit").disabled = false; el("cancel-create-group").disabled = false; }
    });
    listen("group-settings", "click", () => {
        if (!selected || selected.creatorId !== user.uid || groups.isClosed(selected)) return;
        el("settings-idle-hours").value = selected.idleHours;
        el("group-settings-error").textContent = "";
        el("group-settings-panel").showModal();
    });
    listen("cancel-group-settings", "click", () => el("group-settings-panel").close());
    listen("group-settings-form", "submit", async event => {
        event.preventDefault();
        if (!selected) return;
        el("save-group-settings").disabled = true;
        try { await groups.changeIdleHours(selected.id, el("settings-idle-hours").value); el("group-settings-panel").close(); }
        catch (error) { el("group-settings-error").textContent = fail(error); }
        finally { el("save-group-settings").disabled = false; }
    });

    function refresh() {
        // Firestore does not send a snapshot at the exact inactivity deadline.
        if (selected && selected.visibility !== "direct") {
            selected = all.find(group => group.id === selected.id) || selected;
            onGroupUpdated(selected);
        }
        if (joining && groups.isClosed(all.find(group => group.id === joining.id) || joining)) {
            el("join-group-panel").close(); status("That group has closed after inactivity.");
        }
        render();
    }
    const stops = [
        groups.watchGroups(data => { all = data; refresh(); }, error => { status(fail(error)); el("groups-empty").textContent = "Groups unavailable."; }),
        groups.watchPins(user.uid, data => { pins = data; render(); }, error => status(fail(error)))
    ];
    const timer = setInterval(refresh, 30000);
    el("new-chat").disabled = false;
    return {
        selectExternal: select,
        dispose() {
            disposed = true; events.abort(); stops.forEach(stop => stop()); stopJoining(); clearInterval(timer);
            for (const id of ["create-group-panel", "join-group-panel", "group-settings-panel"]) if (el(id).open) el(id).close();
            el("new-chat").disabled = true;
        }
    };
}
