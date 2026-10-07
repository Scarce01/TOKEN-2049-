"""Prevention vs honest impact for rule R2 (amount > L_pub and new recipient -> delay), docs/47 section 2.

Inputs (public on-chain): datasets/public/h0_binance_2026-09.json single-withdrawal percentiles,
datasets/public/bitget_2026-09.json theft transfers. Tail between percentiles: log-log interpolation.
Assumption: the new-recipient share of large withdrawals equals the overall first_seen_share.
Output: analysis/out/risk_tradeoff.json
"""
import json
import math
import os

ROOT = os.path.join(os.path.dirname(__file__), '..')
h0 = json.load(open(os.path.join(ROOT, 'datasets/public/h0_binance_2026-09.json'), encoding='utf-8'))
sw = h0['single_withdrawal']
THEFT = {'stable': [34.75e6, 12.85e6], 'eth': [7130.86, 13965.93, 1879.20, 1395.90]}  # USD, ETH
GRID = {'stable': [3e5, 1e6, 4e6, 1e7], 'eth': [400, 1000, 1300, 5000]}


def tail(q, x):
    pts = [(0.5, q['p50']), (0.9, q['p90']), (0.99, q['p99']), (0.999, q['p999']), (0.9999, q['p9999'])]
    if x <= pts[0][1]:
        return 0.5
    for (p1, a1), (p2, a2) in zip(pts, pts[1:]):
        if a1 <= x <= a2:
            t1, t2 = math.log10(1 - p1), math.log10(1 - p2)
            return 10 ** (t1 + (t2 - t1) * (math.log10(x) - math.log10(a1)) / (math.log10(a2) - math.log10(a1)))
    return (1 - pts[-1][0]) * pts[-1][1] / x


rows = []
for kind in ('stable', 'eth'):
    q = sw[kind]
    for L in GRID[kind]:
        honest = tail(q, L)
        caught = [a for a in THEFT[kind] if a > L]
        rows.append({
            'asset': kind, 'threshold': L,
            'honest_over_threshold': round(honest, 6),
            'honest_delayed_new_recipient_only': round(honest * q['first_seen_share'], 6),
            'theft_caught': f'{len(caught)}/{len(THEFT[kind])}',
            'theft_value_caught': round(sum(caught) / sum(THEFT[kind]), 4),
        })


def combined(ls, le):
    s, e = sw['stable'], sw['eth']
    f = s['n'] * tail(s, ls) * s['first_seen_share'] + e['n'] * tail(e, le) * e['first_seen_share']
    return f / (s['n'] + e['n'])


per_day = (sw['stable']['n'] + sw['eth']['n']) / 30
rec = combined(4e6, 1300)
out = {
    'source': 'public_onchain (percentiles, theft list) + assumed (new-recipient share of large withdrawals)',
    'rows': rows,
    'recommended': {'stable_usd': 4e6, 'eth': 1300, 'honest_delayed': round(rec, 6),
                    'honest_delayed_per_day': round(rec * per_day, 1), 'withdrawals_per_day': round(per_day)},
    'detection_lag_minutes_bitget': 7,
}
os.makedirs(os.path.join(ROOT, 'analysis/out'), exist_ok=True)
json.dump(out, open(os.path.join(ROOT, 'analysis/out/risk_tradeoff.json'), 'w', encoding='utf-8', newline='\n'), indent=2)
print(json.dumps(out['recommended']))
for r in rows:
    print(r)
