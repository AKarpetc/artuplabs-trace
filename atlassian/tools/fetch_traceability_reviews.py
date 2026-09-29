"""Все отзывы у приложений темы «прослеживаемость требований» и соседей.

Отчёт 15: что покупатели лидеров просят и на что жалуются. Берёт не только
1-2 звезды (как fetch_reviews.py), а все отзывы: плохие показывают дыры,
хорошие — за что платят.

Источники:
- /rest/2/addons/{key}/reviews — отвечает 200 на браузерный User-Agent
  (на 2026-09-24); у каждого отзыва есть поле hosting (cloud/server/datacenter);
- HTML страницы листинга — в нём встроено состояние Apollo с полями
  isForgeROACompliant (бейдж Runs on Atlassian) и cloudAppId + scopes
  облачной сборки. Поштучные /addons/{key} и /versions/latest отдают 410
  на любой агент, поэтому признак Forge берётся отсюда.

Любой отказ попадает в FAILURES и в выходной файл; молча не глотается.

    python3 tools/fetch_traceability_reviews.py --out data/reviews_traceability.json
"""

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import date

sys.path.insert(0, "analysis")
from scan_domain import load, match  # noqa: E402

BASE = "https://marketplace.atlassian.com/rest/2"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/140.0 Safari/537.36")

# Соседи, которых нет в 15 листингах темы, но которые продают ту же работу
# (связь требование -> тест / карта связей). Проверены по data/apps.json.
ADJACENT = [
    "com.deviniti.atlassian.apps.rtm",               # Deviniti RTM
    "com.xpandit.plugins.xray",                      # Xray (покрытие требований)
    "com.kanoah.test-manager",                       # Zephyr (Scale)
    "com.docminer.jira.issue-links",                 # Links Hierarchy
    "com.ketryx.app.atlassian",                      # Ketryx (медтех)
    "com.radbee.confluence.forge.snapshotsextension",  # Snapshots + Xray
    "com.uption.jira.visualdependencies",            # Visual Dependencies
    "de.stagil.jira.issue-maps",                     # STAGIL Link Maps
    "pl.com.tt.apdc.ilv",                            # Issue Links Viewer
    "com.easesolutions.confluence.plugins.connect",  # easeConnect
]

FAILURES = []


def fetch(url, as_json=True, attempts=3):
    last = None
    for i in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json" if as_json else "text/html"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r) if as_json else r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}"
            if e.code in (404, 410):
                break
        except Exception as e:  # сеть, таймаут
            last = type(e).__name__
        if i < attempts - 1:
            time.sleep(2 ** i)
    FAILURES.append(f"{last} {url}")
    return None


def all_reviews(key, cap):
    out, summary, offset = [], None, 0
    while offset < cap:
        d = fetch(f"{BASE}/addons/{key}/reviews?sort=recent&limit=50&offset={offset}")
        if d is None:
            break
        if summary is None:
            summary = {"count": d.get("count"), "avg": d.get("averageStars"), "per_rating": d.get("countPerRating")}
        batch = (d.get("_embedded") or {}).get("reviews") or []
        for r in batch:
            resp = ((r.get("_embedded") or {}).get("response") or {}).get("text")
            out.append({
                "stars": r.get("stars"), "date": (r.get("date") or "")[:10],
                "hosting": r.get("hosting"), "text": (r.get("review") or "").strip(),
                "vendor_replied": bool(resp),
            })
        if len(batch) < 50:
            break
        offset += 50
        time.sleep(0.25)
    return summary, out


def platform(url):
    """Признаки Forge / Runs on Atlassian со страницы листинга."""
    if url and url.startswith("/"):
        url = "https://marketplace.atlassian.com" + url
    html = fetch(url, as_json=False) if url else None
    if not html:
        return {"checked": False}
    roa = re.findall(r'"isForgeROACompliant":(true|false)', html)
    m = re.search(r'"MarketplaceCloudAppDeployment".*?"cloudAppId":"([^"]*)","scopes":\[(.*?)\]', html)
    scopes = re.findall(r'CloudAppScope:([^"]+)"', m.group(2)) if m else []
    return {
        "checked": True,
        "runs_on_atlassian": "true" in roa if roa else None,
        "cloud_app_ari": bool(m and m.group(1).startswith("ari:cloud:ecosystem")),
        "connect_scopes": any(":connect-" in s for s in scopes),
        "scopes_sample": scopes[:6],
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--themes", default="analysis/themes_regulated.json")
    p.add_argument("--theme", default="прослеживаемость треб.")
    p.add_argument("--cap", type=int, default=3000, help="максимум отзывов на приложение")
    p.add_argument("--out", default="data/reviews_traceability.json")
    a = p.parse_args()

    apps = load()
    words = json.load(open(a.themes, encoding="utf-8"))[a.theme]
    by_key = {x["key"]: x for x in apps}
    theme_keys = [x["key"] for x in sorted((x for x in apps if match(x, words)), key=lambda x: -(x["installs"] or 0))]
    prices = {x["key"]: x.get("prices") for x in json.load(open("data/pricing_regulated.json"))}

    result = []
    for key in theme_keys + [k for k in ADJACENT if k not in theme_keys]:
        app = by_key.get(key)
        if not app:
            FAILURES.append(f"нет в apps.json: {key}")
            continue
        summary, revs = all_reviews(key, a.cap)
        plat = platform(app.get("listing_url"))
        cloud = [r for r in revs if r["hosting"] == "cloud"]
        print(f"{app['name'][:50]:<52} уст.{app['installs']:>6} отзывов {len(revs):>4} (cloud {len(cloud):>3})"
              f" RoA={plat.get('runs_on_atlassian')} connect={plat.get('connect_scopes')}", file=sys.stderr)
        result.append({
            "key": key, "name": app["name"], "vendor": app.get("vendor"),
            "group": "theme" if key in theme_keys else "adjacent",
            "installs": app.get("installs"), "release_date": app.get("release_date"),
            "price_200": (prices.get(key) or {}).get("200"),
            "listing_url": app.get("listing_url"),
            "platform": plat, "review_summary": summary, "reviews": revs,
        })
        time.sleep(0.3)

    out = {"taken": date.today().isoformat(), "failures": FAILURES, "apps": result}
    json.dump(out, open(a.out, "w"), ensure_ascii=False, indent=1)
    print(f"записано -> {a.out}", file=sys.stderr)
    if FAILURES:
        print(f"ОТКАЗОВ: {len(FAILURES)}", file=sys.stderr)
        for f in FAILURES:
            print("   ", f, file=sys.stderr)


if __name__ == "__main__":
    main()
