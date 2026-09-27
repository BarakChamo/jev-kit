import json, statistics as st
def load(f):
    try: return {m['map']: m for m in json.load(open(f)) if 'accuracy' in m}
    except FileNotFoundError: return {}
normal, hard = {}, {}
for f in ['results.default.json', 'results.round2.json', 'results.rerun503.json', 'results.fix2-lenient.json', 'results.fix2.json', 'results.sonnetfinal.json']:
    for k, v in load(f).items(): normal.setdefault(k, v) if f == 'results.fix2.json' else normal.update({k: v})
for f in ['results.default.hard.json', 'results.round2.hard.json', 'results.rerun503.hard.json', 'results.fix2-lenient.hard.json', 'results.fix2.hard.json', 'results.sonnetfinal.hard.json']:
    for k, v in load(f).items(): hard.setdefault(k, v) if f == 'results.fix2.hard.json' else hard.update({k: v})
def group(name):
    parts = name.split('-'); task = '-'.join(parts[:2]); arm = parts[2]; rep = int(parts[3]); model = 'sonnet' if name.endswith('sonnet') else 'default'
    if arm == 'base': ver = 'no plugin'
    elif model == 'sonnet': ver = 'plugin v3 + rule 5 refined' if rep <= 3 else 'plugin (final)'
    else: ver = 'plugin v3' if rep <= 4 else 'plugin v3 + rule 5 refined' if rep <= 8 else 'plugin (final)'
    return task, model, ver
rows = []
for name in sorted(normal):
    t, mdl, ver = group(name)
    n, h = normal[name], hard.get(name)
    rows.append(dict(map=name, task=t, model=mdl, version=ver, acc=n['accuracy'], wrong=n['wrongRate'], hacc=h['accuracy'] if h else None, hwrong=h['wrongRate'] if h else None))
json.dump(rows, open('summary.json', 'w'), indent=1)
pc = lambda x: f'{x*100:.1f}%'
print('| task | agent model | version | maps | accuracy | wrong | hard: accuracy | hard: wrong |')
print('| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |')
order = ['no plugin', 'plugin v3', 'plugin v3 + rule 5 refined', 'plugin (final)']
for t in ['reply-exposure', 'alert-routing', 'expense-review']:
    for mdl in ['default', 'sonnet']:
        for ver in order:
            g = [r for r in rows if r['task'] == t and r['model'] == mdl and r['version'] == ver]
            if not g: continue
            print(f"| {t} | {mdl} | {ver} | {len(g)} | {pc(st.mean(r['acc'] for r in g))} | {pc(st.mean(r['wrong'] for r in g))} | {pc(st.mean(r['hacc'] for r in g))} | {pc(st.mean(r['hwrong'] for r in g))} |")
