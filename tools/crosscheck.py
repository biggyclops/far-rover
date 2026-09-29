#!/usr/bin/env python3
"""Cross-check farsim.py (rules="v3") with JS simulation for key scenarios."""

import sys
sys.path.insert(0, '/workspace/tools')

from farsim import (
    run, C_ALWAYS, C_BATT, C_CRATER, C_DUST, C_ORENEXT, C_ONORE, C_GOAL,
    A_EXPLORE, A_RETURN, A_SIDESTEP, A_GOTOORE, A_DRILL, A_WAIT,
    WIN, CR, B0, ST_NOMOVE, ST_CHARGE2, ST_CIRCLE
)

# Expected values matching both farsim (rules="v3") and JS simulation
JS_EXPECTED = {
    # Scenario A: Camera build, Always->Explore
    'A': {
        'combo': ('Di', 'Sp', 'Ca'),
        'prog': [(C_ALWAYS, 0, A_EXPLORE)],
        'expected': {'outcome': B0, 'turns': 25, 'tiles': 17, 'where': 'J11'}
    },
    # First-minute story: Di+Du+Sp, Always->Explore (no camera, hits crater)
    'first_minute': {
        'combo': ('Di', 'Du', 'Sp'),
        'prog': [(C_ALWAYS, 0, A_EXPLORE)],
        'expected': {'outcome': CR, 'turns': 5, 'tiles': 4, 'where': 'F8'}
    },
    # Scenario E: ore program with Goal met -> Return
    'E': {
        'combo': ('Di', 'Sp', 'Ca'),
        'prog': [
            (C_BATT, 8, A_RETURN),
            (C_GOAL, 0, A_RETURN),
            (C_ORENEXT, 0, A_GOTOORE),
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
    # Scenario I: Return drives into camera-revealed crater
    'I': {
        'combo': ('Di', 'Sp', 'Ca'),
        'prog': [
            (C_BATT, 11, A_RETURN),
            (C_ALWAYS, 0, A_EXPLORE)
        ],
        'expected': {'outcome': CR, 'turns': 40, 'tiles': 25, 'where': 'F8', 'goal_met_turn': 39}
    }
}

def main():
    print("=" * 60)
    print("FARSIM.PY CROSS-CHECK (rules='v3')")
    print("=" * 60)
    
    all_match = True
    for name, scenario in JS_EXPECTED.items():
        print(f"\n--- {name} ---")
        combo = scenario['combo']
        prog = scenario['prog']
        
        result = run(prog, combo, rules="v3")
        
        expected = scenario.get('expected', {})
        mismatches = []
        for key, exp_val in expected.items():
            actual = getattr(result, key)
            if actual != exp_val:
                mismatches.append(f"{key}: expected {exp_val}, got {actual}")
        
        status = "✓" if not mismatches else "❌"
        print(f"  {status} outcome={result.outcome}, turns={result.turns}, tiles={result.tiles}, cargo={result.cargo}, where={result.where}")
        if mismatches:
            print(f"     MISMATCH: {'; '.join(mismatches)}")
            all_match = False
    
    print("\n" + "=" * 60)
    if all_match:
        print("ALL SCENARIOS MATCH")
    else:
        print("SOME SCENARIOS HAVE MISMATCHES")
    print("=" * 60)
    
    return all_match

if __name__ == "__main__":
    import sys
    sys.exit(0 if main() else 1)
