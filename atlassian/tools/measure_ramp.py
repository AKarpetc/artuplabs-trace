"""Сколько установок набирает приложение за время жизни листинга.

Отвечает на вопрос «сколько идти до цели» замером, а не оценкой: дата первой
версии даёт возраст листинга, а `totalInstalls` — сколько он набрал.

Возраст берётся из истории версий: число версий, затем последняя страница
списка — там самая старая. Два запроса на приложение, поштучный ресурс,
поэтому нужен браузерный User-Agent (иначе 410, см. docs/06 приложение).

    python3 tools/measure_ramp.py --sample 200
"""

import argparse
import json
import random
import sys
import time
import urllib.error
import urllib.request

BASE = "https://marketplace.atlassian.com/rest/2"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/140.0 Safari/537.36")


class Unavailable(Exception):
    """Ресурс не ответил. Отличается от «ответил, что данных нет»."""


def get(path, attempts=3):
    last = None
    for i in range(attempts):
        try:
            req = urllib.request.Request(BASE + path, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=25) as r:
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


def first_release(key):
    """Дата первой версии приложения (ISO yyyy-mm-dd)."""
    head = get(f"/addons/{key}/versions?limit=1")
    count = head.get("count") or 0
    if count <= 0:
        raise Unavailable(f"нет версий {key}")
    time.sleep(0.15)
    page = get(f"/addons/{key}/versions?limit=1&offset={max(count - 1, 0)}")
    versions = (page.get("_embedded") or {}).get("versions") or []
    if not versions:
        raise Unavailable(f"пустая страница версий {key}")
    date = ((versions[0].get("release") or {}).get("date")) or ""
    if not date:
        raise Unavailable(f"нет даты первой версии {key}")
    return date[:10], count


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--apps", default="data/apps.json")
    p.add_argument("--out", default="data/ramp.json")
    p.add_argument("--sample", type=int, default=200)
    p.add_argument("--min-installs", type=int, default=5)
    args = p.parse_args()

    apps = json.load(open(args.apps))["apps"]
    pool = [
        a for a in apps
        if a["payment_model"] == "atlassian"
        and (a["categories"] or a["legacy_categories"])
        and (a["release_date"] or "") >= "2024-09-15"
        and isinstance(a["installs"], int) and a["installs"] >= args.min_installs
    ]
    random.seed(20260915)
    sample = random.sample(pool, min(args.sample, len(pool)))
    print(f"пул {len(pool)}, берём {len(sample)}", file=sys.stderr)

    rows, failures = [], []
    for i, a in enumerate(sample, 1):
        try:
            date, nver = first_release(a["key"])
            rows.append({
                "key": a["key"], "name": a["name"], "installs": a["installs"],
                "first_release": date, "versions": nver,
                "categories": a["categories"] or a["legacy_categories"],
            })
        except Unavailable as e:
            failures.append(str(e))
        print(f"\r  {i}/{len(sample)} собрано {len(rows)} отказов {len(failures)}", end="", file=sys.stderr)
        time.sleep(0.15)
    print(file=sys.stderr)

    json.dump({"fetched_at": time.strftime("%Y-%m-%d"), "apps": rows}, open(args.out, "w"), ensure_ascii=False)
    print(f"записано {len(rows)} -> {args.out}", file=sys.stderr)
    if failures:
        print(f"ОТКАЗОВ: {len(failures)} — выборка неполна", file=sys.stderr)
        for f in failures[:5]:
            print(f"    {f}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
