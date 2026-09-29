const RESERVED = new Set(['none', 'ambiguous', 'abstain', 'review', 'too_many']);
const PROBABILITY_GATE = 0.7;
const MARGIN_GATE = 0.1;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function normalizeSections(input) {
  const raw = Array.isArray(input?.section_numbers) ? input.section_numbers : [];
  const seen = new Set();
  const out = [];

  for (const value of raw) {
    if (value === null || value === undefined) continue;
    const s = String(value).trim();
    if (!s || s === '[object Object]') continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }

  return out;
}

function needsSafeKeys(sections) {
  return sections.some((section) => RESERVED.has(section));
}

function keyForSection(section, safe) {
  return safe ? `section:${section}` : section;
}

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function sectionFromKey(key, sections) {
  const k = String(key ?? '');
  if (!k) return null;

  if (sections.includes(k)) return k;

  if (k.startsWith('section:')) {
    const section = k.slice('section:'.length);
    if (sections.includes(section)) return section;
  }

  return null;
}

export function buildState(input) {
  const section_numbers = normalizeSections(input);

  return {
    contract_text: isNonEmptyString(input?.contract_text) ? input.contract_text : '',
    question: isNonEmptyString(input?.question) ? input.question : '',
    section_numbers,
    task_convention:
      'A section sets the asked term only if its own operative text states the rule asked in `question`. Headings, cross-references, definitions, schedules, exhibits, and mere mentions do not count unless the numbered section itself contains the substantive rule.'
  };
}

export function questions(input) {
  const sections = normalizeSections(input);
  const safe = needsSafeKeys(sections);

  if (sections.length > 254) {
    return {
      section_choice: {
        type: 'choice',
        instructions:
          'This case has too many section candidates for one safe choice question. Choose an option that sends the case to a person.',
        criteria: {
          abstain: 'A person should locate the section.',
          review: 'The case needs human review because there are too many section candidates.'
        }
      }
    };
  }

  const criteria = {};

  for (const section of sections) {
    criteria[keyForSection(section, safe)] = `Section ${section} of contract_text.`;
  }

  let tailInstruction;

  if (sections.length <= 253) {
    criteria.none = 'No numbered section in contract_text contains the operative rule asked in question.';
    criteria.ambiguous =
      'Two or more numbered sections in contract_text independently contain the operative rule asked in question, and question does not identify a preferred one.';
    tailInstruction = 'Choose `none` if no section does. Choose `ambiguous` if multiple sections do.';
  } else {
    criteria.abstain =
      'No numbered section contains the operative rule asked in question, or two or more sections independently contain it and question does not identify a preferred one.';
    tailInstruction = 'Choose `abstain` if no section does or if multiple sections do.';
  }

  return {
    section_choice: {
      type: 'choice',
      instructions: `Read contract_text, question, section_numbers, and task_convention. Which one section number from section_numbers sets the term asked in question? Choose the section whose own operative text states the rule. ${tailInstruction}`,
      criteria
    }
  };
}

export function decide(answers, input) {
  const sections = normalizeSections(input);

  if (
    !isNonEmptyString(input?.contract_text) ||
    !isNonEmptyString(input?.question) ||
    sections.length === 0 ||
    sections.length > 254
  ) {
    return { section: 'abstain' };
  }

  const answer = answers?.section_choice;

  if (!answer || typeof answer !== 'object' || !answer.probabilities || typeof answer.probabilities !== 'object') {
    return { section: 'abstain' };
  }

  const choice = String(answer.choice ?? '');

  if (!choice || RESERVED.has(choice)) {
    return { section: 'abstain' };
  }

  const section = sectionFromKey(choice, sections);

  if (!section) {
    return { section: 'abstain' };
  }

  const entries = Object.entries(answer.probabilities)
    .map(([key, value]) => [String(key), asNumber(value)])
    .sort((a, b) => b[1] - a[1]);

  if (entries.length === 0 || entries[0][0] !== choice) {
    return { section: 'abstain' };
  }

  const p = entries[0][1];
  const second = entries.length > 1 ? entries[1][1] : 0;

  if (p < PROBABILITY_GATE || p - second < MARGIN_GATE) {
    return { section: 'abstain' };
  }

  return { section };
}
