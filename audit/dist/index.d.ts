/**
 * Offline audits for Jev eval results.
 *
 * Every function here runs on results you have already recorded — no model calls, no API key. Each
 * one exists because it found something real in a 57-suite study, and none of them lint question
 * text: a static checker over the design laws was measured at 0 useful fixes out of 7, while the
 * outcome-based confidently-wrong queue found 7 real defects out of 7. Read outcomes, not prose.
 *
 * Input is one JSON object per case:
 *
 *   { "caseId": "c1", "gold": { "verdict": "block" }, "raw": { "verdict": <Jev answer> } }
 *
 * where a Jev answer is the object the API returns for that question. Fields you derive in code can
 * be supplied as `predicted` and `confidence` maps instead of `raw`.
 */
export type NoulAnswer = {
    type: 'noul';
    noul: number;
};
export type ChoiceAnswer = {
    type: 'choice';
    choice: string;
    confidence: number;
    probabilities: Record<string, number>;
};
/** `legend` maps a level index ("0", "1") to that level's criterion text; `probabilities` is keyed by index. */
export type ScoreAnswer = {
    type: 'score';
    score: number;
    confidence: number;
    legend?: Record<string, string>;
    probabilities: Record<string, number>;
};
export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;
export type Row = {
    caseId: string;
    gold: Record<string, string>;
    raw?: Record<string, Answer | undefined>;
    predicted?: Record<string, string | undefined>;
    confidence?: Record<string, number | undefined>;
    /** A whole-map run (`jev-run --map`): the map's decision per gold field, and its grade. */
    decision?: Record<string, unknown>;
    grades?: Record<string, string>;
    error?: string;
    arm?: string;
};
/** One graded answer, whatever primitive produced it. */
export type Item = {
    caseId: string;
    field: string;
    gold: string;
    label: string;
    /** the scalar the API reports — systematically under-confident, see `calibration` */
    confidence: number;
    /** the full distribution, when the primitive has one */
    probabilities?: Record<string, number>;
    primitive: 'noul' | 'choice' | 'score' | 'derived';
};
/** Flatten rows into one graded item per (case, field). A `yes`/`no` gold reads a Noul at 0.5. */
export declare function items(rows: Row[], opts?: {
    requireConfidence?: boolean;
}): Item[];
export type ConfidentError = Item & {
    direction: string;
};
export type FieldPattern = {
    field: string;
    errors: number;
    /** the most common gold -> predicted pair among the confident errors */
    dominant: string;
    /** share of the field's confident errors that follow the dominant pair */
    share: number;
    /**
     * True when three or more confident errors mostly run one way. In the study behind this package,
     * this was a defect in the question or the labels — not the model — six times out of seven: a
     * question broader than its labels, or a label answering a different question from the one written.
     */
    oneDirection: boolean;
};
/**
 * Every case the model got wrong while sure. Confidence tracks ambiguity, so a confident error is
 * either the model's real boundary or a label that does not follow its own rubric. Both deserve a
 * human minute, and this list costs nothing because the run already happened.
 */
export declare function confidentlyWrong(all: Item[], threshold?: number): {
    errors: ConfidentError[];
    patterns: FieldPattern[];
};
export type Bin = {
    lo: number;
    hi: number;
    n: number;
    claimed: number;
    delivered: number;
};
export type Calibration = {
    answers: number;
    ece: number;
    /** mean confidence when right minus mean confidence when wrong — what a gate lives on */
    separation: number;
    bins: Bin[];
};
/**
 * Calibration of the **confidence scalar**. Across 5,227 answers in the study it was mostly
 * under-confident — a 0.2–0.3 claim delivered 55% — so a default 0.9 gate on it discards answers that
 * are mostly right. It is not the top label's probability (a right answer can carry 0.000), and single
 * suites can differ: read your own bins. Gate on the probability instead (`topLabelCalibration`).
 */
export declare function calibration(all: Item[], binCount?: number): Calibration;
/**
 * Calibration of **every probability in every distribution**, not just the winning label. Pooled over
 * 5,227 answers it tracked the diagonal within about four points where the scalar was off by up to 29.
 * Caution: the many near-zero probabilities of labels nobody chose dominate this pool and flatter the
 * ECE. For gating, read `topLabelCalibration` and `auroc`, which only look at the label acted on.
 */
export declare function probabilityCalibration(all: Item[], binCount?: number): Calibration;
/**
 * Calibration of the probability of the label the answer gave: the number a gate reads. Middle bins
 * are where single suites wander; with ~30 cases each bin holds a handful of answers.
 */
export declare function topLabelCalibration(all: Item[], binCount?: number): Calibration;
/**
 * Area under the ROC curve of the top-label probability as a right/wrong detector: the chance a random
 * right answer is more certain than a random wrong one. A gate fitted on labelled cases needs this
 * (ranking), not calibration. NaN when there are no wrong answers or no right ones.
 */
export declare function auroc(all: Item[], on?: Gate['on']): number;
/**
 * Share of cases where the truth is among the top `k` labels. `argmax` discarded 12–25 points of
 * recall in the study: when the top label was wrong, the truth was the runner-up 67–100% of the time.
 * Show two labels **to a person**; handing a shortlist to another model measured negative.
 */
