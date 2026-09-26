import * as people from "./people.js";

// Render people search, saved friends, direct chats, and group member lists.
export function mountPeople({ user, onSelect }) {
    const el = id => document.getElementById(id);
    const events = new AbortController();
    const listen = (id, event, fn) => el(id).addEventListener(event, fn, { signal: events.signal });
    let disposed = false, searchVersion = 0, listVersion = 0, membersVersion = 0;
    let friends = [], directs = [], results = [], current = null, stopMembers, timer;
    let busy = false;
    const profiles = new Map();
    const status = message => { el("people-status").textContent = message; };
    async function profile(uid) {
        if (!profiles.has(uid)) profiles.set(uid, await people.getProfile(uid));
        return profiles.get(uid);
    }
    function row(person, direct = null) {
        const wrapper = document.createElement("div"); wrapper.className = "person-row";
        const button = document.createElement("button"); button.type = "button"; button.className = "chat-choice";
        button.setAttribute("aria-current", String(current?.otherId === person.uid));
        const name = document.createElement("strong"); name.textContent = person.displayName + (person.uid === user.uid ? " (you)" : "");
        const detail = document.createElement("span"); detail.textContent = "User · " + person.uid.slice(-6);
        button.append(name, detail); button.disabled = person.uid === user.uid;
        button.addEventListener("click", async () => {
            if (busy || disposed) return;
            busy = true; button.disabled = true; status("Opening direct chat...");
            try {
                const chat = direct ? { ...direct, name: person.displayName, otherId: person.uid } : await people.openDirect(user, person);
                if (disposed) return;
                el("members-panel").close(); onSelect(chat); status("");
            } catch (error) { status(error.message || "Could not open direct chat."); }
            finally { busy = false; button.disabled = false; }
        });
        wrapper.appendChild(button);
        if (person.uid !== user.uid) {
            const save = document.createElement("button"); save.type = "button"; save.className = "friend-button";
            let saved = friends.some(item => item.id === person.uid);
            save.textContent = saved ? "Remove friend" : "Save friend";
            save.setAttribute("aria-label", `${save.textContent} ${person.displayName}`);
            save.addEventListener("click", async () => {
                save.disabled = true;
                try {
                    if (saved) await people.removeFriend(user, person); else await people.saveFriend(user, person);
                    status(saved ? "Friend removed. Your messages are kept." : `${person.displayName} saved to friends.`);
                    saved = !saved;
                    save.textContent = saved ? "Remove friend" : "Save friend";
                    save.setAttribute("aria-label", `${save.textContent} ${person.displayName}`);
                    save.disabled = false;
                } catch (error) { status(error.message); save.disabled = false; }
            });
            wrapper.appendChild(save);
        }
        return wrapper;
    }
    async function renderLists() {
        // Profile fetches may finish after a newer listener update; only the
        // latest render is allowed to replace the visible lists.
        const version = ++listVersion;
        try {
            const ids = new Set([...friends.map(item => item.id), ...directs.flatMap(chat => chat.participantIds.filter(uid => uid !== user.uid))]);
            await Promise.all([...ids].map(profile));
            if (disposed || version !== listVersion) return;
            const term = el("chat-search").value.trim().toLowerCase();
            const matches = person => person.displayName.toLowerCase().includes(term);
            el("friends-list").replaceChildren(); el("direct-list").replaceChildren();
            for (const friend of friends) { const person = profiles.get(friend.id); if (matches(person)) el("friends-list").appendChild(row(person)); }
            for (const chat of directs.slice().sort((a, b) => (b.lastActivityAt?.toMillis?.() || 0) - (a.lastActivityAt?.toMillis?.() || 0))) {
                const person = profiles.get(chat.participantIds.find(uid => uid !== user.uid));
                if (person && matches(person)) el("direct-list").appendChild(row(person, chat));
            }
            el("friends-empty").hidden = el("friends-list").children.length > 0;
            el("direct-empty").hidden = el("direct-list").children.length > 0;
            renderSearch();
        } catch (error) { if (!disposed) status(error.message); }
    }
    function renderSearch() {
        el("people-results").replaceChildren();
        for (const person of results) el("people-results").appendChild(row(person));
    }
    function search() {
        // Debounce remote prefix searches and discard results for old input.
        clearTimeout(timer);
        const version = ++searchVersion;
        const term = el("chat-search").value.trim();
        results = []; renderSearch(); renderLists();
        el("people-search-section").hidden = !term;
        el("people-search-status").textContent = term ? "Searching people..." : "";
        if (!term) return;
        timer = setTimeout(async () => {
            try {
                const found = await people.searchPeople(term, user.uid);
                if (disposed || version !== searchVersion) return;
                results = found; found.forEach(person => profiles.set(person.uid, person)); renderSearch();
                el("people-search-status").textContent = found.length ? "Select a name to message. Showing up to 25 name matches." : "No people found. Search the beginning of a name.";
            } catch (error) { if (!disposed && version === searchVersion) el("people-search-status").textContent = error.message; }
        }, 250);
    }
    listen("chat-search", "input", search);
    listen("close-members", "click", () => el("members-panel").close());
    listen("members-panel", "close", () => { stopMembers?.(); stopMembers = null; membersVersion++; });
    listen("show-members", "click", () => {
        if (!current || current.visibility === "direct") return;
        const id = current.id;
        el("members-title").textContent = `Members of ${current.name}`;
        el("members-list").replaceChildren(); el("members-status").textContent = "Loading members...";
        el("members-panel").showModal();
        stopMembers?.();
        stopMembers = people.watchMembers(id, async ids => {
            const version = ++membersVersion;
            try {
                const members = await Promise.all(ids.map(profile));
                if (disposed || version !== membersVersion || current?.id !== id) return;
                el("members-list").replaceChildren();
                members.sort((a, b) => a.displayName.localeCompare(b.displayName)).forEach(person => el("members-list").appendChild(row(person)));
                el("members-status").textContent = `${members.length} member${members.length === 1 ? "" : "s"}. Select a name to message.`;
            } catch (error) { if (version === membersVersion) el("members-status").textContent = error.message; }
        }, error => { el("members-status").textContent = error.message; });
    });
    const stops = [
        people.watchFriends(user.uid, data => { friends = data; renderLists(); }, error => status(error.message)),
        people.watchDirects(user.uid, data => { directs = data; renderLists(); }, error => status(error.message))
    ];
    search();
    return {
        setConversation(chat) {
            current = chat; el("show-members").hidden = !chat || chat.visibility === "direct";
            if (el("members-panel").open) el("members-panel").close();
            renderLists();
        },
        dispose() {
            disposed = true; events.abort(); clearTimeout(timer); stops.forEach(stop => stop()); stopMembers?.();
            if (el("members-panel").open) el("members-panel").close();
        }
    };
}
