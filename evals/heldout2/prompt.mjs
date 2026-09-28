// The single source of every task prompt, used by run.sh (Claude Code agents) and author.mjs (one-shot
// API authors). Same text for every arm and every model.
import { readFileSync } from 'node:fs';

export const API = 'Jev (TypeSafe System One) API: POST https://ai-gateway.vercel.sh/typesafe/v1/systemone with JSON {"model":"typesafe-ai/jev","state":<any JSON>,"questions":{<id>:<question>}}. Question types: {"type":"noul","instructions":"...","criteria":{"true":"...","false":"..."}} returns {"type":"noul","noul":<probability 0..1>}; {"type":"choice","instructions":"...","criteria":{"<option>":"<description>"}} returns {"type":"choice","choice":"<option>","confidence":<0..1>,"probabilities":{"<option>":<p>}} (at most 255 options); {"type":"score","instructions":"...","criteria":["<lowest level>","...","<highest level>"]} returns {"type":"score","score":<fractional level index>,"confidence":<0..1>,"legend":{"0":"<level text>"},"probabilities":{"0":<p>}}. All questions are answered in one parallel pass.';

export const TASKS = {
  'sla-breach': {
    text: 'Our support desk handles thousands of tickets a day. For each ticket, decide whether the first-response SLA was breached, under our written SLA policy (business hours, holidays, priorities). Build this check on Jev.',
    out: '{ breached: "yes" | "no" | "abstain" }',
  },
  'refund-eligibility': {
    text: 'Customers ask to return items from multi-item orders by writing a free-text message. For each request, decide whether the item they are asking about is eligible for return under our returns policy. We handle hundreds of thousands of requests a month. Build this on Jev.',
    out: '{ eligible: "yes" | "no" | "abstain" }',
  },
  'access-request': {
    text: 'Employees and contractors request access to internal systems in free text. For each request, decide: grant, needs_approval, or deny, under our written access policy and system catalog. Build this on Jev.',
    out: '{ decision: "grant" | "needs_approval" | "deny" | "abstain" }',
  },
  'clause-locator': {
    text: 'Our legal team asks which section of a contract sets a given term (governing law, liability cap, renewal, and so on). For each contract and question, point to the section number. Thousands of contracts a month. Build this on Jev.',
    out: '{ section: "<section number as a string>" | "abstain" }',
  },
  culprit: {
    text: 'When a CI job fails, we want to automatically point developers at the single log line that states the cause of the failure. We have thousands of failures a day. Build this on Jev.',
    out: '{ culprit_line: <0-based index into input.log_lines> | "abstain" }',
  },
  'data-export': {
    text: 'Teams request data exports in free text. For each request, decide: grant, needs_approval, or deny, under our written data export policy and the dataset and destination catalogs. We handle thousands of requests a week. Build this on Jev.',
    out: '{ decision: "grant" | "needs_approval" | "deny" | "abstain" }',
    suite: '../heldout3/data-export.json',
  },
  'expense-review': {
    text: 'Employees submit expense lines. For each line decide: approve, needs_approval (manager must approve), or reject, under our written travel and expense policy (limits in USD; convert foreign currency at the rates provided). We process hundreds of thousands of lines a month. Build this on Jev.',
    out: '{ decision: "approve" | "needs_approval" | "reject" | "abstain" }',
    suite: '../heldout/expense-review.json',
  },
};

export function buildPrompt(task) {
  const t = TASKS[task];
  const suite = JSON.parse(readFileSync(new URL(t.suite ?? `./${task}.json`, import.meta.url), 'utf8'));
  const sample = JSON.stringify(suite.cases[0].input, null, 1).slice(0, 3500);
  return `${t.text}

${API}

Each case arrives as an input object shaped like this example:
${sample}

Write map.mjs (plain JavaScript ES module, no dependencies) exporting:
  buildState(input)       -> the Jev state for this case
  questions(input)        -> the Jev questions map for this case
  decide(answers, input)  -> ${t.out}
answers is the API's answers object for your questions. Return "abstain" for any case you would send to a person rather than decide. Keep it concise. Do not call the API.`;
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(buildPrompt(process.argv[2]));
