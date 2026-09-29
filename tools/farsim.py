"""Far Rover paper-test bot playtester: core rules engine.

Implements the paper-test kit (paper-test/cards.md, map.md, facilitator-guide.md)
as literally as possible. Every place where the kit is ambiguous is marked with
an AMBIG-xx tag that matches the ambiguity list in report.md.

Board: 12 x 12, columns A..L (0..11), rows 1..12 (0..11). Position = row*12+col.
The lander is an off-grid position (index 144) with virtual coordinates
(row 12, col F=5), i.e. just below F12. Its only neighbour is F12 (AMBIG-01).
Facing: 0=N (up), 1=E, 2=S, 3=W. Right of f is (f+1)%4, left (f+3)%4, back (f+2)%4.
"""
import random

COLS = "ABCDEFGHIJKL"
N_TILES = 144
LANDER = 144
F12 = 11 * 12 + 5

# terrain codes
EMPTY, CRATER, ORE, DUST = 0, 1, 2, 3

# ---- the kit's fixed planet layout (map.md) ----
KIT_LAYOUT = {
    CRATER: "F8 C10 J9 D6 I6 G3 K4 B2 E1 L11".split(),
    ORE: "D11 H10 G9 B7 E7 J7 H5 C4 K8 F2 I2 A12".split(),
    DUST: "F10 G10 B5 B6 C5 J3 J2 K2".split(),
}

def sq(name):
    c = COLS.index(name[0]); r = int(name[1:]) - 1
    return r * 12 + c

def name(pos):
    if pos == LANDER:
        return "LANDER"
    return f"{COLS[pos % 12]}{pos // 12 + 1}"

def kit_terrain():
    t = [EMPTY] * N_TILES
    for k, cells in KIT_LAYOUT.items():
        for c in cells:
            assert t[sq(c)] == EMPTY
            t[sq(c)] = k
    assert t.count(CRATER) == 10 and t.count(ORE) == 12 and t.count(DUST) == 8
    return t

def random_terrain(rng, keep_safe=("F12",)):
    """Random layout with the doc's counts (10 craters, 12 ore, 8 dust).
    NOT the kit layout; used only for the layout-sensitivity check.
    The kit's safe start square(s) are kept empty."""
    safe = {sq(s) for s in keep_safe}
    cells = [p for p in range(N_TILES) if p not in safe]
    rng.shuffle(cells)
    t = [EMPTY] * N_TILES
    for p in cells[:10]: t[p] = CRATER
    for p in cells[10:22]: t[p] = ORE
    for p in cells[22:30]: t[p] = DUST
    return t

# ---- geometry tables ----
def rc(pos):
    if pos == LANDER:
        return 12, 5
    return pos // 12, pos % 12

DR = [(-1, 0), (0, 1), (1, 0), (0, -1)]

def _build_tables():
    step = [[None] * 4 for _ in range(145)]      # forward-style move, lander reachable
    side = [[None] * 4 for _ in range(145)]      # sidestep move, lander counts as off-map (AMBIG-04)
    for p in range(145):
        r, c = rc(p)
        for d in range(4):
            nr, nc = r + DR[d][0], c + DR[d][1]
            if p == LANDER:
                tgt = F12 if d == 0 else None
                step[p][d] = tgt; side[p][d] = tgt
                continue
            if 0 <= nr < 12 and 0 <= nc < 12:
                step[p][d] = nr * 12 + nc; side[p][d] = nr * 12 + nc
            elif (nr, nc) == (12, 5):
                step[p][d] = LANDER; side[p][d] = None
    rings = []
    for p in range(145):
        r, c = rc(p)
        rr = [0] * 26
        for q in range(N_TILES):
            qr, qc = q // 12, q % 12
            rr[abs(qr - r) + abs(qc - c)] |= (1 << q)
        while rr and rr[-1] == 0:
            rr.pop()
        rings.append(tuple(rr))
    dl = [abs(rc(p)[0] - 12) + abs(rc(p)[1] - 5) for p in range(145)]
    cam = []
    for p in range(145):
        r, c = rc(p); m = 0
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                nr, nc = r + dr, c + dc
                if 0 <= nr < 12 and 0 <= nc < 12:
                    m |= 1 << (nr * 12 + nc)
        cam.append(m)
    nbm = []
    for p in range(145):
        m = 0
        for d in range(4):
            q = step[p][d]
            if q is not None and q != LANDER:
                m |= 1 << q
        nbm.append(m)
    return step, side, rings, dl, cam, nbm