export declare function topK(all: Item[], k?: number): {
    field: string;
    n: number;
    top1: number;
    topK: number;
}[];
export type Gate = {
    on: 'confidence' | 'probability';
    /** the question the gate is for; undefined for a gate pooled over every question */
    field?: string;
    target: number;
    /** answers the gate was fitted on */
    n: number;
    /** null when no threshold reaches the target precision on this data */
    threshold: number | null;
    coverage: number;
    precision: number;
    /** 95% Wilson lower bound on that precision: at ~30 cases, "95% precise" can mean 80% */
    lower: number;
    /** true when the answers held no wrong ones, so any threshold "reaches" the target */
    noErrors: boolean;
};
/** 95% Wilson score lower bound for k successes in n. */
export declare function wilsonLower(k: number, n: number, z?: number): number;
/**
 * The lowest threshold at which everything at or above it is at least `target` precise, and how much
 * of the queue that automates. Fit this on held-out labelled cases, never guess it: on adversarial
 * cases the ordering survived while coverage collapsed to one case in eight.
 */
export declare function fitGate(all: Item[], target?: number, on?: Gate['on']): Gate;
/**
 * One gate per question. Questions differ in how their certainty tracks correctness (a noul's never
 * drops below 0.5; a 30-way choice's can sit at 0.3 and be right), so a pooled threshold is wrong for
 * most of them.
 */
export declare function fitGates(all: Item[], target?: number, on?: Gate['on']): Gate[];
/** Apply fitted per-question gates to other answers: the precision and coverage they actually get. */
export declare function applyGates(all: Item[], gates: Gate[]): {
    field: string;
    n: number;
    coverage: number;
    precision: number;
}[];
/**
 * Deterministic split by case id: the same case always lands on the same side. FNV-1a, then a murmur3
 * finaliser, because ids that differ only in their last characters (triage-001, triage-002) otherwise
 * share their high bits and land on one side together.
 */
export declare function inFitHalf(caseId: string, fraction?: number): boolean;
/** Rows that recorded an error instead of answers: counted, never graded. */
export declare const errored: (rows: Row[]) => Row[];
/**
 * Cases whose gold differs between two runs. A diff across different labels is meaningless: the same
 * answers can move from right to wrong because a label was corrected.
 */
export declare function goldMismatches(before: Row[], after: Row[]): string[];
/** Replace each row's gold with the suite's current labels, so two runs are graded on the same truth. */
export declare function regold(rows: Row[], cases: {
    id: string;
    gold?: Record<string, unknown>;
}[]): Row[];
/** Parse JSONL text into rows, skipping blank lines. */
export declare function parseRows(text: string): Row[];
export type FieldDiff = {
    field: string;
    /** cases present in both runs */
    n: number;
    before: number;
    after: number;
    delta: number;
    /** wrong before, right after */
    fixed: number;
    /** right before, wrong after */
    broken: number;
    /** answers whose label changed at all, right or wrong */
    flipped: number;
    /** two-sided exact sign test on fixed vs broken */
    p: number;
    /**
     * `real` needs both |Δ| ≥ 7 points and p < 0.05. Re-running an unchanged baseline drifted 2.5 and
     * 5.9 points at n=20–50 in the study, and a single-suite gap under ~7 points never replicated.
     */
    verdict: 'real' | 'unproven' | 'no change';
};
/**
 * Compare two runs of the same cases — before and after a question change, a recompile, or a model
 * version bump. A no-op rewording once moved 82% of one suite's answers, so `flipped` matters even
 * when accuracy does not move. Re-run the comparator arm too: a clearer question helps every model.
 */
export declare function diff(before: Item[], after: Item[]): FieldDiff[];
/** How sure one answer is: a noul's distance from its nearer end, a choice's or score's top probability. */
export declare function answerCertainty(answer: Answer): number;
export type Decision = {
    caseId: string;
    field: string;
    gold: unknown;
    decision: unknown;
    grade: 'right' | 'wrong' | 'abstain';
    /** the least certain answer behind the decision; null when the map asked Jev nothing for this case */
    weakest: {
        question: string;
        certainty: number;
    } | null;
};
/** True for rows written by `jev-run --map`. */
export declare const isMapRow: (row: Row) => boolean;
/** One graded decision per (case, decision field) of a map run. Rows that errored are skipped: count them with `errored`. */
export declare function decisions(rows: Row[]): Decision[];
export type DecisionField = {
    field: string;
    n: number;
    right: number;
    wrong: number;
    abstain: number;
    accuracy: number;
    wrongRate: number;
    coverage: number;
};
/** Right / wrong / abstain per decision field. */
export declare function decisionSummary(all: Decision[]): DecisionField[];
export type WeakLink = {
    question: string;
    wrong: number;
    right: number;
};
/**
 * Which question was the least certain answer behind each decision, counted separately for wrong and
 * right decisions. A question that is the weak link in many wrong decisions and few right ones is the
 * first one to read.
 */
export declare function weakLinks(all: Decision[]): WeakLink[];
export type DecisionGate = {
    target: number;
    /** send a case to a person when its weakest answer is below this; null if no threshold reaches the target */
    threshold: number | null;
    /** share of all cases the map still decides with the gate */
    coverage: number;
    precision: number;
    /** wrong decisions the gate turns into abstentions */
    wrongRemoved: number;
    /** right decisions it turns into abstentions */
    rightLost: number;
    /** 95% Wilson lower bound on the precision */
    lower: number;
    /** no wrong decisions at all: nothing for a gate to remove */
    noErrors: boolean;
};
/**
 * Fit a gate on the weakest answer behind each decision: the lowest threshold at which the decisions
 * kept reach the target precision. Cases the map already abstained on stay abstained. Decisions made
 * without asking Jev anything count as certain.
 */
export declare function fitDecisionGate(all: Decision[], target?: number): DecisionGate;
