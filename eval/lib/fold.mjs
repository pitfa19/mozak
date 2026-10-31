// Croatian-aware diacritic folding and query term extraction for the eval arms.
// D3 Goal 3: fold c-caron and c-acute to c, s-caron to s, z-caron to z, d-stroke to d, explicitly.

const FOLD = new Map([
  ['č', 'c'], ['ć', 'c'], ['š', 's'], ['ž', 'z'], ['đ', 'd'],
  ['Č', 'C'], ['Ć', 'C'], ['Š', 'S'], ['Ž', 'Z'], ['Đ', 'D'],
]);

export function fold(text) {
  let out = '';
  for (const ch of text) out += FOLD.get(ch) ?? ch;
  return out;
}

export function hasCroatianDiacritics(text) {
  return /[čćšžđ]/iu.test(text);
}

// Folded stopwords, English and Croatian. Question words are stopwords too.
const STOP = new Set(fold(`
a an and are as at be been by can did do does for from has have how in is it its of on or the this that to was
were what when where which who whom whose why will with into after before about than then there their they them
much many note notes now new one two per all any our your his her
i ili je su se da li u na za od do s sa iz o po kod koji koja koje kojeg kojem kojim koliko kolika koliki kada kad
gdje tko sto što što je li ali pa te ne nije biti bio bila bilo kako kakav kakva taj ta to tog tom toga njegova
njezina njezin njegov nakon prije
`).split(/\s+/).filter(Boolean));

const STEM_LEN = 6;

// Terms: folded, lowercased, stopwords dropped, letters-only terms longer than 6 cut to a 6-letter prefix.
export function queryTerms(question) {
  const words = fold(question.toLowerCase()).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const terms = [];
  for (const w of words) {
    if (STOP.has(w)) continue;
    const numeric = /^\p{N}+$/u.test(w);
    if (numeric ? w.length < 2 : w.length < 3) continue;
    const t = !numeric && w.length > STEM_LEN ? w.slice(0, STEM_LEN) : w;
    if (!terms.includes(t)) terms.push(t);
  }
  return terms;
}

const CLASS = { c: '[cčć]', s: '[sš]', z: '[zž]', d: '[dđ]' };

function escapeRe(ch) {
  return /[\\^$.*+?()[\]{}|\-]/.test(ch) ? `\\${ch}` : ch;
}

// Body of a pattern that matches the folded term against unfolded text.
export function foldedPatternBody(term) {
  let body = '';
  for (const ch of term) body += CLASS[ch] ?? escapeRe(ch);
  return body;
}

// ripgrep (Rust regex) pattern: Unicode word boundary at the start, prefix match.
export function rgPattern(term) {
  return `\\b${foldedPatternBody(term)}`;
}

// JavaScript equivalent. JS \b is ASCII-only, so use a Unicode lookbehind instead.
export function jsRegExp(term) {
  return new RegExp(`(?<![\\p{L}\\p{N}\\p{M}_])${foldedPatternBody(term)}`, 'giu');
}
