// map.mjs — point to the contract section that sets a given term.
// Pattern: "pick one of many with a choice" (rule 10) over every section number,
// with an explicit "not set / ambiguous" option (rule 14), gated on the
// probability of the label we act on (rule 13). No pre-filtering (rule 16):
// the whole contract text goes into the state (rule 1).

const ABSTAIN_OPTION = "not_set_or_ambiguous";
const GATE_ACT = 0.8;   // fit on labelled cases before trusting (jev-eval)

export function buildState(input) {
  return {
    contract_text: input.contract_text,
    section_numbers: input.section_numbers,
    question: input.question,
    convention: [
      "Legal-team convention for 'which section sets a term':",
      "A section SETS a term when its own heading or text establishes the rule for that term",
      "(the governing law, the liability cap, renewal, notice periods, and so on).",
      "A section does NOT set the term when it only mentions the term in passing,",
      "cross-references another section, or states a different term that happens to use",
      "similar words (for example, a termination notice period is not a renewal notice period).",
      "Only sections whose numbers appear in `section_numbers` count; schedules or addenda",
      "mentioned in the text but not listed there do not count.",
    ].join(" "),
  };
}

export function questions(input) {
  const options = {};
  for (const n of input.section_numbers) options[String(n)] = null;
  options[ABSTAIN_OPTION] =
    "no section in `contract_text` sets the term the question asks about, or more than one section could equally be the answer, or the answer cannot be determined — a person should decide";
  return {
    which_section: {
      type: "choice",
      instructions:
        "Reading `contract_text` and the convention in `convention`, which section number listed in `section_numbers` is the section that sets the term asked about in `question`? Answer with the number of the section whose own text establishes that term. Do not answer with a section that merely mentions the term, cross-references it, or covers a neighbouring but different term.",
      criteria: options,
    },
  };
}

export function decide(answers, input) {
  const a = answers && answers.which_section;
  if (!a || a.type !== "choice") return { section: "abstain" };
  if (a.choice === ABSTAIN_OPTION) return { section: "abstain" };
  if (!input.section_numbers.includes(Number(a.choice))) return { section: "abstain" };
  const p = (a.probabilities && a.probabilities[a.choice]) ?? a.confidence ?? 0;
  // Gate on the probability of the label we act on; doubt never becomes an answer.
  if (p < GATE_ACT) return { section: "abstain" };
  return { section: String(a.choice) };
}
