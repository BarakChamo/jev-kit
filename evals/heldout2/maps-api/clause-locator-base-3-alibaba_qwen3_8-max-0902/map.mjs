const MAX_OPTIONS = 255;
const MIN_CONFIDENCE = 0.7;
const MIN_TOP_PROB = 0.55;
const MIN_MARGIN = 0.12;

function asString(value) {
  return String(value ?? "").trim();
}

function escapeRegExp(value) {
  return asString(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sectionNumbers(input) {
  const raw = Array.isArray(input?.section_numbers) ? input.section_numbers : [];
  const seen = new Set();
  const out = [];

  for (const value of raw) {
    const n = asString(value);
    if (n && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }

  return out;
}

function truncate(text, max) {
  const s = asString(text).replace(/\s+/g, " ");
  if (!s) return "";
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

function parseSections(input) {
  const numbers = sectionNumbers(input);
  const sections = numbers.map((number) => ({ number, text: "" }));
  const byNumber = new Map(sections.map((s) => [s.number, s]));
  const text = asString(input?.contract_text);

  if (!numbers.length || !text) return sections;

  const wanted = new Set(numbers);
  let current = null;

  const close = () => {
    if (!current) return;
    const body = current.parts.join("\n").replace(/\s+/g, " ").trim();
    const section = byNumber.get(current.number);
    if (section && body && (!section.text || body.length > section.text.length)) {
      section.text = body;
    }
    current = null;
  };

  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(\d+)[.)](?!\d)\s*(.*)$/);
    if (m && wanted.has(m[1])) {
      close();
      current = { number: m[1], parts: [m[2] || ""] };
    } else if (current) {
      current.parts.push(line);
    }
  }
  close();

  if (sections.some((s) => !s.text)) {
    const escaped = numbers
      .slice()
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp);

    const markerRe = new RegExp(`(?:^|\\s)(${escaped.join("|")})[.)](?!\\d)`, "g");
    const markers = [];
    let m;

    while ((m = markerRe.exec(text))) {
      if (wanted.has(m[1])) {
        markers.push({
          number: m[1],
          index: m.index,
          start: m.index + m[0].length
        });
      }
    }

    markers.sort((a, b) => a.index - b.index);

    for (let i = 0; i < markers.length; i++) {
      const section = byNumber.get(markers[i].number);
      if (!section || section.text) continue;

      const stop = i + 1 < markers.length ? markers[i + 1].index : text.length;
      const body = text.slice(markers[i].start, stop).replace(/\s+/g, " ").trim();
      if (body) section.text = body;
    }
  }

  return sections;
}

function describe(section) {
  return truncate(section.text || `Section ${section.number}`, 500);
}

function invalidReason(input) {
  const question = asString(input?.question);
  const numbers = sectionNumbers(input);

  if (!question) return "missing question";
  if (!numbers.length) return "missing sections";
  if (numbers.length > MAX_OPTIONS) return "too many sections";

  return null;
}

export function buildState(input) {
  const numbers = sectionNumbers(input);

  return {
    question: asString(input?.question),
    section_numbers: numbers,
    contract_text: asString(input?.contract_text),
    sections: parseSections(input).map((s) => ({
      number: s.number,
      excerpt: truncate(s.text, 800)
    })),
    limits: {
      max_options: MAX_OPTIONS,
      invalid_reason: invalidReason(input)
    }
  };
}

export function questions(input) {
  const reason = invalidReason(input);

  if (reason) {
    return {
      review: {
        type: "noul",
        instructions: `Should this contract question be sent to a person because it is invalid (${reason})?`,
        criteria: {
          true: "Yes, send it to a person.",
          false: "No, it can be answered automatically."
        }
      }
    };
  }

  const numbers = sectionNumbers(input);
  const sections = parseSections(input);
  const includeAbstain = numbers.length < MAX_OPTIONS;
  const criteria = {};

  if (includeAbstain) {
    criteria.abstain = "No listed section clearly sets the requested term.";
  }

  for (const section of sections) {
    if (Object.keys(criteria).length >= MAX_OPTIONS) break;
    criteria[section.number] = describe(section);
  }

  return {
    section: {
      type: "choice",
      instructions:
        `Question: ${asString(input.question)}\n` +
        "Using the contract state, choose the section number whose language sets the requested term. " +
        (includeAbstain
          ? "Choose abstain only if no section clearly applies."
          : "Choose the single best section."),
      criteria
    }
  };
}

export function decide(answers, input) {
  if (invalidReason(input)) {
    return { section: "abstain" };
  }

  const allowed = new Set(sectionNumbers(input));
  let best = null;

  for (const answer of Object.values(answers || {})) {
    if (!answer || answer.type !== "choice") continue;

    const choice = asString(answer.choice).replace(/[.)\s]+$/, "");
    if (!choice || choice === "abstain" || !allowed.has(choice)) continue;

    const rawConfidence = Number(answer.confidence);
    const confidence = Number.isFinite(rawConfidence) ? rawConfidence : 1;
    if (confidence < MIN_CONFIDENCE) continue;

    if (answer.probabilities && typeof answer.probabilities === "object") {
      const probs = Object.entries(answer.probabilities)
        .map(([option, p]) => [
          asString(option).replace(/[.)\s]+$/, ""),
          Number(p)
        ])
        .filter(([, p]) => Number.isFinite(p))
        .sort((a, b) => b[1] - a[1]);

      if (probs.length) {
        const top = probs[0][1];
        const chosen = probs.find(([option]) => option === choice);
        const chosenProb = chosen ? chosen[1] : 0;
        const second = probs.find(([option]) => option !== choice);
        const secondProb = second ? second[1] : 0;

        if (chosenProb < MIN_TOP_PROB) continue;
        if (chosenProb < top - 0.05) continue;
        if (chosenProb - secondProb < MIN_MARGIN && chosenProb < 0.9) continue;
      }
    }

    if (!best || confidence > best.confidence) {
      best = { section: choice, confidence };
    }
  }

  return best ? { section: best.section } : { section: "abstain" };
}
