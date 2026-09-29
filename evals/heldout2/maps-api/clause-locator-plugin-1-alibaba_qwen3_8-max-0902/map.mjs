const ABSTAIN = "abstain";
const MAX_CHOICE_OPTIONS = 255;
const MIN_LOCATE_PROB = 0.7;

function normalizeSectionNumbers(input) {
  const raw = Array.isArray(input?.section_numbers) ? input.section_numbers : [];
  const seen = new Set();
  const out = [];

  for (const value of raw) {
    const s = String(value ?? "").trim().replace(/[.).:]+$/, "");
    if (!s || s.toLowerCase() === ABSTAIN) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }

  return out;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function truncate(text, limit = 320) {
  if (typeof text !== "string") return "";
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= limit ? clean : clean.slice(0, limit - 1) + "…";
}

function headingRegExp(num) {
  return new RegExp(
    `^[\\t ]*(?:[#>*\\-]+[\\t ]*)*(?:section[\\t ]+)?${escapeRegExp(num)}(?:[\\t ]*[.).:\\-])?(?![0-9.])`,
    "im"
  );
}

function extractSections(text, numbers) {
  const sections = Object.create(null);
  for (const num of numbers) sections[num] = "";

  if (typeof text !== "string" || !text) return sections;

  const found = [];
  for (const num of numbers) {
    const match = headingRegExp(num).exec(text);
    if (match) found.push({ num, start: match.index });
  }

  found.sort((a, b) => a.start - b.start);

  for (let i = 0; i < found.length; i += 1) {
    const end = i + 1 < found.length ? found[i + 1].start : text.length;
    sections[found[i].num] = text.slice(found[i].start, end).trim();
  }

  return sections;
}

export function buildState(input) {
  const contract_text =
    typeof input?.contract_text === "string" ? input.contract_text.replace(/\r/g, "") : "";
  const question = typeof input?.question === "string" ? input.question.trim() : "";
  const section_numbers = normalizeSectionNumbers(input);
  const sections = extractSections(contract_text, section_numbers);

  return {
    contract_text,
    question,
    section_numbers,
    sections,
    convention:
      "A section sets the term in `question` when its own text states the operative legal rule, right, obligation, cap, renewal, termination, notice, or condition asked about. A definition, cross-reference, incidental mention, or schedule reference is not enough unless that section itself contains the operative rule.",
  };
}

export function questions(input) {
  const state = buildState(input);
  const numbers = state.section_numbers;
  const tooMany = numbers.length + 1 > MAX_CHOICE_OPTIONS;

  if (!state.question || numbers.length === 0 || tooMany) {
    return {
      locate_section: {
        type: "choice",
        instructions:
          "Choose `abstain` because this case has no usable question, no usable section numbers, or too many sections to ask safely in one choice question.",
        criteria: {
          [ABSTAIN]: "Send this case to a person.",
        },
      },
    };
  }

  const criteria = {};

  for (const num of numbers) {
    const section_text = state.sections[num] || "";
    criteria[num] = section_text
      ? `Section ${num}: ${truncate(section_text, 320)}`
      : `Section ${num}: section text not parsed; read \`contract_text\`.`;
  }

  criteria[ABSTAIN] =
    "No listed section clearly sets the term asked in `question`, or a single section cannot be chosen.";

  return {
    locate_section: {
      type: "choice",
      instructions:
        "Which section number in `section_numbers` most directly sets the legal term asked in `question`? " +
        "Read `contract_text` and `sections`. Apply `convention`. " +
        "Choose the one section whose own wording states the operative rule asked about. " +
        "Do not choose a section only because it mentions related words, defines a term, or points to another section. " +
        "Choose `abstain` if no listed section clearly sets the term or if a person should decide.",
      criteria,
    },
  };
}

export function decide(answers, input) {
  const numbers = normalizeSectionNumbers(input);
  const question = typeof input?.question === "string" ? input.question.trim() : "";

  if (!question || numbers.length === 0 || numbers.length + 1 > MAX_CHOICE_OPTIONS) {
    return { section: ABSTAIN };
  }

  const answer = answers?.locate_section;
  const choice = String(answer?.choice ?? ABSTAIN);

  if (choice === ABSTAIN || !numbers.includes(choice)) {
    return { section: ABSTAIN };
  }

  const p = answer?.probabilities?.[choice];

  if (typeof p !== "number" || !Number.isFinite(p) || p < MIN_LOCATE_PROB) {
    return { section: ABSTAIN };
  }

  return { section: choice };
}
