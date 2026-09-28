"""Round 4 summary -> summary.md.
Procurement: every author x arm (no plugin, v4.2, v4.3). Earlier tasks: v4.3 (this round) against the same
models' v4.2 maps from round 2 (`../heldout2/results.api-v42.json`, with its 64k retries merged in).
Maps that produced no code or failed to load count as 0 accuracy; "loaded" leaves them out."""
import json, os, statistics as st

here = os.path.dirname(os.path.abspath(__file__))
def load(path):
    p = os.path.join(here, path)
    rows = [{k: v for k, v in m.items() if k != 'rows'} for m in json.load(open(p))] if os.path.exists(p) else []
    # A map whose first attempt produced no code was retried once without streaming (results.<name>-retry.json):
    # the retry replaces the failed attempt and is marked, so both numbers stay visible.
    retry = os.path.join(here, path.replace('.json', '-retry.json'))
    if os.path.exists(retry) and not path.endswith('-retry.json'):
        again = {m['map']: {**{k: v for k, v in m.items() if k != 'rows'}, 'retried': True} for m in json.load(open(retry))}
        rows = [again.get(m['map'], m) if 'loadError' in m else m for m in rows]
    return rows

AUTHORS = {'claude': 'Claude Code agent', 'zai_glm-5_3': 'GLM 5.3', 'alibaba_qwen3_8-max-0902': 'Qwen 3.8 Max (0902)',
           'deepseek_deepseek-v4-pro-0813': 'DeepSeek V4 Pro (0813)', 'deepseek_deepseek-v4-pro': 'DeepSeek V4 Pro'}
pc = lambda x: f'{x*100:.1f}%'

def agg(g):
    ok = [m for m in g if 'accuracy' in m]
    n = sum(m['n'] for m in ok)
    return dict(maps=len(g), failed=len(g) - len(ok), retried=sum(1 for m in g if m.get('retried')),
                acc=st.mean([m['accuracy'] for m in ok] + [0.0] * (len(g) - len(ok))) if g else float('nan'),
                loaded=sum(m['right'] for m in ok) / n if n else float('nan'),
                wrong=sum(m['wrong'] for m in ok), decided=n)

out = ['## Procurement', '', '| author | arm | maps | retried | failed | accuracy | loaded accuracy | wrong decisions |', '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |']
arms = {'no plugin': ['results.cc-base.json', 'results.api-base.json'], 'v4.2': ['results.cc-v42.json', 'results.api-v42.json'], 'v4.3': ['results.cc-v43.json', 'results.api-v43.json']}
proc = {arm: [m for f in files for m in load(f)] for arm, files in arms.items()}
for a in ['claude', 'zai_glm-5_3', 'alibaba_qwen3_8-max-0902', 'deepseek_deepseek-v4-pro-0813']:
    for arm in arms:
        s = agg([m for m in proc[arm] if m['author'] == a])
        if s['maps']: out.append(f"| {AUTHORS[a]} | {arm} | {s['maps']} | {s['retried']} | {s['failed']} | {pc(s['acc'])} | {pc(s['loaded'])} | {s['wrong']} / {s['decided']} |")
for arm in arms:
    s = agg(proc[arm])
    out.append(f"| **all authors** | {arm} | {s['maps']} | {s['retried']} | {s['failed']} | {pc(s['acc'])} | {pc(s['loaded'])} | {s['wrong']} / {s['decided']} |")

# earlier tasks: v4.3 now vs v4.2 in round 2
r2 = {m['map']: m for m in load('../heldout2/results.api-v42.json')}
for m in load('../heldout2/results.api-v42-64k.json'): r2[m['map']] = m
v42 = list(r2.values())
v43 = load('results.api-v43-r2.json')
out += ['', '## Earlier tasks: v4.3 against round 2 v4.2', '', '| author | task | v4.2 loaded accuracy (wrong) | v4.3 loaded accuracy (wrong) | v4.2 / v4.3 failed |', '| --- | --- | ---: | ---: | ---: |']
pairs = [('zai_glm-5_3', 'zai_glm-5_3'), ('alibaba_qwen3_8-max-0902', 'alibaba_qwen3_8-max-0902'), ('deepseek_deepseek-v4-pro', 'deepseek_deepseek-v4-pro-0813')]
for old, new in pairs:
    for t in ['sla-breach', 'culprit', 'access-request']:
        a = agg([m for m in v42 if m['author'] == old and m['task'] == t and m['arm'] == 'plugin'])
        b = agg([m for m in v43 if m['author'] == new and m['task'] == t])
        fa = lambda s: f"{pc(s['loaded'])} ({s['wrong']}/{s['decided']})" if s['maps'] else '—'
        out.append(f"| {AUTHORS[new]} | {t} | {fa(a)} | {fa(b)} | {a['failed']}/{a['maps']} · {b['failed']}/{b['maps']} |")
open(os.path.join(here, 'summary.md'), 'w').write('\n'.join(out) + '\n')
print('\n'.join(out))
