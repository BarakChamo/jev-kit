const GATE = 0.8; // placeholder: fit per corpus with jev-audit on labelled cases
const MAX_SECTIONS = 254; // one choice question may have at most 255 options; reserve one for abstain

function unsupported(tooManySections) {
  return {
    unsupported: {
      type: 'choice',
      instructions: tooManySections
        ? '`contract_text` has more sections than this map can ask Jev to choose between in one choice question. A person should decide.'
        : 'This case is missing the information needed to find a section. A person should decide.',
      criteria: {
        abstain: 'A person should decide.',
      },
    },
  };
}

export function buildState(input) {
  return {
    contract_text: input.contract_text ?? '',
    section_numbers: Array.isArray(input.section_numbers) ? input.section_numbers : [],
    question: input.question ?? '',
  };
}

export function questions(input) {
  const sectionNumbers = Array.isArray(input.section_numbers) ? input.section_numbers : [];
  const hasRequiredText = String(input.contract_text ?? '').trim().length > 0 &&
    String(input.question ?? '').trim().length > 0;

  if (!hasRequiredText || sectionNumbers.length > MAX_SECTIONS) {
    return unsupported(sectionNumbers.length > MAX_SECTIONS);
  }

  const criteria = {};
  for (const n of sectionNumbers) {
    criteria[String(n)] =
      `Section ${n} of \`contract_text\`. Choose this option only when that exact numbered section states the terms asked about in \`question\`.`;
  }
  criteria.abstain =
    '`question` is not answered by a single section of `contract_text`, or multiple sections answer it equally; a person should decide.';

  return {
    section_choice: {
      type: 'choice',
      instructions:
        'Read `contract_text` and `question`. Which section number in `section_numbers` states the terms that `question` asks about? Choose the exact section number. If no single section answers `question`, or it is genuinely ambiguous between sections, choose `abstain`.',
      criteria,
    },
  };
}

export function decide(answers, input) {
  const sectionNumbers = new Set((input?.section_numbers ?? []).map(String));
  const ans = answers?.section_choice;

  if (!ans) return { section: 'abstain' };
  if (ans.choice === 'abstain') return { section: 'abstain' };
  if (!sectionNumbers.has(ans.choice)) return { section: 'abstain' };

  const topProbability = ans.probabilities?.[ans.choice] ?? 0;
  if (topProbability < GATE) return { section: 'abstain' };

  return { section: ans.choice };
}
