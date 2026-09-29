const ABSTAIN = "abstain";
const CHOICE_ID = "section_choice";
const GATE = 0.8;
const MAX_CHOICE_OPTIONS = 255;

function sectionNumbers(input) {
  const raw = Array.isArray(input?.section_numbers) ? input.section_numbers : [];
  const seen = new Set();
  const out = [];

  for (const value of raw) {
    const s = String(value ?? "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }

  return out;
}

export function buildState(input) {
  return {
    contract_text: String(input?.contract_text ?? ""),
    question: String(input?.question ?? ""),
    section_numbers: sectionNumbers(input),
  };
}

export function questions(input) {
  const numbers = sectionNumbers(input);
  const criteria = {};

  if (numbers.length + 1 > MAX_CHOICE_OPTIONS) {
    criteria[ABSTAIN] =
      "The case has too many listed sections for a calibrated single choice; a person should decide.";

    return {
      [CHOICE_ID]: {
        type: "choice",
        instructions:
          "Choose `abstain` because this map cannot safely select among more than 254 listed section numbers in one choice.",
        criteria,
      },
    };
  }

  for (const n of numbers) {
    criteria[n] =
      `The term asked about in \`question\` is set in the section of \`contract_text\` numbered ${n}.`;
  }

  criteria[ABSTAIN] =
    "No section listed in `section_numbers` clearly sets the term asked about in `question`; a person should decide.";

  return {
    [CHOICE_ID]: {
      type: "choice",
      instructions:
        "Which option is the section number in `section_numbers` whose text in `contract_text` sets the term asked about in `question`? " +
        "Choose `abstain` if no listed section clearly sets that term.",
      criteria,
    },
  };
}

export function decide(answers, input) {
  const numbers = sectionNumbers(input);
  const answer = answers?.[CHOICE_ID];
  const choice = String(answer?.choice ?? "");

  if (!choice || choice === ABSTAIN || !numbers.includes(choice)) {
    return { section: ABSTAIN };
  }

  const p = Number(answer?.probabilities?.[choice] ?? answer?.confidence ?? 0);
  if (!Number.isFinite(p) || p < GATE) {
    return { section: ABSTAIN };
  }

  return { section: choice };
}