STEP, SIDE, RINGS, DL, CAM, NBM = _build_tables()

# ---- cards ----
# conditions
C_ALWAYS, C_BATT, C_CRATER, C_DUST, C_ORENEXT, C_ONORE, C_GOAL = range(7)
COND_NAMES = {C_ALWAYS: "Always", C_BATT: "Battery below {n}", C_CRATER: "Crater in front",
              C_DUST: "On a dust tile", C_ORENEXT: "Ore next to rover", C_ONORE: "On an ore tile",
              C_GOAL: "Goal met"}
COND_SENSOR = {C_ALWAYS: None, C_BATT: None, C_CRATER: "Di", C_DUST: "Du", C_ORENEXT: "Sp", C_ONORE: "Sp", C_GOAL: None}
# actions
A_EXPLORE, A_RETURN, A_SIDESTEP, A_GOTOORE, A_DRILL, A_WAIT = range(6)
ACT_NAMES = {A_EXPLORE: "Explore", A_RETURN: "Return and charge", A_SIDESTEP: "Sidestep",
             A_GOTOORE: "Go to ore", A_DRILL: "Drill", A_WAIT: "Wait"}
ACT_SENSOR = {A_GOTOORE: "Sp"}

SENSORS = ["Di", "Du", "Sp", "Ca"]
COMBOS = [("Di", "Du", "Sp"), ("Di", "Du", "Ca"), ("Di", "Sp", "Ca"), ("Du", "Sp", "Ca")]

def combo_name(combo):
    return "+".join(combo)

def rule_str(rule):
    c, n, a = rule
    cs = COND_NAMES[c].format(n=n)
    return f"IF {cs} THEN {ACT_NAMES[a]}"

def prog_str(prog):
    if not prog:
        return "(no rules)"
    return " | ".join(f"{i+1}. {rule_str(r)}" for i, r in enumerate(prog))

def legal(prog, combo):
    if len(prog) > 4:
        return False
    for c, n, a in prog:
        s = COND_SENSOR[c]
        if s is not None and s not in combo:
            return False
        s = ACT_SENSOR.get(a)
        if s is not None and s not in combo:
            return False
    return True

# ---- outcomes ----
WIN, CR, B0, ST_NOMOVE, ST_CHARGE2, ST_CIRCLE, TU = "WIN", "CR", "B0", "ST_nomove", "ST_charge2", "ST_circle", "TU"

class Result:
    __slots__ = ("outcome", "turns", "tiles", "cargo", "charges", "fired", "where", "crater_faceup",
                 "edit", "moves", "max_dist", "tiles_at_end_of_first_trip", "goal_met_turn")

    def row(self):
        return dict(outcome=self.outcome, turns=self.turns, tiles=self.tiles, cargo=self.cargo,
                    charges=self.charges, where=self.where, crater_faceup=int(self.crater_faceup),
                    edit=self.edit, moves=self.moves, max_dist=self.max_dist,
                    goal_met_turn=self.goal_met_turn if self.goal_met_turn is not None else "",
                    fired="/".join(str(x) for x in self.fired))


