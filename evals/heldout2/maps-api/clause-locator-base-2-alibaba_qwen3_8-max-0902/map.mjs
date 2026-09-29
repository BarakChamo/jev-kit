const ABSTAIN = "abstain";
const MAX_OPTIONS = 255;
const MIN_CONFIDENCE = 0.7;
const MIN_PROBABILITY = 0.5;
const MIN_MARGIN = 0.1;

const cache = new WeakMap();

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function truncate(value, limit) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function sectionNumbers(input) {
  if (!Array.isArray(input?.section_numbers)) return [];
  return [...new Set(input.section_numbers.map((n) => String(n).trim()).filter(Boolean))];
}

function markerRegExp(sectionNumber, inline) {
  const n = escapeRegExp(sectionNumber);
  const boundary = inline ? "(?:^|\\n|\\s)" : "(?:^|\\n)";
  return new RegExp(
    `${boundary}\\s*(?:(?:section|article|clause|paragraph)\\s*#?\\s*:?)?\\s*${n}(?=\\s|[.):–—-](?!\\d)|$)\\s*[.):–—-]?\\s*`,
    "gi"
  );
}

function parse(input) {
  const text = typeof input?.contract_text === "string" ? input.contract_text : "";
  const question = typeof input?.question === "string" ? input.question.trim() : "";
  const order = sectionNumbers(input);
  const sections = Object.create(null);
  const markers = [];

  for (const num of order) {
    let match = markerRegExp(num, false).exec(text);
    if (!match) match = markerRegExp(num, true).exec(text);
    if (match) {
      markers.push({ num, index: match.index, end: match.index + match[0].length });
    }
  }

  markers.sort((a, b) => a.index - b.index || order.indexOf(a.num) - order.indexOf(b.num));

  const seen = new Set();
  const unique = [];
  for (const marker of markers) {
    if (!seen.has(marker.num)) {
      seen.add(marker.num);
      unique.push(marker);
    }
  }

  for (let i = 0; i < unique.length; i += 1) {
    const marker = unique[i];
    const stop = i + 1 < unique.length ? unique[i + 1].index : text.length;
    const body = text.slice(marker.end, stop).trim();
    const firstLine = body.split(/\r?\n/)[0] || "";
    sections[marker.num] = {
      heading: truncate(firstLine.split(/[.?!]/)[0], 120),
      text: body ? `${marker.num}. ${body}` : ""
    };
  }

  for (const num of order) {
    if (!sections[num]) sections[num] = { heading: "", text: "" };
  }

  return { text, question, order, sections };
}

function getParsed(input) {
  if (input && typeof input === "object") {
    if (cache.has(input)) return cache.get(input);
    const parsed = parse(input);
    cache.set(input, parsed);
    return parsed;
  }
  return parse(input);
}

function probability(obj, key, fallback) {
  const value = Number(obj?.[key]);
  return Number.isFinite(value) ? value : fallback;
}

export function buildState(input) {
  const parsed = getParsed(input);
  return {
    question: parsed.question,
    section_numbers: parsed.order,
    contract_text: parsed.text,
    sections: Object.fromEntries(parsed.order.map((num) => [num, parsed.sections[num]?.text || ""]))
  };
}

export function questions(input) {
  const parsed = getParsed(input);

  if (!parsed.question || parsed.order.length === 0 || parsed.order.length > MAX_OPTIONS) {
    return {};
  }

  const includeAbstain = parsed.order.length < MAX_OPTIONS && !parsed.order.includes(ABSTAIN);
  const criteria = {};

  for (const num of parsed.order) {
    criteria[num] = truncate(parsed.sections[num]?.text || "", 180) || `Section ${num}`;
  }

  if (includeAbstain) {
    criteria[ABSTAIN] = "No listed section clearly sets the requested term, or the contract text is insufficient.";
  }

  return {
    section: {
      type: "choice",
      instructions: [
        "Choose the contract section number that most directly sets the term asked about.",
        `Question: ${parsed.question}`,
        "Use state.sections, falling back to state.contract_text if needed.",
        "Prefer explicit provisions over tangential references.",
        includeAbstain ? "Choose 'abstain' if no section clearly answers the question." : ""
      ].filter(Boolean).join("\n"),
      criteria
    }
  };
}

export function decide(answers, input) {
  const validList = sectionNumbers(input);

  if (
    !input?.question ||
    !String(input.question).trim() ||
    validList.length === 0 ||
    validList.length > MAX_OPTIONS
  ) {
    return { section: ABSTAIN };
  }

  const answer = answers?.section;
  if (!answer || answer.type !== "choice") return { section: ABSTAIN };

  const choice = String(answer.choice ?? "").trim();
  const valid = new Set(validList);
  if (!valid.has(choice)) return { section: ABSTAIN };

  const confidence = Number(answer.confidence);
  if (!Number.isFinite(confidence) || confidence < MIN_CONFIDENCE) {
    return { section: ABSTAIN };
  }

  const probabilities =
    answer.probabilities && typeof answer.probabilities === "object"
      ? answer.probabilities
      : {};

  const chosenProbability = probability(probabilities, choice, confidence);
  const abstainProbability = probability(probabilities, ABSTAIN, Number.NaN);

  if (
    Number.isFinite(abstainProbability) &&
    (abstainProbability >= chosenProbability || chosenProbability - abstainProbability < MIN_MARGIN)
  ) {
    return { section: ABSTAIN };
  }

  const otherProbabilities = Object.entries(probabilities)
    .map(([key, value]) => [key, Number(value)])
    .filter(([key, value]) => key !== choice && key !== ABSTAIN && Number.isFinite(value));

  if (otherProbabilities.length > 0) {
    const next = Math.max(...otherProbabilities.map(([, value]) => value));
    if (chosenProbability < MIN_PROBABILITY || chosenProbability - next < MIN_MARGIN) {
      return { section: ABSTAIN };
    }
  }

  return { section: choice };
}
