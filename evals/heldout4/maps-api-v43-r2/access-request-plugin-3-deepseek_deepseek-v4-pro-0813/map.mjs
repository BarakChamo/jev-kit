function systemEntries(catalog) {
  const entries = [];
  const used = new Set(['none', 'multiple_systems']);

  for (const item of catalog) {
    let key = item.system;
    let suffix = 1;

    while (used.has(key)) {
      key = suffix === 1
        ? `${item.system} (${item.environment})`
        : `${item.system} (${item.environment} ${suffix})`;
      suffix += 1;
    }

    used.add(key);
    entries.push({ key, item });
  }

  return entries;
}

export function buildState(input) {
  return {
    policy_text: input?.policy_text ?? '',
    catalog: input?.catalog ?? [],
    requester: input?.requester ?? {},
    request_text: input?.request_text ?? '',
  };
}

export function questions(input) {
  const catalog = Array.isArray(input?.catalog) ? input.catalog : [];
  const entries = systemEntries(catalog);

  const systemCriteria = {};
  for (const entry of entries) {
    systemCriteria[entry.key] = `the request asks for access to ${entry.item.system} in the ${entry.item.environment} environment`;
  }
  systemCriteria.multiple_systems = 'the request asks for access to more than one system in the catalog';
  systemCriteria.none = 'the request does not ask for access to any system in the catalog';

  return {
    system: {
      type: 'choice',
      instructions: 'Which system in `catalog` does `request_text` ask for access to?',
      criteria: systemCriteria,
    },
    access: {
      type: 'choice',
      instructions: 'What level of access does `request_text` ask for? If the request asks for more than one level, choose the highest level: admin is highest, then write, then read.',
      criteria: {
        read: 'the request asks only for read, read-only, view, list, query, or download access',
        write: 'the request asks for write, edit, modify, delete, read-write, or any change access; choose this if the request asks for write access, even if read access is also included',
        admin: 'the request asks for admin, administrator, root, or administrative access; choose this if the request asks for admin access, even if other access is also included',
        unclear: 'the request does not state a level of access',
      },
    },
  };
}

function probabilityOf(answer) {
  if (!answer) return 0;

  if (
    answer.probabilities &&
    typeof answer.choice === 'string' &&
    answer.probabilities[answer.choice] !== undefined
  ) {
    return answer.probabilities[answer.choice];
  }

  if (typeof answer.noul === 'number') return answer.noul;
  if (typeof answer.confidence === 'number') return answer.confidence;

  return 0;
}

export function decide(answers, input) {
  const SYSTEM_GATE = 0.60;
  const ACCESS_GATE = 0.60;

  const sysAnswer = answers?.system;
  const accessAnswer = answers?.access;

  if (!sysAnswer || !accessAnswer) return { decision: 'abstain' };

  const sysChoice = sysAnswer.choice;
  const accessChoice = accessAnswer.choice;
  const systemProbability = probabilityOf(sysAnswer);
  const accessProbability = probabilityOf(accessAnswer);

  if (systemProbability < SYSTEM_GATE || accessProbability < ACCESS_GATE) {
    return { decision: 'abstain' };
  }

  if (accessChoice === 'admin') return { decision: 'deny' };
  if (accessChoice === 'unclear') return { decision: 'abstain' };
  if (sysChoice === 'none' || sysChoice === 'multiple_systems') {
    return { decision: 'abstain' };
  }

  const catalog = Array.isArray(input?.catalog) ? input.catalog : [];
  const entry = systemEntries(catalog).find((candidate) => candidate.key === sysChoice);

  if (!entry) return { decision: 'abstain' };

  const environment = entry.item.environment;
  const requester = input?.requester ?? {};
  const employment = requester.employment;
  const role = requester.role;
  const onCall = Boolean(requester.on_call);

  if (employment === 'contractor' && environment === 'production') {
    return { decision: 'deny' };
  }

  if (environment !== 'production') {
    if (accessChoice === 'read') return { decision: 'grant' };
    if (accessChoice === 'write') return { decision: 'needs_approval' };
    return { decision: 'abstain' };
  }

  if (
    accessChoice === 'read' &&
    employment === 'employee' &&
    role === 'engineer' &&
    onCall
  ) {
    return { decision: 'grant' };
  }

  if (accessChoice === 'read' || accessChoice === 'write') {
    return { decision: 'needs_approval' };
  }

  return { decision: 'abstain' };
}