def run_v1(prog, combo, terrain=None, stuck_mode="literal", edit_mode="none", edit_turn=None,
        max_turns=500, trace=False, heur_n=6):
    """Simulate one run.

    stuck_mode:
      'literal'  : circles = the same (tile, facing) comes up 3 times in the run (AMBIG-08).
      'progress' : circles = the same (tile, facing) comes up 3 times with no new tile
                   flipped and no ore drilled in between.
      'none'     : no circles rule (only the 3-idle-turn and double-charge rules, plus the turn cap).
    edit_mode:
      'none'     : uplink unused.
      'mid'      : heuristic edit applied between turns edit_turn and edit_turn+1 (see heuristic_edit).
      'home'     : the moment the goal is met away from the lander, rewrite the top rule that
                   is not 'Crater in front' as 'Always -> Return and charge' ("call it home").
    """
    if terrain is None:
        terrain = KIT_TERRAIN
    prog = list(prog)
    has_cam = "Ca" in combo
    pos = LANDER; facing = 0; batt = 20; cargo = 0
    scanned = 0
    ore_mask = 0
    for p in range(N_TILES):
        if terrain[p] == ORE:
            ore_mask |= 1 << p
    ALL = (1 << N_TILES) - 1
    charge_left = 0          # remaining charge turns after this one
    charged_since_move = False
    nomove = 0
    circ = {}
    turn = 0
    charges = 0
    moves = 0
    max_dist = 0
    fired = [0] * 5          # index 4 = no rule matched
    edit_used = ""
    goal_met_turn = None
    tr = [] if trace else None
    res = Result()
    res.crater_faceup = False
    outcome = None; where = ""

    while True:
        # ---- uplink edits happen between turns ----
        if edit_mode == "mid" and not edit_used and turn == edit_turn:
            newp, desc = heuristic_edit(prog, combo, scanned.bit_count(), cargo, pos, batt, heur_n)
            if newp is not None:
                prog = newp; edit_used = f"t{turn}:{desc}"
        if edit_mode == "home" and not edit_used and goal_met_turn is not None and pos != LANDER:
            i = _first_non_crater(prog)
            prog = _overwrite_or_append(prog, i, (C_ALWAYS, 0, A_RETURN))
            edit_used = f"t{turn}:rule{i+1}=Always->Return"
        if turn >= max_turns:
            outcome = TU; where = name(pos); break
        turn += 1
        # 1. charging?
        if charge_left > 0:
            charge_left -= 1
            if charge_left == 0:
                batt = 20
            if trace: tr.append((turn, name(pos), facing, batt, "charging"))
            continue
        # 2. check rules top to bottom
        unscanned = ALL & ~scanned
        act = None; slot = 4
        for i, (c, n, a) in enumerate(prog):
            if c == C_ALWAYS:
                ok = True
            elif c == C_BATT:
                ok = batt < n
            elif c == C_CRATER:
                f = STEP[pos][facing]
                ok = f is not None and f != LANDER and terrain[f] == CRATER
            elif c == C_DUST:
                ok = pos != LANDER and terrain[pos] == DUST
            elif c == C_ORENEXT:
                ok = (NBM[pos] & ore_mask) != 0
            else:  # C_ONORE
                ok = pos != LANDER and (ore_mask >> pos) & 1 == 1
            if ok:
                act = a; slot = i; break
        fired[slot] += 1
        # 4. do the action
        moved_to = None
        drilled = False
        started_charge = False
        turned = False
        if act == A_EXPLORE or act == A_RETURN:
            if act == A_RETURN and pos == LANDER:
                if charged_since_move:
                    outcome = ST_CHARGE2; where = name(pos); break
                started_charge = True
            else:
                if act == A_EXPLORE:
                    if unscanned == 0:
                        dfun = None   # AMBIG-13: nothing left to explore; do nothing
                    else:
                        def dfun(p, _u=unscanned):
                            for k, m in enumerate(RINGS[p]):
                                if m & _u:
                                    return k
                            return 999
                else:
                    dfun = DL.__getitem__
                if dfun is not None:
                    d0 = dfun(pos)
                    f = STEP[pos][facing]
                    if f is not None and dfun(f) < d0:
                        moved_to = f
                    else:
                        for nd in ((facing + 1) % 4, (facing + 3) % 4, (facing + 2) % 4):
                            q = STEP[pos][nd]
                            if q is not None and dfun(q) < d0:
                                facing = nd; turned = True; break
        elif act == A_SIDESTEP:
            q = SIDE[pos][(facing + 1) % 4]
            if q is None:
                q = SIDE[pos][(facing + 3) % 4]
            moved_to = q        # may be None (only on the lander): no move (AMBIG-04)
        elif act == A_GOTOORE:
            for nd in (facing, (facing + 1) % 4, (facing + 3) % 4, (facing + 2) % 4):
                q = STEP[pos][nd]
                if q is not None and q != LANDER and (ore_mask >> q) & 1:
                    moved_to = q; facing = nd; break
        elif act == A_DRILL:
            batt = max(0, batt - 2)
            if pos != LANDER and (ore_mask >> pos) & 1:
                ore_mask &= ~(1 << pos); cargo += 1; drilled = True
                if goal_met_turn is None and cargo >= 3:
                    goal_met_turn = turn
        # A_WAIT / None: nothing

        if started_charge:
            charges += 1
            charge_left = 2
            charged_since_move = True
            if trace: tr.append((turn, name(pos), facing, batt, f"rule{slot+1}:charge"))
            continue
        if moved_to is not None:
            cost = 2 if (moved_to != LANDER and terrain[moved_to] == DUST) else 1
            batt = max(0, batt - cost)
            pos = moved_to
            moves += 1
            nomove = 0
            charged_since_move = False
            if pos != LANDER:
                max_dist = max(max_dist, DL[pos])
            # 5. scan
            before = scanned
            if has_cam:
                scanned |= CAM[pos]          # AMBIG-10: camera also fires after a move onto the lander
            elif pos != LANDER:
                scanned |= 1 << pos
            if goal_met_turn is None and scanned.bit_count() >= 30:
                goal_met_turn = turn
            progressed = scanned != before
        else:
            nomove += 1
            progressed = False
        if trace: tr.append((turn, name(pos), facing, batt, f"rule{slot+1 if slot < 4 else '-'}:{ACT_NAMES.get(act, 'none')}"))
        # 6. check the result
        if pos != LANDER and terrain[pos] == CRATER:
            outcome = CR; where = name(pos)
            res.crater_faceup = bool((before >> pos) & 1) if moved_to is not None else False
            break
        if batt == 0 and pos != LANDER:
            outcome = B0; where = name(pos); break
        if pos == LANDER and (scanned.bit_count() >= 30 or cargo >= 3):
            outcome = WIN; where = name(pos); break
        # stuck checks
        if nomove >= 3:
            outcome = ST_NOMOVE; where = name(pos); break
        if stuck_mode != "none" and (moved_to is not None or turned):
            key = (pos, facing)
            if stuck_mode == "progress" and progressed:
                circ = {}
            cnt = circ.get(key, 0) + 1
            circ[key] = cnt
            if cnt >= 3:
                outcome = ST_CIRCLE; where = name(pos); break
        elif stuck_mode == "progress" and drilled:
            circ = {}

    res.outcome = outcome; res.turns = turn; res.tiles = scanned.bit_count(); res.cargo = cargo
    res.charges = charges; res.fired = fired; res.where = where; res.edit = edit_used
    res.moves = moves; res.max_dist = max_dist; res.goal_met_turn = goal_met_turn
    if trace:
        return res, tr
    return res


