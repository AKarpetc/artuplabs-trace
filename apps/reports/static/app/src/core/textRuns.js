const KOREAN = /[ᄀ-ᇿ㄰-㆏ꥠ-꥿가-힯ힰ-퟿]/u;
const CJK = /[⺀-⿿　-ㄯ㆐-鿿豈-﫿︰-﹏＀-￯\u{20000}-\u{3134F}]/u;
const EMOJI = /\p{Extended_Pictographic}/u;
const JOINER = /[‍︎️\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]/u;
const SPACE = /\s/u;

/** Script of one character: korean, cjk, emoji or latin (Latin, Cyrillic, Greek and the rest). */
export function scriptOf(char) {
  if (KOREAN.test(char)) return 'korean';
  if (CJK.test(char)) return 'cjk';
  if (EMOJI.test(char) && char.codePointAt(0) >= 0x2190) return 'emoji';
  return 'latin';
}

/** Splits text into consecutive runs of one script; spaces stay with the run before them. */
export function splitRuns(text) {
  const runs = [];
  for (const char of String(text ?? '')) {
    const last = runs[runs.length - 1];
    const joins = Boolean(last) && ((SPACE.test(char) && last.script !== 'emoji') || (JOINER.test(char) && last.script === 'emoji'));
    const script = joins ? last.script : scriptOf(char);
    if (last && last.script === script) {
      last.text += char;
    } else {
      runs.push({ text: char, script });
    }
  }
  return runs;
}

/** Every script that occurs in the given texts. */
export function scriptsIn(texts) {
  const found = new Set();
  for (const text of texts) {
    for (const run of splitRuns(text)) found.add(run.script);
  }
  return found;
}
