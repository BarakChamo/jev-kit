import os, random, shutil, json, re
S = os.path.dirname(os.path.abspath(__file__))
runs = sorted(os.listdir(f'{S}/runs'))
random.seed(11); ids = random.sample(range(100, 999), len(runs))
key = {}
os.makedirs(f'{S}/blind', exist_ok=True)
# Final messages can name the plugin's skills; redact those so the arm is not given away by name.
red = re.compile(r'jev[-:](eval|questions|fit|audit|run)|jev:jev-\w+|skill|plugin|rule \d+|law \d+', re.I)
for r, i in zip(runs, ids):
    task = r.split('-')[0]
    d = f'{S}/blind/{task}-{i}'
    shutil.rmtree(d, ignore_errors=True); os.makedirs(d)
    for f in ('questions.json', 'decide.ts'):
        p = f'{S}/runs/{r}/{f}'
        if os.path.exists(p): shutil.copy(p, d)
    t = open(f'{S}/runs/{r}/transcript.txt').read()
    open(f'{d}/final.txt', 'w').write(red.sub('[REDACTED]', t))
    key[f'{task}-{i}'] = r
json.dump(key, open(f'{S}/key.json', 'w'), indent=1)
print(sorted(key))