def heuristic_edit(prog, combo, tiles, cargo, pos, batt, heur_n=6):
    """The 'simple heuristic' uplink edit used at the midpoint. What an engineer
    looking at the table would plausibly do with their one edit:
      1. Goal already met (30 face-up or 3 ore) and rover away from the lander:
         rewrite the top rule that is not 'Crater in front' as 'Always -> Return and charge'
         (call it home, keeping any crater guard above it).
      2. Otherwise, if no rule can bring it home (no 'Return and charge' action):
         write 'Battery below heur_n -> Return and charge' into the first empty slot if there
         is no Always rule above it, otherwise over the top-most rule that is neither
         'Crater in front' nor 'Always'.
      3. Otherwise leave the program alone (uplink unused).
    Returns (new_prog or None, description)."""
    p = list(prog)
    if (tiles >= 30 or cargo >= 3) and pos != LANDER:
        i = _first_non_crater(p)
        return _overwrite_or_append(p, i, (C_ALWAYS, 0, A_RETURN)), f"rule{i+1}=Always->Return"
    if not any(a == A_RETURN for _, _, a in p):
        r = (C_BATT, heur_n, A_RETURN)
        if len(p) < 4 and not any(c == C_ALWAYS for c, _, _ in p):
            return p + [r], f"rule{len(p)+1}=Batt<{heur_n}->Return"
        for i, (c, n, a) in enumerate(p):
            if c != C_CRATER and c != C_ALWAYS:
                return _overwrite(p, i, r), f"rule{i+1}=Batt<{heur_n}->Return"
        return None, ""
    return None, ""


