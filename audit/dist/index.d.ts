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
 * Calibration of the **confidence scalar**. Across 5,227 answers this was systematically
 * under-confident at every bin — a 0.7–0.8 claim delivered 78%, a 0.2–0.3 claim 55% — which means a
 * default 0.9 gate discards answers that are mostly right. Compare with `probabilityCalibration`.
 */
export declare function calibration(all: Item[], binCount?: number): Calibration;
/**
 * Calibration of **every probability in every distribution**, not just the winning label. In the
 * study this tracked the diagonal within about four points where the scalar was off by up to 29 —
 * so if you gate, gate on the probability of the label you care about.
 */
export declare function probabilityCalibration(all: Item[], binCount?: number): Calibration;
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
    target: number;
    /** null when no threshold reaches the target precision on this data */
    threshold: number | null;
    coverage: number;
    precision: number;
};
/**
 * The lowest threshold at which everything at or above it is at least `target` precise, and how much
 * of the queue that automates. Fit this on held-out labelled cases, never guess it: on adversarial
 * cases the ordering survived while coverage collapsed to one case in eight.
 */
export declare function fitGate(all: Item[], target?: number, on?: Gate['on']): Gate;
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
/** One graded decision per (case, decision field) of a map run. Rows that errored are skipped. */
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
};
/**
 * Fit a gate on the weakest answer behind each decision: the lowest threshold at which the decisions
 * kept reach the target precision. Cases the map already abstained on stay abstained. Decisions made
 * without asking Jev anything count as certain.
 */
export declare function fitDecisionGate(all: Decision[], target?: number): DecisionGate;
