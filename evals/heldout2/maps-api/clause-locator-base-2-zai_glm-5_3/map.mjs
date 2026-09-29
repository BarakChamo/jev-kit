// map.mjs — points to the contract section that sets a given term, using Jev.

const CHOICE_MAX = 254; // 255 options minus one "none" slot
const MIN_CONFIDENCE = 0.5;
const MIN_NOUL = 0.5;
const MIN_MARGIN = 0.15;

export function buildState(input) {
  return {
    contract_text: input.contract_text,
    section_numbers: input.section_numbers,
    question: input.question,
  };
}

export function questions(input) {
  const sections = input.section_numbers.map(String);
  const q = {};

  if (sections.length > 0 && sections.length <= CHOICE_MAX) {
    // One choice question over all section numbers (well under the 255-option cap).
    const criteria = {};
    for (const s of sections) {
      criteria[s] = `Section ${s} of the contract is the section whose text sets the term asked about.`;
    }
    criteria["none"] = "None of the listed sections sets the term asked about.";
    q.section = {
      type: "choice",
      instructions:
        `Read the contract text. ${input.question} ` +
        `Pick the section number of the section that sets that term. ` +
        `Judge by the full text of each section, not just its heading.`,
      criteria,
    };
  } else {
    // Fallback for very long contracts: one noul question per section.
    for (const s of sections) {
      q[`s${s}`] = {
        type: "noul",
        instructions:
          `Read the contract text. ${input.question} ` +
          `Consider only Section ${s} of the contract.`,
        criteria: {
          true: `Section ${s} sets the term asked about; its text establishes that term.`,
          false: `Section ${s} does not set the term asked about.`,
        },
      };
    }
  }
  return q;
}

export function decide(answers, input) {
  const sections = input.section_numbers.map(String);
  const valid = new Set(sections);
  const abstain = { section: "abstain" };

  const a = answers.section;
  if (a) {
    // Choice mode.
    if (a.choice === "none" || !valid.has(a.choice)) return abstain;
    if ((a.confidence ?? 0) < MIN_CONFIDENCE) return abstain;
    // Require a clear margin over the runner-up section.
    const probs = Object.entries(a.probabilities ?? {})
      .filter(([k]) => valid.has(k))
      .map(([, p]) => p)
      .sort((x, y) => y - x);
    if (probs.length === 0) return abstain;
    const runnerUp = probs[1] ?? 0;
    if (probs[0] - runnerUp < MIN_MARGIN) return abstain;
    return { section: a.choice };
  }

  // Noul mode: highest-scoring section, if confident and unambiguous.
  let best = null;
  let bestP = 0;
  let secondP = 0;
  for (const s of sections) {
    const p = answers[`s${s}`]?.noul ?? 0;
    if (p > bestP) {
      secondP = bestP;
      bestP = p;
      best = s;
    } else if (p > secondP) {
      secondP = p;
    }
  }
  if (best === null || bestP < MIN_NOUL || bestP - secondP < MIN_MARGIN) return abstain;
  return { section: best };
}
