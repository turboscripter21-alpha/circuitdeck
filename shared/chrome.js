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
      <button type="button" class="cd-theme" data-cd-theme>
        <svg class="sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/></svg>
        <svg class="moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.6A8.3 8.3 0 1 1 9.4 4a6.6 6.6 0 0 0 10.6 10.6z"/></svg>
      </button>`;
    host.appendChild(wrap);
    btn = wrap.querySelector('.cd-theme');
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
  }
  window.CircuitDeck = { getTheme, setTheme };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
  // the theme may change in another tab
  window.addEventListener('storage', (e) => { if (e.key === KEY) setTheme(e.newValue === 'dark' ? 'dark' : 'light'); });
})();
