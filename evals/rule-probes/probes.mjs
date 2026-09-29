// Rule probes: each rule's recommended wording against the one it warns against, on the same items,
// across three domains, with truth set by construction. Subject: Jev only.
//   NODE_USE_ENV_PROXY=1 node --env-file=../../.env.local probes.mjs [rule...]
import { writeFileSync } from 'node:fs';
import { evaluate } from '../../plugin/skills/jev-eval/scripts/jev-run.mjs';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const opts = (xs) => Object.fromEntries(xs.map((x) => [String(x), null]));
const yes = (a) => a.noul > 0.5;
const conf = (a) => (a.type === 'noul' ? Math.abs(a.noul - 0.5) * 2 : a.probabilities?.[a.choice] ?? a.confidence);
const DAY = 86400000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const long = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

// Each probe: items [{ state, truth }], and variants { name: { questions(item), read(answers, item) -> prediction } }.
const P = [];

// ---- rule 2: name the field (with padding that contains trigger content) ---------------------------
for (const [domain, trigger, clean, dirty, q] of [
  ['privilege', 'This email is privileged and confidential, prepared at the request of counsel.', 'Q3 planning notes: move the offsite to Lisbon, budget unchanged.', 'Legal advice from outside counsel on the merger risk: we recommend delaying the filing.', 'contains legal advice from a lawyer'],
  ['personal data', 'Contact: jane.doe@example.com, +44 20 7946 0000, 12 Baker Street.', 'Release notes: the export button now works in Safari.', 'Customer record: Tom Reyes, tom.reyes@example.org, +1 415 555 0199.', 'contains a person\'s contact details'],
  ['profanity', 'What the hell is this garbage, fix your damn app.', 'Thanks for the quick fix, everything works now.', 'This is a damn joke, the app crashed again and I lost my crap.', 'contains profanity'],
]) {
  const items = Array.from({ length: 12 }, (_, i) => ({ state: { excerpt: i % 2 ? dirty : clean, attachments: `Related material in the same thread: ${trigger} ` + 'Routine message. '.repeat(40) }, truth: i % 2 === 1 }));
  P.push({ rule: 2, domain, items, variants: {
    'this document (warned)': { questions: () => ({ q: { type: 'noul', instructions: `Does this document ${q}?` } }), read: (a) => yes(a.q) },
    'named field (recommended)': { questions: () => ({ q: { type: 'noul', instructions: `Does \`excerpt\` ${q}?` } }), read: (a) => yes(a.q) },
  } });
}

// ---- rule 4: the key carries no meaning ------------------------------------------------------------
for (const [domain, texts, instr] of [
  ['refunds', [['Please refund my order, it never arrived.', true], ['Where is my order?', false], ['I want my money back.', true], ['Can I change my address?', false]], 'Does `message` ask for money back?'],
  ['deploys', [['Rolled back the release after errors.', true], ['Deployed v2.3 to staging.', false], ['Reverted commit a1b2 in production.', true], ['Added a new feature flag.', false]], 'Does `note` describe undoing a change?'],
  ['security', [['Password was pasted in the public channel.', true], ['Rotated keys as scheduled.', false], ['API token committed to the repo.', true], ['Enabled 2FA for all admins.', false]], 'Does `event` describe a credential being exposed?'],
]) {
  const field = instr.match(/`(\w+)`/)[1];
  const items = Array.from({ length: 12 }, (_, i) => { const [t, truth] = texts[i % texts.length]; return { state: { [field]: t, id: i }, truth }; });
  P.push({ rule: 4, domain, items, variants: {
    'misleading key (warned)': { questions: () => ({ is_not_the_case: { type: 'noul', instructions: instr } }), read: (a) => yes(a.is_not_the_case) },
    'neutral key (recommended)': { questions: () => ({ q1: { type: 'noul', instructions: instr } }), read: (a) => yes(a.q1) },
  } });
}

