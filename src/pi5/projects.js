// All Pi 5 projects in order, plus the derived "What to buy" list.
import { PROJECTS_A } from './projects-a.js';
import { PROJECTS_B } from './projects-b.js';
import { PARTS } from '../core/parts.js';

export const PROJECTS = [...PROJECTS_A, ...PROJECTS_B].map((p, i) => ({ ...p, n: i + 1, thumb: `/pi5/thumbs/${p.id}.png` }));
export const byId = Object.fromEntries(PROJECTS.map((p) => [p.id, p]));

const BASE = [
  [1, 'Raspberry Pi 5 (any RAM size; 4 GB is plenty here)'],
  [1, 'Official 27 W USB-C power supply (5.1 V / 5 A)'],
  [1, 'microSD card, 32 GB or more, A1/A2 class, with Raspberry Pi OS'],
];
const RESISTOR = { 330: '330 Ω', '1k': '1 kΩ', '2k': '2 kΩ (or 2.2 kΩ)', '10k': '10 kΩ', '20k': '20 kΩ (or 2 × 10 kΩ in series)' };

// Quantities with generic specs — no shops, no prices.
export function buyList(p) {
  const out = [...BASE];
  const counts = new Map();
  for (const part of p.parts) {
    const key = part.type === 'resistor' ? `resistor:${part.opts?.ohms}` : part.type === 'led' ? `led:${part.opts?.color}` : part.type;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const [key, qty] of counts) {
    const [type, v] = key.split(':');
    if (type === 'resistor') out.push([qty, `${RESISTOR[v] || v + ' Ω'} resistor, ¼ W`]);
    else if (type === 'led') out.push([qty, `5 mm ${v} LED`]);
    else out.push([qty, PARTS[type].buy]);
  }
  if (!p.noBreadboard) out.push([1, 'Half-size breadboard (400 tie points)'], [1, 'Jumper wires, female-to-male and male-to-male (assorted pack)']);
  return out;
}
