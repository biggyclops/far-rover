"""Differential test: farsim.py (rules v3) vs simulation.js on the kit map."""
import json, random, subprocess, sys, collections, os
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from farsim import run, COMBOS, prog_str
from programs import random_program

N = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
rng = random.Random(7)
progs = []
for combo in COMBOS:
    for _ in range(N):
        p = random_program(combo, rng)
        progs.append((p, combo))

node = subprocess.Popen(
    ['node', os.path.join(HERE, 'demo_harness.mjs')],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, cwd=ROOT
)
inp = '\n'.join(json.dumps({'prog': [list(r) for r in p], 'combo': list(c)}) for p, c in progs) + '\n'
out, err = node.communicate(inp)
if node.returncode:
    sys.stderr.write(err or 'demo_harness failed\n')
    sys.exit(node.returncode)
res = [json.loads(l) for l in out.splitlines() if l.strip()]
if len(res) != len(progs):
    print(f"harness returned {len(res)} of {len(progs)} results", file=sys.stderr)
    sys.exit(1)
mism = collections.Counter(); ex = {}
moved = 0
for (p, c), d in zip(progs, res):
    f = run(p, c, rules='v3')
    key_f = (f.outcome, f.turns, f.tiles, f.cargo); key_d = (d['outcome'], d['turns'], d['tiles'], d['cargo'])
    if f.moves: moved += 1
    if key_f != key_d:
        k = (f.outcome, d['outcome'])
        mism[k] += 1
        ex.setdefault(k, []).append((prog_str(p), c, key_f, key_d))
print(f"programs {len(progs)}, movers {moved}, mismatches {sum(mism.values())}")
for k, v in mism.most_common():
    print(k, v)
    for e in ex[k][:3]: print('   ', e)
sys.exit(1 if mism else 0)
