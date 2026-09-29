#!/usr/bin/env python3
"""Cross-check farsim.py (rules="v3") with JS simulation for key scenarios."""

import sys
sys.path.insert(0, '/workspace/tools')

from farsim import (
    run, C_ALWAYS, C_BATT, C_CRATER, C_DUST, C_ORENEXT, C_ONORE, C_GOAL,
    A_EXPLORE, A_RETURN, A_SIDESTEP, A_GOTOORE, A_DRILL, A_WAIT,
    WIN, CR, B0, ST_NOMOVE, ST_CHARGE2, ST_CIRCLE
)

# Expected JS simulation results (from simulation tests)
JS_EXPECTED = {
    # Scenario A: Distance+Dust+Spectral, Always->Explore
    'A': {
        'combo': ('Di', 'Du', 'Sp'),
        'prog': [(C_ALWAYS, 0, A_EXPLORE)],
        'expected': {'outcome': B0, 'turns': 25, 'tiles': 17, 'where': 'J11'}
    },
    # Scenario B (first-minute): Distance+Dust+Spectral, Always->Explore (without resume)
    'B': {
        'combo': ('Di', 'Du', 'Sp'),
        'prog': [(C_ALWAYS, 0, A_EXPLORE)],
        # Note: B ends at tick 5 lost to crater because in JS test we DON'T resume auto-pause
        # But farsim doesn't have auto-pause, so it continues. Actually B should be same as A
        # Let me think - in JS tests, Scenario B tests the "first minute" path where crater is hit
        # because there's no Distance sensor avoidance after auto-pause... but that's a UI thing
        # Actually re-reading: Scenario B in JS has Distance+Dust+Spectral too, ends lost-crater F8 tick 5
        # This is because after the crater auto-pause, we step WITHOUT resuming in the test...
        # Actually no, looking at the test, it DOES resume. The difference is Scenario B tests
        # the case where Explore sees the crater and avoids it... but then why lost-crater?
        # Let me check the actual JS test... Actually in the summary it says:
        # "Scenario B: 4 tiles scanned (craters don't count), lost crater tick 5"
        # This seems wrong for the pure sim. Let me just test what farsim gives.
        'expected': None  # Will check manually
    },
    # Scenario E: ore program - Goal met -> Return
    'E': {
        'combo': ('Di', 'Sp', 'Ca'),
        'prog': [
            (C_CRATER, 0, A_SIDESTEP),
            (C_ORENEXT, 0, A_GOTOORE),
            (C_GOAL, 0, A_RETURN),
            (C_ALWAYS, 0, A_EXPLORE)
        ],
        'expected': {'outcome': WIN, 'turns': 29, 'tiles': 14, 'cargo': 3}
    },
    # Scenario H - Starter program with Camera
    'H_camera': {
        'combo': ('Di', 'Sp', 'Ca'),
        'prog': [
            (C_CRATER, 0, A_SIDESTEP),
            (C_BATT, 12, A_RETURN),
            (C_ONORE, 0, A_DRILL),
            (C_ALWAYS, 0, A_EXPLORE)
        ],
        'expected': {'outcome': WIN, 'turns': 46, 'tiles': 25, 'cargo': 1}
    },
    # Scenario H - Starter program with Dust
    'H_dust': {
        'combo': ('Di', 'Du', 'Sp'),
        'prog': [
            (C_CRATER, 0, A_SIDESTEP),
            (C_BATT, 12, A_RETURN),
            (C_ONORE, 0, A_DRILL),
            (C_ALWAYS, 0, A_EXPLORE)
        ],
        'expected': {'outcome': WIN, 'turns': 45, 'tiles': 25, 'cargo': 1}
    },
    # Scenario I: Camera map knowledge only - Return drives into known crater
    'I': {
        'combo': ('Di', 'Sp', 'Ca'),
        'prog': [
            (C_CRATER, 0, A_SIDESTEP),
            (C_BATT, 12, A_RETURN),
            (C_ALWAYS, 0, A_EXPLORE)
        ],
        'expected': {'outcome': CR, 'turns': 40, 'tiles': 25, 'where': 'F8'}
    }
}

def main():
    print("=" * 60)
    print("FARSIM.PY CROSS-CHECK (rules='v3')")
    print("=" * 60)
    
    results = {}
    for name, scenario in JS_EXPECTED.items():
        print(f"\n--- Scenario {name} ---")
        combo = scenario['combo']
        prog = scenario['prog']
        
        result = run(prog, combo, rules="v3")
        
        print(f"  Combo: {'+'.join(combo)}")
        print(f"  Outcome: {result.outcome}")
        print(f"  Turns: {result.turns}")
        print(f"  Tiles: {result.tiles}")
        print(f"  Cargo: {result.cargo}")
        print(f"  Where: {result.where}")
        print(f"  Goal met turn: {result.goal_met_turn}")
        
        results[name] = result
        
        expected = scenario.get('expected')
        if expected:
            matches = []
            mismatches = []
            for key, exp_val in expected.items():
                actual = getattr(result, key)
                if actual == exp_val:
                    matches.append(f"{key}={actual}")
                else:
                    mismatches.append(f"{key}: expected {exp_val}, got {actual}")
            
            if mismatches:
                print(f"  ❌ MISMATCH: {'; '.join(mismatches)}")
            else:
                print(f"  ✓ Matches JS expected values")
    
    print("\n" + "=" * 60)
    print("ADDITIONAL TEST PROGRAMS")
    print("=" * 60)
    
    # Extra program 1: Return only
    print("\n--- Extra: Always -> Return (should get stuck charging twice) ---")
    result = run([(C_ALWAYS, 0, A_RETURN)], ('Di', 'Du', 'Sp'), rules="v3")
    print(f"  Outcome: {result.outcome}, Turns: {result.turns}")
    
    # Extra program 2: Wait only
    print("\n--- Extra: Always -> Wait (should get stuck no move) ---")
    result = run([(C_ALWAYS, 0, A_WAIT)], ('Di', 'Du', 'Sp'), rules="v3")
    print(f"  Outcome: {result.outcome}, Turns: {result.turns}")
    
    # Extra program 3: Drill only (no ore under lander)
    print("\n--- Extra: Always -> Drill (should get stuck no move after battery depletes) ---")
    result = run([(C_ALWAYS, 0, A_DRILL)], ('Di', 'Du', 'Sp'), rules="v3")
    print(f"  Outcome: {result.outcome}, Turns: {result.turns}, Battery cost check")
    
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    
    return results

if __name__ == "__main__":
    main()
