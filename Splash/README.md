# Campus Loop — Wayfinder splash

The splash follows the selected white campus-map mockup: navy wordmark, pale map, cobalt route, gold destination and a quiet loading bar. On phones the map moves below the heading. The route reveals along its turns every 2.1 seconds. Reduced-motion preferences show the complete route without animation.

Open `/Splash/preview.html` to review the animation. Escape reveals inline loading examples. Add `?still` for a static reference frame. “Explore campus” opens the app.

The existing startup contract is preserved: wait for DOM and map readiness, with a 1.5 second minimum for the first visit in a session and 350 ms on return. Reduced motion has no minimum. The splash fades away in 480 ms; Escape or Continue dismisses it immediately. A 10 second watchdog prevents failed resources from trapping the user. Opening a feature dialog also dismisses the splash.

`CampusLoopLoading.ready()`, `.message(text)`, `.dismiss()` and `.mount(target, options)` remain available. Mounted loaders use textContent, polite status announcements and reference-counted `aria-busy` cleanup. Feature loaders now use the matching navigation arrow.

## Assets

- `campus-map.png` and `campus-route.png` were generated with ImageGen from the user-selected Wayfinder reference. They preserve the full canvas and separate background artwork from the transparent route for animation. This is decorative artwork, not a navigable or geographically verified campus map.
- `navigation.svg` is the filled navigation icon from Tabler Icons: https://github.com/tabler/tabler-icons/blob/main/icons/filled/navigation.svg. Its MIT license is in `assets/TABLER-LICENSE.txt`.
- Typography uses the app’s existing Inter Variable font from `CampusUI/fonts/InterVariable.woff2`.

Implementation verification and matched desktop/mobile captures are kept in the workspace’s `wayfinder-splash/design-qa.md`. The lifecycle suite is `node --test wayfinder-splash/qa/splash-lifecycle.test.cjs`.
