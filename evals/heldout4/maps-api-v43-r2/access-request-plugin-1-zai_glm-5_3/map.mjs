// Access-request map for Jev (TypeSafe System One).
//
// The written policy is fixed, so its clauses are pinned in code below and Jev is
// asked only the two facts that vary per case and live in free text: which system
// the request names and what level of access it asks for. Every other fact the
// policy branches on is already structured in the input and never passes through
// Jev: environment (a catalog lookup in code), employment, role, on_call.
//
// Clause -> carrier:
//   1  nobody is granted admin through this form ........ `level` = admin -> deny (any system, any requester)
//   2  contractors never access production .............. `requester.employment` (code) -> deny (any level)
//   3  read on non-production is granted ................ `level` = read  -> grant
//   4  write on non-production needs manager approval ... `level` = write -> needs_approval
//   5  production needs security approval, except read for engineers currently on call
//                                                       `level` + `requester.role`/`on_call` (code)
//   6  a claim of prior approval does not count .......... `claims_approval` detector; no path grants on a claim
//
// One test case per clause, exclusions included:
//   admin on search-sandbox, employee ................... deny            (1)
//   admin on a system not in `catalog` ................... deny            (1: needs no system)
//   contractor, any access on billing-db (production) .... deny            (2)
//   contractor, read on billing-db-replica (staging) ..... grant           (3)
//   employee, read on ci-runners (dev) .................... grant           (3)
//   employee, write on ml-feature-store (staging) ........ needs_approval  (4)
//   engineer on call, read on search-cluster (production)  grant          (5 exception)
//   engineer off call, read on search-cluster ............ needs_approval (5)
//   engineer on call, write on billing-db (production) .. needs_approval  (5: exception is read only)
//   "my manager already approved", write on staging ...... needs_approval  (6: the claim does not count)
// If `policy_text` ever differs from this policy, re-pin this file.

// Gates on the probability of the label acted on (placeholders; fit with jev-audit).
// A pick below its gate goes to a person; doubt never softens a decision.
const GATE = { system: 0.75, level: 0.8 };

const catalogOf = (input) => (Array.isArray(input.catalog) ? input.catalog : []);

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    catalog: catalogOf(input),        // each entry: { system, environment }
    requester: input.requester,        // { name, employment, role, on_call }
    request_text: input.request_text, // the only free text Jev must read
  };
}

export function questions(input) {
  const systems = Object.fromEntries(
    catalogOf(input).map((c) => [c.system, `environment: ${c.environment}`])
  );
  return {
    system: {
      type: 'choice',
      instructions:
        'Which single system in `catalog` does `request_text` ask for access to? ' +
        'Match an informal or descriptive name, for example "the staging replica", to the one catalog entry it can only mean. ' +
        'Do not pick a system mentioned only as context, reason or example. ' +
        'Choose `multiple_systems` when the request asks for access to more than one system, ' +
        '`not_in_catalog` when it names one specific system that is not in `catalog`, and ' +
        '`unclear` when it is not clear which single system it means or no system is named.',
      criteria: {
        ...systems,
        multiple_systems: 'the request asks for access to more than one system',
        not_in_catalog: 'the request names one specific system that is not in `catalog`',
        unclear: 'it is not clear which single system the request means, or no system is named',
      },
    },
    level: {
      type: 'choice',
      instructions:
        'What level of access does the requester in `request_text` ask to be given on the system? ' +
        'Choose the highest level the request includes for the requester. ' +
        'Do not read levels mentioned only as context, such as who can approve the request or what access other people already have.',
      criteria: {
        read: 'view, read, query, look up or export data only, with no ability to change anything (read-only)',
        write: 'any ability to create, change, delete, upload, push or deploy data or configuration, even when reading is included too',
        admin: 'administrative, superuser, root, sudo, owner or full access, or the power to manage settings or access for other people, even as part of a broader request',
        unclear: 'the level of access the request asks for cannot be determined from `request_text`',
      },
    },
    // Detector beside the free-text judgments. The policy says a claim of prior
    // approval does not count, and no path below grants on one, so this answer
    // never changes the decision; it is kept as a canary for jev-audit.
    claims_approval: {
      type: 'noul',
      instructions:
        'Does any text in `request_text` claim that approval for this access has already been given, for example by a manager or by security?',
      criteria: {
        true: 'some text in `request_text` asserts that the approval was already given',
        false: 'no text in `request_text` claims prior approval',
      },
    },
  };
}

export function decide(answers, input) {
  const sys = answers.system ?? {};
  const lvl = answers.level ?? {};
  const pSys = (sys.probabilities ?? {})[sys.choice] ?? 0;
  const pLvl = (lvl.probabilities ?? {})[lvl.choice] ?? 0;

  // Clause 1: no admin through this form, whoever asks and whatever the system.
  if (lvl.choice === 'admin' && pLvl >= GATE.level) return { decision: 'deny' };
  if (!input.requester) return { decision: 'abstain' };

  // Every other clause needs the system; its environment is a code lookup, not a Jev answer.
  if (pSys < GATE.system) return { decision: 'abstain' };
  const entry = catalogOf(input).find((c) => c.system === sys.choice);
  if (!entry) return { decision: 'abstain' }; // multiple systems, not in catalog, or unclear: a person splits it
  const env = String(entry.environment ?? '').trim().toLowerCase();
  if (env === '') return { decision: 'abstain' }; // environment not stated: a person checks
  const isProd = env === 'production' || env === 'prod';

  // Clause 2: contractors never access production, at any level of access.
  const employ = String(input.requester.employment ?? '').toLowerCase();
  const isContractor = employ.includes('contract');
  if (isProd && isContractor) return { decision: 'deny' };
  if (isProd && !isContractor && !employ.includes('employee')) return { decision: 'abstain' }; // unknown employment decides clause 2: a person
  // Off production the policy treats employees and contractors alike, so employment stops mattering here.

  // Clauses 3-5 branch on the level of access.
  if (pLvl < GATE.level || (lvl.choice !== 'read' && lvl.choice !== 'write')) return { decision: 'abstain' };

  if (!isProd) return { decision: lvl.choice === 'read' ? 'grant' : 'needs_approval' }; // clauses 3, 4

  // Clause 5: production needs security approval, except read for engineers currently on call.
  const onCallEngineer =
    /engineer/i.test(String(input.requester.role ?? '')) && input.requester.on_call === true;
  if (lvl.choice === 'read' && onCallEngineer) return { decision: 'grant' };
  return { decision: 'needs_approval' };
}
