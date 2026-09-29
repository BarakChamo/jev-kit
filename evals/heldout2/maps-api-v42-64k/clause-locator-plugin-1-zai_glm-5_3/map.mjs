// map.mjs — point to the section of a contract that sets a given legal term.
//
// Encoding (rule 10): ONE `choice` over every listed section number, with a rubric
// naming what to skip — a `noul` per section would truthfully fire on every section
// that so much as mentions the term. No pre-filtering: every section is offered
// (rule 16); one request answers everything.
// Abstain (rules 13/14): the choice carries `not_found` / `multiple_sections`
// options, the picked section's own probability is gated, and a detector `noul`
// (rule 15) vetoes picks when two sections share the term.
// GATES are placeholders: fit them on ~30 labelled cases (jev-eval / jev-audit).

const MAX_OPTIONS = 255; // hard API limit for one choice
const GATE = 0.8; // gate on the label we act on; 0.8 removed all wrong picks over 20+ options in the study
const MULTI_GATE = 0.5; // detector veto threshold

const sectionNumbers = (input) =>
  [...new Set((Array.isArray(input?.section_numbers) ? input.section_numbers : []).map(String))].filter((s) => s !== '');

// First paragraph of each numbered heading, to anchor each option to its text.
// Headings are accepted only in ascending order, which drops "1." lists inside section 7.
function snippets(text, nums) {
  const want = new Set(nums.map(Number).filter(Number.isFinite));
  const out = new Map();
  let last = -1;
  for (const para of String(text).split(/\n\s*\n|\n(?=\s*\d{1,4}\s*[.)]\s)/)) {
    const m = para.match(/^\s*(\d{1,4})\s*[.)]\s+(.+)$/s);
    if (!m) continue;
    const n = Number(m[1]);
    if (!want.has(n) || n <= last) continue;
    out.set(String(n), m[2].replace(/\s+/g, ' ').trim().slice(0, 240));
    last = n;
  }
  return out;
}

export function buildState(input) {
  return {
    contract_text: String(input?.contract_text ?? ''), // the source, in full (rule 1)
    section_numbers: sectionNumbers(input),
    question: String(input?.question ?? ''),
  };
}

export function questions(input) {
  const nums = sectionNumbers(input);
  // More than 253 numbered sections (rare): a person handles it rather than
  // pre-filtering sections or combining unmeasured batched picks.
  if (nums.length === 0 || nums.length + 2 > MAX_OPTIONS) return {};
  const snips = snippets(String(input?.contract_text ?? ''), nums);
  const criteria = {};
  for (const n of nums) {
    const s = snips.get(n);
    criteria[n] = s ? `Section ${n} of \`contract_text\`, which begins: "${s}"` : `Section ${n} of \`contract_text\`.`;
  }
  criteria.not_found = 'No section listed in `section_numbers` sets that term: `contract_text` does not set it in any of the numbered sections.';
  criteria.multiple_sections = 'Two or more sections listed in `section_numbers` each set that term, so no single section number answers `question`.';
  return {
    section: {
      type: 'choice',
      instructions:
        'Which single section of `contract_text` sets the term that `question` asks about? Pick the number of the section whose operative wording sets that term (its rule, cap, period, chosen law, or similar). Do not pick a section that only mentions or cross-references the term, and do not pick anything not listed in `section_numbers` (schedules, annexes, headings, signature blocks). If no listed section sets the term, pick `not_found`; if two or more listed sections each set it, pick `multiple_sections`.',
      criteria,
    },
    multiple_sections_sets: {
      type: 'noul',
      instructions:
        'Do two or more of the sections listed in `section_numbers` each contain operative wording that sets the term `question` asks about? A section that only mentions, defines, cross-references or headlines the term does not count.',
      criteria: {
        true: 'two or more listed sections each operatively set that term',
        false: 'at most one listed section operatively sets that term',
      },
    },
  };
}

export function decide(answers, input) {
  const nums = new Set(sectionNumbers(input));
  if (nums.size === 0 || nums.size + 2 > MAX_OPTIONS) return { section: 'abstain' };
  const pick = answers?.section;
  if (!pick || pick.type !== 'choice') return { section: 'abstain' };
  const chosen = String(pick.choice);
  if (!nums.has(chosen)) return { section: 'abstain' }; // `not_found`, `multiple_sections`, or anything odd
  const multi = answers?.multiple_sections_sets;
  if (typeof multi?.noul === 'number' && multi.noul > MULTI_GATE) return { section: 'abstain' };
  const p = pick.probabilities?.[chosen] ?? 0; // gate on the label we act on (rule 13)
  return p >= GATE ? { section: chosen } : { section: 'abstain' }; // unsure never becomes a section number
}
