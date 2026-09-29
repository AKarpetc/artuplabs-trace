#!/usr/bin/env python3
"""Цены по ступеням для приложений из тематического скана.

Берёт ключи приложений, попавших в выбранные темы скана, и тянет по каждому
реальную цену. Отказ не молчит: он попадает в список и печатается.

    python3 analysis/price_domain.py --scan data/domain_regulated.json \
        --themes "QMS и CAPA,контролируемые документы,фарма и GxP"
"""
import argparse
import json
import re
import statistics as st
import sys
import time
import urllib.request

sys.path.insert(0, "tools")
from fetch_pricing import get, monthly_by_tier, price_at, FAILURES  # noqa: E402

SEATS = [50, 200, 1000]


def keys_for(scan_path, apps_path, themes, theme_defs):
    apps = json.load(open(apps_path, encoding="utf-8"))["apps"]
    words = [w for t in themes for w in theme_defs[t]]
    out = []
    for a in apps:
        h = " ".join(
            [a.get("name") or "", a.get("tagline") or ""]
            + (a.get("keywords") or [])
            + (a.get("categories") or [])
            + (a.get("legacy_categories") or [])
        ).lower()
        if any(re.search(r"\b" + re.escape(w) + r"\b", h) for w in words):
            out.append(a)
    seen, uniq = set(), []
    for a in out:
        if a["key"] not in seen:
            seen.add(a["key"]); uniq.append(a)
    return uniq


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--apps", default="data/apps.json")
    p.add_argument("--theme-file", default="analysis/themes_regulated.json")
    p.add_argument("--themes", required=True)
    p.add_argument("--out", default="data/pricing_regulated.json")
    a = p.parse_args()

    defs = json.load(open(a.theme_file, encoding="utf-8"))
    themes = [t.strip() for t in a.themes.split(",")]
    apps = keys_for(None, a.apps, themes, defs)
    apps = [x for x in apps if x.get("payment_model") == "atlassian"]
    print(f"платных через Atlassian в темах: {len(apps)}")

    rows = []
    for i, app in enumerate(apps, 1):
        tiers = monthly_by_tier(get(f"/addons/{app['key']}/pricing/cloud/live"))
        row = {
            "key": app["key"], "name": app["name"], "vendor": app.get("vendor"),
            "installs": app.get("installs") or 0, "release_date": app.get("release_date"),
            "prices": {str(s): price_at(tiers, s) for s in SEATS} if tiers else None,
        }
        rows.append(row)
        print(f"[{i}/{len(apps)}] {app['name'][:44]:44} "
              f"{'—' if not tiers else ' '.join(f'{s}:{price_at(tiers,s)}' for s in SEATS)}")
        time.sleep(0.4)

    json.dump(rows, open(a.out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    print(f"\nотказов: {len(FAILURES)}")
    for f in FAILURES[:10]:
        print("  ", f)
    for s in SEATS:
        vals = [r["prices"][str(s)] for r in rows if r["prices"] and r["prices"][str(s)]]
        if vals:
            print(f"\n{s} мест: n={len(vals)} медиана ${st.median(vals):.0f} "
                  f"диапазон ${min(vals):.0f}–${max(vals):.0f}  "
                  f"клиентов до $5 000: {5000/st.median(vals):.0f}")


if __name__ == "__main__":
    main()
