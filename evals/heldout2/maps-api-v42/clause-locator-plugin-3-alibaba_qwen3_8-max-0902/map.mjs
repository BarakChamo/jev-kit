const ABSTAIN = 'abstain';
const MAX_CHOICE_OPTIONS = 255;
const SECTION_GATE = 0.6;

function sectionNumbers(input) {
  if (!input || !Array.isArray(input.section_numbers)) return [];

  const seen = new Set();
  const out = [];

  for (const value of input.section_numbers) {
    if (typeof value !== 'string' && typeof value !== 'number') continue;

    const section = String(value).trim();
    if (!section || seen.has(section)) continue;

    seen.add(section);
    out.push(section);
  }

  return out;
}

function usable(input) {
  return (
    !!input &&
    typeof input.contract_text === 'string' &&
    input.contract_text.trim() !== '' &&
    typeof input.question === 'string' &&
    input.question.trim() !== ''
  );
}

function abstainQuestion(instructions) {
  return {
    section: {
      type: 'choice',
      instructions,
      criteria: {
        [ABSTAIN]: 'The case should be sent to a person.',
      },
    },
  };
}

export function buildState(input) {
  return {
    contract_text: typeof input?.contract_text === 'string' ? input.contract_text : '',
    question: typeof input?.question === 'string' ? input.question : '',
    section_numbers: sectionNumbers(input),
  };
}

export function questions(input) {
  const numbers = sectionNumbers(input);

  if (!usable(input)) {
    return abstainQuestion('Choose `abstain` because `contract_text` or `question` is missing or empty.');
  }

  if (numbers.length === 0) {
    return abstainQuestion('Choose `abstain` because `section_numbers` has no candidate section.');
  }

  if (numbers.length > MAX_CHOICE_OPTIONS) {
    return abstainQuestion('Choose `abstain` because `section_numbers` has more than 255 candidate sections.');
  }

  const includeAbstain = numbers.length < MAX_CHOICE_OPTIONS;
  const criteria = {};

  for (const section of numbers) {
    criteria[section] = `Section ${section} listed in \`section_numbers\` and appearing in \`contract_text\`.`;
  }

  if (includeAbstain) {
    criteria[ABSTAIN] =
      'No single section listed in `section_numbers` and appearing in `contract_text` answers `question`, or multiple sections are equally plausible.';
  }

  const instructions = includeAbstain
    ? 'Which section number in `section_numbers` corresponds to the numbered section of `contract_text` that sets the term asked about in `question`? Choose the section that primarily establishes that term. Choose `abstain` for no single answering section or multiple equally plausible sections.'
    : 'Which section number in `section_numbers` corresponds to the numbered section of `contract_text` that sets the term asked about in `question`? Choose the section that primarily establishes that term.';

  return {
    section: {
      type: 'choice',
      instructions,
      criteria,
    },
  };
}

export function decide(answers, input) {
  const numbers = sectionNumbers(input);

  if (!usable(input) || numbers.length === 0 || numbers.length > MAX_CHOICE_OPTIONS) {
    return ABSTAIN;
  }

  const answer = answers?.section;
  if (!answer || answer.type !== 'choice' || answer.choice == null) {
    return ABSTAIN;
  }

  const choice = String(answer.choice);
  if (choice === ABSTAIN) {
    return ABSTAIN;
  }

  if (!numbers.includes(choice)) {
    return ABSTAIN;
  }

  const probability = answer.probabilities?.[choice];
  const gateValue =
    typeof probability === 'number' && Number.isFinite(probability)
      ? probability
      : typeof answer.confidence === 'number' && Number.isFinite(answer.confidence)
        ? answer.confidence
        : 0;

  return gateValue >= SECTION_GATE ? choice : ABSTAIN;
}
