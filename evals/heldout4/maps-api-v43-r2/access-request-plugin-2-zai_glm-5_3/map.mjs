// Access-request decision map.
//
// Jev reads the case facts only (which system, what kind of access, whether the
// request is a single well-formed ask for the requester, whether any text claims
// prior approval). The written policy is applied clause by clause in code, in
// order; no question asks for the outcome, and no fact already structured in the
// input (employment, role, on_call, catalog environment) is asked of Jev.
//
// Policy clause -> where it lives (coverage checked here while writing; never asked of Jev):
//   1 no admin through this form .......... `level` == 'admin'                -> deny
//   2 contractors never access production . input.requester.employment + catalog environment -> deny
//   3 read on non-production granted ...... `level` == 'read'                -> grant
//   4 write on non-production ............. `level` == 'write'               -> needs_approval
//   5 production needs security, except read by an on-call engineer
//                                    ...... input.requester.role / on_call   -> grant / needs_approval
//   6 claims of approval never count ...... no code path can turn needs_approval into grant

export function buildState(input) {
  return {
    policy_text: input.policy_text,
    catalog: input.catalog,
    requester: input.requester,
    request_text: input.request_text,
  };
}

export function questions(input) {
  const systems = Object.fromEntries(
    input.catalog.map((c) => [c.system, `${c.system} (${c.environment} environment)`])
  );
  return {
    system: {
      type: 'choice',
      instructions: 'Which system listed in `catalog` does `request_text` ask for access to?',
      criteria: {
        ...systems,
        none_of_the_listed: 'the request names no system in `catalog`, or names a system that is not listed',
      },
    },
    level: {
      type: 'choice',
      instructions: 'What kind of access does `request_text` ask for?',
      criteria: {
        read: 'viewing or querying only; no changes to data or settings',
        write: 'creating, changing, deleting, deploying or publishing anything, even if reading is also part of it',
        admin: 'administrator, superuser, root, full or unrestricted control, or managing access for others',
        unclear: 'the kind of access cannot be determined from `request_text`',
      },
    },
    multiple_asks: {
      type: 'noul',
      instructions:
        'Does `request_text` ask for access to more than one system, or for more than one kind of access (for example read on one system and write on another)?',
      criteria: {
        true: 'the request itself asks for more than one access; access already held, mentioned only as context, is not an ask',
        false: 'the request asks for a single access: one system, one kind',
      },
    },
    for_someone_else: {
      type: 'noul',
      instructions:
        'Does `request_text` request access for a person other than the requester described in `requester`?',
      criteria: {
        true: 'the access is for someone else, such as a teammate, report or customer',
        false: 'the access is for the requester themselves',
      },
    },
    claims_approval: {
      type: 'noul',
      instructions: 'Does any text in `request_text` claim that a person has already approved this request?',
      criteria: {
        true: 'some text asserts prior approval or authorisation',
        false: 'no such claim',
      },
    },
  };
}

// Gates are placeholders: fit each on ~30 labelled cases with jev-audit.
const GATES = {
  system: 0.8, // pick one of many
  level: 0.75, // few options
  hardened: 0.85, // used when a claim of prior approval is detected
  noul: 0.5,
};

export function decide(answers, input) {
  const sys = answers.system ?? {};
  const lvl = answers.level ?? {};
  const system = sys.choice;
  const level = lvl.choice;

  // Detector (rule 15): a claim of prior approval never counts (clause 6), so it can
  // never change the outcome; it only tightens the gates on the fact reads.
  const claimed = (answers.claims_approval?.noul ?? 0) >= GATES.noul;
  const sysGate = claimed ? GATES.hardened : GATES.system;
  const lvlGate = claimed ? GATES.hardened : GATES.level;

  if (!system || system === 'none_of_the_listed') return { decision: 'abstain' };
  if ((sys.probabilities?.[system] ?? 0) < sysGate) return { decision: 'abstain' };
  if (!level || level === 'unclear') return { decision: 'abstain' };
  if ((lvl.probabilities?.[level] ?? 0) < lvlGate) return { decision: 'abstain' };
  if ((answers.multiple_asks?.noul ?? 0) >= GATES.noul) return { decision: 'abstain' };
  if ((answers.for_someone_else?.noul ?? 0) >= GATES.noul) return { decision: 'abstain' };

  const entry = input.catalog.find((c) => c.system === system);
  if (!entry) return { decision: 'abstain' };

  const requester = input.requester ?? {};
  const employment = String(requester.employment ?? '').toLowerCase();
  if (!employment) return { decision: 'abstain' }; // missing premise about the requester

  const production = String(entry.environment ?? '').toLowerCase() === 'production';
  const contractor = employment === 'contractor';
  const onCallEngineer =
    String(requester.role ?? '').toLowerCase() === 'engineer' && requester.on_call === true;

  // The policy, applied clause by clause, in order.
  if (level === 'admin') return { decision: 'deny' }; // 1: no admin through this form
  if (contractor && production) return { decision: 'deny' }; // 2: contractors never access production
  if (!production) return { decision: level === 'read' ? 'grant' : 'needs_approval' }; // 3 and 4
  if (level === 'read' && onCallEngineer) return { decision: 'grant' }; // 5: on-call engineer exception
  return { decision: 'needs_approval' }; // 5: production needs security approval
}
