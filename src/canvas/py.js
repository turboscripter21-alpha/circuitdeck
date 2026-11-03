// M11 · A small Python interpreter for the canvas (Pi 5: gpiozero / RPi.GPIO, ESP32: MicroPython machine).
// Source → tokens → AST → tree-walking generator interpreter on the shared Machine (virtual time, threads).
// Every error carries a line number and a Python-style name (SyntaxError, NameError, …); nothing throws out.
import { RunError, Restart } from './runtime.js';
import { pinsOf } from './hw.js';

export class PySyntaxError extends Error { constructor(msg, line) { super(msg); this.line = line; this.kind = 'compile'; } }
const KW = new Set(['False', 'None', 'True', 'and', 'as', 'assert', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield', 'async', 'await']);
const OPS = ['**=', '//=', '>>=', '<<=', '->', '**', '//', '==', '!=', '<=', '>=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '>>', '<<', ':=', '+', '-', '*', '/', '%', '<', '>', '=', '(', ')', '[', ']', '{', '}', ',', ':', '.', ';', '&', '|', '^', '~', '@'];

export function pyLex(src) {
  const toks = [];
  const S = (msg, line) => { throw new PySyntaxError(`SyntaxError: ${msg}`, line); };
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const indents = [0];
  let depth = 0; // bracket nesting
  let cont = false; // backslash continuation
  let tripleBuf = null; // { q, s, line, prefix }
  for (let li = 0; li < lines.length; li++) {
    const line = li + 1;
    let s = lines[li];
    let i = 0;
    if (tripleBuf) {
      const end = s.indexOf(tripleBuf.q);
      if (end < 0) { tripleBuf.s += s + '\n'; continue; }
      tripleBuf.s += s.slice(0, end);
      toks.push({ t: 'str', v: unescape(tripleBuf.s, tripleBuf.raw), f: tripleBuf.f, line: tripleBuf.line });
      i = end + 3; tripleBuf = null;
    } else if (depth === 0 && !cont) {
      // indentation
      let col = 0;
      while (i < s.length && (s[i] === ' ' || s[i] === '\t')) { col += s[i] === '\t' ? 8 - (col % 8) : 1; i++; }
      if (i >= s.length || s[i] === '#') continue; // blank / comment line
      const top = indents[indents.length - 1];
      if (col > top) {
        const prev = toks[toks.length - 1];
        if (!prev) throw new PySyntaxError('IndentationError: unexpected indent', line);
        indents.push(col); toks.push({ t: 'indent', line });
      } else {
        while (col < indents[indents.length - 1]) { indents.pop(); toks.push({ t: 'dedent', line }); }
        if (col !== indents[indents.length - 1]) throw new PySyntaxError('IndentationError: unindent does not match any outer indentation level', line);
        const prev = toks[toks.length - 1];
        if (prev && prev.t === 'nl' && toks[toks.length - 2]?.v === ':' && col <= top) throw new PySyntaxError(`IndentationError: expected an indented block after line ${toks[toks.length - 2].line}`, line);
      }
    }
    cont = false;
    while (i < s.length) {
      const ch = s[i];
      if (ch === ' ' || ch === '\t') { i++; continue; }
      if (ch === '#') break;
      if (ch === '\\' && i === s.length - 1) { cont = true; i++; break; }
      // strings (with optional prefixes)
      const pm = /^([rRfFbBuU]{0,2})('''|"""|'|")/.exec(s.slice(i));
      if (pm && (pm[1] === '' || /^[rRfFbBuU]+$/.test(pm[1])) && (pm[1] || true) && (/[A-Za-z_]/.test(ch) ? pm[1].length > 0 : true)) {
        const pre = pm[1].toLowerCase(), q = pm[2];
        const raw = pre.includes('r'), f = pre.includes('f');
        let j = i + pm[0].length;
        if (q.length === 3) {
          const end = s.indexOf(q, j);
          if (end < 0) { tripleBuf = { q, s: s.slice(j) + '\n', line, raw, f }; i = s.length; break; }
          toks.push({ t: 'str', v: unescape(s.slice(j, end), raw), f, line }); i = end + 3; continue;
        }
        let out = '';
        while (j < s.length && s[j] !== q) { if (s[j] === '\\' && j + 1 < s.length) { out += s[j] + s[j + 1]; j += 2; } else out += s[j++]; }
        if (j >= s.length) S('unterminated string literal', line);
        toks.push({ t: 'str', v: unescape(out, raw), f, line }); i = j + 1; continue;
      }
      if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(s[i + 1] || ''))) {
        const mm = /^(0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*)?\.?\d[\d_]*(?:[eE][-+]?\d+)?|\d[\d_]*\.)/.exec(s.slice(i));
        const txt = mm[0].replace(/_/g, '');
        let v, fl = false;
        if (/^0[xX]/.test(txt)) v = parseInt(txt.slice(2), 16);
        else if (/^0[bB]/.test(txt)) v = parseInt(txt.slice(2), 2);
        else if (/^0[oO]/.test(txt)) v = parseInt(txt.slice(2), 8);
        else { v = Number(txt); fl = /[.eE]/.test(txt); }
        i += mm[0].length;
        if (/[A-Za-z_]/.test(s[i] || '')) S('invalid decimal literal', line);
        toks.push({ t: 'num', v, fl, line }); continue;
      }
      if (/[A-Za-z_]/.test(ch)) {
        let j = i + 1; while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
        const w = s.slice(i, j);
        toks.push({ t: KW.has(w) ? 'kw' : 'id', v: w, line }); i = j; continue;
      }
      const op = OPS.find((o) => s.startsWith(o, i));
      if (!op) S(`invalid character '${ch}'`, line);
      if ('([{'.includes(op)) depth++;
      if (')]}'.includes(op)) { depth--; if (depth < 0) S(`unmatched '${op}'`, line); }
      toks.push({ t: 'op', v: op, line }); i += op.length;
    }
    if (depth === 0 && !cont && !tripleBuf && toks.length && toks[toks.length - 1].t !== 'nl') toks.push({ t: 'nl', line });
  }
  if (tripleBuf) S('unterminated triple-quoted string literal', tripleBuf.line);
  if (depth > 0) S("'(' was never closed", lines.length);
  const last = lines.length;
  if (toks.length && toks[toks.length - 1].t !== 'nl') toks.push({ t: 'nl', line: last });
  if (toks.length >= 2 && toks[toks.length - 2].v === ':') throw new PySyntaxError(`IndentationError: expected an indented block after line ${toks[toks.length - 2].line}`, last);
  while (indents.length > 1) { indents.pop(); toks.push({ t: 'dedent', line: last }); }
  toks.push({ t: 'eof', line: last });
  return toks;
}
function unescape(s, raw) {
  if (raw) return s;
  return s.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|[0-7]{1,3}|.)/gs, (m, e) => {
    if (e[0] === 'x' || e[0] === 'u') return String.fromCharCode(parseInt(e.slice(1), 16));
    if (/^[0-7]+$/.test(e)) return String.fromCharCode(parseInt(e, 8));
    return { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', a: '\x07', b: '\b', f: '\f', v: '\v', '\n': '' }[e] ?? '\\' + e;
  });
}

// ---------------------------------------------------------------- parser
export function pyParse(src) {
  const toks = pyLex(src);
  let p = 0;
  const peek = (o = 0) => toks[p + o];
  const next = () => toks[p++];
  const isOp = (v, o = 0) => { const t = toks[p + o]; return t.t === 'op' && t.v === v; };
  const isKw = (v, o = 0) => { const t = toks[p + o]; return t.t === 'kw' && t.v === v; };
  const desc = (t) => (t.t === 'nl' ? 'end of line' : t.t === 'eof' ? 'end of file' : t.t === 'indent' ? 'an indent' : t.t === 'dedent' ? 'a dedent' : `'${t.v}'`);
  const S = (msg, t = peek()) => { throw new PySyntaxError(`SyntaxError: ${msg}`, t.line); };
  const expectOp = (v, why) => { if (!isOp(v)) S(why || `expected '${v}' but found ${desc(peek())}`); return next(); };
  const name = () => { const t = next(); if (t.t !== 'id') S(t.t === 'kw' ? `'${t.v}' is a reserved word and can't be used as a name` : `expected a name but found ${desc(t)}`, t); return t.v; };

  function block() {
    expectOp(':', `expected ':' at the end of the line`);
    if (peek().t !== 'nl') { const body = simpleLine(); return body; } // one-line body: if x: y
    next();
    if (peek().t !== 'indent') throw new PySyntaxError(`IndentationError: expected an indented block after line ${toks[p - 2]?.line ?? peek().line} — indent the lines that belong inside it`, peek().line);
    next();
    const body = [];
    while (peek().t !== 'dedent' && peek().t !== 'eof') body.push(...statement());
    if (peek().t === 'dedent') next();
    return body;
  }
  function simpleLine() {
    const out = [simple()];
    while (isOp(';')) { next(); if (peek().t === 'nl') break; out.push(simple()); }
    if (peek().t !== 'nl') S(`invalid syntax — unexpected ${desc(peek())}`);
    next();
    return out;
  }
  function statement() {
    const t = peek();
    if (t.t === 'indent') throw new PySyntaxError('IndentationError: unexpected indent', t.line);
    if (t.t === 'kw') {
      const line = t.line;
      switch (t.v) {
        case 'if': {
          next(); const tests = [[expr(), block()]]; let orelse = null;
          while (isKw('elif')) { next(); tests.push([expr(), block()]); }
          if (isKw('else')) { next(); orelse = block(); }
          return [{ k: 'if', tests, orelse, line }];
        }
        case 'while': { next(); const cond = expr(); const body = block(); let orelse = null; if (isKw('else')) { next(); orelse = block(); } return [{ k: 'while', cond, body, orelse, line }]; }
        case 'for': {
          next(); const target = targetList(); if (!isKw('in')) S("expected 'in' in the for loop"); next();
          const iter = exprList(); const body = block(); let orelse = null; if (isKw('else')) { next(); orelse = block(); }
          return [{ k: 'for', target, iter, body, orelse, line }];
        }
        case 'def': {
          next(); const nm = name(); expectOp('(', `expected '(' after def ${nm}`);
          const params = []; let star = null, kstar = null;
          while (!isOp(')')) {
            if (isOp('*')) { next(); if (peek().t === 'id') star = name(); }
            else if (isOp('**')) { next(); kstar = name(); }
            else { const pn = name(); if (isOp(':')) { next(); expr(); } let def = null; if (isOp('=')) { next(); def = expr(); } params.push({ name: pn, def }); }
            if (!isOp(')')) expectOp(',');
          }
          next();
          if (isOp('->')) { next(); expr(); }
          const body = block();
          return [{ k: 'def', name: nm, params, star, kstar, body, line }];
        }
        case 'class': S('classes are not supported by the canvas interpreter yet — use functions and variables instead.');
        // falls through (S throws)
        case 'try': {
          next(); const body = block(); const handlers = []; let orelse = null, final = null;
          while (isKw('except')) {
            next(); let type = null, as = null;
            if (!isOp(':')) { type = expr(); if (isKw('as')) { next(); as = name(); } }
            handlers.push({ type, as, body: block() });
          }
          if (isKw('else')) { next(); orelse = block(); }
          if (isKw('finally')) { next(); final = block(); }
          if (!handlers.length && !final) S("expected 'except' or 'finally' block");
          return [{ k: 'try', body, handlers, orelse, final, line }];
        }
        case 'with': S("'with' blocks are not supported by the canvas interpreter yet.");
        // falls through
        case 'async': case 'await': S("async code is not supported by the canvas interpreter.");
        // falls through
        default: break;
      }
    }
    return simpleLine();
  }
  function simple() {
    const t = peek(); const line = t.line;
    if (t.t === 'kw') {
      switch (t.v) {
        case 'pass': next(); return { k: 'pass', line };
        case 'break': next(); return { k: 'break', line };
        case 'continue': next(); return { k: 'continue', line };
        case 'return': next(); return { k: 'return', value: peek().t === 'nl' || isOp(';') ? null : exprList(), line };
        case 'global': case 'nonlocal': { next(); const names = [name()]; while (isOp(',')) { next(); names.push(name()); } return { k: t.v, names, line }; }
        case 'del': { next(); const targets = [expr()]; while (isOp(',')) { next(); targets.push(expr()); } return { k: 'del', targets, line }; }
        case 'assert': { next(); const test = expr(); let msg = null; if (isOp(',')) { next(); msg = expr(); } return { k: 'assert', test, msg, line }; }
        case 'raise': { next(); return { k: 'raise', exc: peek().t === 'nl' ? null : expr(), line }; }
        case 'import': {
          next(); const mods = [];
          do { if (mods.length) next(); let nm = name(); while (isOp('.')) { next(); nm += '.' + name(); } let as = null; if (isKw('as')) { next(); as = name(); } mods.push({ name: nm, as }); } while (isOp(','));
          return { k: 'import', mods, line };
        }
        case 'from': {
          next(); let mod = name(); while (isOp('.')) { next(); mod += '.' + name(); }
          if (!isKw('import')) S("expected 'import'"); next();
          const names = []; const paren = isOp('('); if (paren) next();
          if (isOp('*')) { next(); names.push({ name: '*' }); }
          else do { if (names.length) next(); if (paren && isOp(')')) break; const nm = name(); let as = null; if (isKw('as')) { next(); as = name(); } names.push({ name: nm, as }); } while (isOp(','));
          if (paren) expectOp(')');
          return { k: 'from', mod, names, line };
        }
        case 'yield': S("'yield' (generators) is not supported by the canvas interpreter.");
        // falls through
        default: break;
      }
    }
    const first = exprList(true);
    if (isOp('=')) {
      const targets = [first]; let value;
      for (;;) { next(); const e = exprList(true); if (isOp('=')) { targets.push(e); continue; } value = e; break; }
      for (const tg of targets) checkTarget(tg);
      return { k: 'assign', targets, value, line };
    }
    const aug = ['+=', '-=', '*=', '/=', '//=', '%=', '**=', '&=', '|=', '^=', '>>=', '<<='].find((o) => isOp(o));
    if (aug) { next(); checkTarget(first); if (first.k === 'tuple') S("'tuple' is an illegal expression for augmented assignment"); return { k: 'aug', target: first, op: aug.slice(0, -1), value: exprList(), line }; }
    if (isOp(':') && first.k === 'name') { next(); expr(); if (isOp('=')) { next(); return { k: 'assign', targets: [first], value: exprList(), line }; } return { k: 'pass', line }; }
    return { k: 'expr', e: first, line };
  }
  function checkTarget(e) {
    if (e.k === 'name' || e.k === 'attr' || e.k === 'index') return;
    if (e.k === 'tuple' || e.k === 'list') { e.items.forEach(checkTarget); return; }
    if (e.k === 'star') { checkTarget(e.e); return; }
    if (e.k === 'call') S("cannot assign to function call here. Maybe you meant '==' instead of '='?", { line: e.line });
    if (e.k === 'num' || e.k === 'str' || e.k === 'const') S("cannot assign to literal here. Maybe you meant '==' instead of '='?", { line: e.line });
    S(`cannot assign to expression here. Maybe you meant '==' instead of '='?`, { line: e.line });
  }
  function targetList() {
    const line = peek().line;
    const tgt = () => (isOp('*') ? (next(), { k: 'star', e: bitor(), line }) : bitor());
    const items = [tgt()];
    if (!isOp(',')) return items[0];
    while (isOp(',')) { next(); if (isKw('in')) break; items.push(tgt()); }
    return { k: 'tuple', items, line };
  }
  function exprList(allowStar) {
    const line = peek().line;
    const one = () => { if (allowStar && isOp('*')) { next(); return { k: 'star', e: orExpr(), line }; } return expr(); };
    const first = one();
    if (!isOp(',')) return first;
    const items = [first];
    while (isOp(',')) { next(); if (peek().t === 'nl' || isOp('=') || isOp(')') || isOp(';')) break; items.push(one()); }
    return { k: 'tuple', items, line };
  }
  function expr() {
    const line = peek().line;
    if (isKw('lambda')) {
      next(); const params = [];
      while (!isOp(':')) { const pn = name(); let def = null; if (isOp('=')) { next(); def = expr(); } params.push({ name: pn, def }); if (!isOp(':')) expectOp(','); }
      next();
      return { k: 'lambda', params, body: expr(), line };
    }
    const e = orExpr();
    if (isKw('if')) { next(); const cond = orExpr(); if (!isKw('else')) S("expected 'else' after 'if' expression"); next(); return { k: 'ifexp', cond, a: e, b: expr(), line }; }
    if (isOp(':=')) { next(); return { k: 'walrus', target: e, value: expr(), line }; }
    return e;
  }
  function orExpr() { let e = andExpr(); while (isKw('or')) { const line = next().line; e = { k: 'or', a: e, b: andExpr(), line }; } return e; }
  function andExpr() { let e = notExpr(); while (isKw('and')) { const line = next().line; e = { k: 'and', a: e, b: notExpr(), line }; } return e; }
  function notExpr() { if (isKw('not')) { const line = next().line; return { k: 'not', e: notExpr(), line }; } return compare(); }
  function compare() {
    const line = peek().line;
    const first = bitor(); const ops = [], rest = [];
    for (;;) {
      let op = null;
      if (['<', '>', '==', '>=', '<=', '!='].some((o) => isOp(o))) op = next().v;
      else if (isKw('in')) { next(); op = 'in'; }
      else if (isKw('not') && isKw('in', 1)) { next(); next(); op = 'not in'; }
      else if (isKw('is')) { next(); if (isKw('not')) { next(); op = 'is not'; } else op = 'is'; }
      else if (isOp('=') && false) op = '=';
      if (!op) break;
      ops.push(op); rest.push(bitor());
    }
    return ops.length ? { k: 'cmp', first, ops, rest, line } : first;
  }
  const binLevel = (ops, sub) => () => { let e = sub(); for (;;) { const o = ops.find((x) => isOp(x)); if (!o) return e; const line = next().line; e = { k: 'bin', op: o, a: e, b: sub(), line }; } };
  const factorFn = () => factor();
  const term = binLevel(['*', '/', '//', '%', '@'], factorFn);
  const arith = binLevel(['+', '-'], term);
  const shift = binLevel(['<<', '>>'], arith);
  const bitand = binLevel(['&'], shift);
  const bitxor = binLevel(['^'], bitand);
  const bitor = binLevel(['|'], bitxor);
  function factor() {
    if (isOp('-') || isOp('+') || isOp('~')) { const t = next(); return { k: 'unary', op: t.v, e: factor(), line: t.line }; }
    return power();
  }
  function power() {
    const e = postfix(atom());
    if (isOp('**')) { const line = next().line; return { k: 'bin', op: '**', a: e, b: factor(), line }; }
    return e;
  }
  function postfix(e) {
    for (;;) {
      const t = peek();
      if (isOp('(')) {
        next(); const args = [], kwargs = [];
        while (!isOp(')')) {
          if (isOp('*')) { next(); args.push({ k: 'star', e: expr(), line: t.line }); }
          else if (isOp('**')) { next(); kwargs.push({ name: null, e: expr() }); }
          else if (peek().t === 'id' && isOp('=', 1)) { const kn = next().v; next(); kwargs.push({ name: kn, e: expr() }); }
          else { if (kwargs.length) S('positional argument follows keyword argument'); const a = expr(); if (isKw('for')) { args.push(comp('gen', a, t.line)); } else args.push(a); }
          if (!isOp(')')) expectOp(',', `expected ',' or ')' in the call but found ${desc(peek())} — did you forget a comma?`);
        }
        next();
        e = { k: 'call', fn: e, args, kwargs, line: t.line };
      } else if (isOp('.')) { next(); const nt = next(); if (nt.t !== 'id' && nt.t !== 'kw') S(`expected an attribute name after '.'`, nt); e = { k: 'attr', obj: e, name: nt.v, line: t.line }; }
      else if (isOp('[')) {
        next();
        const sl = () => {
          let a = null, b = null, c = null;
          if (!isOp(':')) { a = expr(); if (!isOp(':')) return a; }
          next(); if (!isOp(']') && !isOp(':') && !isOp(',')) b = expr();
          if (isOp(':')) { next(); if (!isOp(']') && !isOp(',')) c = expr(); }
          return { k: 'slice', a, b, c, line: t.line };
        };
        let idx = sl();
        if (isOp(',')) { const items = [idx]; while (isOp(',')) { next(); if (isOp(']')) break; items.push(sl()); } idx = { k: 'tuple', items, line: t.line }; }
        expectOp(']');
        e = { k: 'index', obj: e, idx, line: t.line };
      } else return e;
    }
  }
  function comp(kind, elt, line, val) {
    const gens = [];
    while (isKw('for')) { next(); const target = targetList(); if (!isKw('in')) S("expected 'in'"); next(); const iter = orExpr(); const ifs = []; while (isKw('if')) { next(); ifs.push(orExprNoCond()); } gens.push({ target, iter, ifs }); }
    return { k: 'comp', kind, elt, val, gens, line };
  }
  function orExprNoCond() { return orExpr(); }
  function atom() {
    const t = next(); const line = t.line;
    if (t.t === 'num') return { k: 'num', v: t.v, fl: t.fl, line };
    if (t.t === 'str') {
      const parts = [t];
      while (peek().t === 'str') parts.push(next());
      if (!parts.some((x) => x.f)) return { k: 'str', v: parts.map((x) => x.v).join(''), line };
      return { k: 'fstr', parts: parts.flatMap((x) => (x.f ? fparts(x.v, line) : [x.v])), line };
    }
    if (t.t === 'id') return { k: 'name', id: t.v, line };
    if (t.t === 'kw') {
      if (t.v === 'True') return { k: 'const', v: true, line };
      if (t.v === 'False') return { k: 'const', v: false, line };
      if (t.v === 'None') return { k: 'const', v: null, line };
      S(`invalid syntax — '${t.v}' can't be used here`, t);
    }
    if (t.v === '(') {
      if (isOp(')')) { next(); return { k: 'tuple', items: [], line }; }
      const first = isOp('*') ? (next(), { k: 'star', e: orExpr(), line }) : expr();
      if (isKw('for')) { const c = comp('gen', first, line); expectOp(')'); return c; }
      if (isOp(')')) { next(); return first.k === 'star' ? { k: 'tuple', items: [first], line } : { ...first, paren: true }; }
      const items = [first];
      while (isOp(',')) { next(); if (isOp(')')) break; items.push(isOp('*') ? (next(), { k: 'star', e: orExpr(), line }) : expr()); }
      expectOp(')', `expected ',' or ')' but found ${desc(peek())} — did you forget a comma?`);
      return { k: 'tuple', items, line };
    }
    if (t.v === '[') {
      if (isOp(']')) { next(); return { k: 'list', items: [], line }; }
      const first = isOp('*') ? (next(), { k: 'star', e: orExpr(), line }) : expr();
      if (isKw('for')) { const c = comp('list', first, line); expectOp(']'); return c; }
      const items = [first];
      while (isOp(',')) { next(); if (isOp(']')) break; items.push(isOp('*') ? (next(), { k: 'star', e: orExpr(), line }) : expr()); }
      expectOp(']', `expected ',' or ']' but found ${desc(peek())} — did you forget a comma?`);
      return { k: 'list', items, line };
    }
    if (t.v === '{') {
      if (isOp('}')) { next(); return { k: 'dict', keys: [], vals: [], line }; }
      const k1 = expr();
      if (isOp(':')) {
        next(); const v1 = expr();
        if (isKw('for')) { const c = comp('dict', k1, line, v1); expectOp('}'); return c; }
        const keys = [k1], vals = [v1];
        while (isOp(',')) { next(); if (isOp('}')) break; keys.push(expr()); expectOp(':'); vals.push(expr()); }
        expectOp('}');
        return { k: 'dict', keys, vals, line };
      }
      if (isKw('for')) { const c = comp('set', k1, line); expectOp('}'); return c; }
      const items = [k1];
      while (isOp(',')) { next(); if (isOp('}')) break; items.push(expr()); }
      expectOp('}');
      return { k: 'set', items, line };
    }
    if (t.t === 'nl' || t.t === 'eof') S('invalid syntax — the line ends too early', t);
    S(`invalid syntax — unexpected ${desc(t)}`, t);
  }
  function fparts(s, line) {
    const out = []; let i = 0, lit = '';
    while (i < s.length) {
      if (s[i] === '{' && s[i + 1] === '{') { lit += '{'; i += 2; continue; }
      if (s[i] === '}' && s[i + 1] === '}') { lit += '}'; i += 2; continue; }
      if (s[i] === '{') {
        let d = 1, j = i + 1, q = null;
        while (j < s.length && d) { const c = s[j]; if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if ('([{'.includes(c)) d++; else if (')]}'.includes(c)) d--; if (d) j++; }
        if (d) throw new PySyntaxError("SyntaxError: f-string: expecting '}'", line);
        let inner = s.slice(i + 1, j), spec = '', conv = '';
        // split top-level ':' (format spec) and '!r'
        let dd = 0, cut = -1;
        for (let k = 0; k < inner.length; k++) { const c = inner[k]; if ('([{'.includes(c)) dd++; else if (')]}'.includes(c)) dd--; else if (c === ':' && dd === 0 && inner[k + 1] !== '=') { cut = k; break; } }
        if (cut >= 0) { spec = inner.slice(cut + 1); inner = inner.slice(0, cut); }
        const cm = /!([rsa])\s*$/.exec(inner); if (cm) { conv = cm[1]; inner = inner.slice(0, cm.index); }
        let selfDoc = false; if (/=\s*$/.test(inner) && !/[=!<>]=\s*$/.test(inner)) { selfDoc = true; inner = inner.replace(/=\s*$/, ''); }
        if (!inner.trim()) throw new PySyntaxError('SyntaxError: f-string: empty expression not allowed', line);
        if (lit) { out.push(lit); lit = ''; }
        let e;
        try { const sub = pyParse(`(${inner})\n`); e = sub[0].e; } catch (err) { throw new PySyntaxError(err.message.startsWith('SyntaxError') ? `SyntaxError: f-string: ${err.message.replace('SyntaxError: ', '')}` : err.message, line); }
        relineExpr(e, line);
        if (selfDoc) out.push(inner + '=');
        out.push({ e, spec, conv: conv || (selfDoc && !spec ? 'r' : '') });
        i = j + 1; continue;
      }
      if (s[i] === '}') throw new PySyntaxError("SyntaxError: f-string: single '}' is not allowed", line);
      lit += s[i++];
    }
    if (lit) out.push(lit);
    return out;
  }

  const prog = [];
  while (peek().t !== 'eof') {
    if (peek().t === 'dedent') { next(); continue; }
    prog.push(...statement());
  }
  return prog;
}
function relineExpr(e, line) { if (!e || typeof e !== 'object') return; if ('line' in e) e.line = line; for (const v of Object.values(e)) { if (Array.isArray(v)) v.forEach((x) => relineExpr(x, line)); else if (v && typeof v === 'object') relineExpr(v, line); } }

// ---------------------------------------------------------------- values
export class PyExc { constructor(type, msg, args) { this.type = type; this.msg = msg ?? ''; this.args = args ?? (msg != null ? [msg] : []); } }
class PyThrow extends Error { constructor(exc, line) { super(`${exc.type.name}: ${exc.msg}`); this.exc = exc; this.line = line; } }
class ExcType { constructor(name, parent) { this.name = name; this.parent = parent; } isSub(t) { for (let x = this; x; x = x.parent) if (x === t) return true; return false; } }
const BaseException = new ExcType('BaseException');
const EXC = { BaseException };
for (const [n, par] of [['Exception', 'BaseException'], ['KeyboardInterrupt', 'BaseException'], ['SystemExit', 'BaseException'], ['ArithmeticError', 'Exception'], ['ZeroDivisionError', 'ArithmeticError'], ['OverflowError', 'ArithmeticError'], ['LookupError', 'Exception'], ['IndexError', 'LookupError'], ['KeyError', 'LookupError'], ['ValueError', 'Exception'], ['TypeError', 'Exception'], ['NameError', 'Exception'], ['UnboundLocalError', 'NameError'], ['AttributeError', 'Exception'], ['RuntimeError', 'Exception'], ['NotImplementedError', 'RuntimeError'], ['RecursionError', 'RuntimeError'], ['OSError', 'Exception'], ['ImportError', 'Exception'], ['ModuleNotFoundError', 'ImportError'], ['StopIteration', 'Exception'], ['AssertionError', 'Exception'], ['TimeoutError', 'OSError']]) EXC[n] = new ExcType(n, EXC[par]);
const pyErr = (type, msg) => new PyThrow(new PyExc(EXC[type], msg));
class PyFunc { constructor(o) { Object.assign(this, o); } }
class Bound { constructor(fn, self) { this.fn = fn; this.self = self; } }
class PyRange { constructor(a, b, c) { this.a = a; this.b = b; this.c = c; } *[Symbol.iterator]() { const { a, b, c } = this; if (c > 0) for (let i = a; i < b; i += c) yield i; else for (let i = a; i > b; i += c) yield i; } get length() { const { a, b, c } = this; return Math.max(0, Math.ceil((b - a) / c)); } }
// host classes (gpiozero, machine, …): { name, init(self, a, kw, ctx), methods{}, props{get,set}, consts{} }
export class HostClass { constructor(name, def) { this.name = name; Object.assign(this, { methods: {}, props: {}, consts: {} }, def); } }
class HostObj { constructor(cls) { this.$cls = cls; } }
class Module { constructor(name, attrs) { this.name = name; this.attrs = attrs; } }
const builtinFn = (name, fn, gen = false) => { fn.$name = name; fn.$gen = gen; return fn; };
const TUPLE = (a) => { a.$t = true; return a; };
const isTuple = (v) => Array.isArray(v) && v.$t === true;

function typeName(v) {
  if (v === null || v === undefined) return 'NoneType';
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'float';
  if (typeof v === 'string') return 'str';
  if (Array.isArray(v)) return v.$t ? 'tuple' : 'list';
  if (v instanceof Map) return 'dict';
  if (v instanceof Set) return 'set';
  if (v instanceof PyRange) return 'range';
  if (v instanceof PyFunc || typeof v === 'function' || v instanceof Bound) return v instanceof Bound ? 'method' : 'function';
  if (v instanceof HostObj) return v.$cls.name;
  if (v instanceof HostClass || v instanceof ExcType) return 'type';
  if (v instanceof Module) return 'module';
  if (v instanceof PyExc) return v.type.name;
  return 'object';
}
const fnum = (v) => {
  if (Number.isNaN(v)) return 'nan';
  if (!Number.isFinite(v)) return v < 0 ? '-inf' : 'inf';
  if (Number.isInteger(v)) return String(v);
  let s = String(v);
  if (/e/.test(s)) { s = s.replace(/e([+-])(\d)$/, 'e$10$2'); }
  return s;
};
function repr(v, seen = new Set()) {
  if (typeof v === 'string') { const q = v.includes("'") && !v.includes('"') ? '"' : "'"; return q + v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t').replace(q === "'" ? /'/g : /"/g, '\\' + q) + q; }
  return str(v, seen);
}
function str(v, seen = new Set()) {
  if (v === null || v === undefined) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'number') return fnum(v);
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && seen.has(v)) return Array.isArray(v) ? '[...]' : '{...}';
  if (Array.isArray(v)) { seen.add(v); const s = v.map((x) => repr(x, seen)); seen.delete(v); return v.$t ? `(${s.join(', ')}${s.length === 1 ? ',' : ''})` : `[${s.join(', ')}]`; }
  if (v instanceof Map) { seen.add(v); const s = [...v].map(([k, x]) => `${repr(k, seen)}: ${repr(x, seen)}`); seen.delete(v); return `{${s.join(', ')}}`; }
  if (v instanceof Set) return v.size ? `{${[...v].map((x) => repr(x)).join(', ')}}` : 'set()';
  if (v instanceof PyRange) return `range(${v.a}, ${v.b}${v.c !== 1 ? ', ' + v.c : ''})`;
  if (v instanceof PyFunc) return `<function ${v.name}>`;
  if (typeof v === 'function') return `<built-in function ${v.$name}>`;
  if (v instanceof Bound) return `<bound method ${v.fn.$name || v.fn.name}>`;
  if (v instanceof HostObj) return v.$cls.str ? v.$cls.str(v) : `<gpiozero.${v.$cls.name} object>`;
  if (v instanceof HostClass) return `<class '${v.name}'>`;
  if (v instanceof ExcType) return `<class '${v.name}'>`;
  if (v instanceof Module) return `<module '${v.name}'>`;
  if (v instanceof PyExc) return v.args.length === 1 ? str(v.args[0]) : v.msg;
  return String(v);
}
const truthy = (v) => {
  if (v === null || v === undefined || v === false || v === 0 || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  if (v instanceof Map || v instanceof Set) return v.size > 0;
  if (v instanceof PyRange) return v.length > 0;
  if (v instanceof HostObj && v.$cls.truthy) return v.$cls.truthy(v);
  return true;
};
function eq(a, b) {
  if (a === b) return true;
  if (typeof a === 'number' || typeof a === 'boolean') return (typeof b === 'number' || typeof b === 'boolean') && +a === +b;
  if (Array.isArray(a) && Array.isArray(b)) return !!a.$t === !!b.$t && a.length === b.length && a.every((x, i) => eq(x, b[i]));
  if (a instanceof Map && b instanceof Map) return a.size === b.size && [...a].every(([k, v]) => b.has(k) && eq(v, b.get(k)));
  if (a instanceof Set && b instanceof Set) return a.size === b.size && [...a].every((x) => b.has(x));
  return false;
}
const hashKey = (k) => { if (typeof k === 'boolean') return +k; if (Array.isArray(k)) { if (!k.$t) throw pyErr('TypeError', "unhashable type: 'list'"); return 't:' + k.map((x) => repr(x)).join('\u0001'); } if (k instanceof Map) throw pyErr('TypeError', "unhashable type: 'dict'"); return k; };
// a dict keeps tuple keys by repr; remember original keys for iteration
class Dict extends Map {
  constructor(e) { super(); this.orig = new Map(); if (e) for (const [k, v] of e) this.set(k, v); }
  get(k) { return super.get(hashKey(k)); }
  has(k) { return super.has(hashKey(k)); }
  set(k, v) { const h = hashKey(k); if (h !== k) this.orig.set(h, k); return super.set(h, v); }
  delete(k) { const h = hashKey(k); this.orig.delete(h); return super.delete(h); }
  *entries() { for (const [h, v] of super.entries()) yield [this.orig.has(h) ? this.orig.get(h) : h, v]; }
  [Symbol.iterator]() { return this.entries(); }
  *keys() { for (const [k] of this.entries()) yield k; }
  *values() { for (const [, v] of this.entries()) yield v; }
}
const num = (v, what) => { if (typeof v === 'number') return v; if (typeof v === 'boolean') return +v; throw pyErr('TypeError', `${what || 'expected a number'}, got ${typeName(v)}`); };
const toInt = (v) => { if (typeof v === 'boolean') return +v; if (typeof v !== 'number' || !Number.isInteger(v)) throw pyErr('TypeError', `'${typeName(v)}' object cannot be interpreted as an integer`); return v; };
function cmpVals(a, b, op) {
  const ta = typeof a === 'boolean' ? 'number' : typeof a, tb = typeof b === 'boolean' ? 'number' : typeof b;
  if (ta === 'number' && tb === 'number') return op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : a >= b;
  if (ta === 'string' && tb === 'string') return op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : a >= b;
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (!eq(a[i], b[i])) return cmpVals(a[i], b[i], op);
    return cmpVals(a.length, b.length, op);
  }
  throw pyErr('TypeError', `'${op}' not supported between instances of '${typeName(a)}' and '${typeName(b)}'`);
}
const pyMod = (a, b) => { if (b === 0) throw pyErr('ZeroDivisionError', Number.isInteger(a) && Number.isInteger(b) ? 'integer modulo by zero' : 'float modulo'); const r = a % b; return r !== 0 && (r < 0) !== (b < 0) ? r + b : r; };
function binop(op, a, b) {
  if (typeof a === 'boolean') a = +a; if (typeof b === 'boolean') b = +b;
  const na = typeof a === 'number', nb = typeof b === 'number';
  if (na && nb) {
    switch (op) {
      case '+': return a + b; case '-': return a - b; case '*': return a * b;
      case '/': if (b === 0) throw pyErr('ZeroDivisionError', 'division by zero'); return a / b;
      case '//': if (b === 0) throw pyErr('ZeroDivisionError', 'integer division or modulo by zero'); return Math.floor(a / b);
      case '%': return pyMod(a, b);
      case '**': if (a === 0 && b < 0) throw pyErr('ZeroDivisionError', '0.0 cannot be raised to a negative power'); return a ** b;
      case '&': return toInt(a) & toInt(b); case '|': return toInt(a) | toInt(b); case '^': return toInt(a) ^ toInt(b);
      case '<<': return toInt(a) * 2 ** toInt(b); case '>>': return Math.floor(toInt(a) / 2 ** toInt(b));
      default: break;
    }
  }
  if (op === '+') {
    if (typeof a === 'string' && typeof b === 'string') return a + b;
    if (Array.isArray(a) && Array.isArray(b) && !!a.$t === !!b.$t) { const r = a.concat(b); return a.$t ? TUPLE(r) : r; }
    if (typeof a === 'string' || typeof b === 'string') throw pyErr('TypeError', typeof a === 'string' ? `can only concatenate str (not "${typeName(b)}") to str — wrap it with str(...)` : `unsupported operand type(s) for +: '${typeName(a)}' and 'str' — wrap it with str(...)`);
  }
  if (op === '*') {
    const rep = (s, n) => { n = toInt(n); return typeof s === 'string' ? s.repeat(Math.max(0, n)) : (() => { const r = []; for (let i = 0; i < n; i++) r.push(...s); return s.$t ? TUPLE(r) : r; })(); };
    if ((typeof a === 'string' || Array.isArray(a)) && nb) return rep(a, b);
    if ((typeof b === 'string' || Array.isArray(b)) && na) return rep(b, a);
  }
  if (op === '%' && typeof a === 'string') return percentFmt(a, b);
  if (op === '-' && a instanceof Set && b instanceof Set) return new Set([...a].filter((x) => !b.has(x)));
  if (op === '|' && a instanceof Set && b instanceof Set) return new Set([...a, ...b]);
  if (op === '&' && a instanceof Set && b instanceof Set) return new Set([...a].filter((x) => b.has(x)));
  if (op === '|' && a instanceof Map && b instanceof Map) return new Dict([...a, ...b]);
  throw pyErr('TypeError', `unsupported operand type(s) for ${op}: '${typeName(a)}' and '${typeName(b)}'`);
}
function contains(c, x) {
  if (typeof c === 'string') { if (typeof x !== 'string') throw pyErr('TypeError', `'in <string>' requires string as left operand, not ${typeName(x)}`); return c.includes(x); }
  if (Array.isArray(c)) return c.some((y) => eq(x, y));
  if (c instanceof Map || c instanceof Set) return c instanceof Set ? c.has(x) : c.has(x);
  if (c instanceof PyRange) return [...c].includes(x);
  throw pyErr('TypeError', `argument of type '${typeName(c)}' is not iterable`);
}
function iter(v) {
  if (typeof v === 'string' || Array.isArray(v) || v instanceof PyRange || v instanceof Set) return v;
  if (v instanceof Map) return v.keys();
  if (v && typeof v === 'object' && typeof v[Symbol.iterator] === 'function' && !(v instanceof HostObj)) return v;
  if (v instanceof HostObj && v.$cls.iter) return v.$cls.iter(v);
  throw pyErr('TypeError', `'${typeName(v)}' object is not iterable`);
}
const list = (v) => [...iter(v)];
function normIdx(seq, i, what) {
  i = toInt(i);
  const n = seq.length;
  if (i < 0) i += n;
  if (i < 0 || i >= n) throw pyErr('IndexError', `${what} index out of range (it has ${n} item${n === 1 ? '' : 's'}, valid indexes are 0…${n - 1})`);
  return i;
}
function sliceIdx(n, a, b, c) {
  c = c == null ? 1 : toInt(c); if (c === 0) throw pyErr('ValueError', 'slice step cannot be zero');
  const fix = (x, d) => { if (x == null) return d; x = toInt(x); if (x < 0) x += n; return c > 0 ? Math.max(0, Math.min(n, x)) : Math.max(-1, Math.min(n - 1, x)); };
  const st = fix(a, c > 0 ? 0 : n - 1), en = fix(b, c > 0 ? n : -1);
  const out = []; if (c > 0) for (let i = st; i < en; i += c) out.push(i); else for (let i = st; i > en; i += c) out.push(i);
  return out;
}

// ---------------------------------------------------------------- formatting (format spec mini-language, % operator)
function fmtSpec(v, spec) {
  if (!spec) return str(v);
  const m = /^(?:(.)?([<>^=]))?([-+ ])?(#)?(0)?(\d+)?([,_])?(?:\.(\d+))?([bcdeEfFgGnosxX%])?$/.exec(spec);
  if (!m) throw pyErr('ValueError', `Invalid format specifier '${spec}'`);
  let [, fill, align, sign, alt, zero, width, group, prec, type] = m;
  width = width ? +width : 0;
  if (zero && !align) { fill = '0'; align = '='; }
  fill = fill || ' ';
  let s;
  const isNum = typeof v === 'number' || typeof v === 'boolean';
  if (type && 'bcdoxXn'.includes(type)) {
    if (!isNum) throw pyErr('ValueError', `Unknown format code '${type}' for object of type '${typeName(v)}'`);
    if (!Number.isInteger(+v)) throw pyErr('ValueError', `Unknown format code '${type}' for object of type 'float'`);
    const n = Math.abs(+v);
    s = type === 'b' ? n.toString(2) : type === 'o' ? n.toString(8) : type === 'x' ? n.toString(16) : type === 'X' ? n.toString(16).toUpperCase() : type === 'c' ? String.fromCharCode(n) : String(n);
    if (alt && 'box'.includes(type.toLowerCase())) s = '0' + type + s;
    if (group) s = s.replace(/\B(?=(\d{3})+(?!\d))/g, group);
    if (+v < 0) s = '-' + s; else if (sign === '+') s = '+' + s; else if (sign === ' ') s = ' ' + s;
  } else if (type && 'eEfFgG%'.includes(type) || (isNum && prec != null && !type)) {
    if (!isNum) throw pyErr('ValueError', `Unknown format code '${type}' for object of type '${typeName(v)}'`);
    let x = +v; const p = prec != null ? +prec : 6;
    if (type === '%') { x *= 100; }
    const ax = Math.abs(x);
    if (!Number.isFinite(x)) s = Number.isNaN(x) ? 'nan' : 'inf';
    else if (type === 'e' || type === 'E') { s = ax.toExponential(p).replace(/e([+-])(\d)$/, 'e$10$2'); if (type === 'E') s = s.toUpperCase(); }
    else if (type === 'g' || type === 'G' || !type) { s = String(+ax.toPrecision(Math.max(1, p))); if (!type && Number.isInteger(+s) && !/e/.test(s)) s = s; }
    else s = ax.toFixed(p);
    if (group) { const [i2, f2] = s.split('.'); s = i2.replace(/\B(?=(\d{3})+(?!\d))/g, group) + (f2 != null ? '.' + f2 : ''); }
    if (type === '%') s += '%';
    if (x < 0 || Object.is(x, -0) && false) s = '-' + s; else if (sign === '+') s = '+' + s; else if (sign === ' ') s = ' ' + s;
  } else {
    s = str(v);
    if (prec != null && typeof v === 'string') s = s.slice(0, +prec);
    if (isNum && sign === '+' && +v >= 0) s = '+' + s;
    if (isNum && group) s = s.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  }
  if (s.length < width) {
    const pad = width - s.length;
    const al = align || (isNum ? '>' : '<');
    if (al === '<') s = s + fill.repeat(pad);
    else if (al === '>') s = fill.repeat(pad) + s;
    else if (al === '^') s = fill.repeat(Math.floor(pad / 2)) + s + fill.repeat(Math.ceil(pad / 2));
    else { const sg = /^[-+ ]/.test(s) ? s[0] : ''; const pre = /^[-+ ]?0[box]/i.test(s) ? s.slice(sg.length, sg.length + 2) : ''; s = sg + pre + fill.repeat(pad) + s.slice(sg.length + pre.length); }
  }
  return s;
}
function percentFmt(f, args) {
  const a = isTuple(args) ? args : [args];
  let i = 0;
  const out = f.replace(/%([-+ 0#]*)(\d+|\*)?(?:\.(\d+))?([sdifrxXeEgGc%])/g, (m, flags, w, p, t) => {
    if (t === '%') return '%';
    if (i >= a.length) throw pyErr('TypeError', 'not enough arguments for format string');
    const v = a[i++];
    if (t === 's') return fmtSpec(str(v), `${flags.includes('-') ? '<' : '>'}${w || ''}`);
    if (t === 'r') return fmtSpec(repr(v), `${flags.includes('-') ? '<' : '>'}${w || ''}`);
    if ('di'.includes(t)) { if (typeof v !== 'number' && typeof v !== 'boolean') throw pyErr('TypeError', `%${t} format: a real number is required, not ${typeName(v)}`); return fmtSpec(Math.trunc(+v), `${flags.includes('-') ? '<' : ''}${flags.includes('+') ? '+' : ''}${flags.includes('0') && !flags.includes('-') ? '0' : ''}${w || ''}d`); }
    if (typeof v !== 'number' && typeof v !== 'boolean' && t !== 'c') throw pyErr('TypeError', `must be real number, not ${typeName(v)}`);
    return fmtSpec(+v, `${flags.includes('-') ? '<' : ''}${flags.includes('+') ? '+' : ''}${flags.includes('0') && !flags.includes('-') ? '0' : ''}${w || ''}${p != null ? '.' + p : ''}${t === 'i' ? 'd' : t}`);
  });
  if (i < a.length) throw pyErr('TypeError', 'not all arguments converted during string formatting');
  return out;
}
function strFormat(s, args, kw) {
  let auto = 0;
  return s.replace(/\{\{|\}\}|\{([^{}!:]*)(?:!([rs]))?(?::([^{}]*))?\}/g, (m, key, conv, spec) => {
    if (m === '{{') return '{'; if (m === '}}') return '}';
    let v;
    if (key === '') v = args[auto++];
    else if (/^\d+$/.test(key)) v = args[+key];
    else { const [k0, ...rest] = key.split('.'); v = kw.get ? kw.get(k0) : kw[k0]; if (v === undefined) throw pyErr('KeyError', `'${k0}'`); if (rest.length) throw pyErr('ValueError', 'attribute lookups in format() are not supported'); }
    if (v === undefined) throw pyErr('IndexError', `Replacement index ${key || auto - 1} out of range for positional args tuple`);
    if (conv === 'r') v = repr(v);
    return fmtSpec(v, spec || '');
  });
}

// ---------------------------------------------------------------- interpreter
const BRK = { brk: 1 }, CONT = { cont: 1 };
class Ret { constructor(v) { this.v = v; } }
function collectLocals(body, params) {
  const loc = new Set(params), glob = new Set();
  const tgt = (t) => { if (!t) return; if (t.k === 'name') loc.add(t.id); else if (t.k === 'tuple' || t.k === 'list') t.items.forEach(tgt); else if (t.k === 'star') tgt(t.e); };
  const walk = (ss) => { for (const s of ss || []) {
    switch (s.k) {
      case 'assign': s.targets.forEach(tgt); break;
      case 'aug': tgt(s.target); break;
      case 'for': tgt(s.target); walk(s.body); walk(s.orelse); break;
      case 'def': loc.add(s.name); break;
      case 'import': for (const md of s.mods) loc.add(md.as || md.name.split('.')[0]); break;
      case 'from': for (const n of s.names) if (n.name !== '*') loc.add(n.as || n.name); break;
      case 'global': case 'nonlocal': s.names.forEach((n) => glob.add(n)); break;
      case 'if': s.tests.forEach(([, b]) => walk(b)); walk(s.orelse); break;
      case 'while': walk(s.body); walk(s.orelse); break;
      case 'try': walk(s.body); s.handlers.forEach((h) => { if (h.as) loc.add(h.as); walk(h.body); }); walk(s.orelse); walk(s.final); break;
      default: break;
    }
  } };
  walk(body);
  for (const g of glob) loc.delete(g);
  return { loc, glob };
}
const close = (a, xs) => { let best = null, bd = 3; for (const x of xs) { const d = lev(a, x); if (d < bd) { bd = d; best = x; } } return best; };
function lev(a, b) { if (Math.abs(a.length - b.length) > 2) return 9; const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1)); return d[a.length][b.length]; }

export class Interp {
  constructor(m, { modules, builtinsExtra } = {}) {
    this.m = m;
    this.$ = { l: 0, b: 0, target: 0 };
    this.modules = modules || {};
    this.G = { vars: new Map([['__name__', '__main__']]), parent: null, fn: null };
    this.builtins = makeBuiltins(this);
    Object.assign(this.builtins, builtinsExtra || {});
    this.depth = 0;
  }
  err(type, msg) { return pyErr(type, msg); }
  // ---- names
  lookup(id, sc) {
    for (let s = sc; s; s = s.parent) {
      if (s.vars.has(id)) return s.vars.get(id);
      if (s.fn && s.loc?.has(id)) throw pyErr('UnboundLocalError', `cannot access local variable '${id}' where it is not associated with a value — if you meant the variable outside the function, add \`global ${id}\` as the first line of the function.`);
    }
    if (id in this.builtins) return this.builtins[id];
    const names = [...new Set([...this.allNames(sc), ...Object.keys(this.builtins)])];
    const sug = close(id, names);
    const hint = sug ? ` Did you mean: '${sug}'?` : HINTS[id] || '';
    throw pyErr('NameError', `name '${id}' is not defined.${hint}`);
  }
  allNames(sc) { const out = []; for (let s = sc; s; s = s.parent) out.push(...s.vars.keys()); return out; }
  assignName(id, v, sc) {
    if (sc.fn && sc.glob?.has(id)) {
      // global or nonlocal
      let s = sc.parent; while (s && s.parent && !s.vars.has(id)) s = s.parent;
      (sc.nonl?.has(id) && s ? s : this.G).vars.set(id, v); return;
    }
    sc.vars.set(id, v);
  }
  *assign(t, v, sc) {
    switch (t.k) {
      case 'name': this.assignName(t.id, v, sc); return;
      case 'tuple': case 'list': {
        const vals = list(v);
        const si = t.items.findIndex((x) => x.k === 'star');
        if (si < 0) {
          if (vals.length !== t.items.length) throw pyErr('ValueError', vals.length > t.items.length ? `too many values to unpack (expected ${t.items.length})` : `not enough values to unpack (expected ${t.items.length}, got ${vals.length})`);
          for (let i = 0; i < vals.length; i++) yield* this.assign(t.items[i], vals[i], sc);
        } else {
          const after = t.items.length - si - 1;
          for (let i = 0; i < si; i++) yield* this.assign(t.items[i], vals[i], sc);
          yield* this.assign(t.items[si].e, vals.slice(si, vals.length - after), sc);
          for (let i = 0; i < after; i++) yield* this.assign(t.items[si + 1 + i], vals[vals.length - after + i], sc);
        }
        return;
      }
      case 'attr': { const o = yield* this.ev(t.obj, sc); this.setattr(o, t.name, v); return; }
      case 'index': {
        const o = yield* this.ev(t.obj, sc);
        if (t.idx.k === 'slice') {
          if (!Array.isArray(o)) throw pyErr('TypeError', `'${typeName(o)}' object does not support slice assignment`);
          const a = t.idx.a && (yield* this.ev(t.idx.a, sc)), b = t.idx.b && (yield* this.ev(t.idx.b, sc));
          const ix = sliceIdx(o.length, a, b, null); o.splice(ix[0] ?? (a == null ? 0 : Math.min(o.length, a < 0 ? a + o.length : a)), ix.length, ...list(v)); return;
        }
        const k = yield* this.ev(t.idx, sc);
        this.setitem(o, k, v); return;
      }
      default: throw pyErr('SyntaxError', 'cannot assign to this');
    }
  }
  setitem(o, k, v) {
    if (Array.isArray(o)) { if (o.$t) throw pyErr('TypeError', "'tuple' object does not support item assignment"); o[normIdx(o, k, 'list assignment')] = v; return; }
    if (o instanceof Map) { o.set(k, v); return; }
    if (o instanceof HostObj && o.$cls.setitem) { o.$cls.setitem(o, k, v, this); return; }
    if (typeof o === 'string') throw pyErr('TypeError', "'str' object does not support item assignment (strings can't be changed — build a new one)");
    throw pyErr('TypeError', `'${typeName(o)}' object does not support item assignment`);
  }
  getitem(o, k) {
    if (Array.isArray(o) || typeof o === 'string') {
      if (k instanceof PySlice) { const ix = sliceIdx(o.length, k.a, k.b, k.c); if (typeof o === 'string') return ix.map((i) => o[i]).join(''); const r = ix.map((i) => o[i]); return o.$t ? TUPLE(r) : r; }
      if (typeof k !== 'number' && typeof k !== 'boolean') throw pyErr('TypeError', `${typeName(o)} indices must be integers or slices, not ${typeName(k)}`);
      return o[normIdx(o, k, typeName(o))];
    }
    if (o instanceof Map) { if (!o.has(k)) throw pyErr('KeyError', repr(k)); return o.get(k); }
    if (o instanceof PyRange) { const a = [...o]; return k instanceof PySlice ? sliceIdx(a.length, k.a, k.b, k.c).map((i) => a[i]) : a[normIdx(a, k, 'range object')]; }
    if (o instanceof HostObj && o.$cls.getitem) return o.$cls.getitem(o, k, this);
    throw pyErr('TypeError', `'${typeName(o)}' object is not subscriptable`);
  }
  getattr(o, name) {
    if (o instanceof Module) {
      if (name in o.attrs) return o.attrs[name];
      const sug = close(name, Object.keys(o.attrs));
      throw pyErr('AttributeError', `module '${o.name}' has no attribute '${name}'${sug ? `. Did you mean: '${sug}'?` : ''}${o.missing?.[name] ? ' — ' + o.missing[name] : ''}`);
    }
    if (o instanceof HostObj) {
      const c = o.$cls;
      if (name in c.props) return c.props[name].get ? c.props[name].get(o, this) : (() => { throw pyErr('AttributeError', `'${c.name}' attribute '${name}' is write-only`); })();
      if (name in c.methods) return new Bound(c.methods[name], o);
      if (name in c.consts) return c.consts[name];
      if (o.attrs && name in o.attrs) return o.attrs[name];
      const sug = close(name, [...Object.keys(c.props), ...Object.keys(c.methods)]);
      throw pyErr('AttributeError', `'${c.name}' object has no attribute '${name}'${sug ? `. Did you mean: '${sug}'?` : ''}`);
    }
    if (o instanceof HostClass) { if (name in o.consts) return o.consts[name]; throw pyErr('AttributeError', `type object '${o.name}' has no attribute '${name}'`); }
    if (o instanceof PyExc) { if (name === 'args') return TUPLE([...o.args]); }
    const tbl = METHODS[typeName(o)] || (o instanceof Map ? METHODS.dict : null);
    if (tbl && name in tbl) return new Bound(tbl[name], o);
    if (typeof o === 'number' && name === 'real') return o;
    const sug = tbl ? close(name, Object.keys(tbl)) : null;
    throw pyErr('AttributeError', `'${typeName(o)}' object has no attribute '${name}'${sug ? `. Did you mean: '${sug}'?` : ''}`);
  }
  setattr(o, name, v) {
    if (o instanceof HostObj) {
      const c = o.$cls;
      if (name in c.props) { if (!c.props[name].set) throw pyErr('AttributeError', `can't set attribute '${name}' (it is read-only)`); c.props[name].set(o, v, this); return; }
      if (c.open) { (o.attrs ||= {})[name] = v; return; }
      const sug = close(name, Object.keys(c.props));
      throw pyErr('AttributeError', `'${c.name}' object has no attribute '${name}'${sug ? `. Did you mean: '${sug}'?` : ''}`);
    }
    if (o instanceof Module) { o.attrs[name] = v; return; }
    if (o instanceof PyFunc) { (o.attrs ||= {})[name] = v; return; }
    throw pyErr('AttributeError', `'${typeName(o)}' object attribute '${name}' is read-only`);
  }
  // ---- calls
  *call(f, args, kw = {}) {
    if (f instanceof PyFunc) return yield* this.callPy(f, args, kw);
    if (f instanceof Bound) {
      const fn = f.fn;
      if (fn.$gen) return yield* fn(f.self, args, kw, this);
      return fn(f.self, args, kw, this);
    }
    if (typeof f === 'function') { if (f.$gen) return yield* f(args, kw, this); return f(args, kw, this); }
    if (f instanceof HostClass) {
      if (!f.init) throw pyErr('TypeError', `cannot create '${f.name}' instances`);
      const o = new HostObj(f);
      const r = f.init(o, args, kw, this);
      if (r && typeof r.next === 'function') yield* r;
      return o;
    }
    if (f instanceof ExcType) return new PyExc(f, args.length ? str(args[0]) : '', args);
    if (f instanceof HostObj && f.$cls.call) return f.$cls.call(f, args, kw, this);
    throw pyErr('TypeError', `'${typeName(f)}' object is not callable${typeof f === 'number' ? ' — did you forget an operator, like * ?' : ''}`);
  }
  *callPy(f, args, kw) {
    const sc = { vars: new Map(), parent: f.closure, fn: f, loc: f.loc, glob: f.glob, nonl: f.nonl };
    const ps = f.params;
    if (args.length > ps.length && !f.star) throw pyErr('TypeError', `${f.name}() takes ${ps.length} positional argument${ps.length === 1 ? '' : 's'} but ${args.length} ${args.length === 1 ? 'was' : 'were'} given`);
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (i < args.length) { if (p.name in kw) throw pyErr('TypeError', `${f.name}() got multiple values for argument '${p.name}'`); sc.vars.set(p.name, args[i]); }
      else if (Object.prototype.hasOwnProperty.call(kw, p.name)) sc.vars.set(p.name, kw[p.name]);
      else if (p.defv !== undefined) sc.vars.set(p.name, p.defv);
      else throw pyErr('TypeError', `${f.name}() missing required argument: '${p.name}'`);
    }
    if (f.star) sc.vars.set(f.star, TUPLE(args.slice(ps.length)));
    const extra = Object.keys(kw).filter((k) => !ps.some((p) => p.name === k));
    if (f.kstar) sc.vars.set(f.kstar, new Dict(extra.map((k) => [k, kw[k]])));
    else if (extra.length) throw pyErr('TypeError', `${f.name}() got an unexpected keyword argument '${extra[0]}'`);
    if (++this.depth > 200) { this.depth = 0; throw pyErr('RecursionError', 'maximum recursion depth exceeded — a function keeps calling itself without stopping'); }
    const saveL = this.$.l;
    try {
      if (f.lambda) return yield* this.ev(f.lambda, sc);
      const r = yield* this.exec(f.body, sc);
      return r instanceof Ret ? r.v : null;
    } catch (e) { if ((e instanceof PyThrow || e instanceof RunError) && e.line == null) e.line = this.$.l; throw e; } finally { this.depth--; this.$.l = saveL; }
  }
  // run a callback as its own thread (gpiozero when_pressed, Pin.irq, …)
  spawnCall(f, args = []) {
    const self = this;
    if (f == null) return;
    this.m.spawn((function* () { try { yield* self.call(f, args.slice(0, self.arity(f, args.length)), {}); } catch (e) { throw self.toRunError(e); } })(), 'cb', true);
  }
  arity(f, n) { if (f instanceof PyFunc) return f.star ? n : Math.min(n, f.params.length); return n; }
  // ---- statements
  *exec(stmts, sc) {
    const $ = this.$;
    for (const s of stmts) {
      $.l = s.line;
      switch (s.k) {
        case 'expr': yield* this.ev(s.e, sc); break;
        case 'assign': { const v = yield* this.ev(s.value, sc); for (const t of s.targets) yield* this.assign(t, v, sc); break; }
        case 'aug': {
          const t = s.target;
          let obj, key, cur;
          if (t.k === 'name') cur = this.lookup(t.id, sc);
          else if (t.k === 'attr') { obj = yield* this.ev(t.obj, sc); cur = this.getattr(obj, t.name); }
          else { obj = yield* this.ev(t.obj, sc); key = yield* this.ev(t.idx, sc); cur = this.getitem(obj, key); }
          const rhs = yield* this.ev(s.value, sc);
          let v;
          if (s.op === '+' && Array.isArray(cur) && !cur.$t) { cur.push(...list(rhs)); v = cur; } else v = binop(s.op, cur, rhs);
          if (t.k === 'name') this.assignName(t.id, v, sc); else if (t.k === 'attr') this.setattr(obj, t.name, v); else this.setitem(obj, key, v);
          break;
        }
        case 'if': {
          let done = false;
          for (const [c, body] of s.tests) { if (truthy(yield* this.ev(c, sc))) { const r = yield* this.exec(body, sc); if (r) return r; done = true; break; } }
          if (!done && s.orelse) { const r = yield* this.exec(s.orelse, sc); if (r) return r; }
          break;
        }
        case 'while': {
          let broke = false;
          while (truthy(yield* this.ev(s.cond, sc))) {
            if (--$.b < 0) { yield 0; }
            const r = yield* this.exec(s.body, sc);
            $.l = s.line;
            if (r === BRK) { broke = true; break; }
            if (r === CONT) continue;
            if (r) return r;
          }
          if (!broke && s.orelse) { const r = yield* this.exec(s.orelse, sc); if (r) return r; }
          break;
        }
        case 'for': {
          const it = iter(yield* this.ev(s.iter, sc));
          let broke = false;
          for (const v of it) {
            if (--$.b < 0) { yield 0; }
            $.l = s.line;
            yield* this.assign(s.target, v, sc);
            const r = yield* this.exec(s.body, sc);
            if (r === BRK) { broke = true; break; }
            if (r === CONT) continue;
            if (r) return r;
          }
          if (!broke && s.orelse) { const r = yield* this.exec(s.orelse, sc); if (r) return r; }
          break;
        }
        case 'break': return BRK;
        case 'continue': return CONT;
        case 'pass': break;
        case 'return': if (!sc.fn) throw new PySyntaxError("SyntaxError: 'return' outside function", s.line); return new Ret(s.value ? yield* this.ev(s.value, sc) : null);
        case 'def': {
          const params = [];
          for (const p of s.params) params.push({ name: p.name, defv: p.def ? yield* this.ev(p.def, sc) : undefined });
          const { loc, glob } = s.$an ||= collectLocals(s.body, [...s.params.map((p) => p.name), s.star, s.kstar].filter(Boolean));
          const nonl = new Set(); (function walk(ss) { for (const x of ss) { if (x.k === 'nonlocal') x.names.forEach((n) => nonl.add(n)); } })(s.body);
          this.assignName(s.name, new PyFunc({ name: s.name, params, star: s.star, kstar: s.kstar, body: s.body, closure: sc, loc, glob, nonl, line: s.line }), sc);
          break;
        }
        case 'global': case 'nonlocal': break;
        case 'import': for (const md of s.mods) { const mod = this.importMod(md.name); if (md.as) this.assignName(md.as, mod, sc); else this.assignName(md.name.split('.')[0], this.importMod(md.name.split('.')[0]), sc); } break;
        case 'from': {
          const mod = this.importMod(s.mod);
          for (const n of s.names) {
            if (n.name === '*') { for (const [k, v] of Object.entries(mod.attrs)) if (!k.startsWith('_')) this.assignName(k, v, sc); continue; }
            if (!(n.name in mod.attrs)) { const sug = close(n.name, Object.keys(mod.attrs)); throw pyErr('ImportError', `cannot import name '${n.name}' from '${s.mod}'${sug ? ` — did you mean '${sug}'?` : mod.missing?.[n.name] ? ' — ' + mod.missing[n.name] : ` (the canvas simulates: ${Object.keys(mod.attrs).filter((k) => /^[A-Z]/.test(k)).slice(0, 14).join(', ')})`}`); }
            this.assignName(n.as || n.name, mod.attrs[n.name], sc);
          }
          break;
        }
        case 'try': {
          let r;
          try {
            r = yield* this.exec(s.body, sc);
            if (!r && s.orelse) r = yield* this.exec(s.orelse, sc);
          } catch (e) {
            if (!(e instanceof PyThrow)) throw e;
            let h = null;
            for (const hd of s.handlers) {
              if (!hd.type) { h = hd; break; }
              const t = yield* this.ev(hd.type, sc);
              const ts = Array.isArray(t) ? t : [t];
              if (ts.some((x) => x instanceof ExcType && e.exc.type.isSub(x))) { h = hd; break; }
            }
            if (!h) { if (s.final) { const fr = yield* this.exec(s.final, sc); if (fr) return fr; } throw e; }
            if (h.as) this.assignName(h.as, e.exc, sc);
            try { r = yield* this.exec(h.body, sc); } finally { if (s.final) { const fr = yield* this.exec(s.final, sc); if (fr) return fr; } }
            if (r) return r;
            break;
          }
          if (s.final) { const fr = yield* this.exec(s.final, sc); if (fr) return fr; }
          if (r) return r;
          break;
        }
        case 'raise': {
          if (!s.exc) throw pyErr('RuntimeError', 'No active exception to reraise');
          let x = yield* this.ev(s.exc, sc);
          if (x instanceof ExcType) x = new PyExc(x, '');
          if (!(x instanceof PyExc)) throw pyErr('TypeError', 'exceptions must derive from BaseException');
          throw new PyThrow(x, s.line);
        }
        case 'assert': if (!truthy(yield* this.ev(s.test, sc))) throw pyErr('AssertionError', s.msg ? str(yield* this.ev(s.msg, sc)) : ''); break;
        case 'del': for (const t of s.targets) {
          if (t.k === 'name') { if (!sc.vars.delete(t.id)) throw pyErr('NameError', `name '${t.id}' is not defined`); }
          else if (t.k === 'index') { const o = yield* this.ev(t.obj, sc); const k = yield* this.ev(t.idx, sc); if (Array.isArray(o)) o.splice(normIdx(o, k, 'list assignment'), 1); else if (o instanceof Map) { if (!o.delete(k)) throw pyErr('KeyError', repr(k)); } else throw pyErr('TypeError', `'${typeName(o)}' object doesn't support item deletion`); }
          else throw pyErr('TypeError', 'cannot delete that');
        } break;
        default: throw pyErr('RuntimeError', `unsupported statement ${s.k}`);
      }
    }
    return undefined;
  }
  importMod(name) {
    const mk = this.modules[name];
    if (mk === undefined) {
      const why = NO_MODULE[name] || NO_MODULE[name.split('.')[0]];
      throw pyErr('ModuleNotFoundError', `No module named '${name}'${why ? ' — ' + why : ' (it is not simulated in the canvas)'}`);
    }
    if (typeof mk === 'string') throw pyErr('ModuleNotFoundError', `No module named '${name}' — ${mk}`);
    if (typeof mk === 'function') this.modules[name] = mk(this);
    return this.modules[name];
  }
  // ---- expressions
  *ev(e, sc) {
    switch (e.k) {
      case 'num': return e.v;
      case 'str': return e.v;
      case 'const': return e.v;
      case 'name': return this.lookup(e.id, sc);
      case 'fstr': {
        let out = '';
        for (const p of e.parts) {
          if (typeof p === 'string') { out += p; continue; }
          let v = yield* this.ev(p.e, sc);
          if (p.conv === 'r') v = repr(v);
          let spec = p.spec;
          if (spec.includes('{')) { spec = yield* this.ev({ k: 'fstr', parts: fpartsSimple(spec), line: e.line }, sc); }
          out += fmtSpec(v, spec);
        }
        return out;
      }
      case 'tuple': return TUPLE(yield* this.evItems(e.items, sc));
      case 'list': return yield* this.evItems(e.items, sc);
      case 'set': return new Set(yield* this.evItems(e.items, sc));
      case 'dict': { const d = new Dict(); for (let i = 0; i < e.keys.length; i++) d.set(yield* this.ev(e.keys[i], sc), yield* this.ev(e.vals[i], sc)); return d; }
      case 'attr': return this.getattr(yield* this.ev(e.obj, sc), e.name);
      case 'index': {
        const o = yield* this.ev(e.obj, sc);
        if (e.idx.k === 'slice') { const i = e.idx; return this.getitem(o, new PySlice(i.a && (yield* this.ev(i.a, sc)), i.b && (yield* this.ev(i.b, sc)), i.c && (yield* this.ev(i.c, sc)))); }
        return this.getitem(o, yield* this.ev(e.idx, sc));
      }
      case 'call': {
        const f = yield* this.ev(e.fn, sc);
        const args = yield* this.evItems(e.args, sc);
        const kw = {};
        for (const k of e.kwargs) { const v = yield* this.ev(k.e, sc); if (k.name) kw[k.name] = v; else if (v instanceof Map) for (const [kk, vv] of v) kw[kk] = vv; }
        const line = this.$.l;
        const r = yield* this.call(f, args, kw);
        this.$.l = line;
        return r;
      }
      case 'unary': {
        const v = yield* this.ev(e.e, sc);
        if (e.op === '-') return -num(v, "bad operand type for unary -: '" + typeName(v) + "'");
        if (e.op === '+') return +num(v, 'bad operand type for unary +');
        return ~toInt(v);
      }
      case 'not': return !truthy(yield* this.ev(e.e, sc));
      case 'and': { const a = yield* this.ev(e.a, sc); return truthy(a) ? yield* this.ev(e.b, sc) : a; }
      case 'or': { const a = yield* this.ev(e.a, sc); return truthy(a) ? a : yield* this.ev(e.b, sc); }
      case 'ifexp': return truthy(yield* this.ev(e.cond, sc)) ? yield* this.ev(e.a, sc) : yield* this.ev(e.b, sc);
      case 'bin': {
        const a = yield* this.ev(e.a, sc), b = yield* this.ev(e.b, sc);
        if (a instanceof HostObj || b instanceof HostObj) { const h = a instanceof HostObj ? a.$cls.binop : null; if (h) return h(a, e.op, b); }
        return binop(e.op, a, b);
      }
      case 'cmp': {
        let a = yield* this.ev(e.first, sc);
        for (let i = 0; i < e.ops.length; i++) {
          const b = yield* this.ev(e.rest[i], sc);
          const op = e.ops[i];
          let r;
          switch (op) {
            case '==': r = eq(a, b); break; case '!=': r = !eq(a, b); break;
            case 'in': r = contains(b, a); break; case 'not in': r = !contains(b, a); break;
            case 'is': r = a === b || (a == null && b == null); break; case 'is not': r = !(a === b || (a == null && b == null)); break;
            default: r = cmpVals(a, b, op);
          }
          if (!r) return false;
          a = b;
        }
        return true;
      }
      case 'lambda': {
        const params = [];
        for (const p of e.params) params.push({ name: p.name, defv: p.def ? yield* this.ev(p.def, sc) : undefined });
        return new PyFunc({ name: '<lambda>', params, lambda: e.body, closure: sc, loc: new Set(params.map((p) => p.name)), glob: new Set(), nonl: new Set() });
      }
      case 'comp': {
        const out = e.kind === 'dict' ? new Dict() : e.kind === 'set' ? new Set() : [];
        const csc = { vars: new Map(), parent: sc, fn: null };
        const self = this;
        const loop = function* (gi) {
          if (gi === e.gens.length) {
            if (e.kind === 'dict') out.set(yield* self.ev(e.elt, csc), yield* self.ev(e.val, csc));
            else if (e.kind === 'set') out.add(yield* self.ev(e.elt, csc));
            else out.push(yield* self.ev(e.elt, csc));
            return;
          }
          const g = e.gens[gi];
          for (const v of iter(yield* self.ev(g.iter, gi === 0 ? sc : csc))) {
            if (--self.$.b < 0) yield 0;
            yield* self.assign(g.target, v, csc);
            let ok = true;
            for (const c of g.ifs) if (!truthy(yield* self.ev(c, csc))) { ok = false; break; }
            if (ok) yield* loop(gi + 1);
          }
        };
        yield* loop(0);
        return out;
      }
      case 'walrus': { const v = yield* this.ev(e.value, sc); this.assignName(e.target.id, v, sc); return v; }
      case 'star': throw pyErr('SyntaxError', "can't use starred expression here");
      case 'slice': throw pyErr('SyntaxError', 'invalid slice');
      default: throw pyErr('RuntimeError', `unsupported expression ${e.k}`);
    }
  }
  *evItems(items, sc) {
    const out = [];
    for (const it of items) { if (it.k === 'star') out.push(...list(yield* this.ev(it.e, sc))); else out.push(yield* this.ev(it, sc)); }
    return out;
  }
  // ---- program
  *run(prog) {
    const sc = this.G;
    try {
      yield* this.exec(prog, sc);
    } catch (e) {
      if (e instanceof PyThrow && e.exc.type === EXC.SystemExit) return;
      throw this.toRunError(e);
    }
  }
  toRunError(e) {
    if (e instanceof PyThrow) { const r = new RunError(`${e.exc.type.name}: ${e.exc.msg}`.replace(/: $/, ''), e.line ?? this.$.l); r.py = true; return r; }
    if (e instanceof PySyntaxError) { const r = new RunError(e.message, e.line); r.py = true; return r; }
    if (e instanceof RangeError && /call stack/.test(e.message)) { const r = new RunError('RecursionError: maximum recursion depth exceeded', this.$.l); r.py = true; return r; }
    return e;
  }
}
class PySlice { constructor(a, b, c) { this.a = a; this.b = b; this.c = c; } }
function fpartsSimple(spec) { const out = []; let lit = ''; for (let i = 0; i < spec.length; i++) { if (spec[i] === '{') { const j = spec.indexOf('}', i); const sub = pyParse(`(${spec.slice(i + 1, j)})\n`)[0].e; if (lit) out.push(lit); lit = ''; out.push({ e: sub, spec: '', conv: '' }); i = j; } else lit += spec[i]; } if (lit) out.push(lit); return out; }

const HINTS = {
  true: " Python spells it 'True' (capital T).", false: " Python spells it 'False' (capital F).", null: " Python uses 'None'.", none: " Python uses 'None'.",
  delay: ' In Python use sleep(seconds) — add `from time import sleep`.', millis: ' In Python use time.ticks_ms() (MicroPython) or time.time().',
  sleep: ' Add `from time import sleep` at the top.', pause: ' Add `from signal import pause` at the top.',
  LED: ' Add `from gpiozero import LED` at the top.', Button: ' Add `from gpiozero import Button` at the top.', Pin: ' Add `from machine import Pin` at the top.',
  digitalWrite: ' That is Arduino C++ — switch the language to C++, or use gpiozero / machine.Pin in Python.', pinMode: ' That is Arduino C++ — in Python use LED(pin) / Pin(pin, Pin.OUT).',
  Serial: ' That is Arduino C++ — in Python just use print().',
};
const NO_MODULE = {
  numpy: 'numpy is not available in the canvas.', cv2: 'OpenCV is not simulated in the canvas.', picamera2: 'the camera is shown but not simulated in the canvas.', picamera: 'the camera is shown but not simulated in the canvas.',
  network: 'Wi-Fi is not simulated in the canvas (no network).', urequests: 'there is no network in the canvas.', requests: 'there is no network in the canvas.', socket: 'there is no network in the canvas.', usocket: 'there is no network in the canvas.',
  tflite_runtime: 'TinyML inference runs in the Train page, not the canvas.', tensorflow: 'TinyML inference runs in the Train page, not the canvas.', hailo_platform: 'the AI Kit is shown but not simulated in the canvas.',
  bluetooth: 'Bluetooth is not simulated.', ubluetooth: 'Bluetooth is not simulated.', board: 'CircuitPython is not supported — use gpiozero (Pi) or machine (ESP32).', digitalio: 'CircuitPython is not supported — use gpiozero (Pi) or machine (ESP32).',
  smbus: 'raw I²C (smbus) is not simulated — on the Pi, use the parts with gpiozero.', smbus2: 'raw I²C (smbus2) is not simulated.', spidev: 'raw SPI is not simulated — use gpiozero.MCP3008.', serial: 'pyserial is not simulated — use print() for output.',
  os: 'files and the OS are not simulated in the canvas.', threading: 'threads are not supported — use gpiozero callbacks (when_pressed) or background=True.', _thread: 'threads are not supported — use Pin.irq() callbacks.', asyncio: 'asyncio is not supported by the canvas interpreter.', uasyncio: 'asyncio is not supported by the canvas interpreter.',
};

// ---------------------------------------------------------------- builtins + methods of built-in types
const argN = (name, a, lo, hi = lo) => { if (a.length < lo || a.length > hi) throw pyErr('TypeError', `${name}() takes ${lo === hi ? lo : `${lo} to ${hi}`} argument${hi === 1 ? '' : 's'} (${a.length} given)`); };
function toNumber(v, base) {
  if (typeof v === 'number') return Math.trunc(v);
  if (typeof v === 'boolean') return +v;
  if (typeof v === 'string') {
    const s = v.trim().replace(/_/g, '');
    const b = base ?? 10;
    const re = b === 16 ? /^[-+]?(0x)?[0-9a-f]+$/i : b === 2 ? /^[-+]?(0b)?[01]+$/i : b === 8 ? /^[-+]?(0o)?[0-7]+$/i : /^[-+]?\d+$/;
    if (!re.test(s)) throw pyErr('ValueError', `invalid literal for int() with base ${b}: ${repr(v)}`);
    return parseInt(s.replace(/^([-+]?)0[xbo]/i, '$1'), b);
  }
  throw pyErr('TypeError', `int() argument must be a string or a number, not '${typeName(v)}'`);
}
function sortKeyed(I, arr, key, rev) {
  return (function* () {
    const keys = [];
    for (const x of arr) keys.push(key ? yield* I.call(key, [x]) : x);
    const idx = arr.map((_, i) => i);
    idx.sort((i, j) => (eq(keys[i], keys[j]) ? 0 : cmpVals(keys[i], keys[j], '<') ? -1 : 1) * (rev ? -1 : 1));
    return idx.map((i) => arr[i]);
  })();
}
function makeBuiltins(I) {
  const m = I.m;
  const B = {
    print: builtinFn('print', (a, kw) => { const sep = kw.sep == null ? ' ' : str(kw.sep), end = kw.end == null ? '\n' : str(kw.end); m.out(a.map((x) => str(x)).join(sep) + end); return null; }),
    input: builtinFn('input', function* (a) { if (a.length) m.out(str(a[0])); return yield* I.readLine(); }, true),
    len: builtinFn('len', (a) => { argN('len', a, 1); const v = a[0]; if (typeof v === 'string' || Array.isArray(v)) return v.length; if (v instanceof Map || v instanceof Set) return v.size; if (v instanceof PyRange) return v.length; if (v instanceof HostObj && v.$cls.len) return v.$cls.len(v); throw pyErr('TypeError', `object of type '${typeName(v)}' has no len()`); }),
    range: builtinFn('range', (a) => { argN('range', a, 1, 3); const [x, y, z] = a.map(toInt); if (a.length === 1) return new PyRange(0, x, 1); if (z === 0) throw pyErr('ValueError', 'range() arg 3 must not be zero'); return new PyRange(x, y, a.length === 3 ? z : 1); }),
    int: builtinFn('int', (a) => (a.length ? toNumber(a[0], a[1]) : 0)),
    float: builtinFn('float', (a) => { if (!a.length) return 0; const v = a[0]; if (typeof v === 'number' || typeof v === 'boolean') return +v; if (typeof v === 'string') { const s = v.trim().toLowerCase(); if (s === 'nan') return NaN; if (s === 'inf' || s === '+inf') return Infinity; if (s === '-inf') return -Infinity; if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/.test(s)) throw pyErr('ValueError', `could not convert string to float: ${repr(v)}`); return Number(s); } throw pyErr('TypeError', `float() argument must be a string or a real number, not '${typeName(v)}'`); }),
    str: builtinFn('str', (a) => (a.length ? str(a[0]) : '')),
    repr: builtinFn('repr', (a) => repr(a[0])),
    bool: builtinFn('bool', (a) => (a.length ? truthy(a[0]) : false)),
    list: builtinFn('list', (a) => (a.length ? list(a[0]) : [])),
    tuple: builtinFn('tuple', (a) => TUPLE(a.length ? list(a[0]) : [])),
    set: builtinFn('set', (a) => new Set(a.length ? list(a[0]) : [])),
    dict: builtinFn('dict', (a, kw) => { const d = new Dict(); if (a.length) { if (a[0] instanceof Map) for (const [k, v] of a[0]) d.set(k, v); else for (const p of iter(a[0])) { const pp = list(p); d.set(pp[0], pp[1]); } } for (const [k, v] of Object.entries(kw)) d.set(k, v); return d; }),
    abs: builtinFn('abs', (a) => Math.abs(num(a[0], 'bad operand type for abs()'))),
    round: builtinFn('round', (a) => { const x = num(a[0], 'type must be a number'); if (a.length < 2 || a[1] == null) { const r = Math.round(x); return Math.abs(x % 1) === 0.5 ? (r % 2 === 0 ? r : r - 1) : r; } const p = 10 ** toInt(a[1]); return Math.round(x * p) / p; }),
    min: builtinFn('min', function* (a, kw) { const xs = a.length === 1 ? list(a[0]) : a; if (!xs.length) { if ('default' in kw) return kw.default; throw pyErr('ValueError', 'min() arg is an empty sequence'); } const s = yield* sortKeyed(I, xs, kw.key); return s[0]; }, true),
    max: builtinFn('max', function* (a, kw) { const xs = a.length === 1 ? list(a[0]) : a; if (!xs.length) { if ('default' in kw) return kw.default; throw pyErr('ValueError', 'max() arg is an empty sequence'); } let best = xs[0], bk = kw.key ? yield* I.call(kw.key, [best]) : best; for (const x of xs.slice(1)) { const k = kw.key ? yield* I.call(kw.key, [x]) : x; if (cmpVals(k, bk, '>')) { best = x; bk = k; } } return best; }, true),
    sum: builtinFn('sum', (a) => { let s = a[1] ?? 0; for (const x of iter(a[0])) s = binop('+', s, x); return s; }),
    sorted: builtinFn('sorted', function* (a, kw) { return yield* sortKeyed(I, list(a[0]), kw.key, truthy(kw.reverse)); }, true),
    reversed: builtinFn('reversed', (a) => list(a[0]).reverse()),
    enumerate: builtinFn('enumerate', (a, kw) => { const st = a[1] ?? kw.start ?? 0; return list(a[0]).map((x, i) => TUPLE([i + st, x])); }),
    zip: builtinFn('zip', (a) => { const ls = a.map(list); const n = ls.length ? Math.min(...ls.map((x) => x.length)) : 0; const out = []; for (let i = 0; i < n; i++) out.push(TUPLE(ls.map((x) => x[i]))); return out; }),
    map: builtinFn('map', function* (a) { const ls = a.slice(1).map(list); const n = Math.min(...ls.map((x) => x.length)); const out = []; for (let i = 0; i < n; i++) out.push(yield* I.call(a[0], ls.map((x) => x[i]))); return out; }, true),
    filter: builtinFn('filter', function* (a) { const out = []; for (const x of iter(a[1])) if (a[0] == null ? truthy(x) : truthy(yield* I.call(a[0], [x]))) out.push(x); return out; }, true),
    any: builtinFn('any', (a) => { for (const x of iter(a[0])) if (truthy(x)) return true; return false; }),
    all: builtinFn('all', (a) => { for (const x of iter(a[0])) if (!truthy(x)) return false; return true; }),
    isinstance: builtinFn('isinstance', (a) => { const ts = Array.isArray(a[1]) ? a[1] : [a[1]]; return ts.some((t) => (t === B.int ? typeof a[0] === 'number' && Number.isInteger(a[0]) || typeof a[0] === 'boolean' : t === B.float ? typeof a[0] === 'number' : t === B.str ? typeof a[0] === 'string' : t === B.list ? Array.isArray(a[0]) && !a[0].$t : t === B.tuple ? isTuple(a[0]) : t === B.dict ? a[0] instanceof Map : t === B.bool ? typeof a[0] === 'boolean' : t instanceof HostClass ? a[0] instanceof HostObj && a[0].$cls === t : t instanceof ExcType ? a[0] instanceof PyExc && a[0].type.isSub(t) : false)); }),
    type: builtinFn('type', (a) => ({ int: B.int, float: B.float, str: B.str, bool: B.bool, list: B.list, tuple: B.tuple, dict: B.dict, set: B.set, NoneType: null }[typeName(a[0])] ?? (a[0] instanceof HostObj ? a[0].$cls : null))),
    chr: builtinFn('chr', (a) => String.fromCharCode(toInt(a[0]))),
    ord: builtinFn('ord', (a) => { if (typeof a[0] !== 'string' || a[0].length !== 1) throw pyErr('TypeError', `ord() expected a character, but string of length ${a[0]?.length ?? 0} found`); return a[0].charCodeAt(0); }),
    hex: builtinFn('hex', (a) => (toInt(a[0]) < 0 ? '-0x' + (-a[0]).toString(16) : '0x' + a[0].toString(16))),
    bin: builtinFn('bin', (a) => (toInt(a[0]) < 0 ? '-0b' + (-a[0]).toString(2) : '0b' + a[0].toString(2))),
    oct: builtinFn('oct', (a) => '0o' + toInt(a[0]).toString(8)),
    divmod: builtinFn('divmod', (a) => TUPLE([binop('//', a[0], a[1]), binop('%', a[0], a[1])])),
    pow: builtinFn('pow', (a) => (a.length === 3 ? Number((BigInt(toInt(a[0])) ** BigInt(toInt(a[1]))) % BigInt(toInt(a[2]))) : binop('**', a[0], a[1]))),
    format: builtinFn('format', (a) => fmtSpec(a[0], a[1] ? str(a[1]) : '')),
    hasattr: builtinFn('hasattr', (a) => { try { I.getattr(a[0], a[1]); return true; } catch { return false; } }),
    getattr: builtinFn('getattr', (a) => { try { return I.getattr(a[0], a[1]); } catch (e) { if (a.length > 2) return a[2]; throw e; } }),
    setattr: builtinFn('setattr', (a) => { I.setattr(a[0], a[1], a[2]); return null; }),
    callable: builtinFn('callable', (a) => a[0] instanceof PyFunc || typeof a[0] === 'function' || a[0] instanceof Bound || a[0] instanceof HostClass),
    id: builtinFn('id', (a) => 140000000 + (typeof a[0] === 'number' ? a[0] : 7)),
    hash: builtinFn('hash', (a) => { const k = hashKey(a[0]); return typeof k === 'number' ? k : [...String(k)].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7); }),
    iter: builtinFn('iter', (a) => { const it = iter(a[0])[Symbol.iterator](); return new HostObj(ITER_CLS(it)); }),
    next: builtinFn('next', (a) => { const o = a[0]; if (!(o instanceof HostObj) || !o.$cls.it) throw pyErr('TypeError', `'${typeName(o)}' object is not an iterator`); const r = o.$cls.it.next(); if (r.done) { if (a.length > 1) return a[1]; throw pyErr('StopIteration', ''); } return r.value; }),
    exit: builtinFn('exit', () => { throw new PyThrow(new PyExc(EXC.SystemExit, '')); }),
    quit: builtinFn('quit', () => { throw new PyThrow(new PyExc(EXC.SystemExit, '')); }),
    help: builtinFn('help', () => { m.out('help() is not available in the canvas — try the AI tutor.\n'); return null; }),
    globals: builtinFn('globals', () => new Dict([...I.G.vars])),
    open: builtinFn('open', () => { throw pyErr('OSError', 'files are not simulated in the canvas'); }),
  };
  Object.assign(B, EXC);
  return B;
}
const ITER_CLS = (it) => new HostClass('iterator', { it });
const S = (fn) => fn; // marks methods: (self, args, kw, I)
const strM = {
  upper: S((s) => s.toUpperCase()), lower: S((s) => s.toLowerCase()), title: S((s) => s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase())), capitalize: S((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()),
  swapcase: S((s) => [...s].map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join('')),
  strip: S((s, a) => (a[0] == null ? s.trim() : s.replace(new RegExp(`^[${esc(a[0])}]+|[${esc(a[0])}]+$`, 'g'), ''))), lstrip: S((s, a) => (a[0] == null ? s.trimStart() : s.replace(new RegExp(`^[${esc(a[0])}]+`), ''))), rstrip: S((s, a) => (a[0] == null ? s.trimEnd() : s.replace(new RegExp(`[${esc(a[0])}]+$`), ''))),
  split: S((s, a, kw) => { const sep = a[0] ?? kw.sep ?? null, mx = a[1] ?? kw.maxsplit ?? -1; if (sep === '') throw pyErr('ValueError', 'empty separator'); let parts = sep == null ? s.trim().split(/\s+/).filter((x) => x !== '') : s.split(sep); if (mx >= 0 && parts.length > mx + 1) parts = [...parts.slice(0, mx), parts.slice(mx).join(sep ?? ' ')]; return parts; }),
  rsplit: S((s, a) => (a[0] == null ? s.trim().split(/\s+/) : s.split(a[0]))), splitlines: S((s) => s.split(/\r?\n/).filter((x, i, arr) => !(i === arr.length - 1 && x === ''))),
  join: S((s, a) => list(a[0]).map((x) => { if (typeof x !== 'string') throw pyErr('TypeError', `sequence item: expected str instance, ${typeName(x)} found — use str(...)`); return x; }).join(s)),
  replace: S((s, a) => (a[2] != null ? (() => { let r = s, n = a[2]; let out = ''; while (n-- > 0) { const i = r.indexOf(a[0]); if (i < 0) break; out += r.slice(0, i) + a[1]; r = r.slice(i + a[0].length); } return out + r; })() : s.split(a[0]).join(a[1]))),
  startswith: S((s, a) => (Array.isArray(a[0]) ? a[0].some((x) => s.startsWith(x)) : s.startsWith(a[0]))), endswith: S((s, a) => (Array.isArray(a[0]) ? a[0].some((x) => s.endsWith(x)) : s.endsWith(a[0]))),
  find: S((s, a) => s.indexOf(a[0], a[1] ?? 0)), rfind: S((s, a) => s.lastIndexOf(a[0])), index: S((s, a) => { const i = s.indexOf(a[0]); if (i < 0) throw pyErr('ValueError', 'substring not found'); return i; }),
  count: S((s, a) => (a[0] === '' ? s.length + 1 : s.split(a[0]).length - 1)),
  format: S((s, a, kw) => strFormat(s, a, kw)),
  isdigit: S((s) => /^\d+$/.test(s)), isnumeric: S((s) => /^\d+$/.test(s)), isdecimal: S((s) => /^\d+$/.test(s)), isalpha: S((s) => /^[A-Za-z]+$/.test(s)), isalnum: S((s) => /^[A-Za-z0-9]+$/.test(s)), isspace: S((s) => /^\s+$/.test(s)), isupper: S((s) => /[A-Z]/.test(s) && s === s.toUpperCase()), islower: S((s) => /[a-z]/.test(s) && s === s.toLowerCase()),
  center: S((s, a) => fmtSpec(s, `${a[1] ?? ' '}^${a[0]}`)), ljust: S((s, a) => fmtSpec(s, `${a[1] ?? ' '}<${a[0]}`)), rjust: S((s, a) => fmtSpec(s, `${a[1] ?? ' '}>${a[0]}`)), zfill: S((s, a) => (s.length >= a[0] ? s : (/^[-+]/.test(s) ? s[0] + '0'.repeat(a[0] - s.length) + s.slice(1) : '0'.repeat(a[0] - s.length) + s))),
  encode: S((s) => s), decode: S((s) => s),
};
const esc = (s) => String(s).replace(/[\\\]^-]/g, '\\$&');
const listM = {
  append: S((l, a) => { argN('append', a, 1); l.push(a[0]); return null; }), extend: S((l, a) => { l.push(...list(a[0])); return null; }), insert: S((l, a) => { let i = toInt(a[0]); if (i < 0) i = Math.max(0, l.length + i); l.splice(Math.min(i, l.length), 0, a[1]); return null; }),
  pop: S((l, a) => { if (!l.length) throw pyErr('IndexError', 'pop from empty list'); if (!a.length) return l.pop(); return l.splice(normIdx(l, a[0], 'pop'), 1)[0]; }),
  remove: S((l, a) => { const i = l.findIndex((x) => eq(x, a[0])); if (i < 0) throw pyErr('ValueError', 'list.remove(x): x not in list'); l.splice(i, 1); return null; }),
  index: S((l, a) => { const i = l.findIndex((x) => eq(x, a[0])); if (i < 0) throw pyErr('ValueError', `${repr(a[0])} is not in list`); return i; }), count: S((l, a) => l.filter((x) => eq(x, a[0])).length),
  sort: Object.assign(function* (l, a, kw, I) { const r = yield* sortKeyed(I, l.slice(), kw.key, truthy(kw.reverse)); l.splice(0, l.length, ...r); return null; }, { $gen: true }),
  reverse: S((l) => { l.reverse(); return null; }), clear: S((l) => { l.length = 0; return null; }), copy: S((l) => l.slice()),
};
const tupleM = { index: listM.index, count: listM.count };
const dictM = {
  get: S((d, a) => (d.has(a[0]) ? d.get(a[0]) : a[1] ?? null)), keys: S((d) => [...d.keys()]), values: S((d) => [...d.values()]), items: S((d) => [...d.entries()].map((e) => TUPLE(e))),
  pop: S((d, a) => { if (d.has(a[0])) { const v = d.get(a[0]); d.delete(a[0]); return v; } if (a.length > 1) return a[1]; throw pyErr('KeyError', repr(a[0])); }),
  setdefault: S((d, a) => { if (!d.has(a[0])) d.set(a[0], a[1] ?? null); return d.get(a[0]); }), update: S((d, a, kw) => { if (a[0]) for (const [k, v] of a[0]) d.set(k, v); for (const [k, v] of Object.entries(kw)) d.set(k, v); return null; }),
  clear: S((d) => { d.clear(); return null; }), copy: S((d) => new Dict([...d])),
};
const setM = {
  add: S((s, a) => { s.add(a[0]); return null; }), remove: S((s, a) => { if (!s.delete(a[0])) throw pyErr('KeyError', repr(a[0])); return null; }), discard: S((s, a) => { s.delete(a[0]); return null; }),
  pop: S((s) => { const v = s.values().next(); if (v.done) throw pyErr('KeyError', 'pop from an empty set'); s.delete(v.value); return v.value; }), clear: S((s) => { s.clear(); return null; }),
  union: S((s, a) => new Set([...s, ...list(a[0])])), intersection: S((s, a) => { const o = new Set(list(a[0])); return new Set([...s].filter((x) => o.has(x))); }), difference: S((s, a) => { const o = new Set(list(a[0])); return new Set([...s].filter((x) => !o.has(x))); }),
};
for (const t of [strM, listM, tupleM, dictM, setM]) for (const [k, f] of Object.entries(t)) f.$name = k;
const METHODS = { str: strM, list: listM, tuple: tupleM, dict: dictM, set: setM };

// ---------------------------------------------------------------- hardware modules
const gen = (fn) => { fn.$gen = true; return fn; };
const mod = (name, attrs, missing) => { const md = new Module(name, attrs); md.missing = missing; for (const [k, v] of Object.entries(attrs)) if (typeof v === 'function' && !v.$name) v.$name = k; return md; };
const hc = (name, def) => { const c = new HostClass(name, def); for (const [k, f] of Object.entries(c.methods)) f.$name = k; return c; };
const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function toneHz(t) {
  if (t instanceof HostObj && t.$cls.name === 'Tone') return t.hz;
  if (typeof t === 'number') return t;
  if (typeof t === 'string') { const mm = /^([A-Ga-g])([#b♯♭]?)(-?\d)$/.exec(t.trim()); if (!mm) throw pyErr('ValueError', `invalid note '${t}' — use e.g. 'A4' or 'C#5'`); const midi = 12 * (+mm[3] + 1) + NOTE[mm[1].toUpperCase()] + (mm[2] === '#' || mm[2] === '♯' ? 1 : mm[2] ? -1 : 0); return 440 * 2 ** ((midi - 69) / 12); }
  throw pyErr('TypeError', `can't play ${typeName(t)} — use a frequency, a note like 'A4', or Tone(...)`);
}
const fl = (v, name) => { if (typeof v === 'boolean') return +v; if (typeof v !== 'number') throw pyErr('TypeError', `${name} must be a number, not ${typeName(v)}`); return v; };

function stdModules(I) {
  const m = I.m;
  let seed = 12345;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const sleepS = gen(function* (a) { const s = fl(a[0] ?? 0, 'sleep time'); if (s < 0) throw pyErr('ValueError', 'sleep length must be non-negative'); if (s > 0) yield s * 1000; else yield 0; return null; });
  const time = () => mod('time', {
    sleep: sleepS,
    sleep_ms: gen(function* (a) { const ms = fl(a[0] ?? 0, 'sleep_ms'); yield ms > 0 ? ms : 0; return null; }),
    sleep_us: gen(function* (a) { const us = fl(a[0] ?? 0, 'sleep_us'); yield us > 0 ? us / 1000 : 0; return null; }),
    ticks_ms: () => Math.floor(m.now), ticks_us: () => Math.floor(m.now * 1000), ticks_cpu: () => Math.floor(m.now * 240000),
    ticks_diff: (a) => a[0] - a[1], ticks_add: (a) => a[0] + a[1],
    time: () => 1767225600 + m.now / 1000, monotonic: () => m.now / 1000, perf_counter: () => m.now / 1000, time_ns: () => Math.floor((1767225600000 + m.now) * 1e6), monotonic_ns: () => Math.floor(m.now * 1e6),
    localtime: () => { const d = new Date(Date.UTC(2026, 0, 1) + m.now); return TUPLE([d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), (d.getUTCDay() + 6) % 7, 1]); },
    strftime: (a) => { const d = new Date(Date.UTC(2026, 0, 1) + m.now); const p = (n) => String(n).padStart(2, '0'); return str(a[0]).replace(/%H/g, p(d.getUTCHours())).replace(/%M/g, p(d.getUTCMinutes())).replace(/%S/g, p(d.getUTCSeconds())).replace(/%Y/g, d.getUTCFullYear()).replace(/%m/g, p(d.getUTCMonth() + 1)).replace(/%d/g, p(d.getUTCDate())); },
  });
  const domain = (f) => (a) => { const r = f(...a.map((x) => fl(x, 'argument'))); if (Number.isNaN(r) && !a.some((x) => Number.isNaN(x))) throw pyErr('ValueError', 'math domain error'); return r; };
  const math = () => mod('math', {
    pi: Math.PI, e: Math.E, tau: 2 * Math.PI, inf: Infinity, nan: NaN,
    sqrt: domain(Math.sqrt), sin: domain(Math.sin), cos: domain(Math.cos), tan: domain(Math.tan), asin: domain(Math.asin), acos: domain(Math.acos), atan: domain(Math.atan), atan2: domain(Math.atan2),
    floor: (a) => Math.floor(fl(a[0], 'floor()')), ceil: (a) => Math.ceil(fl(a[0], 'ceil()')), trunc: (a) => Math.trunc(a[0]), fabs: (a) => Math.abs(a[0]),
    log: (a) => { if (a[0] <= 0) throw pyErr('ValueError', 'math domain error'); return a.length > 1 ? Math.log(a[0]) / Math.log(a[1]) : Math.log(a[0]); }, log10: domain(Math.log10), log2: domain(Math.log2), exp: domain(Math.exp), pow: (a) => a[0] ** a[1],
    degrees: (a) => (a[0] * 180) / Math.PI, radians: (a) => (a[0] * Math.PI) / 180, hypot: (a) => Math.hypot(...a), isnan: (a) => Number.isNaN(a[0]), isinf: (a) => a[0] === Infinity || a[0] === -Infinity, isfinite: (a) => Number.isFinite(a[0]),
    copysign: (a) => Math.sign(a[1]) * Math.abs(a[0]), fmod: (a) => a[0] % a[1], gcd: (a) => { let [x, y] = a.map((v) => Math.abs(toInt(v))); while (y) [x, y] = [y, x % y]; return x; }, factorial: (a) => { let r = 1; for (let i = 2; i <= toInt(a[0]); i++) r *= i; return r; },
  });
  const random = () => mod('random', {
    random: () => rnd(), seed: (a) => { seed = (a[0] ?? 1) >>> 0 || 1; return null; },
    randint: (a) => { const lo = toInt(a[0]), hi = toInt(a[1]); if (hi < lo) throw pyErr('ValueError', `empty range in randint(${lo}, ${hi})`); return lo + Math.floor(rnd() * (hi - lo + 1)); },
    randrange: (a) => { const [lo, hi, st] = a.length === 1 ? [0, a[0], 1] : [a[0], a[1], a[2] ?? 1]; const n = Math.ceil((hi - lo) / st); if (n <= 0) throw pyErr('ValueError', 'empty range for randrange()'); return lo + st * Math.floor(rnd() * n); },
    uniform: (a) => a[0] + rnd() * (a[1] - a[0]), choice: (a) => { const l = list(a[0]); if (!l.length) throw pyErr('IndexError', 'Cannot choose from an empty sequence'); return l[Math.floor(rnd() * l.length)]; },
    shuffle: (a) => { const l = a[0]; for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; } return null; }, getrandbits: (a) => Math.floor(rnd() * 2 ** a[0]),
  });
  const pauseFn = gen(function* () { for (;;) yield 1e6; });
  const signal = () => mod('signal', { pause: pauseFn, SIGINT: 2, SIGTERM: 15, signal: () => null });
  const sys = () => mod('sys', { exit: () => { throw new PyThrow(new PyExc(EXC.SystemExit, '')); }, argv: [], platform: m.kind === 'pi5' ? 'linux' : 'esp32', version: m.kind === 'pi5' ? '3.11.2' : '3.4.0; MicroPython v1.23.0', implementation: new Module('implementation', { name: m.kind === 'pi5' ? 'cpython' : 'micropython' }), maxsize: 2 ** 31 - 1, stdout: new Module('stdout', { write: (a) => { m.out(str(a[0])); return a[0].length; } }) });
  const gc = () => mod('gc', { collect: () => null, mem_free: () => 110000 - Math.floor(m.now % 3000), mem_alloc: () => 9000, enable: () => null, disable: () => null });
  const micropython = () => mod('micropython', { const: (a) => a[0], mem_info: () => null, opt_level: () => 0, alloc_emergency_exception_buf: () => null, schedule: (a) => { I.spawnCall(a[0], [a[1]]); return null; } });
  const T = { time, math, random, signal, sys, gc, micropython };
  T.utime = time; T.urandom = random; T.usys = sys;
  return T;
}

// ---- shared pin helpers
function resolvePin(I, v, numbering) {
  const kind = I.m.kind;
  if (v instanceof HostObj && v.pinNo != null) return v.pinNo;
  if (typeof v === 'string') {
    const s = v.trim().toUpperCase();
    let mm;
    if ((mm = /^(?:GPIO|BCM|D)?(\d+)$/.exec(s))) return +mm[1];
    if ((mm = /^(?:BOARD|J8:)(\d+)$/.exec(s))) return physToGpio(I, +mm[1]);
    throw pyErr('ValueError', `'${v}' is not a pin name — use a number like 17 or a name like 'GPIO17'`);
  }
  if (typeof v === 'boolean' || typeof v !== 'number' || !Number.isInteger(v)) throw pyErr('TypeError', `a pin must be a whole number like 17, not ${typeName(v)}${v == null ? ' — did you forget the pin number?' : ''}`);
  if (numbering === 'BOARD') return physToGpio(I, v);
  void kind;
  return v;
}
function physToGpio(I, phys) {
  const p = pinsOf(I.m.kind).find((x) => x.phys === phys);
  if (!p) throw pyErr('ValueError', `physical pin ${phys} doesn't exist on the header (1–40)`);
  if (p.kind !== 'gpio') throw pyErr('ValueError', `physical pin ${phys} is ${p.name}, not a GPIO`);
  return +p.id.slice(4);
}

// ---------------------------------------------------------------- gpiozero (Raspberry Pi 5)
function gpiozeroMod(I) {
  const m = I.m, hw = m.hw, B = m.board;
  const GPIOPinInUse = new ExcType('GPIOPinInUse', EXC.Exception);
  const BadEventHandler = new ExcType('BadEventHandler', EXC.Exception);
  const owners = (I.owners ||= new Map());
  const claim = (o, v, { output = false, label } = {}) => {
    const pin = resolvePin(I, v);
    m.checkPin(pin, I.$.l, { output });
    const prev = owners.get(pin);
    if (prev && prev !== o && !prev.closed) throw new PyThrow(new PyExc(GPIOPinInUse, `pin GPIO${pin} is already in use by ${prev.$cls.name}(${pin}) — each pin can belong to one device (or call .close() first)`));
    owners.set(pin, o);
    (o.pins ||= []).push(pin);
    void label;
    return pin;
  };
  const opt = (a, kw, i, name, d) => (a.length > i ? a[i] : name in kw ? kw[name] : d);
  const cancel = (o) => { o.task = (o.task || 0) + 1; };
  const bg = (o, body, background) => {
    cancel(o); const id = o.task;
    const g = (function* () { yield* body(() => o.task === id); })();
    if (background === false) return g; // run in the caller
    m.spawn(g, 'bg'); return null;
  };
  const closeM = (o) => { cancel(o); o.closed = true; for (const p of o.pins || []) { owners.delete(p); hw.release(B, p); hw.mode(B, p, 0); m.detach(p); } return null; };
  const pinName = (o) => `GPIO${o.pins?.[0]}`;
  const cb = (v) => { if (v != null && !(v instanceof PyFunc || typeof v === 'function' || v instanceof Bound)) throw new PyThrow(new PyExc(BadEventHandler, `the event handler must be a function (got ${typeName(v)}) — write when_pressed = my_function, without the ()`)); return v; };
  const runMaybe = function* (g) { if (g) yield* g; return null; };

  // ---- digital outputs
  const digitalOut = (name, extra = {}) => hc(name, {
    init(o, a, kw) { o.pinNo = claim(o, opt(a, kw, 0, 'pin'), { output: true }); o.ah = truthy(opt(a, kw, 1, 'active_high', true)); o.v = 0; o.set = (v) => { o.v = v ? 1 : 0; hw.write(B, o.pinNo, o.v ^ (o.ah ? 0 : 1)); }; o.set(truthy(opt(a, kw, 2, 'initial_value', false))); },
    methods: {
      on: (o) => { cancel(o); o.set(1); return null; }, off: (o) => { cancel(o); o.set(0); return null; }, toggle: (o) => { cancel(o); o.set(!o.v); return null; },
      blink: gen(function* (o, a, kw) {
        const on = fl(opt(a, kw, 0, 'on_time', 1), 'on_time'), off = fl(opt(a, kw, 1, 'off_time', 1), 'off_time'), n = opt(a, kw, 2, 'n', null), back = opt(a, kw, 3, 'background', true);
        return yield* runMaybe(bg(o, function* (alive) { for (let i = 0; n == null || i < n; i++) { if (!alive()) return; o.set(1); yield on * 1000; if (!alive()) return; o.set(0); yield off * 1000; } }, truthy(back)));
      }),
      close: closeM, ...(extra.methods || {}),
    },
    props: {
      value: { get: (o) => o.v, set: (o, v) => { cancel(o); o.set(truthy(v)); } },
      is_active: { get: (o) => !!o.v }, is_lit: { get: (o) => !!o.v }, pin: { get: (o) => pinName(o) }, active_high: { get: (o) => o.ah }, closed: { get: (o) => !!o.closed },
    },
    str: (o) => `<gpiozero.${name} object on pin ${pinName(o)}, active_high=${o.ah ? 'True' : 'False'}, is_active=${o.v ? 'True' : 'False'}>`,
  });
  const LED = digitalOut('LED');
  const DigitalOutputDevice = digitalOut('DigitalOutputDevice');
  const OutputDevice = digitalOut('OutputDevice');
  const Buzzer = digitalOut('Buzzer', { methods: {
    beep: gen(function* (o, a, kw) {
      const on = fl(opt(a, kw, 0, 'on_time', 1), 'on_time'), off = fl(opt(a, kw, 1, 'off_time', 1), 'off_time'), n = opt(a, kw, 2, 'n', null), back = opt(a, kw, 3, 'background', true);
      return yield* runMaybe(bg(o, function* (alive) { for (let i = 0; n == null || i < n; i++) { if (!alive()) return; o.set(1); yield on * 1000; if (!alive()) return; o.set(0); yield off * 1000; } }, truthy(back)));
    }),
  } });
  // ---- PWM outputs
  const pwmOut = (name) => hc(name, {
    init(o, a, kw) {
      o.pinNo = claim(o, opt(a, kw, 0, 'pin'), { output: true }); o.ah = truthy(opt(a, kw, 1, 'active_high', true)); o.freq = opt(a, kw, 3, 'frequency', 100); o.v = 0;
      o.set = (v) => { v = Math.max(0, Math.min(1, fl(v, 'value'))); o.v = v; const d = o.ah ? v : 1 - v; if (d === 0 || d === 1) hw.write(B, o.pinNo, d); else hw.pwm(B, o.pinNo, d, Math.max(o.freq, 500)); };
      o.set(opt(a, kw, 2, 'initial_value', 0));
    },
    methods: {
      on: (o) => { cancel(o); o.set(1); return null; }, off: (o) => { cancel(o); o.set(0); return null; }, toggle: (o) => { cancel(o); o.set(1 - o.v); return null; },
      blink: gen(function* (o, a, kw) {
        const on = opt(a, kw, 0, 'on_time', 1), off = opt(a, kw, 1, 'off_time', 1), fi = opt(a, kw, 2, 'fade_in_time', 0), fo = opt(a, kw, 3, 'fade_out_time', 0), n = opt(a, kw, 4, 'n', null), back = opt(a, kw, 5, 'background', true);
        return yield* runMaybe(bg(o, fader(o, on, off, fi, fo, n), truthy(back)));
      }),
      pulse: gen(function* (o, a, kw) {
        const fi = opt(a, kw, 0, 'fade_in_time', 1), fo = opt(a, kw, 1, 'fade_out_time', 1), n = opt(a, kw, 2, 'n', null), back = opt(a, kw, 3, 'background', true);
        return yield* runMaybe(bg(o, fader(o, 0, 0, fi, fo, n), truthy(back)));
      }),
      close: closeM,
    },
    props: {
      value: { get: (o) => o.v, set: (o, v) => { cancel(o); if (v < 0 || v > 1) throw pyErr('ValueError', `${name}.value must be between 0 and 1 (got ${str(v)})`); o.set(v); } },
      is_active: { get: (o) => o.v > 0 }, is_lit: { get: (o) => o.v > 0 }, pin: { get: (o) => pinName(o) }, frequency: { get: (o) => o.freq, set: (o, f) => { o.freq = f; o.set(o.v); } },
    },
  });
  function fader(o, on, off, fi, fo, n) {
    return function* (alive) {
      const fps = 25;
      for (let i = 0; n == null || i < n; i++) {
        for (let k = 1; k <= Math.round(fi * fps); k++) { if (!alive()) return; o.set(k / Math.round(fi * fps)); yield 1000 / fps; }
        if (!alive()) return; o.set(1); if (on) yield on * 1000;
        for (let k = Math.round(fo * fps) - 1; k >= 0; k--) { if (!alive()) return; o.set(k / Math.round(fo * fps)); yield 1000 / fps; }
        if (!alive()) return; o.set(0); if (off) yield off * 1000;
      }
    };
  }
  const PWMLED = pwmOut('PWMLED');
  const PWMOutputDevice = pwmOut('PWMOutputDevice');
  // ---- tones
  const Tone = hc('Tone', {
    init(o, a, kw) { if ('midi' in kw) o.hz = 440 * 2 ** ((kw.midi - 69) / 12); else if ('frequency' in kw) o.hz = kw.frequency; else if ('note' in kw) o.hz = toneHz(kw.note); else o.hz = toneHz(a[0]); },
    props: { frequency: { get: (o) => o.hz }, midi: { get: (o) => Math.round(69 + 12 * Math.log2(o.hz / 440)) }, note: { get: (o) => { const mi = Math.round(69 + 12 * Math.log2(o.hz / 440)); return ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][mi % 12] + (Math.floor(mi / 12) - 1); } } },
    str: (o) => `<Tone note='${str(I.getattr(o, 'note'))}' midi=${I.getattr(o, 'midi')} frequency=${o.hz.toFixed(2)}Hz>`,
  });
  const TonalBuzzer = hc('TonalBuzzer', {
    init(o, a, kw) { o.pinNo = claim(o, opt(a, kw, 0, 'pin'), { output: true }); o.hz = 0; const iv = opt(a, kw, 1, 'initial_value', null); if (iv != null) o.play(iv); },
    methods: {
      play: (o, a) => { const hz = toneHz(a[0]); if (hz < 20 || hz > 20000) throw pyErr('ValueError', `tone ${hz.toFixed(1)} Hz is outside the audible range`); o.hz = hz; hw.tone(B, o.pinNo, Math.round(hz)); return null; },
      stop: (o) => { o.hz = 0; hw.tone(B, o.pinNo, 0); hw.write(B, o.pinNo, 0); return null; }, close: closeM,
    },
    props: { is_active: { get: (o) => o.hz > 0 }, tone: { get: (o) => (o.hz ? Object.assign(new HostObj(Tone), { hz: o.hz }) : null) }, value: { get: (o) => (o.hz ? Math.log2(o.hz / 440) : null), set: (o, v) => { if (v == null) TonalBuzzer.methods.stop(o); else TonalBuzzer.methods.play(o, [440 * 2 ** v]); } }, pin: { get: (o) => pinName(o) } },
  });
  // patch play onto instances via init helper
  const tbInit = TonalBuzzer.init; TonalBuzzer.init = (o, a, kw) => { o.play = (t) => TonalBuzzer.methods.play(o, [t]); return tbInit(o, a, kw); };
  // ---- servos
  const servoCls = (name, angular) => hc(name, {
    init(o, a, kw) {
      o.pinNo = claim(o, opt(a, kw, 0, 'pin'), { output: true });
      o.minPw = fl(kw.min_pulse_width ?? 1 / 1000, 'min_pulse_width'); o.maxPw = fl(kw.max_pulse_width ?? 2 / 1000, 'max_pulse_width');
      o.minA = kw.min_angle ?? -90; o.maxA = kw.max_angle ?? 90;
      if (o.minPw >= 0.0009 && o.maxPw <= 0.0021) m.noteOnce('gz-servo', `Line ${I.$.l}: gpiozero's default pulse range (1–2 ms) only turns an SG90 about ±45°. For the full sweep use ${name}(${o.pinNo}, min_pulse_width=0.5/1000, max_pulse_width=2.5/1000).`);
      o.set = (v) => { if (v == null) { o.v = null; hw.release(B, o.pinNo); return; } v = fl(v, 'value'); if (v < -1 || v > 1) throw pyErr('OutputDeviceBadValue' in EXC ? 'ValueError' : 'ValueError', `${name} value must be between -1 and 1 (got ${str(v)})`); o.v = v; hw.servo(B, o.pinNo, Math.round((o.minPw + ((v + 1) / 2) * (o.maxPw - o.minPw)) * 1e6)); };
      const iv = angular ? kw.initial_angle ?? 0 : opt(a, kw, 1, 'initial_value', 0);
      if (angular) o.set(iv == null ? null : ((iv - o.minA) / (o.maxA - o.minA)) * 2 - 1); else o.set(iv);
    },
    methods: { min: (o) => { o.set(-1); return null; }, mid: (o) => { o.set(0); return null; }, max: (o) => { o.set(1); return null; }, detach: (o) => { o.set(null); return null; }, close: closeM },
    props: {
      value: { get: (o) => o.v, set: (o, v) => o.set(v) }, is_active: { get: (o) => o.v != null }, pin: { get: (o) => pinName(o) },
      pulse_width: { get: (o) => (o.v == null ? null : o.minPw + ((o.v + 1) / 2) * (o.maxPw - o.minPw)) },
      ...(angular ? { angle: { get: (o) => (o.v == null ? null : o.minA + ((o.v + 1) / 2) * (o.maxA - o.minA)), set: (o, ang) => { if (ang == null) { o.set(null); return; } ang = fl(ang, 'angle'); const lo = Math.min(o.minA, o.maxA), hi = Math.max(o.minA, o.maxA); if (ang < lo || ang > hi) throw pyErr('ValueError', `angle ${str(ang)} is outside ${lo}…${hi}`); o.set(((ang - o.minA) / (o.maxA - o.minA)) * 2 - 1); } }, min_angle: { get: (o) => o.minA }, max_angle: { get: (o) => o.maxA } } : {}),
    },
  });
  const Servo = servoCls('Servo', false), AngularServo = servoCls('AngularServo', true);
  // ---- motor
  const Motor = hc('Motor', {
    init(o, a, kw) { o.f = claim(o, opt(a, kw, 0, 'forward'), { output: true }); o.b = claim(o, opt(a, kw, 1, 'backward'), { output: true }); o.pwm = truthy(kw.pwm ?? true); o.v = 0; o.apply(); },
    methods: {
      forward: (o, a, kw) => { o.v = fl(opt(a, kw, 0, 'speed', 1), 'speed'); if (o.v < 0 || o.v > 1) throw pyErr('ValueError', 'speed must be between 0 and 1'); o.apply(); return null; },
      backward: (o, a, kw) => { const s = fl(opt(a, kw, 0, 'speed', 1), 'speed'); if (s < 0 || s > 1) throw pyErr('ValueError', 'speed must be between 0 and 1'); o.v = -s; o.apply(); return null; },
      stop: (o) => { o.v = 0; o.apply(); return null; }, reverse: (o) => { o.v = -o.v; o.apply(); return null; }, close: closeM,
    },
    props: { value: { get: (o) => o.v, set: (o, v) => { o.v = Math.max(-1, Math.min(1, fl(v, 'value'))); o.apply(); } }, is_active: { get: (o) => o.v !== 0 } },
  });
  Motor.init = ((init) => (o, a, kw) => { o.apply = () => { const drive = (p, s) => { if (s <= 0) hw.write(B, p, 0); else if (s >= 1 || !o.pwm) hw.write(B, p, 1); else hw.pwm(B, p, s, 1000); }; drive(o.f, o.v > 0 ? o.v : 0); drive(o.b, o.v < 0 ? -o.v : 0); }; return init(o, a, kw); })(Motor.init);
  // ---- RGB LED
  const RGBLED = hc('RGBLED', {
    init(o, a, kw) {
      o.p = [opt(a, kw, 0, 'red'), opt(a, kw, 1, 'green'), opt(a, kw, 2, 'blue')].map((v) => claim(o, v, { output: true }));
      o.ah = truthy(kw.active_high ?? true); o.c = [0, 0, 0];
      o.set = (c) => { const cc = list(c).map((x) => fl(x, 'color')); if (cc.length !== 3 || cc.some((x) => x < 0 || x > 1)) throw pyErr('ValueError', 'color must be a tuple of 3 values between 0 and 1, like (1, 0, 0.5)'); o.c = cc; cc.forEach((v, i) => { const d = o.ah ? v : 1 - v; if (d === 0 || d === 1) hw.write(B, o.p[i], d); else hw.pwm(B, o.p[i], d, 500); }); };
      o.set(kw.initial_value ?? [0, 0, 0]);
    },
    methods: { on: (o) => { o.set([1, 1, 1]); return null; }, off: (o) => { o.set([0, 0, 0]); return null; }, toggle: (o) => { o.set(o.c.map((x) => 1 - x)); return null; }, close: closeM },
    props: {
      color: { get: (o) => TUPLE(o.c.slice()), set: (o, v) => o.set(v) }, value: { get: (o) => TUPLE(o.c.slice()), set: (o, v) => o.set(v) }, is_active: { get: (o) => o.c.some((x) => x > 0) }, is_lit: { get: (o) => o.c.some((x) => x > 0) },
      red: { get: (o) => o.c[0], set: (o, v) => o.set([v, o.c[1], o.c[2]]) }, green: { get: (o) => o.c[1], set: (o, v) => o.set([o.c[0], v, o.c[2]]) }, blue: { get: (o) => o.c[2], set: (o, v) => o.set([o.c[0], o.c[1], v]) },
    },
  });
  // ---- digital inputs (Button, MotionSensor, DigitalInputDevice)
  const inputCls = (name, { pullDefault, act, deact, isProp, waitOn, waitOff }) => hc(name, {
    init(o, a, kw) {
      o.pinNo = claim(o, opt(a, kw, 0, 'pin'));
      const pu = opt(a, kw, 1, 'pull_up', pullDefault);
      o.pu = pu;
      hw.mode(B, o.pinNo, pu === true ? 5 : pu === false ? 9 : 1);
      if (pu == null && 'active_state' in kw) o.activeLow = !truthy(kw.active_state); else o.activeLow = pu === true;
      o.holdTime = fl(kw.hold_time ?? 1, 'hold_time'); o.holdRepeat = truthy(kw.hold_repeat ?? false);
      o.cb = {};
      o.active = () => (hw.level(B, o.pinNo) ? 1 : 0) ^ (o.activeLow ? 1 : 0);
      o.since = 0; o.held = false;
      m.attach(o.pinNo, (rising) => (function* () {
        const on = (rising ? 1 : 0) ^ (o.activeLow ? 1 : 0);
        o.since = m.now; o.held = false;
        const f = on ? o.cb.act : o.cb.deact;
        if (on && o.cb.held) { const t0 = m.now; m.spawn((function* () { do { yield o.holdTime * 1000; if (!o.active() || o.since !== t0) return; o.held = true; yield* I.call(o.cb.held, I.arity(o.cb.held, 1) ? [o] : []); } while (o.holdRepeat); })(), 'hold'); }
        if (f) { try { yield* I.call(f, I.arity(f, 1) ? [o] : []); } catch (e) { throw I.toRunError(e); } }
      })(), 3, I.$.l);
    },
    methods: {
      [waitOn]: gen(function* (o, a, kw) { const to = opt(a, kw, 0, 'timeout', null); const t0 = m.now; while (!o.active()) { if (to != null && m.now - t0 >= to * 1000) return false; yield 5; } return true; }),
      [waitOff]: gen(function* (o, a, kw) { const to = opt(a, kw, 0, 'timeout', null); const t0 = m.now; while (o.active()) { if (to != null && m.now - t0 >= to * 1000) return false; yield 5; } return true; }),
      wait_for_active: gen(function* (o) { while (!o.active()) yield 5; return true; }), wait_for_inactive: gen(function* (o) { while (o.active()) yield 5; return true; }),
      close: closeM,
    },
    props: {
      [isProp]: { get: (o) => !!o.active() }, value: { get: (o) => o.active() }, is_active: { get: (o) => !!o.active() }, pin: { get: (o) => pinName(o) }, pull_up: { get: (o) => o.pu },
      is_held: { get: (o) => o.held }, held_time: { get: (o) => (o.held ? (m.now - o.since) / 1000 : null) }, active_time: { get: (o) => (o.active() ? (m.now - o.since) / 1000 : null) },
      [act]: { get: (o) => o.cb.act ?? null, set: (o, v) => { o.cb.act = cb(v); } }, [deact]: { get: (o) => o.cb.deact ?? null, set: (o, v) => { o.cb.deact = cb(v); } },
      when_activated: { get: (o) => o.cb.act ?? null, set: (o, v) => { o.cb.act = cb(v); } }, when_deactivated: { get: (o) => o.cb.deact ?? null, set: (o, v) => { o.cb.deact = cb(v); } },
      when_held: { get: (o) => o.cb.held ?? null, set: (o, v) => { o.cb.held = cb(v); } }, hold_time: { get: (o) => o.holdTime, set: (o, v) => { o.holdTime = v; } },
    },
  });
  const Button = inputCls('Button', { pullDefault: true, act: 'when_pressed', deact: 'when_released', isProp: 'is_pressed', waitOn: 'wait_for_press', waitOff: 'wait_for_release' });
  const MotionSensor = inputCls('MotionSensor', { pullDefault: false, act: 'when_motion', deact: 'when_no_motion', isProp: 'motion_detected', waitOn: 'wait_for_motion', waitOff: 'wait_for_no_motion' });
  const DigitalInputDevice = inputCls('DigitalInputDevice', { pullDefault: false, act: 'when_activated', deact: 'when_deactivated', isProp: 'is_active', waitOn: 'wait_for_active', waitOff: 'wait_for_inactive' });
  // ---- distance sensor (HC-SR04)
  const DistanceSensor = hc('DistanceSensor', {
    init(o, a, kw) {
      o.echo = claim(o, opt(a, kw, 0, 'echo')); o.trig = claim(o, opt(a, kw, 1, 'trigger'), { output: true }); hw.write(B, o.trig, 0);
      o.max = fl(kw.max_distance ?? 1, 'max_distance'); o.thr = fl(kw.threshold_distance ?? 0.3, 'threshold_distance'); o.lastPing = -1e9;
      o.read = () => {
        const p = hw.partsAt(B, 'hcsr04', 'ECHO', o.echo)[0];
        if (!p) { m.noteOnce('ds-echo', `Line ${I.$.l}: DistanceSensor(echo=${o.echo}) — no HC-SR04 ECHO pin is wired to GPIO${o.echo}. (On a real Pi, put a voltage divider on ECHO: it outputs 5 V.)`); return o.max; }
        if (!hw.partsAt(B, 'hcsr04', 'TRIG', o.trig).includes(p)) { m.noteOnce('ds-trig', `Line ${I.$.l}: DistanceSensor(trigger=${o.trig}) — the HC-SR04 TRIG pin is not wired to GPIO${o.trig}.`); return o.max; }
        if (m.now - o.lastPing > 60) { o.lastPing = m.now; hw.setExtra(p.id, { ping: (hw.extra[p.id]?.ping || 0) + 1 }); }
        const cm = hw.inputs[p.id]?.cm ?? 40;
        return Math.min(o.max, Math.max(0.02, cm / 100));
      };
    },
    methods: { close: closeM, wait_for_in_range: gen(function* (o) { while (o.read() >= o.thr) yield 60; return null; }), wait_for_out_of_range: gen(function* (o) { while (o.read() < o.thr) yield 60; return null; }) },
    props: { distance: { get: (o) => o.read() }, value: { get: (o) => o.read() / o.max }, max_distance: { get: (o) => o.max, set: (o, v) => { o.max = v; } }, threshold_distance: { get: (o) => o.thr, set: (o, v) => { o.thr = v; } }, in_range: { get: (o) => o.read() < o.thr }, echo: { get: (o) => `GPIO${o.echo}` }, trigger: { get: (o) => `GPIO${o.trig}` } },
  });
  // ---- MCP3008 (SPI ADC)
  const MCP3008 = hc('MCP3008', {
    init(o, a, kw) { o.ch = toInt(opt(a, kw, 0, 'channel', 0)); if (o.ch < 0 || o.ch > 7) throw pyErr('ValueError', 'channel must be 0…7'); o.vmax = kw.max_voltage ?? 3.3; },
    methods: { close: () => null },
    props: {
      value: { get: (o) => mcpRead(o) / o.vmax }, voltage: { get: (o) => mcpRead(o) }, raw_value: { get: (o) => Math.round((mcpRead(o) / o.vmax) * 1023) }, channel: { get: (o) => o.ch },
    },
  });
  function mcpRead(o) {
    const chip = hw.partsAt(B, 'mcp3008', 'CLK', 11)[0] || hw.partsAt(B, 'mcp3008', 'CLK')[0];
    if (!chip) { m.noteOnce('mcp', `Line ${I.$.l}: MCP3008 — no MCP3008 is wired to the Pi's SPI pins (CLK→GPIO11, DOUT→GPIO9, DIN→GPIO10, CS→GPIO8).`); return 0; }
    if (o.ch > 2) return 0;
    const v = hw.solve().v(`${chip.id}.CH${o.ch}`) ?? 0;
    return Math.max(0, Math.min(o.vmax, v));
  }
  const CPUTemperature = hc('CPUTemperature', { init() {}, props: { temperature: { get: () => Math.round((47.8 + Math.sin(m.now / 7000) * 1.5) * 10) / 10 }, value: { get: () => 0.478 }, is_active: { get: () => false } } });
  // ---- groups
  const LEDBoard = hc('LEDBoard', {
    *init(o, a, kw) { o.leds = []; for (const p of a) o.leds.push(yield* I.call(kw.pwm ? PWMLED : LED, [p])); },
    methods: { on: (o) => { o.leds.forEach((l) => l.set(1)); return null; }, off: (o) => { o.leds.forEach((l) => l.set(0)); return null; }, toggle: (o) => { o.leds.forEach((l) => l.set(l.v ? 0 : 1)); return null; }, close: (o) => { o.leds.forEach(closeM); return null; } },
    props: { leds: { get: (o) => TUPLE(o.leds.slice()) }, value: { get: (o) => TUPLE(o.leds.map((l) => l.v)), set: (o, v) => list(v).forEach((x, i) => o.leds[i]?.set(x)) } },
    getitem: (o, k) => o.leds[normIdx(o.leds, k, 'LEDBoard')], len: (o) => o.leds.length, iter: (o) => o.leds,
  });
  const LEDBarGraph = LEDBoard;
  const TrafficLights = hc('TrafficLights', {
    *init(o, a, kw) { o.r = yield* I.call(LED, [opt(a, kw, 0, 'red')]); o.a = yield* I.call(LED, [opt(a, kw, 1, 'amber', kw.yellow)]); o.g = yield* I.call(LED, [opt(a, kw, 2, 'green')]); },
    methods: { on: (o) => { [o.r, o.a, o.g].forEach((l) => l.set(1)); return null; }, off: (o) => { [o.r, o.a, o.g].forEach((l) => l.set(0)); return null; }, close: (o) => { [o.r, o.a, o.g].forEach(closeM); return null; } },
    props: { red: { get: (o) => o.r }, amber: { get: (o) => o.a }, yellow: { get: (o) => o.a }, green: { get: (o) => o.g }, value: { get: (o) => TUPLE([o.r.v, o.a.v, o.g.v]), set: (o, v) => { const l = list(v); o.r.set(l[0]); o.a.set(l[1]); o.g.set(l[2]); } } },
  });
  const tones = mod('gpiozero.tones', { Tone });
  const attrs = { LED, PWMLED, Buzzer, TonalBuzzer, Servo, AngularServo, Motor, RGBLED, Button, MotionSensor, DistanceSensor, DigitalInputDevice, DigitalOutputDevice, OutputDevice, PWMOutputDevice, MCP3008, CPUTemperature, LEDBoard, LEDBarGraph, TrafficLights, GPIOPinInUse, BadEventHandler, tones };
  const missing = {};
  for (const n of ['LightSensor', 'LineSensor', 'Robot', 'PhaseEnableMotor', 'LoadAverage', 'PingServer', 'TimeOfDay', 'DiskUsage', 'SmoothedInputDevice', 'RotaryEncoder', 'SPIDevice', 'MCP3004', 'MCP3204', 'MCP3208', 'StatusZero', 'Energenie', 'PiHutXmasTree', 'JamHat', 'CamJamKitRobot']) missing[n] = `${n} is not simulated in the canvas yet.`;
  const md = mod('gpiozero', attrs, missing);
  return { gpiozero: md, 'gpiozero.tones': tones };
}

// ---------------------------------------------------------------- RPi.GPIO (Raspberry Pi 5, legacy API via lgpio shim)
function rpiGpioMod(I) {
  const m = I.m, hw = m.hw, B = m.board;
  let mode = null; const setupAs = new Map(); const events = new Map();
  const chs = (v) => (Array.isArray(v) ? v : [v]);
  const pinOf = (ch) => {
    if (mode == null) throw pyErr('RuntimeError', 'Please set pin numbering mode using GPIO.setmode(GPIO.BOARD) or GPIO.setmode(GPIO.BCM)');
    const p = resolvePin(I, ch, mode === 10 ? 'BOARD' : 'BCM'); m.checkPin(p, I.$.l); return p;
  };
  const PWM = hc('PWM', {
    init(o, a) { o.pin = pinOf(a[0]); if (setupAs.get(o.pin) !== 0) throw pyErr('RuntimeError', `You must setup() the GPIO channel as an output first — GPIO.setup(${str(a[0])}, GPIO.OUT)`); o.f = fl(a[1], 'frequency'); if (o.f <= 0) throw pyErr('ValueError', 'frequency must be greater than 0.0'); o.dc = 0; o.on = false; o.apply = () => { if (!o.on) { hw.write(B, o.pin, 0); return; } const d = o.dc / 100; if (d <= 0) hw.write(B, o.pin, 0); else if (d >= 1) hw.write(B, o.pin, 1); else hw.pwm(B, o.pin, d, o.f); }; },
    methods: {
      start: (o, a) => { const dc = fl(a[0], 'duty cycle'); if (dc < 0 || dc > 100) throw pyErr('ValueError', 'dutycycle must have a value from 0.0 to 100.0'); o.dc = dc; o.on = true; o.apply(); return null; },
      ChangeDutyCycle: (o, a) => { const dc = fl(a[0], 'duty cycle'); if (dc < 0 || dc > 100) throw pyErr('ValueError', 'dutycycle must have a value from 0.0 to 100.0'); o.dc = dc; o.apply(); return null; },
      ChangeFrequency: (o, a) => { o.f = fl(a[0], 'frequency'); o.apply(); return null; },
      stop: (o) => { o.on = false; o.apply(); return null; },
    },
  });
  const edgeMode = (e) => ({ 31: 1, 32: 2, 33: 3 })[e] || (() => { throw pyErr('ValueError', 'The edge must be set to RISING, FALLING or BOTH'); })();
  const attrs = {
    BCM: 11, BOARD: 10, OUT: 0, IN: 1, HIGH: 1, LOW: 0, PUD_UP: 22, PUD_DOWN: 21, PUD_OFF: 20, RISING: 31, FALLING: 32, BOTH: 33, VERSION: '0.7.1a4', RPI_INFO: new Dict([['P1_REVISION', 3], ['TYPE', 'Pi 5 Model B']]), PWM,
    setmode: (a) => { if (a[0] !== 10 && a[0] !== 11) throw pyErr('ValueError', 'An invalid mode was passed to setmode() — use GPIO.BCM or GPIO.BOARD'); if (mode != null && mode !== a[0]) throw pyErr('ValueError', 'A different mode has already been set!'); mode = a[0]; return null; },
    getmode: () => mode, setwarnings: () => null,
    setup: (a, kw) => {
      const dir = a[1] ?? kw.direction; const pud = a[2] ?? kw.pull_up_down ?? 20; const init = a[3] ?? kw.initial;
      if (dir !== 0 && dir !== 1) throw pyErr('ValueError', 'An invalid direction was passed to setup() — use GPIO.IN or GPIO.OUT');
      for (const ch of chs(a[0] ?? kw.channel)) {
        const p = pinOf(ch); setupAs.set(p, dir);
        if (dir === 0) { m.checkPin(p, I.$.l, { output: true }); hw.write(B, p, init ? 1 : 0); }
        else hw.mode(B, p, pud === 22 ? 5 : pud === 21 ? 9 : 1);
      }
      return null;
    },
    output: (a) => {
      const cs = chs(a[0]), vs = Array.isArray(a[1]) ? a[1] : cs.map(() => a[1]);
      cs.forEach((ch, i) => { const p = pinOf(ch); if (setupAs.get(p) !== 0) throw pyErr('RuntimeError', `The GPIO channel has not been set up as an OUTPUT — call GPIO.setup(${str(ch)}, GPIO.OUT) first`); hw.write(B, p, truthy(vs[i])); });
      return null;
    },
    input: (a) => { const p = pinOf(a[0]); if (!setupAs.has(p)) throw pyErr('RuntimeError', `You must setup() the GPIO channel first — GPIO.setup(${str(a[0])}, GPIO.IN)`); return hw.level(B, p); },
    cleanup: (a) => { const list2 = a.length && a[0] != null ? chs(a[0]).map(pinOf) : [...setupAs.keys()]; for (const p of list2) { hw.release(B, p); hw.mode(B, p, 0); m.detach(p); setupAs.delete(p); events.delete(p); } if (!a.length) mode = null; return null; },
    add_event_detect: (a, kw) => {
      const p = pinOf(a[0]); if (setupAs.get(p) !== 1) throw pyErr('RuntimeError', 'You must setup() the GPIO channel as an input first');
      if (events.has(p)) throw pyErr('RuntimeError', 'Conflicting edge detection already enabled for this GPIO channel');
      const ev = { cbs: [], flag: false }; events.set(p, ev); const cb0 = a[2] ?? kw.callback; if (cb0) ev.cbs.push(cb0);
      m.attach(p, () => (function* () { ev.flag = true; try { for (const f of ev.cbs) yield* I.call(f, I.arity(f, 1) ? [a[0]] : []); } catch (e) { throw I.toRunError(e); } })(), edgeMode(a[1] ?? kw.edge), I.$.l);
      return null;
    },
    add_event_callback: (a) => { const ev = events.get(pinOf(a[0])); if (!ev) throw pyErr('RuntimeError', 'Add event detection using add_event_detect first before adding a callback'); ev.cbs.push(a[1]); return null; },
    remove_event_detect: (a) => { const p = pinOf(a[0]); events.delete(p); m.detach(p); return null; },
    event_detected: (a) => { const ev = events.get(pinOf(a[0])); if (!ev) return false; const f = ev.flag; ev.flag = false; return f; },
    wait_for_edge: gen(function* (a, kw) {
      const p = pinOf(a[0]); const md = edgeMode(a[1]); const to = kw.timeout; const t0 = m.now; let last = hw.level(B, p);
      for (;;) { yield 1; const now = hw.level(B, p); if (now !== last) { const r = now === 1; last = now; if (md === 3 || (md === 1 && r) || (md === 2 && !r)) return a[0]; } if (to != null && m.now - t0 >= to) return null; }
    }),
    gpio_function: (a) => (setupAs.get(pinOf(a[0])) ?? -1),
  };
  const md = mod('RPi.GPIO', attrs);
  return { 'RPi.GPIO': md, RPi: new Module('RPi', { GPIO: md }) };
}

// ---------------------------------------------------------------- MicroPython (ESP32): machine, dht, neopixel, ssd1306, i2c_lcd
function microModules(I) {
  const m = I.m, hw = m.hw, B = m.board;
  const pinNo = (v) => { const p = resolvePin(I, v); m.checkPin(p, I.$.l); return p; };
  const Pin = hc('Pin', {
    init(o, a, kw) { o.pinNo = pinNo(a[0]); o.irqs = null; Pin.methods.init(o, a.slice(1), kw); },
    consts: { IN: 1, OUT: 3, OPEN_DRAIN: 7, PULL_UP: 2, PULL_DOWN: 1, PULL_HOLD: 4, IRQ_RISING: 1, IRQ_FALLING: 2, WAKE_LOW: 4, WAKE_HIGH: 5, DRIVE_0: 0, DRIVE_1: 1, DRIVE_2: 2, DRIVE_3: 3 },
    methods: {
      init: (o, a, kw) => {
        const md = a[0] ?? kw.mode ?? -1, pull = a[1] ?? kw.pull ?? -1, val = a[2] ?? kw.value;
        if (md === 3 || md === 7) { m.checkPin(o.pinNo, I.$.l, { output: true }); o.out = true; hw.write(B, o.pinNo, val != null ? truthy(val) : 0); }
        else if (md === 1) { o.out = false; hw.mode(B, o.pinNo, pull === 2 ? 5 : pull === 1 ? 9 : 1); }
        return null;
      },
      value: (o, a) => { if (a.length) { if (!o.out) m.noteOnce(`pv${o.pinNo}`, `Line ${I.$.l}: Pin(${o.pinNo}).value(…) on a pin that isn't Pin.OUT — create it with Pin(${o.pinNo}, Pin.OUT).`); hw.write(B, o.pinNo, truthy(a[0])); o.out = true; return null; } return hw.level(B, o.pinNo); },
      on: (o) => { hw.write(B, o.pinNo, 1); return null; }, off: (o) => { hw.write(B, o.pinNo, 0); return null; }, toggle: (o) => { hw.write(B, o.pinNo, hw.level(B, o.pinNo) ? 0 : 1); return null; },
      irq: (o, a, kw) => {
        const h = a[0] ?? kw.handler; const trig = a[1] ?? kw.trigger ?? 3;
        if (h == null) { m.detach(o.pinNo); return null; }
        if (trig < 1 || trig > 3) throw pyErr('ValueError', 'trigger must be Pin.IRQ_RISING, Pin.IRQ_FALLING, or both (Pin.IRQ_RISING | Pin.IRQ_FALLING)');
        m.attach(o.pinNo, () => (function* () { try { yield* I.call(h, I.arity(h, 1) ? [o] : []); } catch (e) { throw I.toRunError(e); } })(), trig, I.$.l);
        return null;
      },
    },
    call: (o, a) => (a.length ? (hw.write(B, o.pinNo, truthy(a[0])), null) : hw.level(B, o.pinNo)),
    str: (o) => `Pin(${o.pinNo})`,
  });
  const pinOfObj = (v) => (v instanceof HostObj && v.pinNo != null ? v.pinNo : pinNo(v));
  const PWM = hc('PWM', {
    init(o, a, kw) { o.pinNo = pinOfObj(a[0] ?? kw.dest); m.checkPin(o.pinNo, I.$.l, { output: true }); o.f = kw.freq ?? 5000; o.d = kw.duty_u16 != null ? kw.duty_u16 / 65535 : kw.duty != null ? kw.duty / 1023 : kw.duty_ns != null ? (kw.duty_ns * o.f) / 1e9 : 0.5; o.apply(); },
    methods: {
      freq: (o, a) => { if (!a.length) return o.f; const f = toInt(a[0]); if (f < 1 || f > 40000000) throw pyErr('ValueError', 'frequency must be from 1Hz to 40MHz'); o.f = f; o.apply(); return null; },
      duty: (o, a) => { if (!a.length) return Math.round(o.d * 1023); const d = toInt(a[0]); if (d < 0 || d > 1023) m.noteOnce('pwm-duty', `Line ${I.$.l}: duty() takes 0…1023 on the ESP32 — ${d} was clipped.`); o.d = Math.max(0, Math.min(1023, d)) / 1023; o.apply(); return null; },
      duty_u16: (o, a) => { if (!a.length) return Math.round(o.d * 65535); o.d = Math.max(0, Math.min(65535, toInt(a[0]))) / 65535; o.apply(); return null; },
      duty_ns: (o, a) => { if (!a.length) return Math.round((o.d / o.f) * 1e9); o.d = Math.max(0, Math.min(1, (toInt(a[0]) * o.f) / 1e9)); o.apply(); return null; },
      init: (o, a, kw) => { if (kw.freq != null) o.f = kw.freq; if (kw.duty != null) o.d = kw.duty / 1023; if (kw.duty_u16 != null) o.d = kw.duty_u16 / 65535; o.apply(); return null; },
      deinit: (o) => { hw.release(B, o.pinNo); hw.write(B, o.pinNo, 0); return null; },
    },
    str: (o) => `PWM(Pin(${o.pinNo}), freq=${o.f}, duty_u16=${Math.round(o.d * 65535)})`,
  });
  PWM.init = ((init) => (o, a, kw) => { o.apply = () => { if (o.f >= 40 && o.f <= 400) hw.servo(B, o.pinNo, Math.round((o.d / o.f) * 1e6)); else if (o.d <= 0) hw.write(B, o.pinNo, 0); else if (o.d >= 1) hw.write(B, o.pinNo, 1); else hw.pwm(B, o.pinNo, o.d, o.f); }; return init(o, a, kw); })(PWM.init);
  const ADC = hc('ADC', {
    init(o, a, kw) { o.pinNo = pinOfObj(a[0]); m.checkPin(o.pinNo, I.$.l, { analog: true }); o.att = kw.atten ?? 0; o.tip = () => { if (o.att === 0) m.noteOnce('adc-att', `Line ${I.$.l}: tip — ADC() starts with 0 dB attenuation (max ≈1.1 V on a real ESP32; the canvas reads 0–3.3 V). Add adc.atten(ADC.ATTN_11DB) to match real hardware.`); }; },
    consts: { ATTN_0DB: 0, ATTN_2_5DB: 1, ATTN_6DB: 2, ATTN_11DB: 3, WIDTH_9BIT: 9, WIDTH_10BIT: 10, WIDTH_11BIT: 11, WIDTH_12BIT: 12 },
    methods: {
      read: (o) => (o.tip(), Math.round((Math.max(0, Math.min(3.3, hw.volts(B, o.pinNo))) / 3.3) * 4095)), read_u16: (o) => Math.round((Math.max(0, Math.min(3.3, hw.volts(B, o.pinNo))) / 3.3) * 65535),
      read_uv: (o) => Math.round(hw.volts(B, o.pinNo) * 1e6), atten: (o, a) => { o.att = a[0]; return null; }, width: () => null,
    },
  });
  const I2C_ADDR = { lcd1602: 0x27, oled: 0x3c, bme280: 0x76, mpu6050: 0x68 };
  const i2cCls = (name) => hc(name, {
    init(o, a, kw) { o.scl = kw.scl != null ? pinOfObj(kw.scl) : 22; o.sda = kw.sda != null ? pinOfObj(kw.sda) : 21; o.freq = kw.freq ?? 400000; },
    methods: {
      scan: () => { const r = []; for (const [t, ad] of Object.entries(I2C_ADDR)) if (hw.i2c(B, t).length) r.push(ad); return r.sort((x, y) => x - y); },
      writeto: (o, a) => { m.noteOnce('i2c-raw', `Line ${I.$.l}: raw I²C writes aren't simulated — use a driver module (ssd1306, i2c_lcd) instead.`); return a[1]?.length ?? 0; },
      readfrom: (o, a) => { m.noteOnce('i2c-raw', `Line ${I.$.l}: raw I²C reads aren't simulated — use a driver module instead.`); return new Uint8Array(a[1] || 0); },
      writeto_mem: () => null, readfrom_mem: (o, a) => new Uint8Array(a[2] || 0),
    },
    str: (o) => `${name}(scl=${o.scl}, sda=${o.sda}, freq=${o.freq})`,
  });
  const Timer = hc('Timer', {
    init(o) { o.gen = 0; },
    consts: { ONE_SHOT: 0, PERIODIC: 1 },
    methods: {
      init: (o, a, kw) => {
        const period = kw.period ?? (kw.freq ? 1000 / kw.freq : 1000), once = (kw.mode ?? 1) === 0, cb = kw.callback; const id = ++o.gen;
        if (cb == null) throw pyErr('TypeError', 'Timer.init() needs callback=your_function');
        m.spawn((function* () { do { yield period; if (o.gen !== id) return; try { yield* I.call(cb, I.arity(cb, 1) ? [o] : []); } catch (e) { throw I.toRunError(e); } } while (!once && o.gen === id); })(), 'timer');
        return null;
      },
      deinit: (o) => { o.gen++; return null; },
    },
  });
  const time_pulse_us = gen(function* (a) {
    const p = pinOfObj(a[0]), lvl = a[1], to = a[2] ?? 1000000;
    const echo = hw.partsAt(B, 'hcsr04', 'ECHO', p)[0];
    if (!echo) { yield to / 1000; return -1; }
    const trig = hw.solve().netOf(`${echo.id}.TRIG`);
    const driven = Object.keys(hw.pins[B] || {}).some((g) => hw.solve().netOf(`${B}:GPIO${g}`) === trig && hw.pins[B][g].mode === 3);
    const cm = hw.inputs[echo.id]?.cm ?? 40;
    if (!driven) { yield to / 1000; return -2; }
    const t = Math.round(cm * 58.3);
    if (t > to) { yield to / 1000; return -1; }
    hw.setExtra(echo.id, { ping: (hw.extra[echo.id]?.ping || 0) + 1 });
    yield t / 1000; return lvl ? t : 0;
  });
  const machine = mod('machine', {
    Pin, PWM, ADC, I2C: i2cCls('I2C'), SoftI2C: i2cCls('SoftI2C'), Timer, time_pulse_us,
    reset: () => { throw new Restart(); }, soft_reset: () => { throw new Restart(); },
    freq: (a) => (a.length ? null : 240000000), unique_id: () => 'b\'\\x24\\x6f\\x28\\xa1\\xb2\\xc3\'',
    idle: gen(function* () { yield 0; return null; }), lightsleep: gen(function* (a) { yield a[0] ?? 1e6; return null; }),
    deepsleep: gen(function* (a) { m.note(`Line ${I.$.l}: deepsleep(${a[0] ?? ''}) — the ESP32 sleeps, then restarts from the top.`); yield a[0] ?? 1e6; throw new Restart(); }),
    disable_irq: () => 0, enable_irq: () => null, reset_cause: () => 1, PWRON_RESET: 1, HARD_RESET: 2, WDT_RESET: 3, DEEPSLEEP_RESET: 4, SOFT_RESET: 5,
  }, { UART: 'UART is not simulated — use print() for serial output.', SPI: 'SPI is not simulated in MicroPython mode yet.', RTC: 'RTC is not simulated.', WDT: 'the watchdog is not simulated.', TouchPad: 'TouchPad is not simulated.', DAC: 'DAC is not simulated.' });
  // dht
  const dhtCls = (name) => hc(name, {
    init(o, a) { o.pinNo = pinOfObj(a[0]); o.r = null; },
    methods: {
      measure: (o) => {
        const p = hw.partsAt(B, 'dht22', 'DATA', o.pinNo)[0];
        if (!p) throw new PyThrow(new PyExc(EXC.OSError, `[Errno 116] ETIMEDOUT — no DHT22 DATA pin is wired to GPIO${o.pinNo}`));
        const s = hw.solve();
        if (!((s.v(`${p.id}.VCC`) ?? 0) >= 3 && s.v(`${p.id}.GND`) === 0)) throw new PyThrow(new PyExc(EXC.OSError, '[Errno 116] ETIMEDOUT — the DHT22 isn\'t powered (VCC→3V3, GND→GND)'));
        o.r = { ...hw.inputs[p.id] }; return null;
      },
      temperature: (o) => { if (!o.r) throw pyErr('RuntimeError', 'call measure() before temperature()'); return name === 'DHT11' ? Math.round(o.r.t) : Math.round(o.r.t * 10) / 10; },
      humidity: (o) => { if (!o.r) throw pyErr('RuntimeError', 'call measure() before humidity()'); return name === 'DHT11' ? Math.round(o.r.h) : Math.round(o.r.h * 10) / 10; },
    },
  });
  const dht = mod('dht', { DHT22: dhtCls('DHT22'), DHT11: dhtCls('DHT11') });
  // neopixel
  const NeoPixel = hc('NeoPixel', {
    init(o, a, kw) { o.pinNo = pinOfObj(a[0]); m.checkPin(o.pinNo, I.$.l, { output: true }); o.n = toInt(a[1] ?? kw.n); o.px = Array.from({ length: o.n }, () => [0, 0, 0]); },
    methods: {
      write: (o) => { const p = hw.partsAt(B, 'ring', 'DIN', o.pinNo)[0]; if (!p) { m.noteOnce('ring-miss', `Line ${I.$.l}: no NeoPixel ring DIN on GPIO${o.pinNo}.`); return null; } hw.setExtra(p.id, { pixels: o.px.map((c) => (c.some((x) => x) ? c.slice() : null)) }); return null; },
      fill: (o, a) => { const c = colour(a[0]); o.px = o.px.map(() => c.slice()); return null; },
    },
    props: { n: { get: (o) => o.n } },
    getitem: (o, k) => TUPLE(o.px[normIdx(o.px, k, 'NeoPixel')].slice()),
    setitem: (o, k, v) => { o.px[normIdx(o.px, k, 'NeoPixel')] = colour(v); },
    len: (o) => o.n,
  });
  function colour(v) { const l = list(v).map((x) => toInt(x)); if (l.length < 3 || l.some((x) => x < 0 || x > 255)) throw pyErr('ValueError', 'a NeoPixel colour is (r, g, b) with each value 0…255'); return l.slice(0, 3); }
  const neopixel = mod('neopixel', { NeoPixel });
  // ssd1306
  const SSD = hc('SSD1306_I2C', {
    init(o, a, kw) { o.w = toInt(a[0]); o.h = toInt(a[1]); o.ops = []; o.inv = false; o.on = true; },
    methods: {
      fill: (o, a) => { o.ops = a[0] ? [['rect', 0, 0, o.w, o.h, 1, 1]] : []; return null; },
      text: (o, a) => { o.ops.push(['text', toInt(a[1]), toInt(a[2]), 1, a[3] ?? 1, str(a[0])]); return null; },
      pixel: (o, a) => { if (a.length > 2) o.ops.push(['px', a[0], a[1], a[2]]); return a.length > 2 ? null : 0; },
      hline: (o, a) => { o.ops.push(['line', a[0], a[1], a[0] + a[2] - 1, a[1], a[3]]); return null; }, vline: (o, a) => { o.ops.push(['line', a[0], a[1], a[0], a[1] + a[2] - 1, a[3]]); return null; },
      line: (o, a) => { o.ops.push(['line', a[0], a[1], a[2], a[3], a[4]]); return null; },
      rect: (o, a) => { o.ops.push(['rect', a[0], a[1], a[2], a[3], a[5] ? 1 : 0, a[4]]); return null; }, fill_rect: (o, a) => { o.ops.push(['rect', a[0], a[1], a[2], a[3], 1, a[4]]); return null; },
      ellipse: (o, a) => { o.ops.push(['circ', a[0], a[1], a[2], a[5] ? 1 : 0, a[4]]); return null; },
      scroll: () => null, contrast: () => null, invert: (o, a) => { o.inv = truthy(a[0]); return null; }, poweroff: (o) => { o.on = false; SSD.methods.show(o); return null; }, poweron: (o) => { o.on = true; return null; },
      show: (o) => { const p = hw.i2c(B, 'oled')[0]; if (!p) { m.noteOnce('oled-miss', `Line ${I.$.l}: no OLED found on this board's I²C pins — wire its SDA and SCL to the board.`); return null; } const ops = o.on ? o.ops.slice() : []; m.setScreen(p.id, { kind: 'oled', w: o.w, h: o.h, ops, inv: o.inv, text: ops.filter((x) => x[0] === 'text').map((x) => x[5]).join('') }); return null; },
    },
  });
  const ssd1306 = mod('ssd1306', { SSD1306_I2C: SSD });
  // i2c LCD (the common lcd_api / i2c_lcd driver files)
  const lcd = lcdClass(I, 'I2cLcd', (a) => ({ rows: toInt(a[2] ?? 2), cols: toInt(a[3] ?? 16) }));
  const i2c_lcd = mod('i2c_lcd', { I2cLcd: lcd });
  return { machine, dht, neopixel, ssd1306, i2c_lcd, machine_i2c_lcd: i2c_lcd, esp8266_i2c_lcd: i2c_lcd, lcd_api: mod('lcd_api', { LcdApi: lcd }) };
}
function lcdClass(I, name, dims) {
  const m = I.m, hw = m.hw, B = m.board;
  const cls = hc(name, {
    init(o, a, kw) { Object.assign(o, dims(a, kw)); o.buf = Array.from({ length: o.rows }, () => ' '.repeat(o.cols)); o.cx = 0; o.cy = 0; o.light = true; o.on = true; o.push(); },
    methods: {
      putstr: (o, a) => { for (const ch of str(a[0])) { if (ch === '\n') { o.cx = 0; o.cy = (o.cy + 1) % o.rows; continue; } if (o.cx < o.cols) o.buf[o.cy] = o.buf[o.cy].slice(0, o.cx) + ch + o.buf[o.cy].slice(o.cx + 1); o.cx++; } o.push(); return null; },
      write_string: (o, a) => cls.methods.putstr(o, a), putchar: (o, a) => cls.methods.putstr(o, a),
      clear: (o) => { o.buf = o.buf.map(() => ' '.repeat(o.cols)); o.cx = 0; o.cy = 0; o.push(); return null; },
      move_to: (o, a) => { o.cx = toInt(a[0]); o.cy = Math.min(o.rows - 1, toInt(a[1])); return null; }, home: (o) => { o.cx = 0; o.cy = 0; return null; },
      backlight_on: (o) => { o.light = true; o.push(); return null; }, backlight_off: (o) => { o.light = false; o.push(); return null; },
      display_on: (o) => { o.on = true; o.push(); return null; }, display_off: (o) => { o.on = false; o.push(); return null; }, show_cursor: () => null, hide_cursor: () => null, blink_cursor_on: () => null, blink_cursor_off: () => null, close: () => null,
    },
    props: { cursor_pos: { get: (o) => TUPLE([o.cy, o.cx]), set: (o, v) => { const l = list(v); o.cy = toInt(l[0]); o.cx = toInt(l[1]); } }, backlight_enabled: { get: (o) => o.light, set: (o, v) => { o.light = truthy(v); o.push(); } } },
  });
  cls.init = ((init) => (o, a, kw) => { o.push = () => { const p = hw.i2c(B, 'lcd1602')[0]; if (!p) { m.noteOnce('lcd-miss', `Line ${I.$.l}: no LCD 1602 found on the I²C pins — wire its SDA and SCL to the board.`); return; } m.setScreen(p.id, { kind: 'lcd', lines: o.on ? o.buf.map((s) => s.trimEnd()) : o.buf.map(() => ''), light: o.light }); }; return init(o, a, kw); })(cls.init);
  return cls;
}

// ---------------------------------------------------------------- program assembly
const PI_ONLY = { gpiozero: 'gpiozero', 'gpiozero.tones': 'gpiozero', RPi: 'RPi.GPIO', 'RPi.GPIO': 'RPi.GPIO', signal: 'signal', RPLCD: 'RPLCD', 'RPLCD.i2c': 'RPLCD' };
const ESP_ONLY = { machine: 1, dht: 1, neopixel: 1, ssd1306: 1, i2c_lcd: 1, machine_i2c_lcd: 1, esp8266_i2c_lcd: 1, lcd_api: 1, micropython: 1, esp32: 1, network: 1, utime: 1, urandom: 1, usys: 1 };
function moduleTable(I) {
  const kind = I.m.kind;
  const std = stdModules(I);
  const lazy = {};
  const once = (fn) => { let v; return () => (v ||= fn()); };
  const gz = once(() => gpiozeroMod(I)), rp = once(() => rpiGpioMod(I)), mi = once(() => microModules(I));
  const T = {};
  for (const [k, f] of Object.entries(std)) T[k] = () => f();
  if (kind === 'pi5') {
    T.gpiozero = () => gz().gpiozero; T['gpiozero.tones'] = () => gz()['gpiozero.tones'];
    T.RPi = () => rp().RPi; T['RPi.GPIO'] = () => rp()['RPi.GPIO'];
    const rl = once(() => { const cls = lcdClass(I, 'CharLCD', (a, kw) => ({ rows: toInt(kw.rows ?? 2), cols: toInt(kw.cols ?? 16) })); return mod('RPLCD.i2c', { CharLCD: cls }); });
    T['RPLCD.i2c'] = rl; T.RPLCD = () => new Module('RPLCD', { i2c: rl() });
    for (const k of Object.keys(ESP_ONLY)) if (!T[k]) T[k] = k === 'machine' || k === 'dht' || k === 'neopixel'
      ? `'${k}' is MicroPython for the ESP32 — on the Raspberry Pi 5 use gpiozero (from gpiozero import LED, Button, …).`
      : k === 'utime' ? "'utime' is MicroPython — on the Pi use 'import time'." : `'${k}' is a MicroPython (ESP32) module — it isn't available on the Raspberry Pi.`;
    delete T.micropython; T.micropython = "'micropython' only exists on MicroPython boards like the ESP32.";
  } else {
    for (const [k, f] of Object.entries({ machine: 'machine', dht: 'dht', neopixel: 'neopixel', ssd1306: 'ssd1306', i2c_lcd: 'i2c_lcd', machine_i2c_lcd: 'machine_i2c_lcd', esp8266_i2c_lcd: 'esp8266_i2c_lcd', lcd_api: 'lcd_api' })) T[k] = () => mi()[f];
    for (const [k, what] of Object.entries(PI_ONLY)) T[k] = `'${k}' is ${what === 'signal' ? 'a desktop Python module' : `a Raspberry Pi library`} — on the ESP32 (MicroPython) use ${what === 'signal' ? 'a while True: loop with time.sleep() to keep running' : 'from machine import Pin, PWM, ADC'}.`;
  }
  void lazy;
  return T;
}

Interp.prototype.readLine = function* () {
  const I = this;
  I.inbuf ??= '';
  while (!I.inbuf.includes('\n')) yield 10;
  const i = I.inbuf.indexOf('\n');
  const s = I.inbuf.slice(0, i).replace(/\r$/, ''); I.inbuf = I.inbuf.slice(i + 1);
  I.m.out(s + '\n');
  return s;
};

export function parsePython(src) {
  try { return { ok: true, prog: pyParse(src.endsWith('\n') ? src : src + '\n') }; }
  catch (e) { if (e instanceof PySyntaxError) return { ok: false, error: { line: e.line, msg: e.message } }; throw e; }
}

// Build a Machine program from Python source.  Throws PySyntaxError (kind 'compile', .line) for bad code.
export function pythonProgram(src) {
  const prog = pyParse(src.endsWith('\n') ? src : src + '\n');
  return {
    lang: 'py',
    make(m) {
      const I = new Interp(m, {});
      I.modules = moduleTable(I);
      const self = { $: I.$, interp: I, serialIn: (t) => { I.inbuf = (I.inbuf ?? '') + t; } };
      self.main = function* () {
        yield* I.run(prog);
        const live = (m.watch?.length || 0) + m.threads.filter((t) => t.name !== 'main').length;
        if (!live) return;
        if (m.kind === 'pi5') {
          m.note(`Your script reached the end, so Python exited and its callbacks and background blinks stopped. Add \`from signal import pause\` at the top and \`pause()\` as the last line to keep it running.`);
          return;
        }
        m.noteOnce('py-repl', 'The script finished — like the MicroPython REPL, pin interrupts and Timers keep running.');
        for (;;) yield 1e6;
      };
      return self;
    },
  };
}
