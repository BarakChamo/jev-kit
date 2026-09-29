export function buildState(input) {
  return {
    contract_text: input.contract_text,
    target_question: input.question,
  };
}

export function questions(input) {
  const criteria = {};
  for (const num of input.section_numbers) {
    criteria[String(num)] = `Section ${num} sets the terms asked about in \`target_question\``;
  }
  criteria.none_or_ambiguous = "no section sets these terms, or multiple sections set them equally";

  return {
    matching_section: {
      type: "choice",
      instructions: "Which section in `contract_text` sets the terms or answers the request specified in `target_question`? Pick the single section that directly governs this topic, or none_or_ambiguous if absent or split.",
      criteria,
    },
  };
}

export function decide(answers, input) {
  const answer = answers?.matching_section;
  if (!answer) return { section: "abstain" };

  const pick = answer.choice;
  const prob = answer.probabilities?.[pick] ?? 0;

  if (pick === "none_or_ambiguous" || prob < 0.6) {
    return { section: "abstain" };
  }

  const validNumbers = new Set(input.section_numbers.map(String));
  if (!validNumbers.has(pick)) {
    return { section: "abstain" };
  }

  return { section: pick };
}
