# Learn ESP32 — local working copy (republished with permission)

Faithful offline copy of https://learn-esp32.vercel.app, created by **Dilum Sanjaya** ([x.com/DilumSanjaya](https://x.com/DilumSanjaya)).
Captured 2 Nov 2026 (deploy last-modified 29 Oct 2026). No design or content changes.

## Run (full stack)
    git clone https://github.com/turboscripter21-alpha/javascript21alpha && cd javascript21alpha
    python3 serve.py 8080
Then open http://localhost:8080/ (lessons are hash routes, e.g. /#blink, /#piano, /#stepper).

`serve.py` (Python 3 standard library only) mimics the original Vercel static hosting: `/` serves index.html,
unknown paths return the site's own `404.html` with HTTP 404, and directory listings are off.
Plain alternatives also work for the site itself: `python3 -m http.server 8080` or `npx serve -l 8080 .`.
It has to be served over HTTP from the web root. The Vite build uses root-absolute `/assets/...` ES modules,
so opening index.html through file:// does not work. It needs no internet connection.

## Backend: there is none
The original is a purely static Vite + three.js (r186) build.
Everything interactive runs in the browser:
- the 3D scenes
- the simulated "upload" and serial monitor
- in-scene controls
- the lesson progress, settings, language and saved layout, all kept in `localStorage` (`learn-esp32:*` keys)
- the 12 lazy-loaded locale chunks

Evidence:
- The bundles make no fetch or XHR calls to any API. The only fetch is Vite's modulepreload.
- On the live deployment, `/api`, `/api/run`, `/api/compile`, `/api/progress` and `/api/health` return Vercel `NOT_FOUND`.
- There are no analytics or third-party requests.
- With every non-localhost request blocked, the full test suite runs with zero blocked, failed or erroring requests.

So nothing had to be rebuilt. The only additions are `404.html` (mirrored from the live site) and `serve.py`.

## Deploy (static)
Any static host works. For Vercel, use no framework preset, no build command, and the repo root as the output directory.
`vercel.json` is kept minimal.

## Layout
- index.html, 404.html, assets/ (JS chunks, CSS, woff2 fonts), icons, og-image.png, site.webmanifest, robots.txt, sitemap.xml: the site
- serve.py: the local static server

## Routes (hash ids)
board blink button wifi sound piano knob rgb light sensor motor servo bluetooth espnow project pump keypad solar radar stepper
