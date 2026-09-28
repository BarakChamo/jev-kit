"""Do the design flags (design.mjs) predict Jev accuracy? Uses the maps that have both.
Usage: python3 design_vs_accuracy.py [maps-dir] [results.json]  ->  design-vs-accuracy.<maps-dir>.md"""
import json, os, sys
sub = sys.argv[1] if len(sys.argv) > 1 else 'maps'
resf = sys.argv[2] if len(sys.argv) > 2 else 'results.claude.json'
res = {r['map'].rstrip('/').split('/')[-1]: r for r in json.load(open(resf))}
names = sorted(n for n in os.listdir(sub) if os.path.isdir(f'{sub}/{n}'))
rows = [(n, r) for n, r in zip(names, json.load(open(f'design.{sub}.json'))) if n in res]
FLAGS = {'sla-breach': ['computesTimeInCode', 'asksBreachDirectly'], 'refund-eligibility': ['computesDaysInCode', 'asksEligibleDirectly'],
         'culprit': ['oneChoiceOverAllLines', 'preFilter']}
out = ['| task | flag | value | maps | accuracy | wrong |', '| --- | --- | --- | ---: | ---: | ---: |']
for task, flags in FLAGS.items():
    for f in flags:
        for val in (True, False):
            xs = [res[n] for n, r in rows if r['task'] == task and r.get(f) is val]
            if not xs: continue
            N = sum(x['n'] for x in xs)
            out.append(f"| {task} | {f} | {'yes' if val else 'no'} | {len(xs)} | {sum(x['right'] for x in xs)}/{N} | {sum(x['wrong'] for x in xs)}/{N} |")
open(f'design-vs-accuracy.{sub}.md', 'w').write('\n'.join(out) + '\n')
print('\n'.join(out))
