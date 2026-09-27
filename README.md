# FIU Navigator

A map-first campus web app for FIU's Modesto A. Maidique Campus. The home screen is `index.html`; its layout and assistant behavior live in `app.css` and `app.js`. The map, class search, live chat, and warning markers keep their own modules.

## Run it locally

From the project folder, run `python3 -m http.server 8000`, then open `http://localhost:8000`. Use a local server because the class catalog and chat templates are fetched by the browser. No front-end build step is needed.

For a phone on the same Wi-Fi, run `python tools/serve_lan.py` and open `http://<computer-IPv4-address>:8080/` on the phone. On Windows, find the Wi-Fi IPv4 address with `ipconfig`. Include `http://` in Safari's address bar; this server does not provide HTTPS. It serves the app's browser assets while excluding credentials, Git files, and directory listings. Keep the computer awake and allow Python through Windows Firewall on the connected network. Campus or guest Wi-Fi may prevent connections between devices.

Phone location access requires a trusted HTTPS connection; it will not work through the HTTP Wi-Fi address above. On the phone, open an HTTPS preview and choose **Locate me**, then allow location access when Safari asks. The location marker appears only when the reported position is within the campus boundary.

- **Find a class** opens the existing search dialog. Search a course code or class ID, select a section, and locate its building on the map. See `ClassSearch/README.md` for data limits.
- **Campus live chat** opens the existing community chat. Its configuration and setup are documented in `LiveChat/README.md`.
- **Ask the assistant** opens a small question panel. Its Python endpoint is `http://127.0.0.1:5000/chat`; run `campus_ai.py` and configure its dependencies/API key to use it locally. The rest of the map still runs if the assistant server is unavailable.

For the Python assistant, copy `.env.example` to `.env` and add your Gemini API key. If you run `AlertNode.js`, copy `service-account_example.json` to `service-account.json` and add your Firebase service account credentials. Both local credential files are ignored by Git.

Use Node.js 22 or newer and run `npm ci` to install the Firebase SDKs for the alert export and local integration tests. The browser loads Firebase 12.19.0 directly from Google's CDN; the Node tools use Firebase Admin 14.5.0.

The `gaxios@6.7.1` dependency override selects the patched CommonJS-compatible `uuid` 11 release for Firebase Admin's Storage dependency ([security fix](https://github.com/uuidjs/uuid/releases/tag/v11.1.1)). Remove the override when that upstream dependency includes a patched version.

The map uses Leaflet and OpenStreetMap tiles. This first UI pass is a responsive 2D map; a 3D scene and turn-by-turn routes are future features, not current navigation behavior.

## Where to change the UI

Edit `index.html` for the home screen's text and buttons, `app.css` for spacing/colors/mobile layout, and `app.js` for the assistant panel. Keep the `open-class`, `open-chat`, `chat-status`, and `map` IDs because the existing feature modules use them. Run `node --test ClassSearch/classData.test.mjs` after changes to the class-search code.
