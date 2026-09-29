// map.mjs — point to the contract section that sets a given term.
// Encoding follows rule 10: one `choice` over ALL sections (no pre-filtering, rule 16),
// with a hand-written term guide in the state (rule 3) and a present-tense noul detector
// to abstain when no section sets the term (rules 13, 14).

const TERM_GUIDE = `Common legal terms, as a lawyer reads them for the question asked:
- Governing law: the clause naming which jurisdiction's laws govern the agreement (choice of law). A venue or dispute-resolution clause is not governing law unless it also names the governing law.
- Liability cap: the limit on a party's total monetary liability, usually in a "Limitation of Liability" section. Carve-outs ("except for breaches of confidentiality") do not make it a different term.
- Renewal: how the agreement's term extends or renews after it ends, including automatic renewal and notice of non-renewal. A clause about terminating the agreement is not renewal.
- Term: how long the agreement initially lasts.
- Termination: rights to end the agreement early, including for-cause and for-convenience notice periods.
- Notices: how formal notice between the parties must be given (writing, addresses, delivery method).
- Indemnification: one party defending or compensating the other against third-party claims.
- Assignment: transferring the agreement or rights under it to another party.
- Confidentiality: obligations to keep disclosed information secret.
- Warranties: promises about how the service or product will perform.
- Fees / payment: amounts, invoicing, payment deadlines and interest on late amounts.
- Force majeure: relief from liability for events beyond a party's reasonable control.
- Data protection: how personal data is processed or protected.
If the question names a term not listed here, read it as a lawyer would.`;

export function buildState(input) {
  // Split the contract into numbered sections in code; send every declared section.
  const sections = {};
  const parts = String(input.contract_text).split(/\n(?=\s*\d{1,3}[.)]\s+)/);
  let current = null;
  for (const part of parts) {
    const m = part.match(/^\s*(\d{1,3})[.)]\s+/);
    if (m) {
      current = Number(m[1]);
      sections[current] = part.trim();
    } else if (current !== null) {
      sections[current] += "\n" + part.trim();
    }
  }
  for (const n of input.section_numbers ?? []) {
    if (!(n in sections)) sections[n] = "(this section number was listed but not found in contract_text)";
  }
  return {
    contract_text: input.contract_text,
    sections,
    question: input.question,
    term_definitions: TERM_GUIDE,
  };
}

export function questions(input) {
  const state = buildState(input);
  const criteria = {};
  for (const n of input.section_numbers ?? Object.keys(state.sections)) {
    criteria[String(n)] = (state.sections[n] ?? "").slice(0, 500);
  }
  return {
    any_section_sets_term: {
      type: "noul",
      instructions:
        "Does any section in `sections` actually state the term asked about in `question`, read per `term_definitions`? A cross-reference to another section, or a passing mention of the word, does not count; only a section that sets the term itself counts.",
      criteria: {
        true: "at least one section in `sections` sets the term asked about in `question`",
        false: "no section in `sections` sets that term",
      },
    },
    section: {
      type: "choice",
      instructions:
        "Which section in `sections` sets the term asked about in `question`, read per `term_definitions`? Pick the section that states the term's rule itself. Do not pick a section that merely mentions or cross-references the term, or a section about a different but related term (for example, a termination section for a renewal question, or a venue clause for a governing-law question). If several sections state parts of the term, pick the one stating the main rule. If no section sets the term, pick the option that says so.",
      criteria: {
        ...criteria,
        none: "no section in `sections` sets the term asked about in `question`",
      },
    },
  };
}

export function decide(answers, input) {
  const present = answers.any_section_sets_term?.noul ?? 0;
  const a = answers.section;
  if (!a || a.choice === "none" || present < 0.5) return { section: "abstain" };
  const p = a.probabilities?.[a.choice] ?? 0;
  // Gate on the probability of the label we act on (rule 13); unsure never becomes a citation.
  if (p >= 0.8) return { section: String(a.choice) };
  return { section: "abstain" };
}