def _first_non_crater(p):
    for i, (c, n, a) in enumerate(p):
        if c != C_CRATER:
            return i
    return len(p)


def _overwrite_or_append(p, i, r):
    q = list(p)
    if i < len(q):
        q[i] = r
    elif len(q) < 4:
        q.append(r)
    return q


def _overwrite(p, i, r):
    q = list(p)
    q[i] = r
    return q


KIT_TERRAIN = kit_terrain()
CRATER_MASKS = {}


def run(prog, combo, terrain=None, rules="v1", **kw):
    """Dispatch: rules="v1" (the original kit, default so the v1 scripts reproduce) or "v2" (the fixed kit)."""
    if rules == "v1":
        return run_v1(prog, combo, terrain=terrain, **kw)
    kw.pop("stuck_mode", None)
    if rules == "v2t":          # v2 plus the one tuning pass: detour around face-up craters
        kw.setdefault("detour", True)
    if rules == "v3":           # kit v3: 25-tile goal, camera is map knowledge only (face-up craters stop Explore only)
        kw.setdefault("goal_tiles", 25)
        kw.setdefault("cam_block", "explore")
    if rules == "v31":          # kit v3.1: v3 with a 20-tile goal
        kw.setdefault("goal_tiles", 20)
        kw.setdefault("cam_block", "explore")
    return run_v2(prog, combo, terrain=terrain, **kw)


