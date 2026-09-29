// map.mjs — access-request triage (grant / needs_approval / deny / abstain) on Jev.
// Design: state carries the policy, catalog, requester record and raw request text
// (rule 1). Questions only read present-tense facts, each scoped to a named field
// (rule 2); the decision is derived in code (rule 12) and gated on probabilities
// (rule 13). No question asks Jev to compare, compute, or decide an action.

const TRUE_P = 0.7;   // act on a noul "true" only at/above this
const FALSE_P = 0.3;  // act on a noul "false" only at/below this
const CHOICE_P = 0.7; // act on a chosen option only at/above this

const NOT_LISTED = 'system_not_in_catalog';

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    catalog: input.catalog,
    requester: input.requester,
    request_text: input.request_text,
  };
}

export function questions(input) {
  return {
    // What the request asks for (read the text exactly; no interpretation of approvals).
    access_level: {
      type: 'choice',
      instructions:
        'What level of access does `request_text` ask for? Judge only what the text asks for, not what it is entitled to.',
      criteria: {
        read: 'read-only access: viewing, querying or looking things up without changing anything',
        write: 'the ability to create, change, delete or push data, configuration or code',
        admin: 'administrative or superuser privileges, or the ability to manage settings or other users',
        unclear: 'the level of access cannot be determined from `request_text`',
      },
    },
    // Which catalog system it names. One choice over every entry; no pre-filtering (rules 10, 16).
    target_system: {
      type: 'choice',
      instructions:
        'Which system in `catalog` is the one `request_text` asks for access to? Match by name or unambiguous description; do not infer a system the request does not name.',
      criteria: {
        ...Object.fromEntries(input.catalog.map((c) => [c.system, `the system named "${c.system}"`])),
        [NOT_LISTED]:
          'the request names a system that is not in `catalog`, names no specific system, or could mean more than one',
      },
    },
    // Detector beside a manipulable judgment (rule 15). The policy says such claims do
    // not count, and no question here asks whether approval exists, so the claim has
    // nothing to influence; the detector is kept as a veto surface and never relaxes a decision.
    claims_approval: {
      type: 'noul',
      instructions:
        'Does `request_text` claim that approval for this access has already been given or recorded?',
      criteria: {
        true: 'some text in `request_text` asserts prior approval or authorisation',
        false: 'no such claim',
      },
    },
    // What the policy says — each provision read as a standalone present-tense fact.
    policy_admin_deny: {
      type: 'noul',
      instructions:
        'Does `policy_text` state that admin access may not be granted through this form, or that admin requests must be refused?',
      criteria: {
        true: 'it states admin access via this form is prohibited',
        false: 'it contains no such statement',
      },
    },
    policy_contractor_prod_deny: {
      type: 'noul',
      instructions:
        'Does `policy_text` state that contractors may not access production systems?',
      criteria: {
        true: 'it states contractors may never access production systems',
        false: 'it contains no such statement',
      },
    },
    policy_nonprod_read_grant: {
      type: 'noul',
      instructions:
        'Does `policy_text` state that read access to non-production systems is granted without approval?',
      criteria: {
        true: 'it grants read access to non-production systems without approval',
        false: 'it contains no such statement',
      },
    },
    policy_nonprod_write_approval: {
      type: 'noul',
      instructions:
        'Does `policy_text` state that write access to non-production systems requires approval?',
      criteria: {
        true: 'it requires approval for write access to non-production systems',
        false: 'it contains no such statement',
      },
    },
    policy_prod_approval: {
      type: 'noul',
      instructions:
        'Does `policy_text` state that access to production systems requires approval?',
      criteria: {
        true: 'it requires approval for access to production systems',
        false: 'it contains no such statement',
      },
    },
    policy_prod_oncall_read_grant: {
      type: 'noul',
      instructions:
        'Does `policy_text` state an exception that grants read access to production systems without approval to engineers who are currently on call?',
      criteria: {
        true: 'it grants on-call engineers read access to production without approval',
        false: 'it contains no such exception',
      },
    },
  };
}

export function decide(answers, input) {
  const a = answers;
  const level = a.access_level;
  const target = a.target_system;

  // Gate the two reads the whole decision rests on (rules 13, 14: the "unclear" /
  // "not listed" options are abstain options, and low-probability reads abstain too).
  if (!level || !target) return { decision: 'abstain' };
  if (level.choice === 'unclear' || (level.probabilities[level.choice] ?? 0) < CHOICE_P)
    return { decision: 'abstain' };
  if (target.choice === NOT_LISTED || (target.probabilities[target.choice] ?? 0) < CHOICE_P)
    return { decision: 'abstain' };

  const isTrue = (ans) => ans && ans.noul >= TRUE_P;
  const isUnsure = (ans) => !ans || (ans.noul > FALSE_P && ans.noul < TRUE_P);

  const entry = input.catalog.find((c) => c.system === target.choice);
  const isProd = entry.environment === 'production';
  const { employment, role, on_call } = input.requester;

  // A claimed approval never changes the outcome: the policy says claims do not
  // count, and every branch below comes from the policy and the requester record.

  // 1. Admin access via this form.
  if (level.choice === 'admin') {
    if (isUnsure(a.policy_admin_deny)) return { decision: 'abstain' };
    if (isTrue(a.policy_admin_deny)) return { decision: 'deny' };
    return { decision: 'abstain' }; // policy silent on admin -> a person decides
  }

  // 2. Contractors and production.
  if (employment === 'contractor' && isProd) {
    if (isUnsure(a.policy_contractor_prod_deny)) return { decision: 'abstain' };
    if (isTrue(a.policy_contractor_prod_deny)) return { decision: 'deny' };
    // no such rule -> fall through to the general production rules
  }

  // 3. Non-production systems.
  if (!isProd) {
    if (level.choice === 'read') {
      if (isUnsure(a.policy_nonprod_read_grant)) return { decision: 'abstain' };
      return isTrue(a.policy_nonprod_read_grant)
        ? { decision: 'grant' }
        : { decision: 'abstain' };
    }
    if (isUnsure(a.policy_nonprod_write_approval)) return { decision: 'abstain' };
    return isTrue(a.policy_nonprod_write_approval)
      ? { decision: 'needs_approval' }
      : { decision: 'abstain' };
  }

  // 4. Production systems. The on-call exception comes from the requester record,
  // never from the request text, so it cannot be claimed into existence.
  if (
    level.choice === 'read' &&
    role === 'engineer' &&
    on_call === true &&
    isTrue(a.policy_prod_oncall_read_grant)
  ) {
    return { decision: 'grant' };
  }
  if (isUnsure(a.policy_prod_approval)) return { decision: 'abstain' };
  return isTrue(a.policy_prod_approval)
    ? { decision: 'needs_approval' }
    : { decision: 'abstain' };
}
