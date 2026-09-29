// Locates which numbered contract section answers a legal-term question.

function parseSections(contractText) {
  const blocks = contractText.split(/\n\s*\n/);
  const map = {};
  for (const block of blocks) {
    const m = block.match(/^\s*(\d+)\.\s/);
    if (m) map[m[1]] = block.trim();
  }
  return map;
}

export function buildState(input) {
  const parsed = parseSections(input.contract_text);
  const sections = input.section_numbers.map((n) => ({
    number: String(n),
    text: parsed[String(n)] || "",
  }));
  return {
    question: input.question,
    sections,
  };
}

export function questions(input) {
  const parsed = parseSections(input.contract_text);
  const criteria = {};
  for (const n of input.section_numbers) {
    const key = String(n);
    const text = parsed[key] || "(section text not found)";
    criteria[key] = `This is the section that most directly sets out the term asked about. Its full text: ${text}`;
  }
  criteria["none"] = "No individual numbered section sets out this term; the contract does not address it as its own section.";

  return {
    section: {
      type: "choice",
      instructions: `The state's \`sections\` field lists every numbered section of a contract with its full text, and \`question\` names a legal term. Which section number in \`sections\` sets out that term? Answer "none" if no listed section sets out this term.`,
      criteria,
    },
  };
}

const CONFIDENCE_THRESHOLD = 0.8;

export function decide(answers, input) {
  const ans = answers && answers.section;
  if (!ans || ans.type !== "choice") return { section: "abstain" };
  if (ans.choice === "none") return { section: "abstain" };

  const topProb = (ans.probabilities && ans.probabilities[ans.choice]) ?? ans.confidence ?? 0;
  if (topProb < CONFIDENCE_THRESHOLD) return { section: "abstain" };

  return { section: String(ans.choice) };
}
