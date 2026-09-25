#!/usr/bin/env python3
"""Independent derivation of the performance fixture vectors (B13).

This script does not share code with `@markov/analytics`. It re-derives the
methodology of docs/markov/accounting-methodology.md ("Valuation and
performance") with Python fractions and writes performance-vectors.json,
which packages/analytics/test/analytics.test.ts replays against the
implementation. Re-run it after changing a scenario:

    python3 packages/analytics/fixtures/derive-vectors.py

Rounding is round-half-to-even (Python's `round` on a Fraction), values are
reported with 6 decimals, returns and ratios with 8.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from fractions import Fraction
from pathlib import Path

DAY = timedelta(days=1)
MAX_AGE = timedelta(hours=24)
VALUE_SCALE = 6
RETURN_SCALE = 8
PRECEDENCE = ["secondary_market", "issuer_mark", "underlying_equity"]

USDC = "FixtureStab1ecoin11111111111111111111111111"
A = "FixtureTokenA1111111111111111111111111111111"
B = "FixtureTokenB1111111111111111111111111111111"
SOL = "SOL"


def t(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(timezone.utc)


def iso(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def dec(value: Fraction, scale: int) -> str:
    unscaled = round(value * 10**scale)
    negative = unscaled < 0
    digits = str(abs(unscaled)).rjust(scale + 1, "0")
    whole, fraction = digits[: len(digits) - scale], digits[len(digits) - scale :]
    text = whole if scale == 0 else f"{whole}.{fraction}"
    return f"-{text}" if negative and unscaled != 0 else text


def rounded(value: Fraction, scale: int) -> Fraction:
    return Fraction(dec(value, scale))


class Prices:
    def __init__(self, observations, stablecoin):
        self.observations = observations
        self.stablecoin = stablecoin

    def at(self, asset: str, when: datetime):
        """(value, caveats) or (None, issue code)."""
        mine = [o for o in self.observations if o["asset"] == asset and t(o["observedAt"]) <= when]
        stale = False
        for kind in PRECEDENCE:
            candidates = [o for o in mine if o["kind"] == kind]
            if not candidates:
                continue
            latest = max(candidates, key=lambda o: t(o["observedAt"]))
            if latest["unit"] != "USD":
                continue
            if when - t(latest["observedAt"]) > MAX_AGE:
                stale = True
                continue
            caveats = ["underlying_as_token_price"] if kind == "underlying_equity" else []
            value = Fraction(latest["value"])
            if asset == self.stablecoin and abs(value - 1) * 10000 > 50:
                caveats.append("stablecoin_depeg")
            return value, caveats
        if asset == self.stablecoin:
            return Fraction(1), ["stablecoin_par"]
        return None, ("stale_price" if stale else "no_observation")


def multiplier_at(asset_facts, when: datetime):
    if not asset_facts["scaled"]:
        return Fraction(1)
    best = None
    for point in asset_facts["multipliers"]:
        if t(point["effectiveAt"]) <= when and (best is None or t(point["effectiveAt"]) >= t(best["effectiveAt"])):
            best = point
    return None if best is None else Fraction(best["multiplier"])


def grid(start: datetime, end: datetime, extra):
    times = {start, end}
    midnight = datetime(start.year, start.month, start.day, tzinfo=timezone.utc) + DAY
    while midnight < end:
        times.add(midnight)
        midnight += DAY
    for moment in extra:
        if start <= moment <= end:
            times.add(moment)
    return sorted(times)


def value_at(assets, balances, when, prices):
    total = Fraction(0)
    issues = []
    caveats = set()
    for asset, raw in balances.items():
        if raw == 0:
            continue
        facts = assets[asset]
        m = multiplier_at(facts, when)
        if m is None:
            issues.append({"code": "multiplier_unknown", "asset": asset})
        price, extra = prices.at(asset, when)
        if price is None:
            issues.append({"code": extra, "asset": asset})
        else:
            caveats.update(extra)
        if raw < 0:
            issues.append({"code": "negative_quantity", "asset": asset})
        if not issues and m is not None and price is not None:
            total += Fraction(raw, 10 ** facts["decimals"]) * m * price
    if issues:
        return None, issues, sorted(caveats)
    return rounded(total, VALUE_SCALE), [], sorted(caveats)


def build_series(kind, assets, changes, prices, start, end, extra_caveats):
    changes = sorted(changes, key=lambda c: t(c["at"]))
    start = start or t(changes[0]["at"])
    flows = [c for c in changes if c["flow"] and start < t(c["at"]) <= end]
    points = []
    valued_flows = []
    prev_time = None
    prev_value = None
    prev_index = None
    prev_complete = False
    for when in grid(start, end, [t(c["at"]) for c in flows]):
        balances = {}
        for change in changes:
            if t(change["at"]) <= when:
                balances[change["asset"]] = balances.get(change["asset"], 0) + int(change["deltaRaw"])
        value, issues, caveats = value_at(assets, balances, when, prices)
        net_flow = Fraction(0)
        for change in flows:
            when_flow = t(change["at"])
            if (prev_time is None or when_flow > prev_time) and when_flow <= when:
                facts = assets[change["asset"]]
                m = multiplier_at(facts, when_flow)
                price, _ = prices.at(change["asset"], when_flow)
                if m is None or price is None:
                    net_flow = None
                    issues.append({"code": "unpriced_flow", "asset": change["asset"]})
                    flow_value = None
                else:
                    flow_value = rounded(Fraction(int(change["deltaRaw"]), 10 ** facts["decimals"]) * m * price, VALUE_SCALE)
                    if net_flow is not None:
                        net_flow += flow_value
                valued_flows.append({"at": change["at"], "value": None if flow_value is None else dec(flow_value, VALUE_SCALE)})
        complete = value is not None and net_flow is not None
        index = None
        if complete:
            if not points:
                index = Fraction(100)
            elif prev_complete and prev_value is not None:
                if prev_value <= 0:
                    issues.append({"code": "zero_base", "asset": None})
                    complete = False
                elif prev_index is not None:
                    index = prev_index * (value - net_flow) / prev_value
        points.append(
            {
                "at": iso(when),
                "value": None if value is None else dec(value, VALUE_SCALE),
                "complete": complete,
                "netFlow": None if net_flow is None else dec(net_flow, VALUE_SCALE),
                "index": None if index is None else dec(index, RETURN_SCALE),
                "issues": [issue["code"] for issue in issues],
                "caveats": sorted(set(caveats) | set(extra_caveats)),
                "_value": value,
                "_index": index,
                "_netFlow": net_flow,
            }
        )
        prev_time, prev_value, prev_index, prev_complete = when, value, index, complete
    return {"start": iso(start), "end": iso(end), "points": points, "flows": valued_flows}


def window(series, period_days, context):
    points = series["points"]
    last = points[-1]
    start_index = 0
    if period_days is not None:
        target = t(last["at"]) - timedelta(days=period_days)
        start_index = -1
        for position, point in enumerate(points):
            if t(point["at"]) <= target:
                start_index = position
        if start_index < 0:
            return {"available": False, "reasons": ["insufficient_history"], "start": None}
    window_points = points[start_index:]
    first = window_points[0]
    reasons = []
    chain_ok = True
    index = []
    current = Fraction(100)
    previous = None
    for point in window_points:
        if not point["complete"]:
            chain_ok = False
            reasons.append("unpriced_flow" if "unpriced_flow" in point["issues"] else "zero_base" if "zero_base" in point["issues"] else "incomplete_points")
            break
        if previous is not None:
            current = current * (point["_value"] - point["_netFlow"]) / previous
        index.append(current)
        previous = point["_value"]
    if not last["complete"] and "stale_price" in last["issues"]:
        reasons.append("stale_end")
    twr = None
    drawdown = None
    if chain_ok:
        twr = index[-1] / 100 - 1
        peak, peak_at, worst, worst_peak, worst_trough = index[0], first["at"], Fraction(0), first["at"], first["at"]
        for position, value in enumerate(index):
            point = window_points[position]
            if value > peak:
                peak, peak_at = value, point["at"]
            decline = (peak - value) / peak
            if decline > worst:
                worst, worst_peak, worst_trough = decline, peak_at, point["at"]
        drawdown = {"value": dec(worst, RETURN_SCALE), "peakAt": worst_peak, "troughAt": worst_trough}
    # Flows strictly after the window start, valued.
    span = t(last["at"]) - t(first["at"])
    flows = [f for f in series["flows"] if t(first["at"]) < t(f["at"]) <= t(last["at"])]
    net_flows = None
    mwr = None
    if all(f["value"] is not None for f in flows):
        net_flows = sum((Fraction(f["value"]) for f in flows), Fraction(0))
        if first["_value"] is not None and last["_value"] is not None and span > timedelta(0):
            weighted = sum((Fraction(f["value"]) * Fraction((t(last["at"]) - t(f["at"])) // timedelta(milliseconds=1), span // timedelta(milliseconds=1)) for f in flows), Fraction(0))
            denominator = first["_value"] + weighted
            if denominator > 0:
                mwr = (last["_value"] - first["_value"] - net_flows) / denominator
    trades = [Fraction(v) for at, v in context.get("trades", []) if t(first["at"]) <= t(at) <= t(last["at"])]
    traded = sum(trades, Fraction(0))
    average = None
    if all(p["complete"] for p in window_points):
        average = sum((p["_value"] for p in window_points), Fraction(0)) / len(window_points)
    realized = sum((Fraction(v) for at, v in context.get("realized", []) if t(first["at"]) < t(at) <= t(last["at"])), Fraction(0))
    fee_lamports = sum(l for at, l in context.get("fees", []) if t(first["at"]) < t(at) <= t(last["at"]))
    fee_value = "0" if fee_lamports == 0 else None
    if fee_lamports and context.get("solPriceAtEnd") is not None:
        fee_value = dec(Fraction(fee_lamports, 10**9) * Fraction(context["solPriceAtEnd"]), VALUE_SCALE)
    open_cost = context.get("openCost")
    unrealized = None
    if last["complete"] and open_cost is not None:
        unrealized = last["_value"] - Fraction(open_cost)
    complete_points = sum(1 for p in window_points if p["complete"])
    return {
        "start": first["at"],
        "end": last["at"],
        "available": chain_ok,
        "reasons": reasons,
        "timeWeightedReturn": None if twr is None else dec(twr, RETURN_SCALE),
        "moneyWeightedReturn": None if mwr is None else dec(mwr, RETURN_SCALE),
        "maxDrawdown": drawdown,
        "startValue": first["value"],
        "endValue": last["value"],
        "netFlows": None if net_flows is None else dec(net_flows, VALUE_SCALE),
        "turnover": None if average is None or average <= 0 else dec(traded / average, RETURN_SCALE),
        "tradedValue": dec(traded, VALUE_SCALE),
        "realizedPnl": None if context.get("model") else dec(realized, VALUE_SCALE),
        "unrealizedPnl": None if context.get("model") or unrealized is None else dec(unrealized, VALUE_SCALE),
        "fees": {"lamports": str(fee_lamports), "value": fee_value},
        "completeness": {
            "expectedPoints": len(window_points),
            "completePoints": complete_points,
            "ratio": dec(Fraction(complete_points, len(window_points)), RETURN_SCALE),
            "historyDays": (t(series["end"]) - t(series["start"])) // DAY,
            "endFresh": last["complete"],
        },
    }


def model_changes(legs, cash, prices, frozen_at, end):
    """Whole base units bought at the first grid time at or after the freeze where everything is priced."""
    for when in grid(frozen_at, end, []):
        changes = []
        ok = True
        for leg in legs:
            m = multiplier_at(leg["facts"], when)
            price, _ = prices.at(leg["facts"]["asset"], when)
            if m is None or price is None or price <= 0:
                ok = False
                break
            raw = round(Fraction(leg["weightBps"], 10000) * 10000 * 10 ** leg["facts"]["decimals"] / (price * m))
            changes.append({"at": iso(when), "asset": leg["facts"]["asset"], "deltaRaw": str(raw), "flow": None})
        if not ok:
            continue
        if cash:
            price, _ = prices.at(cash["facts"]["asset"], when)
            raw = round(Fraction(cash["weightBps"], 10000) * 10000 * 10 ** cash["facts"]["decimals"] / price)
            changes.append({"at": iso(when), "asset": cash["facts"]["asset"], "deltaRaw": str(raw), "flow": None})
        return when, changes
    return None, []


def facts(asset, symbol, decimals, scaled=False, multipliers=()):
    return {"asset": asset, "symbol": symbol, "decimals": decimals, "scaled": scaled, "multipliers": list(multipliers)}


def obs(asset, kind, value, at, unit="USD", source="fixture"):
    return {"asset": asset, "kind": kind, "value": value, "unit": unit, "observedAt": at, "source": source}


def change(at, asset, delta, flow=None):
    return {"at": at, "asset": asset, "deltaRaw": str(delta), "flow": flow}


def strip(series):
    return {
        "start": series["start"],
        "end": series["end"],
        "points": [{k: v for k, v in p.items() if not k.startswith("_")} for p in series["points"]],
        "flows": series["flows"],
    }


def scenario(id_, kind, assets, prices_obs, changes=None, legs=None, cash=None, start=None, end=None, frozen_at=None, context=None, periods=("all",), notes=""):
    prices = Prices(prices_obs, USDC)
    context = context or {}
    extra = ["model_buy_and_hold", "model_no_costs"] if kind == "model" else []
    if kind == "model":
        when, changes = model_changes(legs, cash, prices, t(frozen_at), t(end))
        start = iso(when) if when else None
        context = {**context, "model": True}
    series = build_series(kind, assets, changes, prices, t(start) if start else None, t(end), extra)
    windows = {period: window(series, None if period == "all" else int(period[:-1]), context) for period in periods}
    return {
        "id": id_,
        "notes": notes,
        "kind": kind,
        "assets": list(assets.values()),
        "observations": prices_obs,
        "legs": [{"asset": leg["facts"]["asset"], "weightBps": leg["weightBps"]} for leg in legs] if legs else None,
        "cash": {"asset": cash["facts"]["asset"], "weightBps": cash["weightBps"]} if cash else None,
        "frozenAt": frozen_at,
        "changes": changes if kind == "actual" else None,
        "start": start,
        "end": end,
        "context": {k: v for k, v in context.items() if k != "model"},
        "expected": {"series": strip(series), "windows": windows},
    }


def daily(asset, kind, first_day, days, price_of):
    return [obs(asset, kind, price_of(d), iso(t(first_day) + d * DAY)) for d in range(days + 1)]


usdc = facts(USDC, "USDC", 6)
a = facts(A, "FXA", 6)
b = facts(B, "XSB", 8, scaled=True, multipliers=[{"effectiveAt": "2026-07-01T00:00:00Z", "multiplier": "1", "source": "on_chain"}, {"effectiveAt": "2026-08-02T00:00:00Z", "multiplier": "2", "source": "corporate_action"}])
sol = facts(SOL, "SOL", 9)

scenarios = [
    scenario(
        "deposit-not-profit",
        "actual",
        {USDC: usdc},
        [],
        changes=[change("2026-08-01T00:00:00Z", USDC, 1_000_000_000, {"kind": "external_inflow", "ref": "entry:1"}), change("2026-08-02T00:00:00Z", USDC, 1_000_000_000, {"kind": "external_inflow", "ref": "entry:2"})],
        end="2026-08-03T00:00:00Z",
        periods=("all",),
        notes="Two deposits of 1,000 USDC at par. The valuation doubles, the time-weighted and money-weighted returns are exactly zero.",
    ),
    scenario(
        "price-return-with-deposit",
        "actual",
        {USDC: usdc, A: a},
        [obs(A, "secondary_market", "10.00", "2026-08-01T00:00:00Z"), obs(A, "secondary_market", "11.00", "2026-08-02T00:00:00Z"), obs(A, "secondary_market", "9.90", "2026-08-03T00:00:00Z")],
        changes=[
            change("2026-07-31T12:00:00Z", USDC, 100_000_000, {"kind": "external_inflow", "ref": "entry:1"}),
            change("2026-07-31T12:00:00Z", A, 10_000_000, {"kind": "external_inflow", "ref": "entry:2"}),
            change("2026-08-02T12:00:00Z", USDC, 500_000_000, {"kind": "external_inflow", "ref": "entry:3"}),
        ],
        start="2026-08-01T00:00:00Z",
        end="2026-08-03T00:00:00Z",
        periods=("all", "7d"),
        notes="10 FXA and 100 USDC, then a 500 USDC deposit at noon on day two between a rise and a fall. End value 699 against a start of 200, yet the time-weighted return is +3.37% and the money-weighted return is −0.31%.",
    ),
    scenario(
        "model-split",
        "model",
        {A: a, B: b, USDC: usdc},
        [obs(A, "issuer_mark", "20.00", "2026-08-01T00:00:00Z"), obs(A, "issuer_mark", "22.00", "2026-08-02T00:00:00Z"), obs(A, "issuer_mark", "21.00", "2026-08-03T00:00:00Z"), obs(B, "secondary_market", "50.00", "2026-08-01T00:00:00Z"), obs(B, "secondary_market", "25.00", "2026-08-02T00:00:00Z"), obs(B, "secondary_market", "26.00", "2026-08-03T00:00:00Z")],
        legs=[{"facts": a, "weightBps": 5000}, {"facts": b, "weightBps": 4000}],
        cash={"facts": usdc, "weightBps": 1000},
        frozen_at="2026-07-31T15:00:00Z",
        end="2026-08-03T00:00:00Z",
        notes="A 50/40/10 recipe; XSB splits 2:1 on day two (multiplier 1 → 2, price 50 → 25). The split changes nothing; the value moves only with prices.",
    ),
    scenario(
        "model-missing-observation",
        "model",
        {A: a, B: b, USDC: usdc},
        [obs(A, "issuer_mark", "20.00", "2026-08-01T00:00:00Z"), obs(A, "issuer_mark", "22.00", "2026-08-02T00:00:00Z"), obs(A, "issuer_mark", "21.00", "2026-08-03T00:00:00Z"), obs(B, "secondary_market", "50.00", "2026-07-31T12:00:00Z"), obs(B, "secondary_market", "26.00", "2026-08-03T00:00:00Z")],
        legs=[{"facts": a, "weightBps": 5000}, {"facts": b, "weightBps": 4000}],
        cash={"facts": usdc, "weightBps": 1000},
        frozen_at="2026-07-31T15:00:00Z",
        end="2026-08-03T00:00:00Z",
        notes="The same recipe with no XSB observation on day two: that point is stale, the chain breaks and no return is reported although the end value is known.",
    ),
    scenario(
        "model-stale-end",
        "model",
        {A: a, B: b, USDC: usdc},
        [obs(A, "issuer_mark", "20.00", "2026-08-01T00:00:00Z"), obs(A, "issuer_mark", "22.00", "2026-08-02T00:00:00Z"), obs(B, "secondary_market", "50.00", "2026-08-01T00:00:00Z"), obs(B, "secondary_market", "25.00", "2026-08-02T00:00:00Z"), obs(B, "secondary_market", "26.00", "2026-08-03T00:00:00Z")],
        legs=[{"facts": a, "weightBps": 5000}, {"facts": b, "weightBps": 4000}],
        cash={"facts": usdc, "weightBps": 1000},
        frozen_at="2026-07-31T15:00:00Z",
        end="2026-08-03T06:00:00Z",
        notes="FXA's last observation is 30 hours old at the end: the end point is incomplete and stale, so nothing is reported for the window.",
    ),
    scenario(
        "zero-base",
        "actual",
        {USDC: usdc},
        [],
        changes=[change("2026-08-01T00:00:00Z", USDC, 100_000_000, {"kind": "external_inflow", "ref": "entry:1"}), change("2026-08-02T00:00:00Z", USDC, -100_000_000, {"kind": "external_outflow", "ref": "entry:2"}), change("2026-08-03T00:00:00Z", USDC, 50_000_000, {"kind": "external_inflow", "ref": "entry:3"})],
        end="2026-08-03T00:00:00Z",
        notes="Everything withdrawn on day two and 50 deposited on day three: the chain cannot pass through a zero valuation, so the time-weighted return is not reported; Modified Dietz is zero.",
    ),
    scenario(
        "instance-trade",
        "actual",
        {USDC: usdc, A: a, SOL: sol},
        [obs(A, "secondary_market", "10.00", "2026-08-01T00:00:00Z"), obs(A, "secondary_market", "12.00", "2026-08-02T00:00:00Z"), obs(A, "secondary_market", "11.00", "2026-08-03T00:00:00Z"), obs(SOL, "secondary_market", "150.00", "2026-08-02T00:00:00Z")],
        changes=[
            change("2026-08-01T00:00:00Z", USDC, 100_000_000, {"kind": "contribution", "ref": "lot:1"}),
            change("2026-08-01T00:00:00Z", USDC, -100_000_000),
            change("2026-08-01T00:00:00Z", A, 10_000_000),
            change("2026-08-02T00:00:00Z", A, -4_000_000),
            change("2026-08-02T00:00:00Z", USDC, 48_000_000),
            change("2026-08-02T00:00:00Z", USDC, -48_000_000, {"kind": "withdrawal", "ref": "consumption:1"}),
        ],
        end="2026-08-03T00:00:00Z",
        context={"trades": [["2026-08-01T00:00:00Z", "100"], ["2026-08-02T00:00:00Z", "48"]], "realized": [["2026-08-02T00:00:00Z", "8"]], "openCost": "60", "fees": [["2026-08-02T00:00:00Z", 5000]], "solPriceAtEnd": "150.00"},
        notes="A strategy instance buys 10 FXA for 100 USDC, sells 4 at 12 (proceeds 48, FIFO cost 40) and holds 6 at 11. Price path 10 → 12 → 11 gives +10% time-weighted; the sale is a withdrawal, not a loss.",
    ),
    scenario(
        "model-long-a",
        "model",
        {A: a},
        daily(A, "secondary_market", "2026-07-01T00:00:00Z", 40, lambda d: dec(10 + Fraction(d, 10), 2)),
        legs=[{"facts": a, "weightBps": 10000}],
        cash=None,
        frozen_at="2026-07-01T00:00:00Z",
        end="2026-08-10T00:00:00Z",
        periods=("all", "30d"),
        notes="Forty days of daily observations rising 0.10 a day: rankable over 30 days.",
    ),
    scenario(
        "model-long-b",
        "model",
        {A: a},
        daily(A, "secondary_market", "2026-07-01T00:00:00Z", 40, lambda d: dec(10 + Fraction(d, 20), 2)),
        legs=[{"facts": a, "weightBps": 10000}],
        cash=None,
        frozen_at="2026-07-01T00:00:00Z",
        end="2026-08-10T00:00:00Z",
        periods=("all", "30d"),
        notes="Forty days rising 0.05 a day: rankable, behind model-long-a.",
    ),
]

output = Path(__file__).with_name("performance-vectors.json")
output.write_text(json.dumps({"methodologyVersion": "stocks-v1", "derivedBy": "derive-vectors.py (Python fractions, round half to even)", "scenarios": scenarios}, indent=2) + "\n")
print(f"wrote {output} with {len(scenarios)} scenarios")
