// Insert the shared chat dialogs into the map page before loading chat.js;
// that controller looks up dialog elements immediately when it runs.
(async () => {
    const scriptUrl = document.currentScript.src;
    const openButton = document.getElementById("open-chat");
    const status = document.getElementById("chat-status");
    try {
        const response = await fetch(new URL("mainChat.html", scriptUrl));
        if (!response.ok) throw new Error("Could not load the chat panel.");
        const page = new DOMParser().parseFromString(await response.text(), "text/html");
        const panels = ["name-panel", "chat-panel"].map((id) => {
            const panel = page.getElementById(id);
            if (!panel) throw new Error("The chat panel is missing from mainChat.html.");
            return document.importNode(panel, true);
        });
        document.body.append(...panels);
        // Load handlers only after their buttons, forms, and panels are mounted.
        const handlers = document.createElement("script");
        handlers.src = new URL("chat.js", scriptUrl).href;
        handlers.onload = () => { openButton.disabled = false; };
        handlers.onerror = () => { status.textContent = "Chat could not load. Refresh the page to try again."; };
        document.body.append(handlers);
    } catch (error) {
        status.textContent = location.protocol === "file:"
            ? "Open the map through your local web server to use chat."
            : "Chat could not load. Refresh the page to try again.";
    }
})();
