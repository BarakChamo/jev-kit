import json, glob, os, statistics as st
res = {}
for f in sorted(g for g in glob.glob('out/*.json') if 'reference' not in g):          # later files (fixes) override earlier ones
    for r in json.load(open(f)):
        res[r['map']] = r
# design grades from the A/B, keyed the same way as maps/
grades = {}
for rnd in range(1, 10):
    d = f'../plugin-ab/round{rnd}'
    if not os.path.exists(f'{d}/grades.json'): continue
    g = json.load(open(f'{d}/grades.json')); key = json.load(open(f'{d}/key.json')) if os.path.exists(f'{d}/key.json') else None
    for k, v in g.items():
        run = key[k] if key else k
        grades[f'r{rnd}-{run}'] = v if isinstance(v, str) else v.get('P')
rows = []
for m, r in sorted(res.items()):
    _, task, arm, _n = m.split('-', 3)
    rows.append(dict(map=m, task=task, arm=arm, grade=grades.get(m, '?'), n=r['n'], right=r['right'], wrong=r['wrong'], abstain=r['abstain'], errors=r['errors'],
                     acc=r['accuracy_all'], acc_dec=r['accuracy_decided'], cov=r['coverage'], top3=r.get('top3_recall')))
def agg(sel):
    if not sel: return None
    return dict(maps=len(sel), acc=st.mean(x['acc'] for x in sel), wrong_rate=st.mean(x['wrong']/x['n'] for x in sel), cov=st.mean(x['cov'] for x in sel),
                acc_dec=st.mean(x['acc_dec'] for x in sel if x['cov'] > 0) if any(x['cov'] > 0 for x in sel) else None)
out = {'rows': rows, 'by_task_arm': {}, 'by_task_grade': {}}
def version(x):
    if x['arm'] == 'base': return 'no plugin'
    rnd = int(x['map'].split('-')[0][1:])
    return 'plugin v3 (rounds 11-12)' if rnd >= 11 else 'plugin v2 (round 10)' if rnd == 10 else 'plugin v1 (rounds 1-7)'
for x in rows: x['version'] = version(x)
for t in ['notice', 'retry', 'culprit']:
    for a in ['no plugin', 'plugin v1 (rounds 1-7)', 'plugin v2 (round 10)', 'plugin v3 (rounds 11-12)']:
        v = agg([x for x in rows if x['task'] == t and x['version'] == a])
        if v: out['by_task_arm'][f'{t} / {a}'] = v
    for g in ['PASS', 'PARTIAL', 'FAIL']:
        out['by_task_grade'][f'{t}/{g}'] = agg([x for x in rows if x['task'] == t and x['grade'] == g and x['version'] in ('no plugin', 'plugin v1 (rounds 1-7)')])
json.dump(out, open('analysis.json', 'w'), indent=1)
f = lambda v: '—' if v is None else f'{v*100:.1f}%'
print('| task / arm | maps | accuracy (abstain = wrong) | wrong decisions | coverage | accuracy when it decides |')
for k, v in out['by_task_arm'].items():
    if v: print(f"| {k} | {v['maps']} | {f(v['acc'])} | {f(v['wrong_rate'])} | {f(v['cov'])} | {f(v['acc_dec'])} |")
print()
for k, v in out['by_task_grade'].items():
    if v: print(f"| {k} | {v['maps']} | {f(v['acc'])} | {f(v['wrong_rate'])} | {f(v['cov'])} | {f(v['acc_dec'])} |")
print()
for x in rows: print(f"{x['map']:22} {x['grade']:8} acc={x['acc']*100:5.1f} wrong={x['wrong']:2} abst={x['abstain']:2} dec={x['acc_dec']*100:5.1f}" + (f" top3={x['top3']*100:.0f}" if x['top3'] is not None else ''))
