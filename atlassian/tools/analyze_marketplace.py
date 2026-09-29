"""Разбор собранных листингов: где категория допускает вход.

    python3 tools/analyze_marketplace.py --min-installs 84

Порог установок обязателен по смыслу: 39% каталога имеет меньше 5 установок,
и без отсечки этот мёртвый хвост определяет любую статистику по «заброшенности».
Порог 84 — минимальное число платящих клиентов на $5 000/мес по ценам средней
ступени, то есть граница, ниже которой приложение к цели отношения не имеет.

Главная метрика — доля установок у топ-3 категории: сколько места остаётся
всем остальным. Цель $5 000/мес не требует победы над лидером, она требует
категории, которая кормит десятки середняков.
"""

import argparse
import datetime as dt
import json
import statistics
from collections import defaultdict

TODAY = dt.date.today()


def age_days(iso):
    """Сколько дней назад вышел последний релиз."""
    if not iso:
        return None
    try:
        return (TODAY - dt.date.fromisoformat(iso[:10])).days
    except ValueError:
        return None


def categories_of(app):
    return app["categories"] or app["legacy_categories"] or []


def summarize(name, apps):
    ages = [a for a in (age_days(x["release_date"]) for x in apps) if a is not None]
    installs = sorted((x["installs"] for x in apps), reverse=True)
    total = sum(installs) or 1
    return {
        "category": name,
        "apps": len(apps),
        "paid_share": sum(1 for x in apps if x["payment_model"] == "atlassian") / len(apps),
        "installs_median": statistics.median(installs),
        "top3_share": sum(installs[:3]) / total,
        "fresh_90d": sum(1 for a in ages if a <= 90) / len(ages) if ages else 0,
        "stale_1y": sum(1 for a in ages if a > 365) / len(ages) if ages else 0,
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--in", dest="src", default="data/apps.json")
    p.add_argument("--min-installs", type=int, default=84)
    p.add_argument("--min-apps", type=int, default=12)
    args = p.parse_args()

    data = json.load(open(args.src))
    apps = data["apps"]
    traction = [a for a in apps if isinstance(a["installs"], int) and a["installs"] >= args.min_installs]

    by_cat = defaultdict(list)
    for a in traction:
        for c in categories_of(a):
            by_cat[c].append(a)
    rows = [summarize(c, v) for c, v in by_cat.items() if len(v) >= args.min_apps]

    print(f"Замер: {data['fetched_at']} | каталог: {len(apps)} | с тягой (>={args.min_installs} уст.): {len(traction)}")
    dead = sum(1 for a in apps if (a["installs"] or 0) < 5)
    print(f"Мёртвый хвост (<5 установок): {dead} ({dead / len(apps):.0%} каталога)\n")

    hdr = f"{'категория':<30}{'прил':>5}{'платн':>7}{'медиана уст':>12}{'свежих90д':>11}{'старше1г':>10}{'топ-3':>8}"
    print("=== КАТЕГОРИИ, отсортированы по концентрации (меньше — больше места) ===")
    print(hdr)
    print("-" * len(hdr))
    for r in sorted(rows, key=lambda r: r["top3_share"]):
        print(f"{r['category'][:29]:<30}{r['apps']:>5}{r['paid_share']:>6.0%}"
              f"{r['installs_median']:>12.0f}{r['fresh_90d']:>10.0%}{r['stale_1y']:>10.0%}{r['top3_share']:>8.0%}")

    print("\n=== КАНДИДАТЫ: топ-3 держат <25%, платных >70%, медиана установок выше общей ===")
    med = statistics.median([r["installs_median"] for r in rows])
    cands = [r for r in rows if r["top3_share"] < 0.25 and r["paid_share"] > 0.70 and r["installs_median"] >= med]
    for r in sorted(cands, key=lambda r: r["top3_share"]):
        print(f"  {r['category']}: {r['apps']} прил., топ-3 держат {r['top3_share']:.0%}, "
              f"медиана {r['installs_median']:.0f} уст., платных {r['paid_share']:.0%}, "
              f"{r['stale_1y']:.0%} не обновлялись >1 года")
    if not cands:
        print("  нет — ослабить порог или брать нишу внутри категории")


if __name__ == "__main__":
    main()
