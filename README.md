# FIU Navigator

A map-first campus web app for FIU's Modesto A. Maidique Campus. The home screen is `index.html`; its layout and assistant behavior live in `app.css` and `app.js`. The map, class search, live chat, and warning markers keep their own modules.

## Run it locally

From the project folder, run `python3 -m http.server 8000`, then open `http://localhost:8000`. Use a local server because the class catalog and chat templates are fetched by the browser. No front-end build step is needed.

- **Find a class** opens the existing search dialog. Search a course code or class ID, select a section, and locate its building on the map. See `ClassSearch/README.md` for data limits.
- **Campus live chat** opens the existing community chat. Its configuration and setup are documented in `LiveChat/README.md`.
- **Ask the assistant** opens a small question panel. Its Python endpoint is `http://127.0.0.1:5000/chat`; run `campus_ai.py` and configure its dependencies/API key to use it locally. The rest of the map still runs if the assistant server is unavailable.

The map uses Leaflet and OpenStreetMap tiles. This first UI pass is a responsive 2D map; a 3D scene and turn-by-turn routes are future features, not current navigation behavior.

## Where to change the UI

Edit `index.html` for the home screen's text and buttons, `app.css` for spacing/colors/mobile layout, and `app.js` for the assistant panel. Keep the `open-class`, `open-chat`, `chat-status`, and `map` IDs because the existing feature modules use them. Run `node --test ClassSearch/classData.test.mjs` after changes to the class-search code.
