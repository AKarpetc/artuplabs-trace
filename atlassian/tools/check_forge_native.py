"""Кто из лидеров уже на Forge, а кто ещё нет.

Приложение на Forge несёт `cloud.appId` вида ari:cloud:ecosystem::app/... .
Поле `deployment.connect` из списочного ответа для этого не годится: оно
false и у Forge-приложений, и у Connect-приложений.

Значение: только Forge-приложение может получить бейдж Runs on Atlassian и
100% ревшары. Тема, где лидеры ещё не на Forge, — это тема, где новичок
получает аргумент, который лидер без переписывания не получит.

    python3 tools/check_forge_native.py --top 20
"""

import argparse
import json
import sys
import time
import urllib.error
import urllib.request

BASE = "https://marketplace.atlassian.com/rest/2"
# Поштучные ресурсы /addons/{key}/... отдают 410 Gone на не-браузерный
# User-Agent: Atlassian выборочно включила отключение v2. Списочные ресурсы
# и цены при этом отвечают 200 на любой агент.
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/140.0 Safari/537.36")

CANDIDATE_CATEGORIES = {
    "Project management", "Reports", "Document management", "Documentation",
    "Dashboard gadgets", "Charts & diagramming", "Themes & styles",
}

THEMES = {
    "экспорт PDF/Word/Excel": ["export", "pdf", "word document", "excel", "print"],
    "Gantt / таймлайн / роадмап": ["gantt", "timeline", "roadmap"],
    "таблицы и расчёты": ["spreadsheet", "table filter", "calculat", "formula"],
    "структура документа": ["heading", "numbered", "table of contents", " toc "],
    "карточки и доски": ["card", "kanban"],
    "кросс-проектные отчёты": ["cross-project", "cross project", "portfolio", "multi-project"],
}


class Unavailable(Exception):
    """Ресурс не ответил. Отличается от «ответил, что признака нет»."""


def get(path, attempts=3):
    """JSON ресурса. Бросает Unavailable, если ответа нет.

    Никогда не возвращает None молча: неотличимость «нет данных» от
    «запрос не прошёл» однажды уже дала ложный результат по всей выборке.
    """
    last = None
    for i in range(attempts):
        try:
            req = urllib.request.Request(BASE + path, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise Unavailable(f"404 {path}") from e
            last = f"HTTP {e.code}"
        except Exception as e:
            last = type(e).__name__
        if i < attempts - 1:
            time.sleep(2 ** i)
    raise Unavailable(f"{last} {path}")


def is_forge(key, cache):
    """True, если последняя версия приложения несёт Forge-ARI."""
    if key in cache:
        return cache[key]
    d = get(f"/addons/{key}/versions/latest")
    ari = ((d or {}).get("cloud") or {}).get("appId") or ""
    cache[key] = str(ari).startswith("ari:cloud:ecosystem::app/")
    time.sleep(0.2)
    return cache[key]


def categories_of(a):
    return set(a["categories"] or a["legacy_categories"] or [])


def select(apps, keys, min_installs):
    return [
        a for a in apps
        if a["payment_model"] == "atlassian"
        and (categories_of(a) & CANDIDATE_CATEGORIES)
        and (a["release_date"] or "") >= "2024-09-15"
        and isinstance(a["installs"], int) and a["installs"] >= min_installs
        and any(x in f" {a['name']} {a.get('tagline') or ''} ".lower() for x in keys)
    ]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--apps", default="data/apps.json")
    p.add_argument("--top", type=int, default=20, help="сколько лидеров темы проверять")
    p.add_argument("--min-installs", type=int, default=50)
    p.add_argument("--out", default="data/forge_native.json")
    args = p.parse_args()

    apps = json.load(open(args.apps))["apps"]
    cache, report, failures = {}, {}, []

    print(f"{'тема':<28}{'проверено':>11}{'на Forge':>10}{'доля':>8}{'уст. под Forge':>16}")
    print("-" * 73)
    for name, keys in THEMES.items():
        leaders = sorted(select(apps, keys, args.min_installs), key=lambda a: -a["installs"])[: args.top]
        if not leaders:
            continue
        flags, failed = [], []
        for a in leaders:
            try:
                flags.append((a, is_forge(a["key"], cache)))
            except Unavailable as e:
                failed.append(f"{a['name'][:40]}: {e}")
        if failed:
            print(f"\n{name}: НЕ ПРОВЕРЕНО {len(failed)} из {len(leaders)} — результат недостоверен")
            for f in failed[:5]:
                print(f"    {f}")
            failures.extend(failed)
        if not flags:
            continue
        n_forge = sum(1 for _, f in flags if f)
        inst_total = sum(a["installs"] for a, _ in flags) or 1
        inst_forge = sum(a["installs"] for a, f in flags if f)
        print(f"{name:<28}{len(flags):>11}{n_forge:>10}{n_forge / len(flags):>8.0%}{inst_forge / inst_total:>15.0%}")
        report[name] = [
            {"name": a["name"], "key": a["key"], "installs": a["installs"], "forge": f}
            for a, f in flags
        ]

    json.dump(report, open(args.out, "w"), ensure_ascii=False, indent=1)
    print(f"\nподробности -> {args.out}", file=sys.stderr)
    if failures:
        print(f"ВНИМАНИЕ: {len(failures)} приложений не проверено — таблицу читать нельзя", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
