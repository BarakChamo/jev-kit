import { findCulprit } from "./decide.ts";

// Canonical case input shape (only the fields this adapter reads).
interface CaseInput {
  job_name: string;
  log_tail: string;
  log_lines: string[];
}

interface LogLine {
  index: number;
  text: string;
}

interface State {
  job_name: string;
  command: string;
  exit_code: number;
  lines: LogLine[];
}

// decide.ts only exports findCulprit; its request/answer shapes aren't exported,
// so we keep our own minimal structural types for them here.
interface JevRequest {
  model: "typesafe-ai/jev";
  state: State;
  questions: Record<string, unknown>;
}

// decide.ts's own callJev callback never throws in normal operation, so a thrown
// CaptureSignal lets us pull the exact request it built without duplicating its
// (unexported) candidate-selection / request-building logic.
class CaptureSignal {
  constructor(public req: JevRequest) {}
}

function deriveScalars(input: CaseInput): { job_name: string; command: string; exit_code: number } {
  const job_name = input.job_name ?? "";
  const match = /exit code (\d+)/.exec(input.log_tail ?? "");
  const exit_code = match ? Number(match[1]) : 1; // fall back to example state's value
  const command = ""; // not present in the canonical input; left empty per instructions
  return { job_name, command, exit_code };
}

function buildLines(log_lines: string[]): LogLine[] {
  // Mirrors decide.ts's own 1-indexing of last200 lines (i + 1).
  return log_lines.map((text, i) => ({ index: i + 1, text }));
}

export function buildState(input: CaseInput): State {
  const { job_name, command, exit_code } = deriveScalars(input);
  return { job_name, command, exit_code, lines: buildLines(input.log_lines) };
}

async function captureRequest(input: CaseInput): Promise<JevRequest | null> {
  const { job_name, command, exit_code } = deriveScalars(input);
  try {
    await findCulprit(job_name, command, exit_code, input.log_lines, async (req) => {
      throw new CaptureSignal(req as unknown as JevRequest);
    });
  } catch (e) {
    if (e instanceof CaptureSignal) return e.req;
    throw e;
  }
  // findCulprit resolved without ever calling callJev: 0 or 1 candidate lines,
  // decided entirely in code, no questions needed.
  return null;
}

export async function questions(input: CaseInput): Promise<Record<string, unknown>> {
  const req = await captureRequest(input);
  return req ? req.questions : {};
}

export async function decide(
  input: CaseInput,
  answers: Record<string, unknown>
): Promise<{ culprit_lines: number[] }> {
  const { job_name, command, exit_code } = deriveScalars(input);
  const verdict = await findCulprit(job_name, command, exit_code, input.log_lines, async () => answers as any);
  if (verdict.outcome === "culprit") {
    return { culprit_lines: [verdict.line.index - 1] };
  }
  return { culprit_lines: [] };
}
