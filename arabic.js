// arabic.js — تشكيل الحروف العربية + ترتيب بصري (RTL) + لف الأسطر
// xterm بيرسم كل حرف في خانة لوحده من الشمال لليمين، فلازم نجهّز النص بصريًا قبل ما نطبعه.

const T = {};
const def = (cp, start, n) => { T[cp] = Array.from({ length: n }, (_, i) => start + i); };
def(0x621, 0xFE80, 1); def(0x622, 0xFE81, 2); def(0x623, 0xFE83, 2); def(0x624, 0xFE85, 2);
def(0x625, 0xFE87, 2); def(0x626, 0xFE89, 4); def(0x627, 0xFE8D, 2);
{
  let s = 0xFE8F;
  const list = [
    [0x628, 4], [0x629, 2], [0x62A, 4], [0x62B, 4], [0x62C, 4], [0x62D, 4], [0x62E, 4],
    [0x62F, 2], [0x630, 2], [0x631, 2], [0x632, 2], [0x633, 4], [0x634, 4], [0x635, 4],
    [0x636, 4], [0x637, 4], [0x638, 4], [0x639, 4], [0x63A, 4], [0x641, 4], [0x642, 4],
    [0x643, 4], [0x644, 4], [0x645, 4], [0x646, 4], [0x647, 4], [0x648, 2], [0x649, 2], [0x64A, 4],
  ];
  for (const [cp, n] of list) { def(cp, s, n); s += n; }
}
// لام + ألف
const LIG = { 0x622: [0xFEF5, 0xFEF6], 0x623: [0xFEF7, 0xFEF8], 0x625: [0xFEF9, 0xFEFA], 0x627: [0xFEFB, 0xFEFC] };

const isMark = (c) => c >= 0x64B && c <= 0x652;
const isArCp = (c) => (c >= 0x600 && c <= 0x6FF) || (c >= 0xFB50 && c <= 0xFEFF);
export const hasArabic = (s) => /[\u0600-\u06FF\uFB50-\uFEFF]/.test(s);
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

// تشكيل: حروف منفصلة -> أشكال متصلة (بداية / وسط / نهاية)
function shape(str) {
  const cs = [...str].map((ch) => ch.codePointAt(0)).filter((c) => !isMark(c) && c !== 0x640);
  const items = [];
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (c === 0x644 && LIG[cs[i + 1]]) { items.push({ f: LIG[cs[i + 1]], lig: true }); i++; continue; }
    items.push({ c, f: T[c] || null });
  }
  let out = '';
  for (let j = 0; j < items.length; j++) {
    const it = items[j];
    if (!it.f) { out += String.fromCodePoint(it.c); continue; }
    const p = items[j - 1];
    const n = items[j + 1];
    const prev = !!(p && p.f && !p.lig && p.f.length === 4);
    const next = !!(n && n.f && n.f.length >= 2);
    let idx = 0;
    if (it.f.length === 4) idx = prev && next ? 3 : prev ? 1 : next ? 2 : 0;
    else if (it.f.length === 2) idx = prev ? 1 : 0;
    out += String.fromCodePoint(it.f[idx]);
  }
  return out;
}

const MIRROR = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<' };

// ترتيب بصري لفقرة RTL
function visual(line) {
  const chars = [...line];
  let cls = chars.map((ch) => {
    const c = ch.codePointAt(0);
    if (isArCp(c)) return 'R';
    if (/[A-Za-z0-9\u00C0-\u024F]/.test(ch)) return 'L';
    return 'N';
  });
  // الرموز والمسافات: لو بين حرفين لاتيني تبقى LTR، غير كده RTL
  for (let i = 0; i < cls.length; i++) {
    if (cls[i] !== 'N') continue;
    let a = i; while (a >= 0 && cls[a] === 'N') a--;
    let b = i; while (b < cls.length && cls[b] === 'N') b++;
    const left = a >= 0 ? cls[a] : 'R';
    const right = b < cls.length ? cls[b] : 'R';
    const v = left === 'L' && right === 'L' ? 'l' : 'r';
    for (let k = a + 1; k < b; k++) cls[k] = v;
    i = b - 1;
  }
  cls = cls.map((c) => (c === 'l' ? 'L' : c === 'r' ? 'R' : c));
  const runs = [];
  for (let i = 0; i < chars.length; i++) {
    const last = runs[runs.length - 1];
    if (last && last.c === cls[i]) last.t += chars[i];
    else runs.push({ c: cls[i], t: chars[i] });
  }
  return runs.reverse().map((r) => {
    if (r.c === 'L') return r.t;
    return [...shape(r.t)].reverse().map((ch) => MIRROR[ch] || ch).join('');
  }).join('');
}

// لف الأسطر بالكلمات (بالترتيب المنطقي) قبل التحويل البصري
function wrap(text, cols) {
  const words = text.split(/ +/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (let w of words) {
    while ([...w].length > cols) {
      if (cur) { lines.push(cur); cur = ''; }
      lines.push([...w].slice(0, cols).join(''));
      w = [...w].slice(cols).join('');
    }
    if (!cur) cur = w;
    else if ([...cur].length + 1 + [...w].length <= cols) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

// الدالة الرئيسية: بتاخد نص (ممكن فيه ألوان ANSI وأسطر كتير) وبترجّعه جاهز للعرض
export function arabize(text, cols = 40) {
  return text.split(/\r?\n/).map((line) => {
    if (!hasArabic(line)) return line;
    const m = line.match(/\x1b\[[0-9;]*m/);
    const color = m ? m[0] : '';
    const reset = color ? '\x1b[0m' : '';
    const plain = stripAnsi(line);
    return wrap(plain, cols).map((l) => {
      const v = visual(l);
      const pad = Math.max(0, cols - [...v].length);
      return color + ' '.repeat(pad) + v + reset;
    }).join('\r\n');
  }).join('\n');
}
