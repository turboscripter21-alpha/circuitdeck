// CircuitDeck shared chrome: the track switcher (ESP32 · Pi 5 · Sandbox · Gallery)
// and the light/dark theme toggle. Plain script, no dependencies, used by every page.
// The theme itself is applied before first paint by the tiny inline snippet in each
// page's <head> (see THEME_BOOT in README); this file only wires the button.
(() => {
  const KEY = 'circuitdeck:theme';
  const root = document.documentElement;
  const TRACKS = [
    { id: 'esp32', href: '/', label: 'ESP32' },
    { id: 'pi5', href: '/pi5/', label: 'Pi 5' },
    { id: 'sandbox', href: '/sandbox/', label: 'Sandbox' },
    { id: 'gallery', href: '/gallery/', label: 'Gallery' },
  ];
  const current = () => {
    const p = location.pathname;
    if (p.startsWith('/pi5')) return 'pi5';
    if (p.startsWith('/sandbox')) return 'sandbox';
    if (p.startsWith('/gallery')) return 'gallery';
    return 'esp32';
  };
  const getTheme = () => (root.dataset.theme === 'dark' ? 'dark' : 'light');
  function setTheme(t) {
    if (t === 'dark') root.dataset.theme = 'dark';
    else delete root.dataset.theme;
    try { localStorage.setItem(KEY, t); } catch {}
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = t === 'dark' ? '#121821' : '#f8f1e6';
    syncButton();
    window.dispatchEvent(new CustomEvent('cd-theme', { detail: { theme: t } }));
  }
  let btn;
  function syncButton() {
    if (!btn) return;
    const dark = getTheme() === 'dark';
    btn.setAttribute('aria-pressed', String(dark));
    btn.title = dark ? 'Switch to light theme' : 'Switch to dark theme';
    btn.setAttribute('aria-label', btn.title);
  }
  function build() {
    const host = document.querySelector('[data-cd-chrome]') || document.querySelector('.brand');
    if (!host || host.querySelector('.cd-chrome')) return;
    const here = current();
    const wrap = document.createElement('div');
    wrap.className = 'cd-chrome';
    wrap.innerHTML = `
      <nav class="cd-tracks" aria-label="Tracks" id="cd-tracks">
        ${TRACKS.map((t) => `<a href="${t.href}" data-track="${t.id}"${t.id === here ? ' aria-current="page"' : ''}>${t.label}</a>`).join('')}
      </nav>
      <button type="button" class="cd-menu" aria-label="Tracks menu" aria-expanded="false" aria-controls="cd-tracks">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
      </button>
      ${SOUND_PAGES.includes(here) ? `<button type="button" class="cd-theme cd-sound" data-cd-sound>
        <svg class="spk-on" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.2 6.4a8 8 0 0 1 0 11.2"/></svg>
        <svg class="spk-off" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>
      </button>` : ''}
      <button type="button" class="cd-theme" data-cd-theme>
        <svg class="sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/></svg>
        <svg class="moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.6A8.3 8.3 0 1 1 9.4 4a6.6 6.6 0 0 0 10.6 10.6z"/></svg>
      </button>`;
    host.appendChild(wrap);
    btn = wrap.querySelector('[data-cd-theme]');
    btn.addEventListener('click', () => setTheme(getTheme() === 'dark' ? 'light' : 'dark'));
    const menu = wrap.querySelector('.cd-menu');
    menu.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = wrap.classList.toggle('is-open');
      menu.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) { wrap.classList.remove('is-open'); menu.setAttribute('aria-expanded', 'false'); }
    });
    // keyboard shortcuts of the ESP32 track must not fire while typing/pressing here
    wrap.addEventListener('keydown', (e) => e.stopPropagation());
    syncButton();
    snd = wrap.querySelector('[data-cd-sound]');
    if (snd) snd.addEventListener('click', () => setSound(!getSound()));
    syncSound();
  }
  // sound on/off (pages with simulated parts); the audio itself lives in src/core/sound.js
  const SKEY = 'circuitdeck:sound';
  const SOUND_PAGES = ['pi5', 'sandbox'];
  let snd;
  const getSound = () => { try { return localStorage.getItem(SKEY) !== '0'; } catch { return true; } };
  function setSound(on) {
    try { localStorage.setItem(SKEY, on ? '1' : '0'); } catch {}
    window.dispatchEvent(new CustomEvent('cd-sound', { detail: { on: !!on } }));
  }
  function syncSound() {
    if (!snd) return;
    const on = getSound();
    snd.classList.toggle('is-muted', !on);
    snd.setAttribute('aria-pressed', String(!on));
    snd.title = on ? 'Mute sounds' : 'Unmute sounds';
    snd.setAttribute('aria-label', snd.title);
    document.querySelectorAll('input[data-set="sound"]').forEach((c) => { c.checked = on; });
  }
  window.addEventListener('cd-sound', syncSound);
  window.CircuitDeck = { getTheme, setTheme };
  // ESP32 track: the original bundle ignores an unknown #lesson and keeps showing the
  // previous lesson, leaving the bad hash in the address bar. Point the URL back at
  // the lesson on screen (overlay only; the bundle itself is untouched).
  if (current() === 'esp32') {
    const IDS = ['board', 'blink', 'button', 'wifi', 'sound', 'piano', 'knob', 'rgb', 'light', 'sensor', 'motor', 'servo', 'bluetooth', 'espnow', 'project', 'pump', 'keypad', 'solar', 'radar', 'stepper'];
    const shown = () => {
      const items = [...document.querySelectorAll('.lesson-list .lesson, .lesson')];
      const i = items.findIndex((e) => e.classList.contains('is-active'));
      return items.length === IDS.length && i >= 0 ? IDS[i] : IDS[0];
    };
    const fixHash = () => {
      let id = location.hash.slice(1);
      try { id = decodeURIComponent(id); } catch {}
      if (!id || IDS.includes(id)) return;
      history.replaceState(history.state, '', location.pathname + location.search + '#' + shown());
    };
    window.addEventListener('hashchange', () => setTimeout(fixHash, 0));
    const boot = () => {
      if (!document.querySelector('.lesson.is-active')) return setTimeout(boot, 200);
      fixHash();
    };
    if (location.hash) setTimeout(boot, 0);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
  // the theme may change in another tab
  window.addEventListener('storage', (e) => { if (e.key === KEY) setTheme(e.newValue === 'dark' ? 'dark' : 'light'); });
})();
