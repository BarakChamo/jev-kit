// Jev map: locate the contract section that sets a given term.

export function buildState(input) {
  return {
    contract_text: input.contract_text,
    section_numbers: input.section_numbers,
    legal_question: input.question,
  };
}

export function questions(input) {
  const criteria = {};
  for (const n of input.section_numbers) {
    criteria[String(n)] =
      `The section of the contract numbered ${n} in \`contract_text\` is the one whose provision directly answers \`legal_question\`.`;
  }
  criteria.none =
    "No section in `contract_text` contains a provision that addresses `legal_question`.";

  return {
    section: {
      type: "choice",
      instructions:
        "Read the contract in `contract_text`, whose numbered sections are listed in `section_numbers`. Which single section's provision directly answers `legal_question`? If none of the sections address it, choose `none`.",
      criteria,
    },
  };
}

export function decide(answers, input) {
  const ans = answers.section;
  if (!ans || ans.choice === "none") return { section: "abstain" };

  const prob = ans.probabilities?.[ans.choice] ?? ans.confidence ?? 0;
  if (prob < 0.75) return { section: "abstain" };

  return { section: String(ans.choice) };
}
