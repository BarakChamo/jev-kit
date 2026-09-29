// Locates which numbered contract section answers a legal question (governing law,
// liability cap, renewal, etc.) by asking Jev to pick among the contract's own section
// numbers, with an explicit "no single section" escape hatch and a confidence gate.

const CONFIDENCE_THRESHOLD = 0.65;

// Best-effort heading extraction, purely to give Jev's choice criteria a human label
// for each section number ("Section 9, titled \"Governing Law\""). Falls back to a
// bare "Section N" when a heading can't be matched; the full contract_text is always
// in state regardless, so a miss here never removes information Jev can see.
function extractHeadings(contractText) {
  const headings = {};
  const re = /(?:^|\n\n)\s*(\d+)\.\s+([A-Za-z][^\n.]*)\./g;
  let m;
  while ((m = re.exec(contractText)) !== null) {
    headings[m[1]] = m[2].trim();
  }
  return headings;
}

export function buildState(input) {
  return {
    contract_text: input.contract_text,
    section_numbers: input.section_numbers,
  };
}

export function questions(input) {
  const headings = extractHeadings(input.contract_text);
  const criteria = {};
  for (const n of input.section_numbers) {
    const key = String(n);
    const title = headings[key];
    criteria[key] = title
      ? `Section ${key}, titled "${title}", as it appears in \`contract_text\`.`
      : `Section ${key} as it appears in \`contract_text\`.`;
  }
  criteria.unclear =
    "No single section in `contract_text` clearly and specifically sets out the terms " +
    "that answer the question below: the topic is not addressed by any section, or it " +
    "is split across two or more sections with no single best answer.";

  return {
    section: {
      type: "choice",
      instructions:
        `Which numbered section in \`contract_text\` sets out the terms that answer this ` +
        `question: "${input.question}"? Pick the section whose heading and body most ` +
        `directly and specifically address the question. Pick "unclear" only if no ` +
        `section addresses it, or if the topic is split across multiple sections with no ` +
        `single best section.`,
      criteria,
    },
  };
}

export function decide(answers, input) {
  const section = answers.section;
  if (!section || section.choice === "unclear") {
    return { section: "abstain" };
  }
  const confidence =
    section.probabilities?.[section.choice] ?? section.confidence ?? 0;
  if (confidence < CONFIDENCE_THRESHOLD) {
    return { section: "abstain" };
  }
  return { section: section.choice };
}
