import * as people from "./people.js";

function personAvatar(person) {
    const avatar = document.createElement("span");
    const words = person.displayName.trim().split(/\s+/);
    const initials = words.length > 1 ? words[0][0] + words[words.length - 1][0] : person.displayName.slice(0, 2);
    const tone = Array.from(person.uid).reduce((sum, character) => sum + character.charCodeAt(0), 0) % 5;
    avatar.className = `avatar avatar-tone-${tone}`;
    avatar.textContent = initials.toUpperCase();
    avatar.setAttribute("aria-hidden", "true");
    return avatar;
}

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
        button.title = `${person.displayName} · User ${person.uid.slice(-6)}`;
        const copy = document.createElement("span"); copy.className = "chat-choice-copy";
        const name = document.createElement("strong"); name.textContent = person.displayName + (person.uid === user.uid ? " (you)" : "");
        const detail = document.createElement("span");
        // Account suffixes distinguish people who picked the same display name.
        detail.textContent = "@" + person.uid.slice(-6);
        copy.append(name, detail);
        button.append(personAvatar(person), copy); button.disabled = person.uid === user.uid;
        button.addEventListener("click", async () => {
            if (busy || disposed) return;
            busy = true; button.disabled = true; status("Opening direct chat...");
            button.setAttribute("aria-busy", "true");
            try {
                const chat = direct ? { ...direct, name: person.displayName, otherId: person.uid } : await people.openDirect(user, person);
                if (disposed) return;
                el("chat-panel").setAttribute("data-mobile-view", "conversation");
                el("members-panel").close(); onSelect(chat); status("");
            } catch (error) { status(error.message || "Could not open direct chat."); }
            finally { busy = false; button.disabled = person.uid === user.uid; button.setAttribute("aria-busy", "false"); }
        });
        wrapper.appendChild(button);
        if (person.uid !== user.uid) {
            const save = document.createElement("button"); save.type = "button"; save.className = "friend-button";
            let saved = friends.some(item => item.id === person.uid);
            const describeSave = () => {
                save.textContent = saved ? "Saved" : "Save";
                save.setAttribute("aria-label", `${saved ? "Remove friend" : "Save friend"} ${person.displayName}`);
                save.setAttribute("aria-pressed", String(saved));
                save.title = saved ? "Remove from friends" : "Save to friends";
            };
            describeSave();
            save.addEventListener("click", async () => {
                save.disabled = true;
                save.setAttribute("aria-busy", "true");
                try {
                    if (saved) await people.removeFriend(user, person); else await people.saveFriend(user, person);
                    status(saved ? "Removed from friends." : "Saved to friends.");
                    saved = !saved;
                    describeSave();
                    save.disabled = false;
                } catch (error) { status(error.message); save.disabled = false; }
                finally { save.setAttribute("aria-busy", "false"); }
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
            el("friends-list").replaceChildren(); el("direct-list").replaceChildren();
            const friendIds = new Set(friends.map(friend => friend.id));
            for (const friend of friends) {
                const person = profiles.get(friend.id);
                const direct = directs.find(chat => chat.participantIds.includes(friend.id));
                if (person && !term) el("friends-list").appendChild(row(person, direct));
            }
            for (const chat of directs.slice().sort((a, b) => (b.lastActivityAt?.toMillis?.() || 0) - (a.lastActivityAt?.toMillis?.() || 0))) {
                const person = profiles.get(chat.participantIds.find(uid => uid !== user.uid));
                if (person && !term && !friendIds.has(person.uid)) el("direct-list").appendChild(row(person, chat));
            }
            el("friends-empty").hidden = el("friends-list").children.length > 0;
            el("direct-empty").hidden = el("direct-list").children.length > 0;
            el("friends-section").hidden = !el("friends-list").children.length;
            el("direct-section").hidden = !el("direct-list").children.length;
            renderSearch();
        } catch (error) { if (!disposed) status(error.message); }
    }
    function renderSearch() {
        el("people-results").replaceChildren();
        for (const person of results) el("people-results").appendChild(row(person, directs.find(chat => chat.participantIds.includes(person.uid))));
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
                el("people-search-status").textContent = found.length ? (found.length === 25 ? "First 25 matches" : "") : "No matches. Try the start of a name.";
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
                el("members-status").textContent = `${members.length} member${members.length === 1 ? "" : "s"}`;
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
