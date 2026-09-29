import { generateText, stepCountIs, tool } from 'ai';
import type { z } from 'zod';
import type { CallMeta } from './types.js';

export const GLM_MODEL = 'zai/glm-5.3-flash';
/** published list price, USD per token */
const GLM_INPUT_PRICE = 0.15 / 1e6;
const GLM_OUTPUT_PRICE = 0.5 / 1e6;

/**
 * List prices for the comparators used here, per token. Only models this repo actually runs are
 * listed; anything else falls back to the GLM prices and is flagged by the model id in the raw rows.
 */
const PRICES: Record<string, { input: number; output: number }> = {
  'zai/glm-5.3-flash': { input: GLM_INPUT_PRICE, output: GLM_OUTPUT_PRICE },
  'openai/gpt-5.5-fast': { input: 12.5 / 1e6, output: 75 / 1e6 },
};

/**
 * How the object came back.
 * `json-schema` is the provider's native structured output — GLM 5.3 Flash does not
 * support it through AI Gateway, so `tool-call` is what this repo actually uses.
 */
export type GlmMode = 'json-schema' | 'tool-call' | 'text-json';

export type GlmResult<T> = {
  object: T | undefined;
  meta: CallMeta;
  mode: GlmMode;
  /** set when the object never parsed against the schema */
  failure?: string;
};

export type Thinking = 'auto' | 'disabled';

function meta(
  model: string,
  started: number,
  usage: { inputTokens?: number; outputTokens?: number },
  providerMetadata: unknown,
): CallMeta {
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  const price = PRICES[model] ?? { input: GLM_INPUT_PRICE, output: GLM_OUTPUT_PRICE };
  const listCostUsd = inputTokens * price.input + outputTokens * price.output;
  const gatewayCost = Number(
    (providerMetadata as { gateway?: { cost?: string } } | undefined)?.gateway?.cost,
  );
  return {
    model,
    latencyMs: performance.now() - started,
    inputTokens,
    outputTokens,
    costUsd: Number.isFinite(gatewayCost) ? gatewayCost : listCostUsd,
    listCostUsd,
  };
}

function providerOptions(thinking: Thinking) {
  return thinking === 'disabled' ? { zai: { thinking: { type: 'disabled' } } } : undefined;
}

/**
 * Structured output from GLM via a forced tool call — the path that works through
 * AI Gateway — falling back to prompt + JSON.parse if the model refuses to call the tool.
 */
export async function generateStructured<T>(args: {
  schema: z.ZodType<T>;
  prompt: string;
  system?: string;
  model?: string;
  thinking?: Thinking;
  maxOutputTokens?: number;
}): Promise<GlmResult<T>> {
  const model = args.model ?? GLM_MODEL;
  const thinking = args.thinking ?? 'auto';
  const started = performance.now();

  const attempt = async () =>
    generateText({
      model,
      system: args.system,
      prompt: args.prompt,
      tools: { submit: tool({ description: 'Submit the answer', inputSchema: args.schema as never }) },
      toolChoice: 'required' as const,
      stopWhen: stepCountIs(1),
      maxOutputTokens: args.maxOutputTokens,
      providerOptions: providerOptions(thinking),
      abortSignal: AbortSignal.timeout(180_000),
    });

  let res: Awaited<ReturnType<typeof attempt>>;
  try {
    res = await attempt();
  } catch (error) {
    // The provider sometimes answers in prose despite toolChoice: 'required'. Ask again
    // without the tool and parse the JSON out of the text.
    const fallback = await generateText({
      model,
      system: args.system,
      prompt: `${args.prompt}\n\nReply with JSON only, matching the requested shape. No prose, no code fence.`,
      maxOutputTokens: args.maxOutputTokens,
      providerOptions: providerOptions(thinking),
      abortSignal: AbortSignal.timeout(180_000),
    });
    const parsed = args.schema.safeParse(extractJson(fallback.text));
    return {
      object: parsed.success ? parsed.data : undefined,
      mode: 'text-json',
      meta: meta(model, started, fallback.usage, fallback.providerMetadata),
      failure: parsed.success
        ? undefined
        : `tool call refused (${(error as Error).message.slice(0, 120)}) and fallback did not parse`,
    };
  }

  const call = res.toolCalls[0];
  if (call) {
    const parsed = args.schema.safeParse(call.input);
    if (parsed.success) {
      return { object: parsed.data, mode: 'tool-call', meta: meta(model, started, res.usage, res.providerMetadata) };
    }
    return {
      object: undefined,
      mode: 'tool-call',
      meta: meta(model, started, res.usage, res.providerMetadata),
      failure: parsed.error.message.slice(0, 300),
    };
  }

  const parsed = args.schema.safeParse(extractJson(res.text));
  return {
    object: parsed.success ? parsed.data : undefined,
    mode: 'text-json',
    meta: meta(model, started, res.usage, res.providerMetadata),
    failure: parsed.success ? undefined : 'no tool call and text did not parse',
  };
}

/** Free-form text, for the arms where the LLM writes rather than decides. */
export async function generateProse(args: {
  prompt: string;
  system?: string;
  model?: string;
  thinking?: Thinking;
  maxOutputTokens?: number;
}): Promise<{ text: string; meta: CallMeta }> {
  const model = args.model ?? GLM_MODEL;
  const started = performance.now();
  const res = await generateText({
    model,
    system: args.system,
    prompt: args.prompt,
    maxOutputTokens: args.maxOutputTokens,
    providerOptions: providerOptions(args.thinking ?? 'auto'),
  });
  return { text: res.text, meta: meta(model, started, res.usage, res.providerMetadata) };
}

export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced?.[1] ?? text;
  const start = body.search(/[[{]/);
  if (start === -1) return undefined;
  const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'));
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return undefined;
  }
}
