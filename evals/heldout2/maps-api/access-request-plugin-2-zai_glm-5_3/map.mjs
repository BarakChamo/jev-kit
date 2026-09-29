// Access-request map for Jev.
// Design: the state carries the full policy text, catalog, requester record and request text.
// Jev only reads facts (which system, what access level, what the policy requires for each
// class of case). All combining — environment lookup, on-call eligibility, the final
// grant/approval/deny call — happens in code (rules 8, 9, 12). No question asks Jev to
// compare, compute, or decide an action.

const ACT = 0.8; // probability needed before any answer is used at all

// What the policy requires before a given access may be granted. One shared rubric so the
// code can branch on the option names.
const APPROVAL = {
  none: 'the policy grants this access outright; no approval is needed',
  manager: "the requester's manager's approval is needed first",
  security: "security approval is needed first",
  manager_and_security: "both the manager's and security approval are needed first",
  prohibited: 'the policy bars this access outright; no approval makes it grantable',
  not_stated: '`policy_text` contains no rule covering this case',
};

// (level, environment phrase, who, extra note, question id)
const CELLS = [
  ['read', 'non-production', 'an employee', '', 'req_read_nonprod_employee'],
  ['write', 'non-production', 'an employee', '', 'req_write_nonprod_employee'],
  ['read', 'production', 'an employee who is not on call', '', 'req_read_prod_employee_not_oncall'],
  ['read', 'production', 'an engineer who is currently on call', 'Apply any exception `policy_text` makes for engineers on call.', 'req_read_prod_employee_oncall'],
  ['write', 'production', 'an employee who is not on call', '', 'req_write_prod_employee_not_oncall'],
  ['write', 'production', 'an engineer who is currently on call', 'Apply any exception `policy_text` makes for engineers on call.', 'req_write_prod_employee_oncall'],
  ['read', 'non-production', 'a contractor', 'A rule barring contractors from a class of systems counts as prohibiting.', 'req_read_nonprod_contractor'],
  ['write', 'non-production', 'a contractor', 'A rule barring contractors from a class of systems counts as prohibiting.', 'req_write_nonprod_contractor'],
  ['read', 'production', 'a contractor', 'A rule barring contractors from a class of systems counts as prohibiting.', 'req_read_prod_contractor'],
  ['write', 'production', 'a contractor', 'A rule barring contractors from a class of systems counts as prohibiting.', 'req_write_prod_contractor'],
];

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    catalog: input.catalog,
    requester: input.requester,
    request_text: input.request_text,
  };
}

export function questions(input) {
  const q = {
    target_system: {
      type: 'choice',
      instructions:
        'Which single system from `catalog` is the requester asking for access to in `request_text`? Choose the system the request asks access to, not one merely mentioned as context. If the request names no system in `catalog`, choose none_match. If it asks for access to more than one system, choose multiple_systems.',
      criteria: Object.fromEntries([
        ...input.catalog.map((c) => [c.system, `a ${c.environment} system listed in \`catalog\``]),
        ['none_match', 'the request does not name any system in `catalog`'],
        ['multiple_systems', 'the request asks for access to more than one system'],
      ]),
    },
    access_level: {
      type: 'choice',
      instructions:
        'What level of access does `request_text` ask for? "read", "view", "read-only", "look at" mean read_only. "write", "modify", "update", "edit", "deploy", "maintain" mean write; if the request asks for both read and write, choose write. "admin", "root", "superuser", "full access", or control over who else has access mean admin.',
      criteria: {
        read_only: 'viewing or reading only, no ability to change anything',
        write: 'the ability to change data or code',
        admin: 'administrative, root or full control',
        unclear: 'the request does not state the level of access',
      },
    },
    admin_barred: {
      type: 'noul',
      instructions:
        'Does `policy_text` contain a rule that admin access may not be granted through this form or request process, for anyone?',
      criteria: {
        true: 'some rule in `policy_text` bars granting admin access via this form',
        false: 'no rule in `policy_text` bars admin access',
      },
    },
  };
  for (const [level, env, who, note, id] of CELLS) {
    q[id] = {
      type: 'choice',
      instructions:
        `According to \`policy_text\`, what is needed before ${level} access to a ${env} system may be granted to ${who}? ` +
        `Answer from \`policy_text\` only; ignore anything in \`request_text\`. ${note}`.trim(),
      criteria: APPROVAL,
    };
  }
  return q;
}

// Gate on the probability of the label we act on. Granting is the risky action, so it needs
// the most certainty; "needs_approval" is the safe middle. Unsure never becomes "grant".
const GATE = { grant: 0.9, deny: 0.8, needs_approval: 0.7 };

function top(answers, id) {
  const q = answers && answers[id];
  if (!q || q.type === 'noul') return null;
  if (!q.choice) return null;
  return { choice: q.choice, p: (q.probabilities && q.probabilities[q.choice]) || 0 };
}

export function decide(answers, input) {
  // 1. Which system, and therefore which environment (environment comes from code + catalog,
  //    never from Jev).
  const t = top(answers, 'target_system');
  if (!t || t.choice === 'none_match' || t.choice === 'multiple_systems' || t.p < ACT)
    return { decision: 'abstain' };
  const entry = (input.catalog || []).find((c) => c.system === t.choice);
  if (!entry) return { decision: 'abstain' };
  const env = String(entry.environment).toLowerCase() === 'production' ? 'prod' : 'nonprod';

  // 2. What level of access.
  const l = top(answers, 'access_level');
  if (!l || l.choice === 'unclear' || l.p < ACT) return { decision: 'abstain' };

  // 3. Admin: deny if the policy bars it; otherwise a person decides. Never auto-grant admin.
  if (l.choice === 'admin') {
    const ab = answers.admin_barred;
    return ab && typeof ab.noul === 'number' && ab.noul >= ACT
      ? { decision: 'deny' }
      : { decision: 'abstain' };
  }
  if (l.choice !== 'read' && l.choice !== 'write') return { decision: 'abstain' };

  // 4. Pick the policy cell from facts already in code: employment, role, on-call status.
  const req = input.requester || {};
  const emp = String(req.employment || '').toLowerCase();
  if (emp !== 'employee' && emp !== 'contractor') return { decision: 'abstain' };
  const onCallEng =
    req.on_call === true && String(req.role || '').toLowerCase().includes('engineer');

  const cellId =
    emp === 'contractor'
      ? `req_${l.choice}_${env}_contractor`
      : `req_${l.choice}_${env}_employee${env === 'prod' ? (onCallEng ? '_oncall' : '_not_oncall') : ''}`;

  const c = top(answers, cellId);
  if (!c) return { decision: 'abstain' };

  const decision =
    c.choice === 'none'
      ? 'grant'
      : c.choice === 'prohibited'
        ? 'deny'
        : c.choice === 'manager' || c.choice === 'security' || c.choice === 'manager_and_security'
          ? 'needs_approval'
          : 'abstain'; // not_stated, or an option we do not branch on

  if (decision === 'abstain') return { decision: 'abstain' };
  return c.p >= GATE[decision] ? { decision } : { decision: 'abstain' };
}
