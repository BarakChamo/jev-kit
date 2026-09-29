// Locate which contract section answers a legal question, using a single Jev choice question.

function extractSectionTitles(contractText, sectionNumbers) {
  const titles = {};
  const re = /^(\d+)\.\s*([^\n]*)/gm;
  let m;
  while ((m = re.exec(contractText)) !== null) {
    const num = m[1];
    const title = m[2].trim().slice(0, 100);
    titles[num] = title;
  }
  const out = {};
  for (const n of sectionNumbers) {
    const key = String(n);
    out[key] = titles[key] ? `Section ${key}: ${titles[key]}` : `Section ${key}`;
  }
  return out;
}

export function buildState(input) {
  return {
    contract_text: input.contract_text,
    section_numbers: input.section_numbers,
  };
}

export function questions(input) {
  const criteria = extractSectionTitles(input.contract_text, input.section_numbers);
  return {
    sec: {
      type: "choice",
      instructions:
        `Read the contract in the state. ${input.question} ` +
        `Pick the single section whose text actually sets that term. ` +
        `If no section addresses the question, or two+ sections plausibly could, ` +
        `still pick your best single answer — confidence will be judged separately.`,
      criteria,
    },
  };
}

export function decide(answers, input) {
  const sec = answers && answers.sec;
  if (!sec || sec.choice == null) return { section: "abstain" };

  const probs = sec.probabilities || {};
  const sorted = Object.values(probs)
    .filter((p) => typeof p === "number")
    .sort((a, b) => b - a);
  const top = sorted[0] ?? sec.confidence ?? 0;
  const second = sorted[1] ?? 0;

  const confident = (sec.confidence ?? top) >= 0.6;
  const clearMargin = top - second >= 0.15;

  const validSections = new Set((input.section_numbers || []).map(String));
  const choice = String(sec.choice);

  if (!validSections.has(choice) || !confident || !clearMargin) {
    return { section: "abstain" };
  }

  return { section: choice };
}
