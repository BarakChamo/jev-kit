// map.mjs — answer "which section of this contract sets the term the lawyer asked about?"
// with a section number, or "abstain".
//
// jev-questions skill: the whole source in the state (r1), every question names its fields (r2),
// the "sets a term" reading convention written once by hand (r3), ONE choice over every
// section number instead of a noul per section or a code pre-filter (r10, r16), 'none' and
// 'ambiguous' outs beside the real options (r14), and a gate on the chosen label's
// probability that never relaxes into a pick (r13). Fit GATE with jev-audit before trusting it.

const GATE = 0.8;      // measured on picks from 20+ items: removed all wrong picks, kept 79% of right ones; refit on labelled cases
const PER_GROUP = 253; // a choice takes at most 255 options; keep two for 'none' and 'ambiguous'

const CONVENTION = [
  'How this task reads "a section sets a term".',
  'A section sets a term when its own operative language establishes that term for the contract: it states the governing law, the liability cap, the renewal rule, the notice period, the payment terms, or whatever else the question asks about.',
  'A section does not set a term when it merely mentions the term while setting something else (a limitation-of-liability section that carves out breaches of confidentiality does not set the confidentiality terms), when it only cross-references another section, or when it only defines a word used in the term.',
  'Where a dedicated section and a more general section both speak to the term, the dedicated section is the one that sets it.',
  'Where two sections each set the same term with neither the primary place for it, the case is ambiguous and a person should decide.',
].join(' ');

export function buildState(input) {
  return {
    contract_text: input.contract_text, // the source itself, not an extraction of it (r1)
    section_numbers: input.section_numbers,
    question: input.question,
    reading_convention: CONVENTION,
  };
}

function pickQuestion(numbers, scope) {
  const criteria = {};
  for (const n of numbers) criteria[String(n)] = `section ${n} of the contract`;
  criteria.none = 'none of the sections offered as options in this question sets the term asked about';
  criteria.ambiguous = 'two or more of the sections offered as options in this question each set the term, with neither the primary place for it; a person should decide';
  return {
    type: 'choice',
    instructions:
      `A lawyer asks the question in \`question\`: which section of the contract sets one term. ` +
      `Reading the full contract in \`contract_text\` and the convention in \`reading_convention\`, ` +
      `which section number among ${scope} does the contract show as setting the term asked about? ` +
      `Pick the section whose own operative language establishes that term — ` +
      `not a section that merely mentions the term while setting something else, ` +
      `not a section that only cross-references another section, ` +
      `not a section that only defines a word used in the term. ` +
      `If no offered section sets the term, pick \`none\`; if two or more offered sections each set it with neither primary, pick \`ambiguous\`.`,
    criteria,
  };
}

export function questions(input) {
  const numbers = input.section_numbers;
  if (numbers.length <= PER_GROUP)
    return { section_pick: pickQuestion(numbers, 'the section numbers in `section_numbers`') };
  // Rare very long contract: one choice per group of numbers; decide() takes the best across groups.
  const qs = {};
  for (let i = 0; i < numbers.length; i += PER_GROUP)
    qs[`pick_${i / PER_GROUP}`] = pickQuestion(
      numbers.slice(i, i + PER_GROUP),
      'the section numbers offered as the options of this question, one group of `section_numbers`'
    );
  return qs;
}

export function decide(answers, input) {
  const valid = new Set(input.section_numbers.map(String));
  let best = { c: null, p: 0 };
  let shared = 0;
  for (const a of Object.values(answers ?? {})) {
    const c = a?.choice;
    if (c === 'ambiguous') shared = Math.max(shared, a.probabilities?.ambiguous ?? 0);
    else if (valid.has(c)) {
      const p = a.probabilities?.[c] ?? 0; // gate on the label's probability, not the confidence scalar (r13)
      if (p > best.p) best = { c, p };
    } // 'none', or a label outside section_numbers: nothing to act on
  }
  if (shared > best.p) return { section: 'abstain' }; // two sections share the term: a person decides
  return best.p >= GATE ? { section: best.c } : { section: 'abstain' }; // unsure never becomes a pick
}
