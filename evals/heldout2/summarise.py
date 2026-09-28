"""Summarise every graded map in results.*.json into summary.md / summary.json.
The skill version comes from the results file (SKILL below); everything else is v3.
A map graded twice (results.panel.json, then results.api.json) is counted once."""
import json, glob, statistics as st

SKILL = {'results.v4.json': 'v4', 'results.v41.json': 'v4.1', 'results.v42.json': 'v4.2', 'results.api-v42.json': 'v4.2'}
PANEL = ['openai_gpt-5_6-terra', 'google_gemini-3_8-flash', 'deepseek_deepseek-v4-pro', 'moonshotai_kimi-k3',
         'mistral_mistral-medium-3_5', 'minimax_minimax-m3', 'meta_muse-spark-1_3']
LABEL = {'claude': 'Claude Code agent', 'zai_glm-5_3': 'GLM 5.3 (one-shot)', 'alibaba_qwen3_8-max-0902': 'Qwen 3.8 Max (one-shot)',
         'panel': 'seven-vendor panel (one-shot)', **{p: p.split('_', 1)[1].replace('_', '.') for p in PANEL}}
TASKS = ['sla-breach', 'refund-eligibility', 'access-request', 'clause-locator', 'culprit']

maps = {}
for f in sorted(glob.glob('results.*.json')):
    for m in json.load(open(f)):
        m = {k: v for k, v in m.items() if k != 'rows'}
        m['skill'] = SKILL.get(f, 'v3')
        maps[(m['map'], m['skill'])] = m
rows = list(maps.values())

pc = lambda x: f'{x*100:.1f}%'
def agg(g):
    ok = [m for m in g if 'accuracy' in m]
    fails = len(g) - len(ok)
    return dict(maps=len(g), load_failures=fails,
                accuracy=st.mean([m['accuracy'] for m in ok] + [0.0] * fails),
                wrong=st.mean([m['wrongRate'] for m in ok]) if ok else 0.0,
                coverage=st.mean([m['coverage'] for m in ok] + [0.0] * fails))
def line(cells, a):
    return '| ' + ' | '.join(cells) + f" | {a['maps']} | {a['load_failures']} | {pc(a['accuracy'])} | {pc(a['wrong'])} | {pc(a['coverage'])} |"
HEAD = ' | maps | load failures | accuracy | wrong | coverage |'
SEP = ' ---: | ---: | ---: | ---: | ---: |'

summary, out = [], ['## By task, author and arm', '', '| task | author | skill | arm' + HEAD, '| --- | --- | --- | --- |' + SEP]
for t in TASKS:
    for a in ['claude', 'zai_glm-5_3', 'alibaba_qwen3_8-max-0902', 'panel']:
        for skill in ['v3', 'v4', 'v4.1', 'v4.2']:
            for arm in ['base', 'plugin']:
                g = [m for m in rows if m['task'] == t and m['arm'] == arm and m['skill'] == skill
                     and (m['author'] in PANEL if a == 'panel' else m['author'] == a)]
                if not g: continue
                s = agg(g); summary.append(dict(task=t, author=a, skill=skill, arm=arm, **s))
                out.append(line([t, LABEL[a], skill, 'plugin' if arm == 'plugin' else 'no plugin'], s))

out += ['', '## One-shot API authors, per model (tasks pooled)', '',
        'Load failures count as 0 accuracy; "loaded" columns leave them out.', '',
        '| model | skill | arm | maps | load failures | accuracy | wrong | coverage | loaded accuracy |', '| --- | --- | --- |' + SEP + ' ---: |']
for p in ['zai_glm-5_3', 'alibaba_qwen3_8-max-0902'] + PANEL:
    for skill in ['v3', 'v4.2']:
        for arm in ['base', 'plugin']:
            g = [m for m in rows if m['author'] == p and m['arm'] == arm and m['skill'] == skill]
            if not g: continue
            ok = [m for m in g if 'accuracy' in m]
            la = pc(st.mean(m['accuracy'] for m in ok)) if ok else '—'
            out.append(line([LABEL[p], skill, 'plugin' if arm == 'plugin' else 'no plugin'], agg(g)) + f' {la} |')

json.dump(summary, open('summary.json', 'w'), indent=1)
open('summary.md', 'w').write('\n'.join(out) + '\n')
print('\n'.join(out))
