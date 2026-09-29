// Locate the contract section that answers a legal question.

const CONFIDENCE_GATE = 0.6;

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
      `Section ${n} of \`contract_text\` is the section whose provision most directly ` +
      `sets out the answer to the question in \`question\`.`;
  }
  criteria.abstain =
    "No section in `contract_text` actually addresses the question in `question` " +
    "(the topic is absent, or the text is genuinely ambiguous between sections) " +
    "and this should go to a person instead.";

  return {
    section: {
      type: "choice",
      instructions:
        "Read the numbered sections in `contract_text`. Which single section, by its " +
        "number in `section_numbers`, contains the provision that answers the question " +
        "in `question`? Choose `abstain` only if no section addresses the question.",
      criteria,
    },
  };
}

export function decide(answers, input) {
  const answer = answers && answers.section;
  if (!answer || answer.type !== "choice") return { section: "abstain" };
  if (answer.choice === "abstain") return { section: "abstain" };
  if (typeof answer.confidence === "number" && answer.confidence < CONFIDENCE_GATE) {
    return { section: "abstain" };
  }
  if (!input.section_numbers.some((n) => String(n) === answer.choice)) {
    return { section: "abstain" };
  }
  return { section: answer.choice };
}
