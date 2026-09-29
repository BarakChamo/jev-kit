const CHUNK_SIZE = 254;
const ACT_THRESHOLD = 0.8;

function candidateSections(input) {
  const raw = Array.isArray(input?.section_numbers) ? input.section_numbers : [];
  const seen = new Set();
  const out = [];

  for (const value of raw) {
    if (value == null) continue;
    const section = String(value).trim();
    if (!section || section.toLowerCase() === "abstain") continue;
    if (!seen.has(section)) {
      seen.add(section);
      out.push(section);
    }
  }

  return out;
}

function chunkArray(values, size) {
  const chunks = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
}

function chunksFor(input) {
  const chunks = chunkArray(candidateSections(input), CHUNK_SIZE);
  return chunks.length > 0 ? chunks : [[]];
}

export function buildState(input) {
  const contractText = typeof input?.contract_text === "string" ? input.contract_text : "";
  const question = typeof input?.question === "string" ? input.question : "";
  const candidates = candidateSections(input);
  const chunks = chunksFor(input);

  const state = {
    contract_text: contractText,
    question,
    candidate_section_numbers: candidates,
    reading_rule:
      "A section sets the asked legal term only if the body of that section includes the operative provision for that term. Headings are only labels. If more than one section equally sets the term, the answer is ambiguous.",
  };

  chunks.forEach((chunk, i) => {
    state[`chunk_${i}`] = chunk;
  });

  return state;
}

export function questions(input) {
  const chunks = chunksFor(input);
  const questionsMap = {};

  chunks.forEach((chunk, i) => {
    const criteria = {};

    for (const section of chunk) {
      criteria[section] =
        `Section ${section} of \`contract_text\` includes the operative provision that answers \`question\`.`;
    }

    criteria.abstain =
      `None of the section numbers in \`chunk_${i}\` includes the operative provision asked about by \`question\`, ` +
      "or the evidence in this chunk genuinely supports more than one section; a person should decide.";

    questionsMap[`chunk_${i}`] = {
      type: "choice",
      instructions:
        "Read `contract_text`, `question`, and `reading_rule`. " +
        `Among only the candidate section numbers listed in \`chunk_${i}\`, ` +
        "which section number is the section whose text includes the operative provision that directly sets the legal term asked about in `question`? " +
        "Use the section body, not just its heading. " +
        "If the asked term is not set by any section in this chunk, or if this chunk genuinely supports more than one answer, choose `abstain`.",
      criteria,
    };
  });

  return questionsMap;
}

export function decide(answers, input) {
  const candidates = candidateSections(input);
  const candidateSet = new Set(candidates);
  const chunks = chunksFor(input);
  const strong = [];

  for (let i = 0; i < chunks.length; i += 1) {
    const answer = answers?.[`chunk_${i}`];
    if (!answer || typeof answer.choice === "undefined") {
      return { section: "abstain" };
    }

    const choice = String(answer.choice ?? "").trim();
    if (!choice || choice === "abstain") continue;
    if (!candidateSet.has(choice)) continue;

    const probability = Number(answer?.probabilities?.[choice] ?? answer?.confidence ?? 0);
    if (Number.isFinite(probability) && probability >= ACT_THRESHOLD) {
      strong.push({ section: choice, probability });
    }
  }

  if (strong.length === 1) {
    return { section: strong[0].section };
  }

  return { section: "abstain" };
}