// ---- rule 5: ask what is true now -------------------------------------------------------------------
for (const [domain, rows, cf, present, transient] of [
  ['CI retry', [['Test timed out after 5000 ms; it passed on the previous 40 runs.', true], ['AssertionError: expected 91.8 to be 90.', false], ['npm ERR! 503 Service Unavailable from registry.', true], ['TypeError: cannot read property id of undefined in checkout.ts:42.', false]], 'Would this job pass if it were retried?', 'What caused the failure in `log`?', ['flaky', 'infrastructure']],
  ['card payments', [['Declined: issuer temporarily unavailable (code 91).', true], ['Declined: insufficient funds (code 51).', false], ['Timeout contacting the card network.', true], ['Declined: card reported stolen (code 43).', false]], 'Would this payment succeed if it were attempted again in a minute?', 'What caused the decline described in `log`?', ['temporary_outage', 'timeout']],
  ['webhooks', [['Receiver returned 503 Service Unavailable.', true], ['Receiver returned 410 Gone: endpoint deleted.', false], ['Connection reset by peer after 30 s.', true], ['Receiver returned 400: payload schema invalid.', false]], 'Would this delivery succeed if it were retried later?', 'What caused the failed delivery in `log`?', ['transient_error', 'network']],
]) {
  const items = Array.from({ length: 12 }, (_, i) => { const [t, truth] = rows[i % rows.length]; return { state: { log: t, attempt: 1 + (i % 3) }, truth }; });
  const classes = Object.fromEntries([...transient.map((c, k) => [c, k === 0 ? 'a temporary, intermittent condition' : 'a temporary problem outside the system itself (a service, a network, a provider)']), ['permanent', 'a cause that will happen again until something is changed']]);
  P.push({ rule: 5, domain, items, variants: {
    'counterfactual (warned)': { questions: () => ({ q: { type: 'noul', instructions: cf } }), read: (a) => yes(a.q) },
    'present fact, derived in code (recommended)': { questions: () => ({ q: { type: 'choice', instructions: present, criteria: classes } }), read: (a) => transient.includes(a.q.choice) },
  } });
}

// ---- rule 6: split compound questions ---------------------------------------------------------------
for (const [domain, reqs, subs, split, truthOf] of [
  ['notice method', ['Notices may be given by email to legal@acme.example or by registered post.', 'Notices must be sent by registered post; email is not valid notice.'], ['The notice was emailed to legal@acme.example.', 'The notice was sent by registered post.'],
    { permits: 'Does `rule` allow notice to be given by email?', used: 'Was the notice described in `what_happened` sent by email?' }, (r, s) => r === 0 || s === 1],
  ['file format', ['Submissions must be PDF files.', 'Submissions may be PDF or Word files.'], ['The submission is a Word document (.docx).', 'The submission is a PDF file.'],
    { permits: 'Does `rule` accept Word documents?', used: 'Is the submission described in `what_happened` a Word document?' }, (r, s) => r === 1 || s === 1],
  ['delivery signature', ['Parcels over $500 are delivered without a signature only if the recipient waived it; otherwise an adult must sign.', 'No signature is required for any parcel.'], ['The $620 parcel was left at the door without a signature.', 'The $620 parcel was signed for by the adult recipient.'],
    { permits: 'Does `rule` allow a $620 parcel to be left without a signature when no waiver was given?', used: 'Was the parcel described in `what_happened` left without a signature?' }, (r, s) => r === 1 || s === 1],
]) {
  const items = [];
  for (let i = 0; i < 12; i++) {
    const r = i % 2, s = Math.floor(i / 2) % 2;
    items.push({ state: { rule: reqs[r], what_happened: subs[s], ref: i }, truth: truthOf(r, s) });
  }
  P.push({ rule: 6, domain, items, variants: {
    'compound (warned)': { questions: () => ({ q: { type: 'noul', instructions: 'Does what is described in `what_happened` satisfy whatever `rule` requires?' } }), read: (a) => yes(a.q) },
    'split, combined in code (recommended)': {
      questions: () => ({ permits: { type: 'noul', instructions: split.permits }, used: { type: 'noul', instructions: split.used } }),
      read: (a) => !yes(a.used) || yes(a.permits),
    },
  } });
}

// ---- rule 7: includes, not is -----------------------------------------------------------------------
for (const [domain, thing, rows] of [
  ['allergens', 'nuts', [['Pad thai topped with crushed peanuts', true], ['Walnut and blue cheese salad', true], ['Chicken curry with a cashew sauce', true], ['Garden salad with lemon dressing', false], ['Tomato soup and bread', false], ['Coconut rice (coconut only, no tree nuts)', false]]],
  ['hazmat shipping', 'a lithium battery', [['Laptop with its battery installed', true], ['Wireless headphones (built-in battery)', true], ['Phone case with a power-bank pocket, power bank included', true], ['Cotton t-shirts', false], ['Books and a paper map', false], ['Battery-shaped chocolate', false]]],
  ['content policy', 'violence', [['A thriller review mentioning a fist fight in chapter 3', true], ['A recipe blog post that ends with a bar brawl anecdote', true], ['A sports report describing a player being punched', true], ['A gardening guide to pruning roses', false], ['A product review of a blender', false], ['A travel blog about a peaceful lake', false]]],
]) {
  const items = Array.from({ length: 12 }, (_, i) => { const [t, truth] = rows[i % rows.length]; return { state: { item: t }, truth }; });
  const kind = { allergens: 'a nut dish', 'hazmat shipping': 'a battery shipment', 'content policy': 'a violent post' }[domain];
  P.push({ rule: 7, domain, items, variants: {
    'is it a kind (warned)': { questions: () => ({ q: { type: 'noul', instructions: `Is \`item\` ${kind}?` } }), read: (a) => yes(a.q) },
    'does it include (recommended)': { questions: () => ({ q: { type: 'noul', instructions: `Does \`item\` include ${thing}, even as a small part?` } }), read: (a) => yes(a.q) },
  } });
}

