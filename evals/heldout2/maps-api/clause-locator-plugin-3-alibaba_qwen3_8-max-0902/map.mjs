const ABSTAIN = '__abstain__';
const MAX_CHOICE_OPTIONS = 254;
const CHOICE_ACT = 0.8;
const CHOICE_ABSTAIN_MAX = 0.35;
const NOUL_ACT = 0.8;
const NOUL_MARGIN = 0.15;
const NO_SECTION_MAX = 0.5;

function normalizeSectionNumber(value) {
  return String(value ?? '')
    .trim()
    .replace(/^section\s+/i, '')
    .replace(/[.)\s]+$/g, '');
}

function useChoice(state) {
  return state.section_numbers.length <= MAX_CHOICE_OPTIONS && !state.section_numbers.includes(ABSTAIN);
}

export function buildState(input) {
  const contract_text = String(input?.contract_text ?? '');
  const question = String(input?.question ?? '');
  const section_numbers = Array.isArray(input?.section_numbers)
    ? [...new Set(input.section_numbers.map(normalizeSectionNumber).filter(Boolean))]
    : [];

  return {
    contract_text,
    question,
    section_numbers,
    convention: 'A section "sets" a term when the operative language in that section establishes the term asked in `question`. A cross-reference, definition, recital, or passing mention does not set the term. If several sections mention the term, the section whose heading and sentences directly state the rule is the one that sets it.'
  };
}

function choiceQuestions(state) {
  const criteria = {
    [ABSTAIN]: 'No section in `contract_text` sets the term asked in `question`, or the state genuinely supports more than one answer.'
  };

  for (const n of state.section_numbers) {
    criteria[n] = `The section numbered ${n} in \`contract_text\`.`;
  }

  return {
    section: {
      type: 'choice',
      instructions: 'Using `convention`, which option is the section number in `section_numbers` whose section in `contract_text` sets the legal term asked in `question`? Choose `__abstain__` if no section sets that term or if the correct section is genuinely ambiguous.',
      criteria
    }
  };
}

function noulQuestions(state) {
  const questions = {
    no_section: {
      type: 'noul',
      instructions: 'Using `convention`, does `contract_text` contain no section listed in `section_numbers` that sets the legal term asked in `question`?',
      criteria: {
        true: 'No section listed in `section_numbers` sets the term asked in `question`.',
        false: 'At least one section listed in `section_numbers` sets the term asked in `question`.'
      }
    }
  };

  state.section_numbers.forEach((n, i) => {
    questions[`s${i}`] = {
      type: 'noul',
      instructions: `Using \`convention\`, does the section numbered ${n} in \`contract_text\` set the legal term asked in \`question\`?`,
      criteria: {
        true: `The section numbered ${n} sets the term asked in \`question\`.`,
        false: `The section numbered ${n} does not set that term, or mentions it only in passing.`
      }
    };
  });

  return questions;
}

export function questions(input) {
  const state = buildState(input);
  return useChoice(state) ? choiceQuestions(state) : noulQuestions(state);
}

export function decide(answers, input) {
  const state = buildState(input);
  if (!state.contract_text || !state.question || state.section_numbers.length === 0) return 'abstain';

  if (useChoice(state)) {
    const answer = answers?.section;
    const choice = answer?.choice;
    if (choice == null) return 'abstain';

    const selected = String(choice);
    if (selected === ABSTAIN || !state.section_numbers.includes(selected)) return 'abstain';

    const p = Number(answer.probabilities?.[selected] ?? 0);
    const abstainP = Number(answer.probabilities?.[ABSTAIN] ?? 0);

    if (!Number.isFinite(p) || p < CHOICE_ACT) return 'abstain';
    if (Number.isFinite(abstainP) && abstainP >= CHOICE_ABSTAIN_MAX) return 'abstain';

    return selected;
  }

  const noP = Number(answers?.no_section?.noul ?? 0);
  if (Number.isFinite(noP) && noP >= NO_SECTION_MAX) return 'abstain';

  const scored = state.section_numbers
    .map((n, i) => {
      const p = Number(answers?.[`s${i}`]?.noul ?? 0);
      return { n, p: Number.isFinite(p) ? p : 0 };
    })
    .sort((a, b) => b.p - a.p);

  const top = scored[0];
  const second = scored[1];

  if (!top || top.p < NOUL_ACT) return 'abstain';
  if (second && top.p - second.p < NOUL_MARGIN) return 'abstain';

  return top.n;
}
