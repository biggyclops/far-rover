"""Enumerate every legal Far Rover paper-test program (up to 4 rules) for a sensor combo,
with rules that can never fire removed (canonical form).
"""
import random
from farsim import (C_ALWAYS, C_BATT, C_CRATER, C_DUST, C_ORENEXT, C_ONORE, C_GOAL,
                    A_EXPLORE, A_RETURN, A_SIDESTEP, A_GOTOORE, A_DRILL, A_WAIT)

BATT_N = list(range(1, 21))

def cond_list(combo, batt_n=BATT_N, rules="v2"):
    cs = [(C_BATT, n) for n in batt_n]
    if rules != "v1": cs.append((C_GOAL, 0))
    if "Di" in combo: cs.append((C_CRATER, 0))
    if "Du" in combo: cs.append((C_DUST, 0))
    if "Sp" in combo: cs += [(C_ORENEXT, 0), (C_ONORE, 0)]
    return cs

def act_list(combo):
    a = [A_EXPLORE, A_RETURN, A_SIDESTEP, A_DRILL, A_WAIT]
    if "Sp" in combo: a.insert(3, A_GOTOORE)
    return a

def cond_seqs(conds, maxlen):
    """Ordered sequences of distinct non-Always conditions, battery N increasing."""
    out = []
    def rec(prefix, maxb):
        out.append(tuple(prefix))
        if len(prefix) == maxlen:
            return
        for c in conds:
            if c in prefix: continue
            if c[0] == C_BATT and c[1] <= maxb: continue
            prefix.append(c)
            rec(prefix, c[1] if c[0] == C_BATT else maxb)
            prefix.pop()
    rec([], 0)
    return out

def random_program(combo, rng, batt_n=BATT_N, rules="v2"):
    """Random canonical program: length 1..4 uniform, then random conds/actions."""
    conds = cond_list(combo, batt_n, rules); acts = act_list(combo)
    L = rng.randint(1, 4)
    use_always = rng.random() < 0.5
    k = L - (1 if use_always else 0)
    k = max(0, min(k, len(conds)))
    seq = rng.sample(conds, k) if k else []
    bs = [n for c, n in seq if c == C_BATT]
    bs.sort(); it = iter(bs)
    seq = [(c, next(it) if c == C_BATT else n) for c, n in seq]
    full = seq + ([(C_ALWAYS, 0)] if use_always else [])
    if not full:
        full = [(C_ALWAYS, 0)]
    return tuple((c, n, rng.choice(acts)) for c, n in full)
