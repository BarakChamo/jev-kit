export function buildState(input) {
  return {
    policy_text: input.policy_text,
    catalog: input.catalog,
    requester: input.requester,
    request_text: input.request_text,
  };
}

export function questions(input) {
  const systemCriteria = {};
  for (const item of input.catalog ?? []) {
    if (item.system) {
      systemCriteria[item.system] = `access to the ${item.system} system`;
    }
  }
  systemCriteria.none_or_other =
    'no catalog system is requested, multiple systems are requested, or the target is unclear';

  return {
    target_system: {
      type: 'choice',
      instructions: 'Which system from `catalog` is being requested in `request_text`?',
      criteria: systemCriteria,
    },
    access_level: {
      type: 'choice',
      instructions: 'What level of access to the system is being requested in `request_text`?',
      criteria: {
        admin: 'administrative, superuser, root, sudo, full control, or unrestricted access',
        write: 'write, edit, update, modify, delete, or create access, without admin or root privileges',
        read: 'read-only, view, inspect, query, or select access, without write or admin privileges',
        ambiguous: 'the access level is unstated, ambiguous, or not clearly one of read, write, or admin',
      },
    },
  };
}

export function decide(answers, input) {
  if (!answers?.target_system || !answers?.access_level) {
    return { decision: 'abstain' };
  }

  const sysAns = answers.target_system;
  const accessAns = answers.access_level;

  const sysChoice = sysAns.choice;
  const accessChoice = accessAns.choice;

  if (sysChoice === 'none_or_other' || accessChoice === 'ambiguous') {
    return { decision: 'abstain' };
  }

  const sysProb = sysAns.probabilities?.[sysChoice] ?? sysAns.confidence ?? 0;
  const accessProb = accessAns.probabilities?.[accessChoice] ?? accessAns.confidence ?? 0;

  if (sysProb < 0.7 || accessProb < 0.7) {
    return { decision: 'abstain' };
  }

  const systemEntry = (input.catalog ?? []).find((c) => c.system === sysChoice);
  if (!systemEntry) {
    return { decision: 'abstain' };
  }

  const env = systemEntry.environment;
  const requester = input.requester ?? {};
  const isContractor = requester.employment === 'contractor';

  // Rule 1: Nobody may be granted admin access through this form
  if (accessChoice === 'admin') {
    return { decision: 'deny' };
  }

  // Rule 2: Contractors may never access production systems
  if (isContractor && env === 'production') {
    return { decision: 'deny' };
  }

  // Non-production systems
  if (env !== 'production') {
    // Rule 3: Read access to non-production is granted without approval
    if (accessChoice === 'read') {
      return { decision: 'grant' };
    }
    // Rule 4: Write access to non-production needs manager approval
    if (accessChoice === 'write') {
      return { decision: 'needs_approval' };
    }
    return { decision: 'abstain' };
  }

  // Production systems (Rule 5)
  // Read access to production for engineers who are currently on call is granted
  if (accessChoice === 'read' && requester.role === 'engineer' && requester.on_call === true) {
    return { decision: 'grant' };
  }

  // Any other access to production needs security approval
  return { decision: 'needs_approval' };
}
