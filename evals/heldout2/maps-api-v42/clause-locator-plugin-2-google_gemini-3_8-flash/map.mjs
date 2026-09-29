const CONFIDENCE_GATE = 0.6;

export function buildState(input) {
  return {
    contract_text: input.contract_text,
    question: input.question,
  };
}

export function questions(input) {
  const criteria = {};
  for (const sec of input.section_numbers) {
    criteria[String(sec)] = `Section ${sec} of \`contract_text\` sets the terms asked about in \`question\``;
  }
  criteria["none"] = "None of the listed sections set the terms asked about in `question`";
  criteria["ambiguous"] = "Multiple sections set the terms or the text is genuinely ambiguous";

  return {
    target_section: {
      type: "choice",
      instructions: "Which section in `contract_text` directly sets the terms asked about in `question`?",
      criteria,
    },
  };
}

export function decide(answers, input) {
  const answer = answers?.target_section;
  if (!answer || !answer.choice) {
    return { section: "abstain" };
  }

  const choice = answer.choice;
  if (choice === "none" || choice === "ambiguous") {
    return { section: "abstain" };
  }

  const prob = answer.probabilities?.[choice] ?? answer.confidence ?? 0;
  if (prob < CONFIDENCE_GATE) {
    return { section: "abstain" };
  }

  const validNumbers = new Set(input.section_numbers.map(String));
  if (!validNumbers.has(choice)) {
    return { section: "abstain" };
  }

  return { section: choice };
}
