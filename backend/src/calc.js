// Sicherer Taschenrechner. Es wird NIE eval() verwendet.
// Unterstützt: + - * / ^ ( ) Prozent (postfix), Funktionen und Konstanten.

const FUNCTIONS = {
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  ln: Math.log,
  log: Math.log10,
  log2: Math.log2,
  exp: Math.exp,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
};

const CONSTANTS = { pi: Math.PI, e: Math.E };

function tokenize(src) {
  const tokens = [];
  const re = /\s*(?:(\d+(?:\.\d+)?(?:e[+-]?\d+)?|\.\d+)|([a-z_][a-z0-9_]*)|([-+*/^%(),×÷·]))/giy;
  let m;
  let pos = 0;
  while (pos < src.length) {
    re.lastIndex = pos;
    m = re.exec(src);
    if (!m) {
      if (/^\s*$/.test(src.slice(pos))) break;
      throw new Error(`Unerwartetes Zeichen bei Position ${pos + 1}.`);
    }
    pos = re.lastIndex;
    if (m[1] !== undefined) tokens.push({ t: 'num', v: Number(m[1]) });
    else if (m[2] !== undefined) tokens.push({ t: 'id', v: m[2].toLowerCase() });
    else {
      let op = m[3];
      if (op === '×' || op === '·') op = '*';
      if (op === '÷') op = '/';
      tokens.push({ t: 'op', v: op });
    }
  }
  return tokens;
}

export function evaluate(expression) {
  if (typeof expression !== 'string' || !expression.trim()) throw new Error('Kein Ausdruck angegeben.');
  if (expression.length > 200) throw new Error('Ausdruck ist zu lang.');
  const src = expression.replace(/,(?=\d)(?<=\d,)/g, '.'); // Dezimalkomma "3,5" → "3.5"
  const tokens = tokenize(src);
  let i = 0;
  let depth = 0;

  const peek = () => tokens[i];
  const next = () => tokens[i++];
  const isOp = (v) => peek()?.t === 'op' && peek().v === v;

  function parseExpr() {
    let left = parseTerm();
    while (isOp('+') || isOp('-')) {
      const op = next().v;
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  function parseTerm() {
    let left = parseUnary();
    for (;;) {
      if (isOp('*') || isOp('/')) {
        const op = next().v;
        const right = parseUnary();
        if (op === '/' && right === 0) throw new Error('Division durch null.');
        left = op === '*' ? left * right : left / right;
      } else if (peek() && (peek().t === 'num' || peek().t === 'id' || isOp('('))) {
        // Implizite Multiplikation: 2(3+4), 2pi
        left *= parseUnary();
      } else break;
    }
    return left;
  }

  function parseUnary() {
    if (isOp('-')) {
      next();
      return -parseUnary();
    }
    if (isOp('+')) {
      next();
      return parseUnary();
    }
    return parsePower();
  }

  function parsePower() {
    const base = parsePostfix();
    if (isOp('^')) {
      next();
      const exp = parseUnary(); // rechtsassoziativ
      return Math.pow(base, exp);
    }
    return base;
  }

  function parsePostfix() {
    let v = parsePrimary();
    while (isOp('%')) {
      next();
      v /= 100;
    }
    return v;
  }

  function parsePrimary() {
    const tok = next();
    if (!tok) throw new Error('Ausdruck endet unerwartet.');
    if (tok.t === 'num') return tok.v;
    if (tok.t === 'id') {
      if (isOp('(')) {
        const fn = FUNCTIONS[tok.v];
        if (!fn) throw new Error(`Unbekannte Funktion „${tok.v}“.`);
        next();
        const args = [];
        if (!isOp(')')) {
          do {
            if (isOp(',')) next();
            args.push(parseNested());
          } while (isOp(','));
        }
        if (!isOp(')')) throw new Error('Schließende Klammer fehlt.');
        next();
        return fn(...args);
      }
      if (tok.v in CONSTANTS) return CONSTANTS[tok.v];
      throw new Error(`Unbekannter Name „${tok.v}“.`);
    }
    if (tok.v === '(') {
      const v = parseNested();
      if (!isOp(')')) throw new Error('Schließende Klammer fehlt.');
      next();
      return v;
    }
    throw new Error(`Unerwartetes Zeichen „${tok.v}“.`);
  }

  function parseNested() {
    if (++depth > 30) throw new Error('Zu tief verschachtelt.');
    const v = parseExpr();
    depth--;
    return v;
  }

  const result = parseExpr();
  if (i < tokens.length) throw new Error(`Unerwartetes Zeichen „${tokens[i].v}“.`);
  if (!Number.isFinite(result)) throw new Error('Das Ergebnis ist nicht endlich.');
  return result;
}

export function formatNumber(n) {
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  const rounded = Number(n.toPrecision(12));
  return String(rounded);
}
