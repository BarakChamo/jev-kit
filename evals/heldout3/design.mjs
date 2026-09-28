// Pre-registered design measure: does a map ask Jev for the policy's outcome? Loads each map, calls
// questions() on every case of its suite, and flags a map when any question is a choice whose options
// include an outcome pair (grant/deny, allow/deny, approved/denied), or a noul asking whether the request
// should be granted, denied, allowed or approved. No Jev calls.
//   node design.mjs <maps dir> [...]
import { readdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SUITES = { 'data-export': './data-export.json', 'access-request': '../heldout2/access-request.json', procurement: '../heldout4/procurement.json' };
const OUTCOME_PAIRS = [['grant', 'deny'], ['allow', 'deny'], ['approved', 'denied'], ['approve', 'deny'], ['approve', 'reject']];
const OUTCOME_NOUL = /\b(should|can|may|must)\b[^?]*\b(be )?(granted|denied|allowed|approved|refused|rejected)\b|\b(grant|deny|allow|approve)\b (this|the) (request|export|access)|\bapply (it|the policy|`?policy_text`?) to (this|the)\b|\b(prohibit|forbid|allow|permit)\w*\b[^?]*\b(this|the) (exact |specific )?(request|export)\b/i;

const asksOutcome = (q) => {
  if (q.type === 'choice') {
    const keys = Object.keys(q.criteria ?? {}).map((k) => k.toLowerCase());
    return OUTCOME_PAIRS.some(([a, b]) => keys.some((k) => k.includes(a)) && keys.some((k) => k.includes(b)));
  }
  if (q.type !== 'noul') return false;
  // Only the question itself counts: the last line of the instructions, which may quote the policy above it.
  // A question about what `policy_text` states reads a constant of the policy, not the request's outcome.
  const asked = (q.instructions ?? '').trim().split('\n').pop() ?? '';
  return !/^\s*does `?policy/i.test(asked) && OUTCOME_NOUL.test(asked);
};

const rows = [];
for (const dir of process.argv.slice(2)) {
  for (const n of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    const task = Object.keys(SUITES).find((t) => n.startsWith(t + '-'));
    const f = `${dir}/${n}/map.mjs`;
    const row = { dir, map: n, task, loaded: existsSync(f) };
    if (row.loaded) {
      try {
        const m = await import(pathToFileURL(f).href);
        const suite = JSON.parse(readFileSync(new URL(SUITES[task], import.meta.url), 'utf8'));
        const flagged = new Set();
        for (const c of suite.cases) for (const [id, q] of Object.entries(await m.questions(c.input))) if (asksOutcome(q)) flagged.add(id);
        row.asksOutcome = flagged.size > 0;
        row.outcomeQuestions = [...flagged];
      } catch (e) { row.loaded = false; row.error = String(e.message).slice(0, 120); }
    }
    rows.push(row);
    console.log(`${n.padEnd(34)} ${row.loaded ? (row.asksOutcome ? `asks for the outcome: ${row.outcomeQuestions.join(', ')}` : 'reads facts') : `not loaded ${row.error ?? ''}`}`);
  }
}
writeFileSync(new URL('./design.json', import.meta.url), JSON.stringify(rows, null, 2));
