// Maps a contract-clause-location case onto a single Jev "choice" question.

export function buildState(input) {
  return {
    contract_text: input.contract_text,
    section_numbers: input.section_numbers,
    question: input.question,
  };
}

export function questions(input) {
  const criteria = {};
  for (const n of input.section_numbers) {
    criteria[String(n)] =
      `Section ${n} of the contract (in state.contract_text) is the section whose provisions directly set the term asked about.`;
  }

  return {
    section: {
      type: "choice",
      instructions:
        `state.contract_text is the full text of a contract, divided into numbered sections. ` +
        `state.question is a legal question about which section governs a specific term. ` +
        `Question: "${input.question}" ` +
        `Pick the single section number whose text actually states that term. ` +
        `If the term is genuinely addressed across multiple sections with no single best section, or is not addressed at all, ` +
        `still pick whichever section is the closest, most direct match.`,
      criteria,
    },
  };
}

export function decide(answers, input) {
  const ans = answers && answers.section;
  if (!ans || ans.type !== "choice" || !ans.choice) {
    return { section: "abstain" };
  }

  const probs = ans.probabilities || {};
  const sorted = Object.entries(probs).sort((a, b) => b[1] - a[1]);
  const top = sorted.length ? sorted[0][1] : ans.confidence ?? 0;
  const second = sorted.length > 1 ? sorted[1][1] : 0;
  const confidence = ans.confidence ?? top;

  const valid = new Set((input.section_numbers || []).map(String));
  if (!valid.has(String(ans.choice))) {
    return { section: "abstain" };
  }

  // Abstain when the model isn't confident or the top two sections are nearly tied.
  if (confidence < 0.6 || top - second < 0.15) {
    return { section: "abstain" };
  }

  return { section: String(ans.choice) };
}
