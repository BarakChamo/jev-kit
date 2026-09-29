const AMBIGUOUS = "ambiguous";
const GATE = 0.8;
const MAX_OPTIONS = 255;

function cleanSections(section_numbers) {
  const seen = new Set();
  const out = [];
  if (!Array.isArray(section_numbers)) return out;
  for (const n of section_numbers) {
    const s = String(n);
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

export function buildState(input) {
  return {
    contract_text: input?.contract_text ?? "",
    section_numbers: input?.section_numbers ?? [],
    question: input?.question ?? "",
  };
}

export function questions(input) {
  const sections = cleanSections(input?.section_numbers);

  if (!input?.contract_text || !input?.question || sections.length === 0 || sections.length > MAX_OPTIONS) {
    return {};
  }

  const criteria = {};
  for (const s of sections) {
    criteria[s] = null;
  }

  const hasAmbiguous = sections.length < MAX_OPTIONS;
  if (hasAmbiguous) {
    criteria[AMBIGUOUS] =
      "No single section in `contract_text` clearly establishes the terms asked about in `question`; a person should decide.";
  }

  let instructions =
    "Which section number of `contract_text` establishes, not merely mentions, the terms asked about in `question`? Choose the section number from the options.";
  if (hasAmbiguous) {
    instructions += " If no single section clearly does, choose 'ambiguous'.";
  }

  return {
    section: {
      type: "choice",
      instructions,
      criteria,
    },
  };
}

export function decide(answers, input) {
  const answer = answers?.section;
  const validSections = new Set(cleanSections(input?.section_numbers));

  if (
    !answer ||
    typeof answer.choice !== "string" ||
    answer.choice === AMBIGUOUS ||
    !validSections.has(answer.choice)
  ) {
    return { section: "abstain" };
  }

  const p = Number(answer.probabilities?.[answer.choice] ?? answer.confidence ?? 0);
  if (!Number.isFinite(p) || p < GATE) {
    return { section: "abstain" };
  }

  return { section: answer.choice };
}
