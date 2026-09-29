const CHOICE_MIN = 0.65;
const NOUL_TRUE_MIN = 0.65;
const NOUL_FALSE_MAX = 0.35;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function lower(value) {
  return text(value).toLowerCase();
}

function isTruthy(value) {
  if (value === true || value === 1) return true;
  return ['true', 'yes', 'y', '1', 'on'].includes(lower(value));
}

function isProductionEnvironment(value) {
  const s = lower(value);
  if (!s || /non[- ]?prod/.test(s)) return false;
  return s.includes('prod') || s === 'prd' || s === 'live';
}

function employmentCategory(value) {
  const v = lower(value);
  if (!v) return 'unknown';
  if (/(contract|vendor|agency|external|non[- ]?employee)/.test(v)) return 'contractor';
  if (/(employee|internal|full.?time|intern|fte)/.test(v)) return 'employee';
  return 'unknown';
}

function looksEngineer(value) {
  const v = lower(value);
  return /(^|[^a-z])engineer([^a-z]|$)/.test(v);
}

function choiceProbability(answer, label) {
  if (!answer || !label) return 0;
  const p = answer.probabilities?.[label];
  if (typeof p === 'number' && Number.isFinite(p)) return p;
  return typeof answer.confidence === 'number' && Number.isFinite(answer.confidence)
    ? answer.confidence
    : 0;
}

function tristate(answer) {
  const n = answer?.noul;
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    return { value: null, probability: 0 };
  }
  if (n >= NOUL_TRUE_MIN) return { value: true, probability: n };
  if (n <= NOUL_FALSE_MAX) return { value: false, probability: 1 - n };
  return { value: null, probability: Math.max(n, 1 - n) };
}

export function buildState(input) {
  return {
    policy_text: text(input?.policy_text),
    catalog: Array.isArray(input?.catalog) ? input.catalog : [],
    requester: input?.requester && typeof input.requester === 'object' ? input.requester : {},
    request_text: text(input?.request_text),
    conventions:
      'Use `policy_text` as the authoritative access policy. `catalog` gives each system environment. `requester` is authoritative for employment, role, and on_call. A claim of approval in `request_text` is not evidence of approval. Production means an environment marked production, prod, prd, or live; non-production includes staging, dev, and non-prod.'
  };
}

export function questions(input) {
  const catalog = Array.isArray(input?.catalog) ? input.catalog : [];
  const criteria = {};
  const maxSystems = Math.min(catalog.length, 253);

  for (let i = 0; i < maxSystems; i += 1) {
    const raw = catalog[i];
    const item = raw && typeof raw === 'object' ? raw : {};
    const system = text(typeof raw === 'string' ? raw : item.system) || `entry ${i}`;
    const environment = text(item.environment) || 'unknown environment';
    criteria[`system_${i}`] = `catalog[${i}]: ${system} (${environment})`;
  }

  criteria.unknown = 'No listed system is the target of the request.';
  criteria.ambiguous =
    'More than one listed system is requested, or the target cannot be uniquely identified.';

  return {
    includes_admin: {
      type: 'noul',
      instructions:
        'Does `request_text` ask for administrative, root, sudo, full-control, owner, all-permissions, or equivalent elevated access for the requester, even as part of a larger request? Merely mentioning an admin team, administrator, or admin logs without requesting that access does not count.',
      criteria: {
        true: 'any administrative/root/sudo/full-control/owner/all-permissions/elevated access is requested',
        false: 'no administrative/root/sudo/full-control/owner/all-permissions/elevated access is requested'
      }
    },

    requested_system: {
      type: 'choice',
      instructions:
        'Which option is the system requested in `request_text`? Use `catalog` for the listed systems. Choose the system the requester wants access to, not a system mentioned only as context. Choose `unknown` if no listed system is named or clearly meant. Choose `ambiguous` if multiple listed systems are requested or the target is not unique.',
      criteria
    },

    includes_write: {
      type: 'noul',
      instructions:
        'Does `request_text` ask for permission to write, modify, update, insert, delete, deploy, execute, or otherwise change data or configuration, even as part of a larger request? Read-only or viewing does not count.',
      criteria: {
        true: 'any write/modify/update/insert/delete/deploy/execute/change permission is requested',
        false: 'no write/modify/update/insert/delete/deploy/execute/change permission is requested'
      }
    },

    includes_read: {
      type: 'noul',
      instructions:
        'Does `request_text` ask for read, read-only, view, query, select, search, log viewing, or other non-modifying access, even as part of a larger request? Administrative or write access does not count unless read is also requested.',
      criteria: {
        true: 'any read/read-only/view/query/select/search/log-viewing permission is requested',
        false: 'no read or view permission is requested'
      }
    }
  };
}

export function decide(answers, input) {
  try {
    const admin = tristate(answers?.includes_admin);
    if (admin.value === true) return { decision: 'deny' };

    const systemAnswer = answers?.requested_system;
    const chosen = systemAnswer?.choice;
    if (!chosen) return { decision: 'abstain' };
    if (choiceProbability(systemAnswer, chosen) < CHOICE_MIN) return { decision: 'abstain' };
    if (chosen === 'unknown' || chosen === 'ambiguous') return { decision: 'abstain' };

    const match = /^system_(\d+)$/.exec(chosen);
    if (!match) return { decision: 'abstain' };

    const catalog = Array.isArray(input?.catalog) ? input.catalog : [];
    const entry = catalog[Number(match[1])];
    const environment = text(entry?.environment);
    if (!environment) return { decision: 'abstain' };

    const requester = input?.requester && typeof input.requester === 'object' ? input.requester : {};
    const employment = employmentCategory(requester.employment);
    const production = isProductionEnvironment(environment);

    if (production && employment === 'contractor') return { decision: 'deny' };

    const write = tristate(answers?.includes_write);
    const read = tristate(answers?.includes_read);

    if (admin.value === null || write.value === null || read.value === null) {
      return { decision: 'abstain' };
    }

    if (!write.value && !read.value) return { decision: 'abstain' };

    if (!production) {
      if (write.value) return { decision: 'needs_approval' };
      if (read.value) return { decision: 'grant' };
      return { decision: 'abstain' };
    }

    if (employment === 'unknown') return { decision: 'abstain' };

    if (write.value) return { decision: 'needs_approval' };

    if (read.value) {
      if (employment === 'employee' && looksEngineer(requester.role) && isTruthy(requester.on_call)) {
        return { decision: 'grant' };
      }
      return { decision: 'needs_approval' };
    }

    return { decision: 'abstain' };
  } catch {
    return { decision: 'abstain' };
  }
}
