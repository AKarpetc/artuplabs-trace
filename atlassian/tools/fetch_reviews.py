"""Отрицательные отзывы у лидеров категории — или отзывы конкретных приложений.

Гейт недели 3: чего не хватает в категории, по словам платящих покупателей.
Берёт лидеров по установкам и выгружает отзывы на 1-2 звезды.

    python3 tools/fetch_reviews.py --category "Time tracking" --leaders 10

Гейт G3 плана ArtUp Export (20_app2_markdown_export.md §3): выдержит ли цена
жалобы на стоимость у конкретных приложений, а не у категории — и по всем
звёздам, не только по низким (жалоба на цену обычно живёт в 3-4★ отзыве
«хороший продукт, но дорого», а не в 1★). Для этого:

    python3 tools/fetch_reviews.py --keys nl.avisi.confluence.plugins.git-plugin,markdown-exporter --all-stars --since 2000-01-01 --out data/reviews_export.json
"""

import argparse
import json
import sys
import time
import urllib.error
import urllib.request

BASE = "https://marketplace.atlassian.com/rest/2"
UA = "market-research/1.0 (personal marketplace research; low volume)"


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


def reviews(key, pages=4, per=50):
    """Свежие отзывы приложения."""
    out = []
    for page in range(pages):
        d = get(f"/addons/{key}/reviews?sort=recent&limit={per}&offset={page * per}")
        if not d:
            break
        batch = (d.get("_embedded") or {}).get("reviews") or []
        if not batch:
            break
        out.extend(batch)
        if len(batch) < per:
            break
        time.sleep(0.2)
    return out


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--apps", default="data/apps.json")
    p.add_argument("--category", default=None)
    p.add_argument("--keys", default=None, help="ключи приложений через запятую вместо категории")
    p.add_argument("--leaders", type=int, default=10)
    p.add_argument("--max-stars", type=int, default=2)
    p.add_argument("--all-stars", action="store_true", help="не фильтровать по звёздам (жалоба на цену чаще живёт в 3-4★, не в 1-2★)")
    p.add_argument("--since", default="2025-01-01", help="отзывы не старше этой даты")
    p.add_argument("--out", default=None)
    args = p.parse_args()

    if bool(args.category) == bool(args.keys):
        sys.exit("указать ровно одно: --category или --keys")

    apps = json.load(open(args.apps))["apps"]

    if args.keys:
        by_key = {a["key"]: a for a in apps}
        leaders = []
        for k in args.keys.split(","):
            k = k.strip()
            a = by_key.get(k)
            leaders.append(a or {"name": k, "key": k, "installs": None})
        print(f"Приложения по ключу: {len(leaders)}\n", file=sys.stderr)
    else:
        in_cat = [
            a for a in apps
            if args.category in (a["categories"] or a["legacy_categories"] or [])
            and isinstance(a["installs"], int)
        ]
        leaders = sorted(in_cat, key=lambda a: -a["installs"])[: args.leaders]
        if not leaders:
            sys.exit(f"категория '{args.category}' не найдена")
        print(f"Категория: {args.category} | лидеров: {len(leaders)}\n", file=sys.stderr)

    collected = []
    for a in leaders:
        rs = reviews(a["key"])
        if args.all_stars:
            bad = [r for r in rs if (r.get("date") or "") >= args.since]
        else:
            bad = [
                r for r in rs
                if (r.get("stars") or 5) <= args.max_stars and (r.get("date") or "") >= args.since
            ]
        label = "всего" if args.all_stars else f"из них ≤{args.max_stars}★"
        installs = a["installs"] if a["installs"] is not None else "?"
        print(f"{a['name'][:52]:<54} уст.{installs!s:>7}  отзывов {len(rs):>4}  {label}: {len(bad)}", file=sys.stderr)
        for r in bad:
            collected.append({
                "app": a["name"], "key": a["key"], "installs": a["installs"],
                "stars": r.get("stars"), "date": (r.get("date") or "")[:10],
                "text": (r.get("review") or "").strip(),
            })
        time.sleep(0.2)

    collected.sort(key=lambda r: r["date"], reverse=True)
    kind = "отзывов (все звёзды)" if args.all_stars else "отрицательных отзывов"
    print(f"\n=== {len(collected)} {kind} с {args.since} ===\n")
    for r in collected:
        print(f"[{r['date']}] {r['stars']}★ {r['app'][:44]} (уст. {r['installs']})")
        print(f"  {r['text'][:400]}\n")

    if args.out:
        json.dump(collected, open(args.out, "w"), ensure_ascii=False, indent=1)
        print(f"записано -> {args.out}", file=sys.stderr)
    if FAILURES:
        print(f"ОТКАЗОВ: {len(FAILURES)} — часть отзывов не получена", file=sys.stderr)
        for f in FAILURES[:5]:
            print(f"    {f}", file=sys.stderr)


if __name__ == "__main__":
    main()
