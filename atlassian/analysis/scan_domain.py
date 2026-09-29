#!/usr/bin/env python3
"""Плотность предложения по предметной области в каталоге Atlassian.

Ищет тему по словам в названии, слогане, ключевых словах и категориях
листинга, затем считает: сколько листингов, как распределены установки,
насколько свежо предложение и кто держит верх.

    python3 analysis/scan_domain.py --themes analysis/themes_retail.json
"""
import argparse
import json
import re
import statistics as st
from datetime import date


def load(path="data/apps.json"):
    return json.load(open(path, encoding="utf-8"))["apps"]


def haystack(app):
    parts = [app.get("name") or "", app.get("tagline") or ""]
    parts += app.get("keywords") or []
    parts += app.get("categories") or []
    parts += app.get("legacy_categories") or []
    return " ".join(parts).lower()


def match(app, words):
    h = haystack(app)
    return [w for w in words if re.search(r"\b" + re.escape(w) + r"\b", h)]


def age_days(app, today):
    d = app.get("release_date")
    if not d:
        return None
    try:
        y, m, dd = (int(x) for x in d.split("-"))
    except ValueError:
        return None
    return (today - date(y, m, dd)).days


def summarize(theme, words, apps, today):
    hits = [a for a in apps if match(a, words)]
    if not hits:
        return {"theme": theme, "apps": 0}
    inst = sorted((a.get("installs") or 0 for a in hits), reverse=True)
    total = sum(inst)
    fresh = [a for a in hits if (age_days(a, today) or 9999) <= 180]
    return {
        "theme": theme,
        "apps": len(hits),
        "installs_total": total,
        "top3_share_pct": round(100 * sum(inst[:3]) / total, 1) if total else 0.0,
        "median_installs": st.median(inst),
        "over_100_installs": len([x for x in inst if x >= 100]),
        "fresh_180d_pct": round(100 * len(fresh) / len(hits), 1),
        "top": [
            {
                "name": a["name"][:52],
                "vendor": (a.get("vendor") or "")[:28],
                "installs": a.get("installs") or 0,
                "released": a.get("release_date"),
                "connect": a.get("connect"),
                "tagline": (a.get("tagline") or "")[:90],
            }
            for a in sorted(hits, key=lambda x: x.get("installs") or 0, reverse=True)[:6]
        ],
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--themes", default="analysis/themes_retail.json")
    p.add_argument("--apps", default="data/apps.json")
    p.add_argument("--out", default="data/domain_scan.json")
    a = p.parse_args()

    apps = load(a.apps)
    themes = json.load(open(a.themes, encoding="utf-8"))
    today = date.today()
    rows = [summarize(t, w, apps, today) for t, w in themes.items()]
    rows.sort(key=lambda r: -r["apps"])
    json.dump(rows, open(a.out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    hdr = f"{'тема':26} {'прил':>4} {'установок':>10} {'top3%':>6} {'медиана':>8} {'>=100':>6} {'свежих%':>8}"
    print(hdr)
    print("-" * len(hdr))
    for r in rows:
        if not r["apps"]:
            print(f"{r['theme'][:26]:26} {0:4}")
            continue
        print(f"{r['theme'][:26]:26} {r['apps']:4} {r['installs_total']:10,} "
              f"{r['top3_share_pct']:6.1f} {r['median_installs']:8.0f} "
              f"{r['over_100_installs']:6} {r['fresh_180d_pct']:8.1f}")


if __name__ == "__main__":
    main()
