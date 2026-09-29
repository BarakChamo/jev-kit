const ABSTAIN = "abstain";
const PAGE_SIZE = 254;
const MIN_CONFIDENCE = 0.6;

function truncate(value, max) {
  const s = String(value ?? "");
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function normalizeNumbers(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const n of list) {
    if (n == null) continue;
    const s = String(n).trim();
    if (!s || s === ABSTAIN || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function parseSnippets(text, numbers) {
  const wanted = new Set(numbers);
  const snippets = new Map();
  if (!text || wanted.size === 0) return snippets;

  const re = /(?:^|\n)\s*(?:(?:Section|Article|Clause|Paragraph)\s+)?([A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)[.).:]?\s/g;
  const markers = [];
  const seen = new Set();
  let m;

  while ((m = re.exec(text)) !== null) {
    const number = m[1];
    if (wanted.has(number) && !seen.has(number)) {
      seen.add(number);
      markers.push({ number, index: m.index });
    }
  }

  markers.sort((a, b) => a.index - b.index);

  for (let i = 0; i < markers.length; i += 1) {
    const end = i + 1 < markers.length ? markers[i + 1].index : text.length;
    const snippet = truncate(text.slice(markers[i].index, end).trim().replace(/\s+/g, " "), 700);
    snippets.set(markers[i].number, snippet);
  }

  return snippets;
}

export function buildState(input) {
  const contract_text = typeof input?.contract_text === "string"
    ? input.contract_text.replace(/\r/g, "")
    : "";

  const section_numbers = normalizeNumbers(input?.section_numbers);
  const snippets = parseSnippets(contract_text, section_numbers);

  return {
    question: truncate(input?.question, 500),
    contract_text,
    sections: section_numbers.map((number) => ({
      number,
      snippet: snippets.get(number) || ""
    }))
  };
}

export function questions(input) {
  const state = buildState(input);
  const sections = state.sections;

  const base = `Legal question: ${state.question}
Choose the contract section number that most directly sets the requested term. Use state.contract_text and state.sections. If the language is ambiguous or absent, choose ${ABSTAIN}.`;

  if (sections.length === 0 || sections.length > PAGE_SIZE * 24) {
    return {
      section: {
        type: "choice",
        instructions: `${base}
Choose ${ABSTAIN} because this case cannot be answered reliably from the supplied sections.`,
        criteria: {
          [ABSTAIN]: "No reliable automated section selection is possible."
        }
      }
    };
  }

  const out = {};

  for (let i = 0; i < sections.length; i += PAGE_SIZE) {
    const chunk = sections.slice(i, i + PAGE_SIZE);
    const criteria = {};

    for (const s of chunk) {
      criteria[s.number] = truncate(s.snippet || `Section ${s.number}`, 240);
    }

    criteria[ABSTAIN] = "No section in this subset clearly answers the question.";

    const chunkIndex = i / PAGE_SIZE;
    const id = sections.length <= PAGE_SIZE ? "section" : `section_${chunkIndex}`;
    const subset = sections.length <= PAGE_SIZE
      ? ""
      : `
This is subset ${chunkIndex + 1}. If the correct section is not in this subset, choose ${ABSTAIN}.`;

    out[id] = {
      type: "choice",
      instructions: `${base}${subset}`,
      criteria
    };
  }

  return out;
}

export function decide(answers, input) {
  const allowed = new Set(normalizeNumbers(input?.section_numbers));
  if (allowed.size === 0) return { section: ABSTAIN };

  let best = null;

  for (const answer of Object.values(answers || {})) {
    if (!answer || answer.type !== "choice") continue;

    const choice = String(answer.choice ?? "");
    if (!choice || choice === ABSTAIN || !allowed.has(choice)) continue;

    const confidence = Number(answer.confidence ?? 1);
    if (!Number.isFinite(confidence) || confidence < MIN_CONFIDENCE) continue;

    if (!best || confidence > best.confidence) {
      best = { section: choice, confidence };
    }
  }

  return best ? { section: best.section } : { section: ABSTAIN };
}
