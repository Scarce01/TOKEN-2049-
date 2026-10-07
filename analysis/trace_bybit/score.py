"""Scoring against the FBI Bybit list (positives only, incomplete). Integers and exact fractions only."""

from fractions import Fraction


def recall_denominator(fbi, seeds):
    """FBI addresses we are asked to discover: the list minus seeds that are already on it."""
    fbi_l = {a.lower() for a in fbi}
    return len(fbi_l - {s.lower() for s in seeds})


def score(result_nodes, fbi, seeds, max_hop, tau_ppm=0, min_tainted=0):
    """result_nodes: {addr: {"hop": int, "taint_ppm": int, ...}} from trace_core.Result.as_json()['nodes'].
    An address counts as flagged when it is within max_hop, its own taint is at least tau, and it is not a
    breakpoint (a DEX pool or an exchange is where tracing stops, not a suspect)."""
    fbi_l = {a.lower() for a in fbi}
    seeds_l = {s.lower() for s in seeds}
    flagged = {
        a.lower(): n
        for a, n in result_nodes.items()
        if a.lower() not in seeds_l
        and n["hop"] <= max_hop
        and n["taint_ppm"] >= tau_ppm
        and int(n.get("tainted_in", 0)) >= min_tainted
        and not n.get("breakpoint")
    }
    found = sorted(a for a in flagged if a in fbi_l)
    denom = recall_denominator(fbi_l, seeds_l)
    return {
        "max_hop": max_hop,
        "tau_ppm": tau_ppm,
        "min_tainted": str(min_tainted),
        "flagged": len(flagged),
        "found_fbi": found,
        "recall": str(Fraction(len(found), denom)) if denom else "n/a",
        "recall_pct": round(100 * len(found) / denom, 2) if denom else None,
        "recall_denominator": denom,
        "precision_lower_bound_pct": round(100 * len(found) / len(flagged), 2) if flagged else None,
    }
