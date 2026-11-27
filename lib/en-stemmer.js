/**
 * Tiny English stemmer for tag normalization only.
 * It is deliberately narrow: possessive, plural, past, gerund, double consonant.
 * Do not use it on fact text or for semantic decisions.
 */

const IRREGULAR = new Map([
  ['am', 'be'], ['is', 'be'], ['are', 'be'], ['was', 'be'], ['were', 'be'], ['been', 'be'],
  ['has', 'have'], ['had', 'have'],
  ['does', 'do'], ['did', 'do'], ['done', 'do'],
  ['goes', 'go'], ['went', 'go'], ['gone', 'go'],
  ['flew', 'fly'], ['flown', 'fly'], ['flies', 'fly'],
  ['ran', 'run'], ['runs', 'run'],
  ['made', 'make'], ['making', 'make'],
  ['took', 'take'], ['taken', 'take'], ['taking', 'take'],
  ['came', 'come'], ['coming', 'come'],
  ['gave', 'give'], ['given', 'give'], ['giving', 'give'],
  ['saw', 'see'], ['seen', 'see'], ['seeing', 'see'],
  ['bought', 'buy'], ['buying', 'buy'],
  ['brought', 'bring'], ['bringing', 'bring'],
  ['thought', 'think'], ['thinking', 'think'],
  ['wrote', 'write'], ['written', 'write'], ['writing', 'write'],
  ['spoke', 'speak'], ['spoken', 'speak'], ['speaking', 'speak'],
])

function cleanWord(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’']s$/u, '')
    .replace(/[^a-z]/gu, '')
}

export function stemEnglishWord(value) {
  let w = cleanWord(value)
  if (!w) return ''
  if (IRREGULAR.has(w)) return IRREGULAR.get(w)
  if (w.length <= 3) return w

  if (w.endsWith('ies') && w.length > 4) w = `${w.slice(0, -3)}y`
  else if (w.endsWith('es') && /(?:s|x|z|ch|sh)$/u.test(w.slice(0, -2))) w = w.slice(0, -2)
  else if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) w = w.slice(0, -1)

  if (w.endsWith('ied') && w.length > 4) w = `${w.slice(0, -3)}y`
  else if (w.endsWith('ed') && w.length > 4) w = w.slice(0, -2)

  if (w.endsWith('ing') && w.length > 5) w = w.slice(0, -3)

  if (/([b-df-hj-np-tv-z])\1$/u.test(w)) w = w.slice(0, -1)
  return w
}

export function stemEnglishPhrase(value) {
  return String(value || '')
    .split(/[^A-Za-z]+/u)
    .map(stemEnglishWord)
    .filter(Boolean)
    .join(' ')
}
