// One-shot map authoring through AI Gateway, for authors that are not Claude Code agents.
//   node author.mjs <task> <arm: plugin|base> <model> <rep> <outdir>
// plugin arm: the jev-questions skill and its patterns reference go in the system prompt, as the
// material a Claude Code agent would load. base arm: a plain engineering system prompt. The user
// prompt is identical in both (prompt.mjs).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { generateText, streamText } from 'ai';
import { buildPrompt } from './prompt.mjs';

const [task, arm, model, rep, outdir] = process.argv.slice(2);
const repo = new URL('../../', import.meta.url);
// SKILL_REF pins the skill text to a git commit, so a resumed round sees the same skill it started with.
const readSkillFile = (p) =>
  process.env.SKILL_REF
    ? execFileSync('git', ['show', `${process.env.SKILL_REF}:${p}`], { cwd: new URL('.', repo).pathname, encoding: 'utf8' })
    : readFileSync(new URL(p, repo), 'utf8');
const skill = () =>
  ['plugin/skills/jev-questions/SKILL.md', 'plugin/skills/jev-questions/references/patterns.md']
    .map((p) => `===== ${p} =====\n${readSkillFile(p)}`)
    .join('\n\n');
const system =
  'You are an expert software engineer. Answer with the complete contents of map.mjs in a single ```js code block, and nothing after it.' +
  (arm === 'plugin' ? `\n\nYou have this skill for writing Jev question maps. Follow it.\n\n${skill()}` : '');
const dir = join(outdir, `${task}-${arm}-${rep}-${model.replace(/[/.]/g, '_')}`);
mkdirSync(dir, { recursive: true });
const started = Date.now();
let text = '', err;
for (let attempt = 0; attempt < 2 && !text; attempt++) {
  try {
    // Streamed by default, with reasoning left on (the models' best), and up to 30 minutes per map. STREAM=0 sends
    // one non-streaming request instead: the gateway caps how long a stream may run, and slow reasoning models hit it.
    const opts = { model, system, prompt: buildPrompt(task), maxOutputTokens: Number(process.env.MAX_OUTPUT ?? 32000), abortSignal: AbortSignal.timeout(1_800_000) };
    const r = process.env.STREAM === '0' ? await generateText(opts) : streamText(opts);
    text = await r.text;
    const skillSha = arm === 'plugin' ? createHash('sha256').update(skill()).digest('hex').slice(0, 12) : null;
    writeFileSync(join(dir, 'usage.json'), JSON.stringify({ model, arm, skillSha, skillRef: process.env.SKILL_REF ?? 'working tree', maxOutputTokens: Number(process.env.MAX_OUTPUT ?? 32000), stream: process.env.STREAM !== '0', servedBy: (await r.response)?.modelId, usage: await r.usage, ms: Date.now() - started }, null, 2));
  } catch (e) { err = String(e?.message ?? e); await new Promise((r) => setTimeout(r, 5000 * (attempt + 1))); }
}
writeFileSync(join(dir, 'response.md'), text || `ERROR: ${err}`);
const blocks = [...text.matchAll(/```(?:js|javascript|mjs)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
const code = blocks.sort((a, b) => b.length - a.length)[0];
if (code) writeFileSync(join(dir, 'map.mjs'), code);
console.log(`done ${task} ${arm} ${model} ${rep} ${code ? 'ok' : 'NO-CODE'} ${Math.round((Date.now() - started) / 1000)}s`);
