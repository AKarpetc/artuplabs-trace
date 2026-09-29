#!/usr/bin/env python3
"""Какая категория Atlassian Marketplace держит цену, нужную для $5 000/мес за год.

Отчёт 04 отобрал категории-кандидаты по плотности конкуренции (доля установок
у топ-3). Это не полный фильтр: цель за ~12 месяцев достижима только там, где
категория держит высокую цену на ступени 200+ мест, иначе требуемое число
установок недостижимо за первый год жизни листинга.

Считает по уже собранным data/apps.json и data/pricing.json, без сети.
Запуск: python3 docs/analysis/category_price_fit.py
"""
import json
import statistics as st

GOAL = 5000
TRIAL_TO_PAID = 0.20          # ориентир отчёта 04
CANDIDATES = ["Project management", "Reports", "Document management", "Documentation",
              "Dashboard gadgets", "Charts & diagramming", "Themes & styles"]


def cats(rec: dict) -> list:
    return rec.get("categories") or rec.get("legacy_categories") or []


def median(xs):
    return st.median(xs) if xs else None


def pct_above(values: list, threshold: float) -> float:
    """Доля листингов категории с числом установок >= threshold."""
    return 100 * sum(1 for v in values if v >= threshold) / len(values) if values else float("nan")


def main() -> None:
    apps = json.load(open("data/apps.json"))["apps"]
    priced = json.load(open("data/pricing.json"))["apps"]

    installs_by_cat: dict[str, list] = {}
    for r in apps:
        for c in cats(r):
            installs_by_cat.setdefault(c, []).append(r.get("installs") or 0)

    price_by_cat: dict[str, dict[str, list]] = {}
    for r in priced:
        for c in r.get("categories", []):
            slot = price_by_cat.setdefault(c, {"50": [], "200": [], "1000": []})
            for tier in slot:
                v = r["tiers"].get(tier)
                if v:
                    slot[tier].append(v)

    print(f"Цель ${GOAL}/мес, конверсия проба->оплата {TRIAL_TO_PAID:.0%}\n")
    hdr = f"{'Категория':<24}{'n':>5}{'$50м':>7}{'$200м':>7}{'$1000м':>8}{'Клиентов':>10}{'Установок':>11}{'Топ-% кат.':>11}"
    print(hdr)
    print("-" * len(hdr))

    rows = []
    for c in CANDIDATES:
        p, inst = price_by_cat.get(c), installs_by_cat.get(c, [])
        if not p or not p["200"]:
            print(f"{c:<24}{'нет данных о ценах':>50}")
            continue
        m50, m200, m1k = median(p["50"]), median(p["200"]), median(p["1000"])
        clients = GOAL / m200
        needed = clients / TRIAL_TO_PAID
        share = pct_above(inst, needed)
        rows.append((c, share, needed, clients))
        print(f"{c:<24}{len(p['200']):>5}{m50:>7.0f}{m200:>7.0f}{(m1k or 0):>8.0f}"
              f"{clients:>10.0f}{needed:>11.0f}{share:>10.1f}%")

    print("\nЧитать так: чтобы взять цель по медианной цене категории на ступени 200 мест,")
    print("надо попасть в верхние N% листингов этой же категории по установкам.\n")
    for c, share, needed, clients in sorted(rows, key=lambda r: -r[1]):
        print(f"  {c:<24} {clients:>4.0f} клиентов = {needed:>5.0f} установок = верхние {share:.1f}%")


if __name__ == "__main__":
    main()
