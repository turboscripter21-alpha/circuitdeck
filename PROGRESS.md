# CircuitDeck — phase 2 progress

## M1 — rename, credit, theme (done)
- Name: **CircuitDeck** (target URL circuitdeck.vercel.app)
- index.html: title/meta/og/JSON-LD/brand/loader renamed, new logo, learn-esp32 URLs -> circuitdeck
- Credit kept: one line "Based on Learn ESP32 by Dilum Sanjaya" -> x.com/DilumSanjaya (+ JSON-LD isBasedOn, README)
- Floor watermark disabled via bundle flag `floorCredit:!1` (stage chunk); title suffix "· CircuitDeck" (index chunk)
- shared/chrome.js + shared/cd.css: track switcher (ESP32 / Pi 5 / Sandbox / Gallery) + light/dark toggle
  (localStorage `circuitdeck:theme`, inline boot script = no flash, light default)
- New favicon/icons, manifest, sitemap, robots, 404
- vendor/three: three r186 module (esbuild-minified vendor only) + OrbitControls for new pages

## M2 — Pi 5 track (/pi5/)  — todo
## M3 — Sandbox (/sandbox/) — todo
## M4 — Gallery (/gallery/) — todo
## M5 — tests — todo
## M6 — deploy — todo