// ---- rule 8: never ask Jev to compare ---------------------------------------------------------------
for (const [domain, mk] of [
  ['baggage', (i) => { const limit = [20, 23, 32][i % 3], w = limit + [-3, -1, 1, 4][i % 4] + (i % 5) * 0.5; return { state: { allowance: `Your fare includes one checked bag of up to ${limit} kg.`, bag: `The checked bag weighed ${w} kg at the desk.` }, truth: w <= limit, nums: [w, limit] }; }],
  ['age limit', (i) => { const min = [16, 18, 21][i % 3], age = min + [-2, -1, 0, 1, 3][i % 5]; return { state: { rule: `Participants must be at least ${min} years old.`, applicant: `The applicant is ${age} years old.` }, truth: age >= min, nums: [age, min] }; }],
  ['budget', (i) => { const cap = [500, 1200, 2500][i % 3], amt = cap + [-150, -20, 30, 400][i % 4]; return { state: { policy: `Purchases up to $${cap} need no approval.`, purchase: `A purchase of $${amt} was requested.` }, truth: amt <= cap, nums: [amt, cap] }; }],
]) {
  const items = Array.from({ length: 12 }, (_, i) => mk(i));
  const fields = Object.keys(items[0].state);
  P.push({ rule: 8, domain, items, variants: {
    'direct comparison (warned)': { questions: () => ({ q: { type: 'noul', instructions: `Is the amount in \`${fields[1]}\` within the limit stated in \`${fields[0]}\`?` } }), read: (a) => yes(a.q) },
    'read both, compare in code (recommended)': {
      questions: (it) => {
        const vals = [...new Set(items.flatMap((x) => x.nums))].sort((a, b) => a - b);
        return { value: { type: 'choice', instructions: `What number does \`${fields[1]}\` state?`, criteria: opts(vals) }, limit: { type: 'choice', instructions: `What limit does \`${fields[0]}\` state?`, criteria: opts(vals) } };
      },
      read: (a, it) => (domain === 'age limit' ? Number(a.value.choice) >= Number(a.limit.choice) : Number(a.value.choice) <= Number(a.limit.choice)),
    },
  } });
}

// ---- rule 9: dates as choices -----------------------------------------------------------------------
for (const [domain, days, due, what] of [
  ['invoice', 30, 'Payment is due 30 days after the invoice date.', 'paid'],
  ['warranty', 365, 'The warranty covers claims made within 365 days of purchase.', 'claimed'],
  ['library', 21, 'Books must be returned within 21 days of borrowing.', 'returned'],
]) {
  const items = Array.from({ length: 12 }, (_, i) => {
    const start = Date.parse('2025-01-05') + i * 23 * DAY;
    const off = days + [-9, -2, -1, 0, 1, 2, 6, 15][i % 8];
    const end = start + off * DAY;
    return { state: { terms: due, start: `Started on ${long(start)}.`, event: `It was ${what} on ${long(end)}.` }, truth: off <= days, dates: [start, end] };
  });
  const dq = (field, label) => ({
    [`${label}_y`]: { type: 'choice', instructions: `In which year is the date in \`${field}\`?`, criteria: opts([2024, 2025, 2026, 2027]) },
    [`${label}_m`]: { type: 'choice', instructions: `In which month is the date in \`${field}\`?`, criteria: opts(MONTHS) },
    [`${label}_d`]: { type: 'choice', instructions: `On which day of the month is the date in \`${field}\`?`, criteria: opts(Array.from({ length: 31 }, (_, k) => k + 1)) },
  });
  const date = (a, l) => Date.UTC(Number(a[`${l}_y`].choice), MONTHS.indexOf(a[`${l}_m`].choice), Number(a[`${l}_d`].choice));
  P.push({ rule: 9, domain, items, variants: {
    'on time? (warned)': { questions: () => ({ q: { type: 'noul', instructions: `Under \`terms\`, did the event in \`event\` happen in time, counting from the date in \`start\`?` } }), read: (a) => yes(a.q) },
    'dates as choices, computed in code (recommended)': { questions: () => ({ ...dq('start', 's'), ...dq('event', 'e') }), read: (a) => (date(a, 'e') - date(a, 's')) / DAY <= days },
  } });
}

