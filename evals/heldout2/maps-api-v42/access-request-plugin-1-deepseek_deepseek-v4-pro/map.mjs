const SYSTEM_GATE = 0.75;
const ACCESS_GATE = 0.75;
const POLICY_GATE = 0.75;

function gatedChoice(answer, gate) {
  if (!answer || typeof answer.choice !== 'string') return null;
  const probabilities = answer.probabilities || {};
  const probability = probabilities[answer.choice];
  return typeof probability === 'number' && probability >= gate ? answer.choice : null;
}

function toDecision(outcome) {
  if (outcome === 'grant' || outcome === 'needs_approval' || outcome === 'deny') {
    return outcome;
  }
  return 'abstain';
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
  const systemCriteria = {};

  input.catalog.forEach((entry, index) => {
    systemCriteria[`catalog_${index}`] = `${entry.system} (${entry.environment})`;
  });

  systemCriteria.multiple_systems =
    'the request asks for access to more than one system in the catalog';
  systemCriteria.not_listed =
    'the request names a system not present in the catalog, or no specific system can be identified';

  const accessCriteria = {
    read: 'read-only access: view, read, query, list, download, or otherwise use data without changing it',
    write:
      'write or modify access, including requests that ask for both read and write, or create/update/delete/deploy/run/execute/change data or system state',
    admin:
      'admin/administrative/root/superuser/full-control access, or the request explicitly asks for admin rights',
    unclear: 'the level of access cannot be determined from the request text',
  };

  const policyOutcomeCriteria = {
    grant: 'the policy grants this access without requiring approval',
    needs_approval: 'the policy requires approval before this access',
    deny: 'the policy prohibits this access',
    not_mentioned: 'the policy does not mention or does not clearly cover this situation',
  };

  return {
    requested_system: {
      type: 'choice',
      instructions:
        'Which system in `catalog` does `request_text` ask for access to? Base the choice only on `request_text` and the exact system names and environments in `catalog`. If `request_text` asks for access to more than one catalog system, choose "multiple_systems". If it names a system not present in `catalog`, or no specific system can be identified, choose "not_listed".',
      criteria: systemCriteria,
    },

    requested_access_type: {
      type: 'choice',
      instructions:
        'What level of access does `request_text` ask for? Base the choice only on `request_text`.',
      criteria: accessCriteria,
    },

    policy_admin_outcome: {
      type: 'choice',
      instructions:
        'According to `policy_text`, what outcome does the policy assign when a requester asks for admin access through this form?',
      criteria: policyOutcomeCriteria,
    },

    policy_contractor_production_outcome: {
      type: 'choice',
      instructions:
        'According to `policy_text`, what outcome does the policy assign when a contractor requests access to a production system?',
      criteria: policyOutcomeCriteria,
    },

    policy_read_nonprod_outcome: {
      type: 'choice',
      instructions:
        'According to `policy_text`, what outcome does the policy assign when a requester asks for read access to a non-production system?',
      criteria: policyOutcomeCriteria,
    },

    policy_write_nonprod_outcome: {
      type: 'choice',
      instructions:
        'According to `policy_text`, what outcome does the policy assign when a requester asks for write access to a non-production system?',
      criteria: policyOutcomeCriteria,
    },

    policy_prod_read_oncall_engineer_outcome: {
      type: 'choice',
      instructions:
        'According to `policy_text`, what outcome does the policy assign when an engineer who is currently on call asks for read access to a production system?',
      criteria: policyOutcomeCriteria,
    },

    policy_prod_read_not_oncall_engineer_outcome: {
      type: 'choice',
      instructions:
        'According to `policy_text`, what outcome does the policy assign when an employee requests read access to a production system and the employee is not an engineer currently on call?',
      criteria: policyOutcomeCriteria,
    },

    policy_prod_write_outcome: {
      type: 'choice',
      instructions:
        'According to `policy_text`, what outcome does the policy assign when an employee requests write access to a production system?',
      criteria: policyOutcomeCriteria,
    },
  };
}

export function decide(answers, input) {
  const access = gatedChoice(answers.requested_access_type, ACCESS_GATE);

  if (!access || access === 'unclear') {
    return { decision: 'abstain' };
  }

  // Admin access is governed by a policy-wide rule.
  if (access === 'admin') {
    const outcome = gatedChoice(answers.policy_admin_outcome, POLICY_GATE);
    return { decision: toDecision(outcome) };
  }

  const system = gatedChoice(answers.requested_system, SYSTEM_GATE);

  if (!system || system === 'multiple_systems' || system === 'not_listed') {
    return { decision: 'abstain' };
  }

  const index = Number(system.slice('catalog_'.length));
  const catalogEntry = input.catalog[index];

  if (!catalogEntry) {
    return { decision: 'abstain' };
  }

  const environment = String(catalogEntry.environment || '').toLowerCase();
  const isProduction = environment === 'production' || environment === 'prod';

  const requester = input.requester || {};
  const employment = String(requester.employment || '').toLowerCase();
  const role = String(requester.role || '').toLowerCase();

  if (!['employee', 'contractor'].includes(employment)) {
    return { decision: 'abstain' };
  }

  if (isProduction) {
    if (employment === 'contractor') {
      const outcome = gatedChoice(
        answers.policy_contractor_production_outcome,
        POLICY_GATE,
      );
      return { decision: toDecision(outcome) };
    }

    if (access === 'read') {
      const isOnCallEngineer = role === 'engineer' && requester.on_call === true;
      const outcome = isOnCallEngineer
        ? gatedChoice(answers.policy_prod_read_oncall_engineer_outcome, POLICY_GATE)
        : gatedChoice(answers.policy_prod_read_not_oncall_engineer_outcome, POLICY_GATE);
      return { decision: toDecision(outcome) };
    }

    if (access === 'write') {
      const outcome = gatedChoice(answers.policy_prod_write_outcome, POLICY_GATE);
      return { decision: toDecision(outcome) };
    }

    return { decision: 'abstain' };
  }

  if (access === 'read') {
    const outcome = gatedChoice(answers.policy_read_nonprod_outcome, POLICY_GATE);
    return { decision: toDecision(outcome) };
  }

  if (access === 'write') {
    const outcome = gatedChoice(answers.policy_write_nonprod_outcome, POLICY_GATE);
    return { decision: toDecision(outcome) };
  }

  return { decision: 'abstain' };
}
