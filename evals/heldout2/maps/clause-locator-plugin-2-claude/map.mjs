const CONFIDENCE_THRESHOLD = 0.5;

// Section bodies start at "N. " on their own paragraph and run to the next "N. " or end of text.
function extractSectionBodies(contractText) {
  const bodies = {};
  const regex = /(?:^|\n\n)(\d+)\.\s*([\s\S]*?)(?=\n\n\d+\.\s|$)/g;
  let m;
  while ((m = regex.exec(contractText)) !== null) {
    bodies[m[1]] = m[2].trim();
  }
  return bodies;
}

function buildCriteria(input) {
  const bodies = extractSectionBodies(input.contract_text);
  const criteria = {};
  for (const n of input.section_numbers) {
    const key = String(n);
    criteria[key] = bodies[key] || `Section ${key} of the contract.`;
  }
  criteria.none = 'No section in `contract_text` substantively addresses the topic asked in `question`.';
  return criteria;
}

export function buildState(input) {
  return {
    contract_text: input.contract_text,
    question: input.question,
  };
}

export function questions(input) {
  return {
    section: {
      type: 'choice',
      instructions:
        'Each option other than "none" is a section number from `contract_text`, paired with that ' +
        "section's full text. Which section's text directly and substantively sets out the answer to " +
        'the question in `question`? A section that only mentions a related term in passing, without ' +
        'actually stating that term, does not count. Choose "none" if no section addresses the topic.',
      criteria: buildCriteria(input),
    },
  };
}

export function decide(answers, input) {
  const ans = answers && answers.section;
  if (!ans || ans.type !== 'choice') return { section: 'abstain' };
  if (ans.choice === 'none') return { section: 'abstain' };
  if (typeof ans.confidence === 'number' && ans.confidence < CONFIDENCE_THRESHOLD) {
    return { section: 'abstain' };
  }
  return { section: String(ans.choice) };
}
