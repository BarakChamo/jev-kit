// map.mjs — access-request triage on Jev (TypeSafe System One).
//
// Design (jev-questions skill):
//   * The access policy is the same fixed text for every case, so its rules are
//     pinned in code in decide(); Jev is asked only present-tense facts about the
//     case. Nothing here asks Jev to interpret or check the policy per case.
//   * Jev only picks the catalog system named by the request and reads the access
//     level it asks for. Every comparison ("is it production?", "is the requester
//     a contractor?") is done in code on stated values; Jev never compares or
//     computes. Requester facts arrive as structured input and are read in code.
//   * Clause 6 (a claimed approval does not count) holds by construction: no
//     question asks about approvals, so no answer path can use a claim. Likewise
//     employment, role and on-call status come only from the `requester` record,
//     never from claims inside `request_text`.
//
// Pinned policy table — every clause mapped to code, one test case each
// (re-derive this table if `policy_text` ever changes):
//   1. admin access, anyone              -> deny            "admin on ci-runners"
//   2. contractor + production           -> deny            contractor "read on billing-db"
//      (beats the on-call exception: contractor engineer on call, prod read -> deny)
//   3. read + non-production             -> grant           "read-only on search-sandbox"
//   4. write + non-production            -> needs_approval  "write on ml-feature-store"
//   5. any other production access       -> needs_approval  "read on hr-portal";
//                                                          "write on search-cluster"
//      5x. read + production + engineer + currently on call -> grant
//   6. claimed prior approval changes nothing — no code path reads approval claims
//      ("my manager already approved write on search-sandbox" -> needs_approval)

// Gates on the probability of the label acted on. Placeholders: fit with jev-audit.
// Opening access without a person is gated more strictly than deny/needs_approval;
// unsure never becomes "grant".
const GATES = {
  system_pick: 0.75, // choice over the catalog entries
  level_act: 0.8, // floor for deny / needs_approval outcomes
  level_grant: 0.85, // floor when the outcome would be grant
  multiple_systems: 0.5, // noul probability above which the request counts as multi-system
};

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    catalog: input.catalog,
    requester: input.requester,
    request_text: input.request_text,
  };
}

export function questions(input) {
  const catalog = Array.isArray(input.catalog) ? input.catalog : [];
  // One choice over every catalog entry — no code pre-filtering of candidates.
  const criteria = Object.fromEntries(
    catalog.map((entry, i) => [String(i), `${entry.system} (environment: ${entry.environment})`])
  );
  criteria.not_listed =
    'the request names no system in `catalog`, or it is not clear which system it means';
  return {
    system: {
      type: 'choice',
      instructions:
        'Which single system in `catalog` does `request_text` ask for access to? Match shortened or informal names: a request for "the billing database" means billing-db. A system that `request_text` says the requester or someone else already has access to does not count. If the request names no system in `catalog`, or it is not clear which one it means, choose not_listed.',
      criteria,
    },
    access_level: {
      type: 'choice',
      instructions:
        'What is the most privileged level of access that `request_text` asks to be granted on the system it names? Access the requester says they already hold does not count. A request that asks to both read and change data counts as write.',
      criteria: {
        read: 'asks only to view, query or read data: "read-only", "read access", "SELECT access", "view access"',
        write: 'asks to create, change, delete or load data, or run jobs that change it: "write access", "read-write", "update access", "deploy"',
        admin: 'asks for administrative, superuser, root or permission-managing access: "admin", "administrator", "sudo", "full access", "manage users or permissions"',
        unclear: 'the request does not make the access level clear, or asks for a level other than read, write or admin',
      },
    },
    asks_for_multiple: {
      type: 'noul',
      instructions:
        'Does `request_text` ask to be granted access to more than one system in `catalog`? Only systems the request asks for count; systems it says are already accessible to the requester or to others do not.',
      criteria: {
        true: 'the request asks for access to two or more systems in `catalog`',
        false: 'the request asks for access to at most one system in `catalog`',
      },
    },
  };
}

export function decide(answers, input) {
  const a = answers || {};
  const requester = input.requester || {};

  // Unreadable premise or low-confidence read -> a person, never a guess.
  if ((a.asks_for_multiple?.noul ?? 0) >= GATES.multiple_systems) return { decision: 'abstain' };

  const sys = a.system;
  if (!sys || sys.choice === 'not_listed') return { decision: 'abstain' };
  if ((sys.probabilities?.[sys.choice] ?? 0) < GATES.system_pick) return { decision: 'abstain' };

  const lvl = a.access_level;
  if (!lvl || lvl.choice === 'unclear') return { decision: 'abstain' };

  const entry = (input.catalog || [])[Number(sys.choice)];
  const environment = entry?.environment;
  if (typeof environment !== 'string') return { decision: 'abstain' };
  if (!requester.employment) return { decision: 'abstain' }; // clause 2 premise unreadable

  const level = lvl.choice;
  const isProduction = environment.trim().toLowerCase().startsWith('prod');
  const contractor = String(requester.employment).trim().toLowerCase() === 'contractor';
  const engineer = /engineer/i.test(String(requester.role ?? ''));
  const onCall = requester.on_call === true || requester.on_call === 'true';

  // Stricter floor when the outcome would open access: doubt never relaxes a
  // decision, and unsure never becomes "grant".
  const wouldGrant =
    level === 'read' && !(contractor && isProduction) && (!isProduction || (engineer && onCall));
  const levelFloor = wouldGrant ? GATES.level_grant : GATES.level_act;
  if ((lvl.probabilities?.[level] ?? 0) < levelFloor) return { decision: 'abstain' };

  if (level === 'admin') return { decision: 'deny' }; // clause 1
  if (contractor && isProduction) return { decision: 'deny' }; // clause 2
  if (!isProduction)
    return { decision: level === 'read' ? 'grant' : 'needs_approval' }; // clauses 3 and 4
  if (level === 'read' && engineer && onCall) return { decision: 'grant' }; // clause 5 exception
  return { decision: 'needs_approval' }; // clause 5
}
