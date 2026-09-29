const GATE = 0.8;

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    catalog: input.catalog,
    requester: input.requester,
    request_text: input.request_text,
  };
}

export function questions(input) {
  const catalog = input.catalog || [];

  const systemCriteria = Object.fromEntries(
    catalog.map((system) => [
      system.system,
      `the system ${system.system} in the ${system.environment} environment`,
    ])
  );
  systemCriteria.ambiguous_or_none =
    'the request does not name a single system, names multiple systems, or names a system not in `catalog`';

  return {
    system: {
      type: 'choice',
      instructions:
        'Which system in `catalog` does `request_text` ask for access to? If no single catalog system is named, choose `ambiguous_or_none`. Base this only on `request_text` and `catalog`.',
      criteria: systemCriteria,
    },
    access_level: {
      type: 'choice',
      instructions:
        'What level of access does `request_text` ask for? If the access level is not stated or is contradictory, choose `ambiguous`. Base this only on `request_text`.',
      criteria: {
        read: 'the request asks only to read, view, query, list, or download data; no changes',
        write: 'the request asks to write, edit, update, delete, create, deploy, or otherwise change the system or data; also read-write access',
        admin: 'the request asks for admin, administrator, superuser, root, full control, or permission to manage users, permissions, or access controls',
        ambiguous: 'the access level is not stated or is contradictory',
      },
    },
    admin_requested: {
      type: 'noul',
      instructions:
        'Does `request_text` ask for admin, administrator, superuser, root, full control, or permission to manage users, permissions, or access controls?',
      criteria: {
        true: 'yes, it asks for admin-level or management capability',
        false: 'no, it asks only for ordinary read/write/change access or no specific level',
      },
    },
  };
}

export function decide(answers, input) {
  const systemAnswer = answers?.system;
  const accessAnswer = answers?.access_level;
  const adminAnswer = answers?.admin_requested;

  if (!systemAnswer || !accessAnswer || !adminAnswer) {
    return { decision: 'abstain' };
  }

  const systemChoice = systemAnswer.choice;
  const accessChoice = accessAnswer.choice;
  const systemP = systemAnswer.probabilities?.[systemChoice];
  const accessP = accessAnswer.probabilities?.[accessChoice];
  const adminP = typeof adminAnswer.noul === 'number' ? adminAnswer.noul : 0;

  // Policy clause 1: nobody may be granted admin access through this form.
  if (
    adminP >= GATE ||
    (accessChoice === 'admin' && typeof accessP === 'number' && accessP >= GATE)
  ) {
    return { decision: 'deny' };
  }

  if (
    accessChoice === 'ambiguous' ||
    typeof accessP !== 'number' ||
    accessP < GATE ||
    systemChoice === 'ambiguous_or_none' ||
    typeof systemP !== 'number' ||
    systemP < GATE
  ) {
    return { decision: 'abstain' };
  }

  const entry = (input.catalog || []).find((system) => system.system === systemChoice);
  if (!entry) return { decision: 'abstain' };

  const environment = String(entry.environment || '')
    .trim()
    .toLowerCase();
  const isProduction = environment === 'production' || environment === 'prod';
  if (!environment) return { decision: 'abstain' };

  const employment = String(input.requester?.employment || '').toLowerCase();
  const role = String(input.requester?.role || '').toLowerCase();
  const onCall = input.requester?.on_call === true;

  if (!employment || !role) return { decision: 'abstain' };

  // Policy clause 2: contractors may never access production systems.
  if (employment === 'contractor' && isProduction) {
    return { decision: 'deny' };
  }

  // Policy clauses 3-5.
  if (isProduction) {
    if (accessChoice === 'read' && role === 'engineer' && onCall) {
      return { decision: 'grant' };
    }
    return { decision: 'needs_approval' };
  }

  if (accessChoice === 'read') {
    return { decision: 'grant' };
  }

  if (accessChoice === 'write') {
    return { decision: 'needs_approval' };
  }

  return { decision: 'abstain' };
}
