"""Цены по ступеням для выборки приложений.

Закрывает пробел отчёта 01: «цены по ступеням не замерены по листингам».

    python3 tools/fetch_pricing.py --sample 300 --min-installs 33
"""

import argparse
import json
import random
import sys
import time
import urllib.error
import urllib.request

BASE = "https://marketplace.atlassian.com/rest/2"
UA = "market-research/1.0 (personal marketplace research; low volume)"
TIERS = [10, 25, 50, 100, 200, 500, 1000]


FAILURES = []


def get(path, attempts=3):
    """JSON ресурса, либо None если ресурса нет (404).

    Отказ (410, 429, сеть) НЕ возвращает None молча: он попадает в FAILURES,
    и вызывающий обязан их показать. Молчаливый None однажды уже превратил
    108 отказов подряд в «признака нет» по всей выборке.
    """
    last = None
    for i in range(attempts):
        try:
            req = urllib.request.Request(BASE + path, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            last = f"HTTP {e.code}"
        except Exception as e:
            last = type(e).__name__
        if i < attempts - 1:
            time.sleep(2 ** i)
    FAILURES.append(f"{last} {path}")
    return None


def monthly_by_tier(pricing):
    """Помесячная цена по ступеням пользователей: {ступень: $/мес}."""
    if not pricing:
        return {}
    out = {}
    for it in pricing.get("items", []):
        if it.get("editionType") != "user-tier" or it.get("licenseType") != "COMMERCIAL":
            continue
        units, months, amount = it.get("unitCount"), it.get("monthsValid"), it.get("amount")
        if units is None or amount is None:
            continue
        per_month = amount if months == 1 else (amount / 12 if months == 12 else None)
        if per_month is None:
            continue
        # помесячный тариф приоритетнее пересчёта годового
        if units not in out or months == 1:
            out[units] = round(per_month, 2)
    return out


def price_at(tiers, seats):
    """Цена за инстанс на N мест: ближайшая ступень не ниже N."""
    fits = sorted(t for t in tiers if t >= seats)
    return tiers[fits[0]] if fits else (tiers[max(tiers)] if tiers else None)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--apps", default="data/apps.json")
    p.add_argument("--out", default="data/pricing.json")
    p.add_argument("--sample", type=int, default=300)
    p.add_argument("--min-installs", type=int, default=33)
    args = p.parse_args()

    apps = json.load(open(args.apps))["apps"]
    pool = [
        a for a in apps
        if a["payment_model"] == "atlassian"
        and (a["categories"] or a["legacy_categories"])
        and (a["release_date"] or "") >= "2024-09-15"
        and isinstance(a["installs"], int) and a["installs"] >= args.min_installs
    ]
    print(f"пул: {len(pool)} живых платных приложений от {args.min_installs} установок", file=sys.stderr)

    random.seed(20260915)
    sample = random.sample(pool, min(args.sample, len(pool)))

    rows = []
    for i, a in enumerate(sample, 1):
        pricing = get(f"/addons/{a['key']}/pricing/cloud/live")
        tiers = monthly_by_tier(pricing)
        if tiers:
            rows.append({
                "key": a["key"], "name": a["name"],
                "categories": a["categories"] or a["legacy_categories"],
                "installs": a["installs"], "release_date": a["release_date"],
                "tiers": tiers,
                "at": {str(s): price_at(tiers, s) for s in (10, 50, 200, 1000)},
            })
        print(f"\r  {i}/{len(sample)} (с ценами: {len(rows)})", end="", file=sys.stderr)
        time.sleep(0.25)
    print(file=sys.stderr)

    json.dump({"fetched_at": time.strftime("%Y-%m-%d"), "apps": rows}, open(args.out, "w"), ensure_ascii=False)
    print(f"записано {len(rows)} -> {args.out}", file=sys.stderr)
    if FAILURES:
        print(f"ОТКАЗОВ: {len(FAILURES)} — цены неполны, выборка смещена", file=sys.stderr)
        for f in FAILURES[:5]:
            print(f"    {f}", file=sys.stderr)


if __name__ == "__main__":
    main()
