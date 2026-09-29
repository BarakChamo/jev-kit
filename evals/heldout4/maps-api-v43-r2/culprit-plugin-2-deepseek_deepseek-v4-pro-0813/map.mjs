const MAX_CHOICE_OPTIONS = 255;
const LABEL_GATE = 0.8;

function getLines(input) {
  return Array.isArray(input?.log_lines) ? input.log_lines : [];
}

export function buildState(input) {
  const log_lines = getLines(input);
  return { log_lines };
}

export function questions(input) {
  const lines = getLines(input);

  if (lines.length === 0) {
    return {};
  }

  // A choice over every line is the reliable encoding, but the API allows at most
  // 255 options. If the case has more lines than the API can accept, we return no
  // question and decide() will abstain rather than pre-filter candidates in code.
  if (lines.length > MAX_CHOICE_OPTIONS) {
    return {};
  }

  const canOfferAmbiguous = lines.length < MAX_CHOICE_OPTIONS;
  const criteria = {};

  lines.forEach((rawLine, i) => {
    const text = typeof rawLine === "string" ? rawLine : String(rawLine ?? "");
    criteria[String(i)] = text === "" ? "(empty line)" : text;
  });

  if (canOfferAmbiguous) {
    criteria.ambiguous = "no single line in `log_lines` states a specific cause of the failure; a person should decide";
  }

  return {
    culprit: {
      type: "choice",
      instructions: [
        "Which line of `log_lines` states the specific cause of the failure?",
        "Pick the actual error message, exception, or failed assertion.",
        'Do not pick generic wrappers such as "##[error]Process completed with exit code 1.", summary counts, group/checkout/install progress lines, or stack frames below the error.',
        "If the same text appears more than once, pick the first occurrence."
      ].join(" "),
      criteria
    }
  };
}

export function decide(answers, input) {
  const lines = getLines(input);

  if (lines.length === 0) {
    return { culprit_line: "abstain" };
  }

  const answer = answers?.culprit;

  if (!answer || typeof answer.choice !== "string") {
    return { culprit_line: "abstain" };
  }

  const chosen = answer.choice;

  if (chosen === "ambiguous") {
    return { culprit_line: "abstain" };
  }

  const index = Number(chosen);

  if (!Number.isInteger(index) || index < 0 || index >= lines.length) {
    return { culprit_line: "abstain" };
  }

  const probability = answer.probabilities?.[chosen];

  if (typeof probability !== "number" || probability < LABEL_GATE) {
    return { culprit_line: "abstain" };
  }

  return { culprit_line: index };
}
