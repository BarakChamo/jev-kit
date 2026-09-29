// map.mjs
// Maps a legal-clause-location case onto Jev (TypeSafe System One) questions.

function extractTitles(contractText) {
  const titles = {};
  const re = /(?:^|\n)\s*(\d+)\.\s*([^.\n]+)\./g;
  let m;
  while ((m = re.exec(contractText)) !== null) {
    const num = m[1];
    const title = m[2].trim();
    if (title) titles[num] = title;
  }
  return titles;
}

export function buildState(input) {
  return {
    contract_text: input.contract_text,
    section_numbers: input.section_numbers,
  };
}

export function questions(input) {
  const titles = extractTitles(input.contract_text);
  const criteria = {};
  for (const num of input.section_numbers) {
    const key = String(num);
    criteria[key] = titles[key] ? `Section ${key}: ${titles[key]}` : `Section ${key}`;
  }

  return {
    section: {
      type: "choice",
      instructions:
        `Given the contract in the state, identify which section number best answers this question: "${input.question}". ` +
        `Pick exactly one section number. If no section actually addresses the question, pick the closest/most relevant one anyway.`,
      criteria,
    },
    on_point: {
      type: "noul",
      instructions:
        `Does at least one section of the contract in the state clearly and unambiguously address this question: "${input.question}"?`,
      criteria: {
        true: "Exactly one section clearly and specifically addresses the question, with no real ambiguity about which section it is.",
        false: "No section clearly addresses the question, or multiple sections plausibly could, or it's ambiguous which section is the right answer.",
      },
    },
  };
}

export function decide(answers, input) {
  const choiceAns = answers?.section;
  const onPointAns = answers?.on_point;

  const validSections = new Set((input.section_numbers || []).map(String));

  if (!choiceAns || choiceAns.type !== "choice" || !validSections.has(choiceAns.choice)) {
    return { section: "abstain" };
  }

  const confidence = typeof choiceAns.confidence === "number" ? choiceAns.confidence : 0;
  const onPointProb = onPointAns && onPointAns.type === "noul" ? onPointAns.noul : 1;

  if (confidence < 0.6 || onPointProb < 0.55) {
    return { section: "abstain" };
  }

  return { section: choiceAns.choice };
}
