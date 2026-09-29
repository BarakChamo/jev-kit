// map.mjs — point to the section of a contract that sets a given term (governing law,
// liability cap, renewal, ...). Standard interface for jev-run: buildState / questions / decide.

const SNIPPET_LEN = 120;
const ACT = 0.8;      // act gate on the chosen label's probability; fit on labelled cases
const MARGIN = 0.1;   // pointing is Jev's weakest mode: also require separation from the runner-up
const PRESENT = 0.5;  // veto: the term must actually be stated somewhere in the contract

// Best-effort snippet of a section's opening text, used only to describe the choice options.
// Never filters: every number in section_numbers stays an option even when this fails.
function sectionDescription(input, n) {
  const text = String(input.contract_text ?? '');
  try {
    const re = new RegExp(`(^|\\n)[ \\t]*(?:Section\\s+)?${n}\\s*[.)\\]:—-]`, 'i');
    const m = text.match(re);
    if (m) {
      const start = m.index + m[0].length;
      const s = text.slice(start, start + SNIPPET_LEN).replace(/\s+/g, ' ').trim();
      if (s) return `Section ${n} of \`contract_text\`, which opens: "${s}…"`;
    }
  } catch {
    /* fall through */
  }
  return `Section ${n} of \`contract_text\`.`;
}

export function buildState(input) {
  return {
    contract_text: input.contract_text, // the full source, not an extraction of it
    section_numbers: input.section_numbers,
    question: input.question,
    // Domain convention, written once (rule 3): what "sets a term" means for a legal reader.
    convention:
      'A section "sets" a term when it states the operative rule for that term itself. ' +
      'A section that only mentions the term in passing, or that points to another section, ' +
      'a schedule or an external document for the rule, does not set the term. Where one ' +
      'section states the rule and another carves out an exception, the section stating the ' +
      'main rule is the one that sets the term.',
  };
}

export function questions(input) {
  const nums = Array.isArray(input.section_numbers) ? input.section_numbers : [];
  const criteria = {};
  for (const n of nums) criteria[String(n)] = sectionDescription(input, n); // all sections: no pre-filter
  criteria.none =
    'No section of `contract_text` states this term; the question does not match anything in the contract.';
  criteria.ambiguous =
    'The contract genuinely supports more than one section as the answer, or the rule is split ' +
    'with no clear main section; a person should decide.';

  return {
    term_present: {
      type: 'noul',
      instructions:
        'Does any section of `contract_text` state the operative rule for the term asked about in ' +
        '`question`, rather than only mentioning that term in passing? Follow `convention`.',
      criteria: {
        true: 'some section states the rule or obligation for this term itself',
        false: 'the term is only mentioned in passing, is handled wholly by reference to another document, or is absent',
      },
    },
    section: {
      type: 'choice', // pick-one-of-many: a choice over every section, not a noul per section
      instructions:
        'Which section of `contract_text` sets the term asked about in `question`? Choose its number ' +
        'from the options. "Sets" follows `convention`. Read the full `contract_text`; the option ' +
        'descriptions are only opening snippets.',
      criteria,
    },
  };
}

export function decide(answers, input) {
  const pick = answers?.section;
  if (!pick || pick.type !== 'choice') return { section: 'abstain' };
  if (pick.choice === 'none' || pick.choice === 'ambiguous') return { section: 'abstain' };

  const probs = pick.probabilities ?? {};
  const p = probs[pick.choice] ?? 0;
  const runner = Math.max(
    0,
    ...Object.entries(probs)
      .filter(([k]) => k !== pick.choice)
      .map(([, v]) => v ?? 0)
  );
  const present = answers?.term_present?.noul ?? 0;

  // Gate on the probability of the label we act on; doubt never relaxes a decision.
  if (p >= ACT && p - runner >= MARGIN && present >= PRESENT) {
    return { section: String(pick.choice) };
  }
  return { section: 'abstain' };
}
