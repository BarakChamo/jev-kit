// Locate which numbered section of a contract sets a given term.

const CONFIDENCE_GATE = 0.6;

function extractHeadings(contractText, sectionNumbers) {
  const headings = {};
  for (const n of sectionNumbers) {
    const re = new RegExp(`(?:^|\\n)\\s*${n}\\.\\s*([^\\n]+)`, "m");
    const m = contractText.match(re);
    if (m) {
      const titleMatch = m[1].match(/^([^.]+)\./);
      headings[String(n)] = (titleMatch ? titleMatch[1] : m[1].slice(0, 60)).trim();
    } else {
      headings[String(n)] = `Section ${n}`;
    }
  }
  return headings;
}

export function buildState(input) {
  return {
    contract_text: input.contract_text,
    section_numbers: input.section_numbers,
  };
}

export function questions(input) {
  const headings = extractHeadings(input.contract_text, input.section_numbers);
  const criteria = {};
  for (const [num, title] of Object.entries(headings)) {
    criteria[num] = `Section ${num}, headed roughly "${title}", covers the subject matter of that heading and the clause text that follows it in \`contract_text\`.`;
  }

  return {
    section: {
      type: "choice",
      instructions:
        `\`contract_text\` is a contract divided into numbered sections listed in \`section_numbers\`. ` +
        `Question: "${input.question}" ` +
        `Read the actual clause text in \`contract_text\` (not just the heading words) and choose the single section number whose clause text sets out the answer to this question.`,
      criteria,
    },
  };
}

export function decide(answers, input) {
  const ans = answers && answers.section;
  if (!ans || ans.type !== "choice") return { section: "abstain" };
  if (!(ans.confidence >= CONFIDENCE_GATE)) return { section: "abstain" };
  const valid = new Set((input.section_numbers || []).map(String));
  if (!valid.has(ans.choice)) return { section: "abstain" };
  return { section: ans.choice };
}
