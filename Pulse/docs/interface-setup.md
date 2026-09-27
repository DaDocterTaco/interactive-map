# Interface and phone setup

The map loads Pulse/client/mount.js, which reuses the existing Firebase app, campus chat sign-in and Leaflet map. No extra account system is created. The local web server exposes only Pulse/client and Pulse/shared browser assets.

## Local rehearsal

Start the Firestore and Auth emulators from Pulse/firebase.json using project demo-campus-pulse. Set FIRESTORE_EMULATOR_HOST=127.0.0.1:8197 and GCLOUD_PROJECT=demo-campus-pulse, then run node scripts/seed-emulator.mjs. This creates one explicitly synthetic location under pulse/rehearsal and refuses a production project.

Run node scripts/preview-server.mjs, then open:

- http://127.0.0.1:8787/preview/index.html?device=1
- http://127.0.0.1:8787/preview/index.html?device=2
- http://127.0.0.1:8787/preview/index.html?device=3

These use independent Firebase app/auth persistence keys. The preview is local-only and is not imported by the production mount. It does not require a Functions emulator.

The integration test suite resets the local emulator database. Reseed the rehearsal after running tests.

## Real devices

Serve the existing campus app over HTTPS. Location APIs may be unavailable from plain HTTP LAN addresses even when Firestore is working. Localhost is a development exception only on the device serving it. Hosting is a separate step; the Firestore migration does not publish the website.

Each phone needs its own signed-in identity, internet connectivity and a visible Pulse page. GPS permission is optional. Selecting a starting spot and manual check-in let the main demo run without GPS.

Automatic arrival is off by default, stops on hidden pages, offline state, leave or successful check-in, and does not retain location fixes. Indoor accuracy may fail the threshold; use the manual button in that case.

## Installing an update

Run from the working Pulse folder:

    node scripts/install.mjs 'C:\Users\Victor\Desktop\Extra\HackAthon\interactive-map'
    node scripts/install.mjs 'C:\Users\Victor\Desktop\Extra\HackAthon\interactive-map' --apply

The installer previews changes, preserves independently modified files, backs up entrypoints, and archives obsolete files that it previously installed. It does not copy node_modules, secrets, emulator data or generated deployment backups.