// ---- rule 10: pick one with a choice ----------------------------------------------------------------
for (const [domain, mk] of [
  ['FAQ passage', (i) => { const qs = [['How long do refunds take?', 'Refunds reach your card within 5 to 10 business days.'], ['Can I change my delivery address?', 'You can change the delivery address until the order ships.'], ['Do you ship to Canada?', 'We ship to Canada and Mexico with tracked delivery.']]; const [q, a] = qs[i % 3]; const generic = ['Thank you for contacting support.', 'Our team is here to help with any question.', 'Please see our help centre for more answers.', 'Refunds, delivery and shipping are covered in this FAQ.']; const lines = [...generic.slice(0, 2), a, ...generic.slice(2)]; const k = i % lines.length; const rot = [...lines.slice(k), ...lines.slice(0, k)]; return { state: { question: q, lines: rot }, truth: rot.indexOf(a) }; }],
  ['email thread', (i) => { const decision = ['We agreed to launch on 4 March.', 'Final decision: the budget is capped at $40k.', 'Decision: we will use vendor B.'][i % 3]; const noise = ['Thanks all for joining the call.', 'Following up on the thread below.', 'Looping in finance for visibility.', 'See the notes from last week.']; const lines = [noise[0], noise[1], decision, noise[2], noise[3]]; const k = i % 5; const rot = [...lines.slice(k), ...lines.slice(0, k)]; return { state: { question: 'Which message records the decision?', lines: rot }, truth: rot.indexOf(decision) }; }],
  ['config', (i) => { const key = ['timeout', 'max_retries', 'region'][i % 3]; const target = { timeout: 'timeout = 30s', max_retries: 'max_retries = 5', region: 'region = eu-west-1' }[key]; const noise = ['# settings for the worker', `# ${key} is documented in the README`, 'log_level = info', 'enabled = true']; const lines = [noise[0], noise[1], target, noise[2], noise[3]]; const k = i % 5; const rot = [...lines.slice(k), ...lines.slice(0, k)]; return { state: { question: `Which line sets ${key}?`, lines: rot }, truth: rot.indexOf(target) }; }],
]) {
  const items = Array.from({ length: 12 }, (_, i) => mk(i));
  P.push({ rule: 10, domain, items, variants: {
    'a noul per item (warned)': { questions: (it) => Object.fromEntries(it.state.lines.map((l, k) => [`l${k}`, { type: 'noul', instructions: `Does line ${k} of \`lines\` answer \`question\`?` }])), read: (a, it) => it.state.lines.map((_, k) => a[`l${k}`].noul).reduce((b, p, k, ps) => (p > ps[b] ? k : b), 0) },
    'one choice (recommended)': { questions: (it) => ({ q: { type: 'choice', instructions: 'Which line of `lines` answers `question`? Not a greeting, a pointer to other help, or a line that only mentions the topic.', criteria: Object.fromEntries(it.state.lines.map((l, k) => [String(k), l])) } }), read: (a) => Number(a.q.choice) },
  } });
}

// ---- run ---------------------------------------------------------------------------------------------
const only = process.argv.slice(2).map(Number);
const out = [];
for (const p of P.filter((p) => !only.length || only.includes(p.rule))) {
  const res = {};
  for (const [vname, v] of Object.entries(p.variants)) {
    let right = 0, confs = [], errs = 0;
    for (const it of p.items) {
      try {
        const { answers } = await evaluate(it.state, v.questions(it));
        const pred = v.read(answers, it);
        if (pred === it.truth) right++;
        confs.push(Math.min(...Object.values(answers).map(conf)));
      } catch (e) { errs++; }
    }
    res[vname] = { right, n: p.items.length, accuracy: right / p.items.length, decisiveness: confs.reduce((a, b) => a + b, 0) / (confs.length || 1), errors: errs };
  }
  out.push({ rule: p.rule, domain: p.domain, results: res });
  console.log(`rule ${p.rule} · ${p.domain.padEnd(18)} ` + Object.entries(res).map(([k, r]) => `${k}: ${r.right}/${r.n} (dec ${r.decisiveness.toFixed(2)})`).join('  |  '));
}
writeFileSync(new URL(`./results${only.length ? '.' + only.join('-') : ''}.json`, import.meta.url), JSON.stringify(out, null, 2));
