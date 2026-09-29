// map.mjs — locate the contract section that sets a given term, using Jev.
// Strategy: one noul question per section ("does THIS section set the term?"),
// all answered in one parallel pass; then pick the strongest section,
// abstaining when the evidence is weak or ambiguous (human review).

const MIN_CONFIDENCE = 0.6; // best section must be at least this likely
const MIN_MARGIN = 0.2;     // and clearly ahead of the runner-up

export function buildState(input) {
  return {
    contract_text: input.contract_text,
    section_numbers: input.section_numbers,
    question: input.question,
  };
}

export function questions(input) {
  const qs = {};
  for (const n of input.section_numbers) {
    qs[`sec_${n}`] = {
      type: "noul",
      instructions:
        `In the contract in state, find the section numbered ${n}. ` +
        `Does that specific section set the terms described in the case question: ` +
        `"${input.question}"? Answer true only if the provisions establishing ` +
        `that term are located in section ${n} itself.`,
      criteria: {
        true: `Section ${n} contains the provision(s) that establish the term described in the case question.`,
        false: `Section ${n} does not establish that term (it addresses other subject matter, or the term is set elsewhere).`,
      },
    };
  }
  return qs;
}

export function decide(answers, input) {
  const sections = input.section_numbers;
  if (!Array.isArray(sections) || sections.length === 0) {
    return { section: "abstain" };
  }

  let best = null;
  let bestP = -1;
  let secondP = -1;

  for (const n of sections) {
    const a = answers[`sec_${n}`];
    if (!a || typeof a.noul !== "number") {
      return { section: "abstain" }; // missing/malformed answer -> human
    }
    const p = a.noul;
    if (p > bestP) {
      secondP = bestP;
      bestP = p;
      best = n;
    } else if (p > secondP) {
      secondP = p;
    }
  }

  if (bestP < MIN_CONFIDENCE) return { section: "abstain" };
  if (sections.length > 1 && bestP - secondP < MIN_MARGIN) {
    return { section: "abstain" }; // ambiguous: term may span sections
  }

  return { section: String(best) };
}
