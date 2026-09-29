// map.mjs — "Which section of this contract sets the governing law (the
// liability cap, the renewal, ...)?" → the section number, or "abstain"
// (a person). One request per case; thousands of contracts a month.
//
// Design (jev-questions skill):
//  - State: the whole contract text (the source, rule 1), every section
//    number, the per-section texts split off in code when the numbering is
//    unambiguous, the legal team's question, and a hand-written reading
//    convention for what "sets a term" means (rule 3).
//  - One `choice` over EVERY section, each option's description quoting that
//    section's full text — the measured pattern for picking one of many
//    (100%, vs 13–100% for a noul per section; rules 10 and 16: no
//    pre-filtering, everything is sent). Over 253 sections the options split
//    across questions, since the API allows at most 255.
//  - `none` / `ambiguous` options (rule 14) plus a gate on the picked
//    option's probability — the calibrated distribution, not the
//    under-confident `confidence` scalar (rule 13). Anything not gated, and
//    any case where two sections both clear the gate, goes to a person.
//    GATE is a placeholder: fit it on ~30 labelled cases (jev-audit).
//  - No comparisons, arithmetic or counterfactuals are asked of Jev
//    (rules 5, 8, 9); the only decision logic is in code below.

const GATE = 0.8;   // placeholder — fit it, don't guess it
const CHUNK = 253;  // 255 options max, minus the non-section options

const CONVENTION = `How this team reads "which section sets a term": a section sets a term when its own words carry the operative rule that establishes that term. Examples: a clause reading "This Agreement shall be governed by the laws of England" sets governing law; "each party's total liability is capped at the fees paid in the twelve months before the claim" sets the liability cap; "this Agreement renews automatically for successive one-year terms unless either party gives notice of non-renewal" sets renewal; "either party may terminate this Agreement for any reason on ninety days' written notice" sets termination for convenience. A section does NOT set a term when it only mentions the topic in passing, only cross-references another section or schedule ("in accordance with the Data Processing Addendum"), only defines words, or only carves out an exception or a special case: a force-majeure clause saying a party "is not liable for delays" does not set the liability cap, and a renewal clause's "notice of non-renewal" does not set termination for convenience. If the rule sits in a schedule, addendum or exhibit rather than a numbered section, no numbered section sets it.`;

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Split `text` into the sections listed in `numbers` by finding each number's
// marker at the start of a line, in order. Two tiers of marker strictness.
// This is a transformation, not a filter: every section stays an option and
// the whole text stays in the state. Returns null on failure, in which case
// the questions fall back to options that carry only the section numbers.
function tryParse(text, numbers, marker) {
  const starts = [];
  let from = 0;
  for (const n of numbers) {
    const re = new RegExp(
      "(?:^|\\n)[ \\t]*(?:§[ \\t]*)?(?:(?:section|article)[ \\t]+)?" +
        esc(String(n).trim()) + marker,
      "i"
    );
    const m = re.exec(text.slice(from));
    if (!m) return null;
    starts.push(from + m.index);
    from += m.index + 1;
  }
  const sections = starts.map((start, i) => ({
    number: String(numbers[i]).trim(),
    text: text.slice(start, i + 1 < starts.length ? starts[i + 1] : text.length).trim(),
  }));
  if (sections.some((s) => !s.text)) return null;
  if (starts[0] > text.length / 2) return null; // markers probably hit stray lines
  return sections;
}

function parseSections(text, numbers) {
  if (typeof text !== "string" || !Array.isArray(numbers) || numbers.length === 0) return null;
  return (
    tryParse(text, numbers, "[ \\t]*[.):][ \\t]+") ||
    tryParse(text, numbers, "[ \\t]*(?=[.):,;]|\\s)")
  );
}

function instructionsFor(parsed, multi) {
  const where = parsed
    ? "The options below list " + (multi ? "some of" : "every one of") +
      " the numbered sections of `contract_text` (the same sections sit in `sections`); each option's description quotes that section's full text."
    : "The options below are the section numbers listed in `section_numbers`; each section's own text is in `contract_text`, so find the sections there.";
  const pick = parsed
    ? "Pick the one option whose quoted section carries the operative rule that establishes the term asked about in `question`, applying the reading convention in `convention`."
    : "Find the section of `contract_text` whose own words carry the operative rule that establishes the term asked about in `question`, applying the reading convention in `convention`, and answer with that section's number.";
  const skip = "Do not answer with a section that only mentions the topic in passing, only cross-references another section or schedule, only defines words, or only carves out an exception or a special case.";
  const abstain = multi
    ? "If no option listed in this question sets the term, pick `none_in_this_list`."
    : "If no listed section sets the term, pick `none`; if two or more listed sections each set it, pick `ambiguous`.";
  return "Which numbered section of the contract sets the term the legal team asks about in `question`? " +
    where + " " + pick + " " + skip + " " + abstain;
}

export function buildState(input) {
  const text = typeof input.contract_text === "string" ? input.contract_text : "";
  const state = {
    contract_text: text,
    section_numbers: (input.section_numbers ?? []).map((n) => String(n).trim()),
    question: input.question ?? "",
    convention: CONVENTION,
  };
  const sections = parseSections(text, input.section_numbers ?? []);
  if (sections) state.sections = sections;
  return state;
}

export function questions(input) {
  const text = typeof input.contract_text === "string" ? input.contract_text : "";
  const numbers = (input.section_numbers ?? []).map((n) => String(n).trim());
  if (numbers.length === 0) return {}; // nothing to point at; decide() abstains
  const sections = parseSections(text, input.section_numbers ?? []);
  const items = sections ?? numbers.map((number) => ({ number }));
  const multi = items.length > CHUNK;
  const qs = {};
  for (let g = 0; g * CHUNK < items.length; g++) {
    const group = items.slice(g * CHUNK, (g + 1) * CHUNK);
    const criteria = {};
    for (const it of group) {
      criteria[it.number] = sections
        ? it.text
        : "the section of `contract_text` numbered " + it.number;
    }
    if (multi) {
      criteria.none_in_this_list =
        "no section listed among the options of this question sets the term";
    } else {
      criteria.none =
        "no numbered section of `contract_text` sets the term asked about in `question`";
      criteria.ambiguous =
        "two or more of the listed sections each set the term; a person should decide which one to cite";
    }
    qs[multi ? "section_" + g : "section"] = {
      type: "choice",
      instructions: instructionsFor(Boolean(sections), multi),
      criteria,
    };
  }
  return qs;
}

export function decide(answers, input) {
  const raw = answers ?? {};
  const given = raw.answers && typeof raw.answers === "object" ? raw.answers : raw;
  const numbers = new Set((input?.section_numbers ?? []).map((n) => String(n).trim()));
  const gated = [];
  for (const ans of Object.values(given)) {
    if (!ans || ans.type !== "choice") continue;
    const pick = String(ans.choice);
    if (!numbers.has(pick)) continue; // `none`, `ambiguous`, `none_in_this_list`: a person decides
    if ((ans.probabilities?.[pick] ?? 0) >= GATE) gated.push(pick);
  }
  // One gated pick is the answer. None gated, or two gated (only possible
  // across chunks, i.e. two sections each confidently set the term) → a person.
  return gated.length === 1 ? { section: gated[0] } : { section: "abstain" };
}
