const MAX_CHOICE_OPTIONS = 255;
const ACT_THRESHOLD = 0.8;
const ABSTAIN = "abstain";

function getLines(input) {
  const raw = input?.log_lines;
  if (Array.isArray(raw)) {
    return raw.map((line) => (line == null ? "" : String(line)));
  }
  if (typeof raw === "string" && raw.length > 0) {
    return raw.split(/\r?\n/);
  }
  return [];
}

const CAUSE_INSTRUCTIONS =
  "Which single line in `log_lines` states the specific cause of the CI failure? " +
  "Choose the 0-based index of the line whose text contains the direct error, failed assertion, exception, timeout, compiler error, missing dependency, or explicit command error. " +
  "Do not choose group markers, step headers, successful output, generic wrappers such as \"Process completed with exit code 1\", summary counts such as \"Test Files 1 failed\", lifecycle messages such as \"ELIFECYCLE Test failed\", or stack frames below the direct error. " +
  "If no one line states the cause, or the log supports more than one line, choose abstain.";

export function buildState(input) {
  return {
    log_lines: getLines(input),
  };
}

export function questions(input) {
  const lines = getLines(input);

  if (lines.length === 0 || lines.length > MAX_CHOICE_OPTIONS - 1) {
    return {
      culprit: {
        type: "choice",
        instructions: CAUSE_INSTRUCTIONS,
        criteria: {
          [ABSTAIN]:
            "No single line can be chosen safely: no direct cause is present, the log is too long to list every line, or multiple lines are equally plausible.",
        },
      },
    };
  }

  const criteria = {};
  lines.forEach((text, index) => {
    criteria[String(index)] = text === "" ? "(empty line)" : text;
  });
  criteria[ABSTAIN] =
    "No single line states the specific cause, or multiple lines are equally plausible; a person should decide.";

  return {
    culprit: {
      type: "choice",
      instructions: CAUSE_INSTRUCTIONS,
      criteria,
    },
  };
}

export function decide(answers, input) {
  const answer = answers?.culprit;
  if (!answer || answer.type !== "choice") return ABSTAIN;

  const choice = answer.choice == null ? "" : String(answer.choice);
  if (choice === "" || choice === ABSTAIN) return ABSTAIN;

  const index = Number(choice);
  if (!Number.isInteger(index) || index < 0 || index >= getLines(input).length) {
    return ABSTAIN;
  }

  const p = answer.probabilities?.[choice];
  const abstainP = answer.probabilities?.[ABSTAIN] ?? 0;

  if (typeof p !== "number" || p < ACT_THRESHOLD || abstainP >= p) {
    return ABSTAIN;
  }

  return index;
}