def run_v2(prog, combo, terrain=None, edit_mode="none", edit_turn=None, max_turns=500,
           trace=False, heur_n=6, cam_avoid=True, ore_goal=3, goal_tiles=30, detour=False,
           cam_block="all"):
    """Simulate one run under the v2 kit (paper-test kit after the bot-playtest fixes).

    Differences from v1 (see report.md, 'v2 kit'):
      * Condition 'Goal met' (no sensor needed): true once the goal is satisfied
        (goal_tiles face-up tiles that aren't craters, or ore_goal ore in cargo).
      * Camera: after each move onto a tile, peek at the 3 x 3 around the rover; craters are turned
        face up, everything else goes back face down. So the tile count (face-up tiles that
        aren't craters) only counts tiles the rover drove onto. Moving onto the lander doesn't
        trigger the camera.
      * No action moves the rover onto a face-up crater: Explore and Return and charge treat it like
        the map edge (never closer), Sidestep doesn't move. (cam_avoid=False switches this off, for testing.)
      * Explore heads for the nearest face-down tile; a step counts as closer if it gets nearer to any of
        the tied nearest ones.
      * Go to ore: move onto the first adjacent undrilled ore (front, right, left, back) and drill it
        in the same turn: 1 to move + 2 to drill.
      * Stuck (circling): the rover ends a move or a turn on the same square facing the same way for the
        3rd time since it last drove onto a face-down tile or drilled ore. Stuck (idle): 3 turns in a row
        without moving; turning in place counts as not moving; charging turns are skipped (they
        neither count nor reset). Stuck (charge): charging twice in a row without leaving the lander.
      * Lander touches only F12. Sidestep treats the lander as off the map (never moves onto or off it).
      * cam_block="explore" (rules "v3"): a face-up crater only stops Explore (it never steps onto one).
        Return and charge and Sidestep can drive into it and the rover is lost as usual.
      * detour=True (rules "v2t", the tuning pass): if Explore or Return and charge finds no closer step
        and a face-up crater ruled out at least one closer step, the rover sidesteps instead (right,
        else left; never onto the lander or a face-up crater), keeping its facing.
    """
    if terrain is None:
        terrain = KIT_TERRAIN
    key_t = id(terrain)
    cm = CRATER_MASKS.get(key_t)
    if cm is None or cm[0] is not terrain:
        m = 0; om = 0
        for p in range(N_TILES):
            if terrain[p] == CRATER: m |= 1 << p
            elif terrain[p] == ORE: om |= 1 << p
        cm = (terrain, m, om); CRATER_MASKS[key_t] = cm
    crater_mask = cm[1]; ore_mask = cm[2]
    prog = list(prog)
    has_cam = "Ca" in combo
    pos = LANDER; facing = 0; batt = 20; cargo = 0
    faceup = 0                      # face-up tiles (driven tiles + camera craters)
    ALL = (1 << N_TILES) - 1
    NONCR = ALL & ~crater_mask
    charge_left = 0
    charged_since_move = False
    nomove = 0
    circ = {}
    turn = 0; charges = 0; moves = 0; max_dist = 0
    fired = [0] * 5
    edit_used = ""
    goal_met_turn = None
    tr = [] if trace else None
    res = Result(); res.crater_faceup = False
    outcome = None; where = ""
    tiles = 0

    while True:
        goal = tiles >= goal_tiles or cargo >= ore_goal
        if edit_mode == "mid" and not edit_used and turn == edit_turn:
            newp, desc = heuristic_edit(prog, combo, tiles if tiles < goal_tiles else 30, cargo if cargo < ore_goal else 3, pos, batt, heur_n)
            if newp is not None:
                prog = newp; edit_used = f"t{turn}:{desc}"
        if edit_mode == "home" and not edit_used and goal and pos != LANDER:
            i = _first_non_crater(prog)
            prog = _overwrite_or_append(prog, i, (C_ALWAYS, 0, A_RETURN))
            edit_used = f"t{turn}:rule{i+1}=Always->Return"
        if turn >= max_turns:
            outcome = TU; where = name(pos); break
        turn += 1
        if charge_left > 0:
            charge_left -= 1
            if charge_left == 0:
                batt = 20
            if trace: tr.append((turn, name(pos), facing, batt, "charging"))
            continue
        act = None; slot = 4
        for i, (c, n, a) in enumerate(prog):
            if c == C_ALWAYS:
                ok = True
            elif c == C_BATT:
                ok = batt < n
            elif c == C_GOAL:
                ok = goal
            elif c == C_CRATER:
                f = STEP[pos][facing]
                ok = f is not None and f != LANDER and terrain[f] == CRATER
            elif c == C_DUST:
                ok = pos != LANDER and terrain[pos] == DUST
            elif c == C_ORENEXT:
                ok = (NBM[pos] & ore_mask) != 0
            else:  # C_ONORE
                ok = pos != LANDER and (ore_mask >> pos) & 1 == 1
            if ok:
                act = a; slot = i; break
        fired[slot] += 1
        moved_to = None; drilled = False; started_charge = False; turned = False
        blocked = (faceup & crater_mask) if cam_avoid else 0
        if cam_block == "explore" and act != A_EXPLORE:
            blocked = 0
        if act == A_EXPLORE or act == A_RETURN:
            if act == A_RETURN and pos == LANDER:
                if charged_since_move:
                    outcome = ST_CHARGE2; where = name(pos); break
                started_charge = True
            else:
                if act == A_EXPLORE:
                    fd = ALL & ~faceup
                    if fd == 0:
                        dfun = None
                    else:
                        def dfun(p, _u=fd):
                            for k, m in enumerate(RINGS[p]):
                                if m & _u:
                                    return k
                            return 999
                else:
                    dfun = DL.__getitem__
                if dfun is not None:
                    d0 = dfun(pos)
                    f = STEP[pos][facing]
                    if f is not None and not (f != LANDER and (blocked >> f) & 1) and dfun(f) < d0:
                        moved_to = f
                    else:
                        for nd in ((facing + 1) % 4, (facing + 3) % 4, (facing + 2) % 4):
                            q = STEP[pos][nd]
                            if q is not None and not (q != LANDER and (blocked >> q) & 1) and dfun(q) < d0:
                                facing = nd; turned = True; break
                        if detour and not turned:
                            # was a closer step ruled out by a face-up crater?
                            cut = False
                            for nd in range(4):
                                q = STEP[pos][nd]
                                if q is not None and q != LANDER and (blocked >> q) & 1 and dfun(q) < d0:
                                    cut = True; break
                            if cut:
                                for sd in ((facing + 1) % 4, (facing + 3) % 4):
                                    q = SIDE[pos][sd]
                                    if q is not None and not (blocked >> q) & 1:
                                        moved_to = q; break
        elif act == A_SIDESTEP:
            q = SIDE[pos][(facing + 1) % 4]
            if q is None:
                q = SIDE[pos][(facing + 3) % 4]
            if q is not None and (blocked >> q) & 1:
                q = None
            moved_to = q
        elif act == A_GOTOORE:
            for nd in (facing, (facing + 1) % 4, (facing + 3) % 4, (facing + 2) % 4):
                q = STEP[pos][nd]
                if q is not None and q != LANDER and (ore_mask >> q) & 1:
                    moved_to = q; facing = nd; break
        elif act == A_DRILL:
            batt = max(0, batt - 2)
            if pos != LANDER and (ore_mask >> pos) & 1:
                ore_mask &= ~(1 << pos); cargo += 1; drilled = True

        if started_charge:
            charges += 1; charge_left = 2; charged_since_move = True
            if trace: tr.append((turn, name(pos), facing, batt, f"rule{slot+1}:charge"))
            continue
        progressed = False
        if moved_to is not None:
            cost = 2 if (moved_to != LANDER and terrain[moved_to] == DUST) else 1
            batt = max(0, batt - cost)
            pos = moved_to; moves += 1; nomove = 0; charged_since_move = False
            if pos != LANDER:
                max_dist = max(max_dist, DL[pos])
                bit = 1 << pos
                before_fu = faceup
                if not faceup & bit:
                    progressed = True
                    faceup |= bit
                    if not crater_mask & bit:
                        tiles += 1
                if act == A_GOTOORE:          # Go to ore drills on arrival
                    batt = max(0, batt - 2)
                    ore_mask &= ~bit; cargo += 1; drilled = True
                if has_cam:
                    faceup |= CAM[pos] & crater_mask
        else:
            nomove += 1
        if goal_met_turn is None and (tiles >= goal_tiles or cargo >= ore_goal):
            goal_met_turn = turn
        if trace: tr.append((turn, name(pos), facing, batt, f"rule{slot+1 if slot < 4 else '-'}:{ACT_NAMES.get(act, 'none')}"))
        if pos != LANDER and terrain[pos] == CRATER:
            outcome = CR; where = name(pos)
            res.crater_faceup = bool((before_fu >> pos) & 1)
            break
        if batt == 0 and pos != LANDER:
            outcome = B0; where = name(pos); break
        if pos == LANDER and (tiles >= goal_tiles or cargo >= ore_goal):
            outcome = WIN; where = name(pos); break
        if nomove >= 3:
            outcome = ST_NOMOVE; where = name(pos); break
        if progressed or drilled:
            circ = {}
        if moved_to is not None or turned:
            key = (pos, facing)
            cnt = circ.get(key, 0) + 1
            circ[key] = cnt
            if cnt >= 3:
                outcome = ST_CIRCLE; where = name(pos); break

    res.outcome = outcome; res.turns = turn; res.tiles = tiles; res.cargo = cargo
    res.charges = charges; res.fired = fired; res.where = where; res.edit = edit_used
    res.moves = moves; res.max_dist = max_dist; res.goal_met_turn = goal_met_turn
    if trace:
        return res, tr
    return res
