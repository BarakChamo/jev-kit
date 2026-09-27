// Two separate paths, on two separate schedules:
//
// 1. COMPILE (offline, ~monthly, triggered by a policy edit). An LLM turns the policy
//    doc into a draft questions.json. Several drafts are scored against a labelled case
//    set and the winner is pinned into the repo, reviewed like any other change.
//    Never runs per-request.
// 2. DECIDE (online, millions of times/day). Loads the pinned questions.json, fills the
//    `state` for one post, calls Jev once, and applies fixed threshold logic to the
//    answers. No LLM call, no policy text, on this path.

import { readFileSync, writeFileSync } from "fs";

// ---------- 1. Compile: policy doc -> pinned questions.json (offline, monthly) ----------

interface QuestionsFile {
  state: Record<string, unknown>;
  questions: Record<string, unknown>;
}

/**
 * Ask an LLM to draft a Jev questions.json from the current policy text, score N drafts
 * against the labelled eval set (see the jev-eval skill), and pin the winner to disk.
 * Run by CI when policy.md changes; never called from the request path.
 */
async function compileQuestionsFromPolicy(
  policyText: string,
  draftCount = 5,
): Promise<void> {
  const drafts: QuestionsFile[] = [];
  for (let i = 0; i < draftCount; i++) {
    drafts.push(await draftQuestionsWithLLM(policyText));
  }

  let best: { file: QuestionsFile; score: number } | undefined;
  for (const draft of drafts) {
    const score = await scoreAgainstLabelledCases(draft); // jev-eval: ~30 labelled posts, half hard cases
    if (!best || score > best.score) best = { file: draft, score };
  }
  if (!best) throw new Error("no drafts produced");

  writeFileSync("questions.json", JSON.stringify(best.file, null, 2));
  // Commit + PR from here for human review; do not auto-deploy an unreviewed pin.
}

async function draftQuestionsWithLLM(_policyText: string): Promise<QuestionsFile> {
  // Prompts an LLM with the policy text and the jev-questions rules (state carries every
  // premise; one present-tense question per fact; name the field; choice/noul over score;
  // no conditionals in the instruction) and asks it to emit a QuestionsFile. Stubbed here.
  throw new Error("not implemented — offline compile step, not run in production request path");
}

async function scoreAgainstLabelledCases(_draft: QuestionsFile): Promise<number> {
  // Runs the draft's questions over the labelled case set and returns accuracy/agreement.
  throw new Error("not implemented — see jev-eval skill");
}

// ---------- 2. Decide: Jev answers -> moderation action (online, per post) ----------

interface Post {
  post_id: string;
  post_text: string;
  author_username: string;
  author_account_age_days: number;
  author_prior_strikes_90d: number;
  target_username: string | null;
  target_is_public_figure: boolean;
  is_reply: boolean;
}

// Mirrors questions.json's `questions` map. Keep these two in sync by construction: the
// compile step should fail its score check if a draft renames or drops one of these ids.
interface JevAnswers {
  violence_threat: { noul: number };
  hate_speech: { noul: number };
  targeted_harassment: { noul: number };
  self_harm_content: { noul: number };
  sexual_content_minor: { noul: number };
  spam_or_scam: { noul: number };
  content_context: {
    choice: "original_statement" | "quoting_or_reporting" | "satire_or_commentary";
    confidence: number;
    probabilities: Record<string, number>;
  };
  evasion_attempt: { noul: number };
}

type Action = "allow" | "escalate" | "remove" | "escalate_specialized";

interface Decision {
  action: Action;
  reasons: string[];
}

const REMOVE_THRESHOLD = 0.85;
const ESCALATE_THRESHOLD = 0.4;
// Zero-tolerance category: gate low, and never auto-remove — route straight to a
// specialized reviewer/legal queue instead of relying on Jev's own confidence.
const CSAM_ESCALATE_THRESHOLD = 0.15;

export function decide(post: Post, answers: JevAnswers): Decision {
  const reasons: string[] = [];

  if (answers.sexual_content_minor.noul >= CSAM_ESCALATE_THRESHOLD) {
    return { action: "escalate_specialized", reasons: ["sexual_content_minor"] };
  }

  const flags: Array<[keyof JevAnswers, number]> = [
    ["violence_threat", answers.violence_threat.noul],
    ["hate_speech", answers.hate_speech.noul],
    ["targeted_harassment", answers.targeted_harassment.noul],
    ["self_harm_content", answers.self_harm_content.noul],
    ["spam_or_scam", answers.spam_or_scam.noul],
  ];

  let worst: Action = "allow";
  for (const [id, p] of flags) {
    if (p >= REMOVE_THRESHOLD) {
      reasons.push(id);
      worst = "remove";
    } else if (p >= ESCALATE_THRESHOLD && worst !== "remove") {
      reasons.push(id);
      worst = "escalate";
    }
  }

  // Evasion attempt detected (rule 10 pattern): don't let the rest of the answers clear
  // the post outright. A manipulated model is a model whose "allow" you can't trust.
  if (answers.evasion_attempt.noul >= 0.5 && worst === "allow") {
    worst = "escalate";
    reasons.push("evasion_attempt");
  }

  // Quoting/condemning or clear satire is a policy-defined exception, but it's a nuanced
  // call — downgrade an auto-remove to a human escalation rather than auto-allowing.
  if (
    worst === "remove" &&
    answers.content_context.choice !== "original_statement" &&
    answers.content_context.confidence >= 0.7
  ) {
    worst = "escalate";
    reasons.push(`content_context:${answers.content_context.choice}`);
  }

  // Repeat offenders: an escalate-band call on a post from someone with a recent pattern
  // is acted on directly rather than queued. This is a fact from the state, not a judgment,
  // so it's applied in code (rule 12) rather than asked as a question.
  if (worst === "escalate" && post.author_prior_strikes_90d >= 3) {
    worst = "remove";
    reasons.push("repeat_offender");
  }

  return { action: worst, reasons };
}

// ---------- Runtime wiring (per post; the only network call in this path) ----------

function buildState(post: Post) {
  return {
    post_id: post.post_id,
    post_text: post.post_text,
    author_username: post.author_username,
    author_account_age_days: post.author_account_age_days,
    author_prior_strikes_90d: post.author_prior_strikes_90d,
    target_username: post.target_username,
    target_is_public_figure: post.target_is_public_figure,
    is_reply: post.is_reply,
  };
}

export async function moderatePost(post: Post): Promise<Decision> {
  const questionsFile: QuestionsFile = JSON.parse(readFileSync("questions.json", "utf8"));

  const res = await fetch("https://ai-gateway.vercel.sh/typesafe/v1/systemone", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.AI_GATEWAY_API_KEY}`,
    },
    body: JSON.stringify({
      model: "typesafe-ai/jev",
      state: buildState(post),
      questions: questionsFile.questions,
    }),
  });
  const answers = (await res.json()) as JevAnswers;

  return decide(post, answers);
}
