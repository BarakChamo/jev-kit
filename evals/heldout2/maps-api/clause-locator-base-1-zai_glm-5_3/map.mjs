// map.mjs — Jev mapper for "which section sets term X?" routing.

const TOP_MIN = 0.60;        // confident single winner
const ALT_MIN = 0.45;        // weaker winner, but only if it clearly beats the runner-up
const MARGIN = 0.25;

export function buildState(input) {
  // State carries the full contract and the section inventory; the question
  // text is embedded in each per-section question instead.
  return {
    contract_text: input.contract_text ?? "",
    section_numbers: input.section_numbers ?? [],
    question: input.question ?? "",
  };
}

export function questions(input) {
  const sections = input.section_numbers ?? [];
  const question = input.question ?? "";
  const qs = {};
  for (const n of sections) {
    qs["s" + n] = {
      type: "noul",
      instructions:
        `The user's legal question is: "${question}". ` +
        `Read the contract in state. Does section ${n} of the contract contain the provision ` +
        `that sets the term the question asks about (i.e., is section ${n} the correct answer)?`,
      criteria: {
        true: `Section ${n} contains the substantive provision the question is about.`,
        false: `Section ${n} does not contain that provision, or only mentions it in passing.`,
      },
    };
  }
  return qs;
}

export function decide(answers, input) {
  const sections = input.section_numbers ?? [];
  if (sections.length === 0) return { section: "abstain" };

  const scored = sections
    .map((n) => {
      const a = answers["s" + n];
      const p = a && typeof a.noul === "number" ? a.noul : 0;
      return { n, p };
    })
    .sort((a, b) => b.p - a.p);

  const top = scored[0];
  const second = scored[1];

  if (top.p >= TOP_MIN) return { section: String(top.n) };
  if (second && top.p >= ALT_MIN && top.p - second.p >= MARGIN) {
    return { section: String(top.n) };
  }
  return { section: "abstain" };
}
