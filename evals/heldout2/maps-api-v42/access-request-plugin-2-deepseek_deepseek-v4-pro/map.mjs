const SYSTEM_GATE = 0.8;
const ACCESS_GATE = 0.8;
const MULTI_GATE = 0.8;

function probabilityOf(answer) {
  if (!answer || !answer.probabilities || !answer.choice) return 0;
  return answer.probabilities[answer.choice] ?? 0;
}

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

  const systemCriteria = {};
  catalog.forEach((entry, i) => {
    systemCriteria[String(i)] = `${entry.system} (${entry.environment})`;
  });
  systemCriteria.none_found = 'The request does not name any system from `catalog`.';

  return {
    requested_system: {
      type: 'choice',
      instructions:
        'Which system listed in `catalog` does `request_text` ask for access to? Choose the option whose system and environment match the request. If the request names a system not present in `catalog`, choose none_found.',
      criteria: systemCriteria,
    },

    access_type: {
      type: 'choice',
      instructions: 'What kind of access does `request_text` ask for?',
      criteria: {
        read: 'Read-only access: view, query, read, select, reports, reconciliation, or explicit read-only.',
        write:
          'Write or change access: write, modify, edit, create, delete, deploy, upload, or run commands that change data.',
        admin:
          'Administrative access: admin, administrator, root, superuser, full control, DBA privileges, or sudo.',
        unclear:
          'The request does not state a clear access level, or asks for several levels without one clear level.',
      },
    },

    multiple_systems: {
      type: 'noul',
      instructions:
        'Does `request_text` ask for access to more than one system named in `catalog`?',
      criteria: {
        true: 'The request names two or more different systems from `catalog` as access targets.',
        false: 'The request asks for access to one system, or no system from `catalog`.',
      },
    },
  };
}

export function decide(answers, input) {
  const accessAnswer = answers?.access_type;
  const systemAnswer = answers?.requested_system;

  if (!accessAnswer || !systemAnswer) return { decision: 'abstain' };

  const accessChoice = accessAnswer.choice;
  if (!accessChoice || accessChoice === 'unclear') return { decision: 'abstain' };

  const pAccess = probabilityOf(accessAnswer);
  if (pAccess < ACCESS_GATE) return { decision: 'abstain' };

  // Policy rule 1: nobody may be granted admin access through this form.
  if (accessChoice === 'admin') return { decision: 'deny' };

  const multiAnswer = answers?.multiple_systems;
  if (multiAnswer && typeof multiAnswer.noul === 'number' && multiAnswer.noul >= MULTI_GATE) {
    return { decision: 'abstain' };
  }

  const systemChoice = systemAnswer.choice;
  if (!systemChoice || systemChoice === 'none_found') return { decision: 'abstain' };

  const pSystem = probabilityOf(systemAnswer);
  if (pSystem < SYSTEM_GATE) return { decision: 'abstain' };

  const catalog = input?.catalog || [];
  const index = Number(systemChoice);

  if (!Number.isInteger(index) || index < 0 || index >= catalog.length) {
    return { decision: 'abstain' };
  }

  const environment = (catalog[index].environment || '').trim().toLowerCase();
  const employment = (input?.requester?.employment || '').trim().toLowerCase();
  const role = (input?.requester?.role || '').trim().toLowerCase();
  const onCall = input?.requester?.on_call === true;

  const isProduction = environment === 'production';

  if (isProduction) {
    // Policy rule 2: contractors may never access production systems.
    if (employment === 'contractor') return { decision: 'deny' };

    // Policy rule 5: production read for on-call engineers is granted; all other production access needs approval.
    if (accessChoice === 'read' && employment === 'employee' && role === 'engineer' && onCall) {
      return { decision: 'grant' };
    }

    return { decision: 'needs_approval' };
  }

  // Non-production systems.
  if (accessChoice === 'read') return { decision: 'grant' };
  if (accessChoice === 'write') return { decision: 'needs_approval' };

  return { decision: 'abstain' };
}
