// Saving, loading and sharing sandbox circuits. Everything stays in the browser.
import { PARTS } from '../core/parts.js';
import { pinsOf, splitRef, isBoardRef } from './circuit.js';

export const CUR_KEY = 'circuitdeck:sandbox:current';
export const SAVES_KEY = 'circuitdeck:sandbox:saves';
const MAX_PARTS = 60, MAX_WIRES = 300;

// Strict validation: anything unexpected is rejected with a readable reason.
export function validate(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Not a CircuitDeck circuit (expected a JSON object).');
  if (raw.v !== 1) throw new Error('Unsupported circuit version.');
  if (raw.board !== 'esp32' && raw.board !== 'pi5') throw new Error('Board must be "esp32" or "pi5".');
  if (!Array.isArray(raw.parts) || !Array.isArray(raw.wires)) throw new Error('Circuit needs "parts" and "wires" arrays.');
  if (raw.parts.length > MAX_PARTS) throw new Error(`Too many parts (max ${MAX_PARTS}).`);
  if (raw.wires.length > MAX_WIRES) throw new Error(`Too many wires (max ${MAX_WIRES}).`);
  const ids = new Set();
  const parts = raw.parts.map((p) => {
    if (!p || typeof p.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,23}$/.test(p.id)) throw new Error(`Bad part id: ${JSON.stringify(p?.id)}`);
    if (ids.has(p.id)) throw new Error(`Duplicate part id: ${p.id}`);
    if (!PARTS[p.type]) throw new Error(`Unknown part type: ${p.type}`);
    ids.add(p.id);
    const opts = {};
    for (const [k, choices] of Object.entries(PARTS[p.type].props || {})) if (p.opts && choices.includes(p.opts[k])) opts[k] = p.opts[k];
    const out = { id: p.id, type: p.type, opts };
    for (const k of ['x', 'z']) if (Number.isFinite(p[k]) && Math.abs(p[k]) < 60) out[k] = Math.round(p[k] * 100) / 100;
    if ([0, 90, 180, 270].includes(p.rot)) out.rot = p.rot;
    return out;
  });
  const board = new Set(pinsOf(raw.board).map((p) => p.id));
  const ok = (ref) => {
    if (typeof ref !== 'string') return false;
    if (isBoardRef(ref)) return board.has(ref);
    const [id, pin] = splitRef(ref);
    const part = parts.find((x) => x.id === id);
    return !!part && PARTS[part.type].pins.some((x) => x.n === pin);
  };
  const seen = new Set();
  const wires = [];
  for (const w of raw.wires) {
    if (!Array.isArray(w) || w.length !== 2 || !ok(w[0]) || !ok(w[1]) || w[0] === w[1]) throw new Error(`Bad wire: ${JSON.stringify(w).slice(0, 80)}`);
    const k = [...w].sort().join('|');
    if (seen.has(k)) continue;
    seen.add(k); wires.push([w[0], w[1]]);
  }
  const name = typeof raw.name === 'string' ? raw.name.replace(/[<>]/g, '').slice(0, 60) : 'My circuit';
  return { v: 1, board: raw.board, name: name || 'My circuit', parts, wires };
}

export const serialize = (c) => JSON.stringify({ v: 1, board: c.board, name: c.name, parts: c.parts.map(({ id, type, opts, x, z, rot }) => ({ id, type, opts, x, z, rot })), wires: c.wires });

// ---- share links: #c=<base64url(deflate-raw(json))>, or #j=<base64url(json)> where CompressionStream is missing
const b64u = (bytes) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = (s) => { const t = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)); return Uint8Array.from(t, (ch) => ch.charCodeAt(0)); };
async function pipe(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }

export async function encodeShare(c) {
  const bytes = new TextEncoder().encode(serialize(c));
  if (typeof CompressionStream === 'function') return `c=${b64u(await pipe(bytes, new CompressionStream('deflate-raw')))}`;
  return `j=${b64u(bytes)}`;
}
export async function decodeShare(hash) {
  const h = hash.replace(/^#/, '');
  let bytes;
  if (h.startsWith('c=')) bytes = await pipe(unb64u(h.slice(2)), new DecompressionStream('deflate-raw'));
  else if (h.startsWith('j=')) bytes = unb64u(h.slice(2));
  else return null;
  return validate(JSON.parse(new TextDecoder().decode(bytes)));
}

// ---- localStorage
const get = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
export function loadCurrent() { const raw = get(CUR_KEY, null); if (!raw) return null; try { return validate(raw); } catch { return null; } }
export function saveCurrent(c) { return put(CUR_KEY, JSON.parse(serialize(c))); }
export function listSaves() { const s = get(SAVES_KEY, []); return Array.isArray(s) ? s.filter((x) => x && x.circuit) : []; }
export function saveNamed(c) {
  const saves = listSaves().filter((s) => s.name !== c.name);
  saves.unshift({ name: c.name, at: Date.now(), circuit: JSON.parse(serialize(c)) });
  return put(SAVES_KEY, saves.slice(0, 30));
}
export function deleteSave(name) { return put(SAVES_KEY, listSaves().filter((s) => s.name !== name)); }
export function download(c) {
  const blob = new Blob([JSON.stringify(JSON.parse(serialize(c)), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(c.name || 'circuit').replace(/[^A-Za-z0-9-_]+/g, '-').toLowerCase()}.circuitdeck.json`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
