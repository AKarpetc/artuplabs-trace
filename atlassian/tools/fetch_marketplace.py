"""Сборщик листингов Atlassian Marketplace.

Первый проход плана: собрать предложение по площадке (категории, установки,
даты обновления, модель оплаты) из публичного REST API без авторизации.

    python3 tools/fetch_marketplace.py --out data/apps.json

API v2 (/rest/2) объявлен deprecated, но на 2026-09-15 отвечает 200.
Когда он отдаст 410, точку входа менять здесь.
"""

import argparse
import json
import sys
import time
import urllib.error
import urllib.request

BASE = "https://marketplace.atlassian.com/rest/2"
UA = "market-research/1.0 (personal marketplace research; low volume)"
PAGE = 50
PAUSE = 0.25


def get(path, attempts=4):
    """GET с экспоненциальной паузой. Возвращает разобранный JSON."""
    url = path if path.startswith("http") else BASE + path
    for i in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 410:
                sys.exit("API v2 отключён (410). Переходить на v3.")
            if e.code in (429, 500, 502, 503, 504) and i < attempts - 1:
                time.sleep(2 ** i)
                continue
            raise
        except (urllib.error.URLError, TimeoutError):
            if i < attempts - 1:
                time.sleep(2 ** i)
                continue
            raise
    raise RuntimeError("недостижимо")


def flatten(addon):
    """Одно приложение из списка -> плоская запись."""
    emb = addon.get("_embedded", {})
    ver = emb.get("version") or {}
    dist = emb.get("distribution") or {}
    dep = ver.get("deployment") or {}
    rel = ver.get("release") or {}
    tags = addon.get("tags") or {}
    programs = addon.get("programs") or {}
    return {
        "key": addon.get("key"),
        "name": addon.get("name"),
        "tagline": addon.get("tagLine"),
        "categories": [c.get("name") for c in (tags.get("category") or [])],
        "keywords": [k.get("name") for k in (tags.get("keywords") or [])],
        "legacy_categories": [c.get("name") for c in (emb.get("categories") or [])],
        "installs": dist.get("totalInstalls"),
        "downloads": dist.get("downloads"),
        "payment_model": ver.get("paymentModel"),
        "version": ver.get("name"),
        "release_date": rel.get("date"),
        "last_modified": addon.get("lastModified"),
        "connect": dep.get("connect"),
        "cloud": dep.get("cloud"),
        "data_center": dep.get("dataCenter"),
        "server": dep.get("server"),
        "cloud_fortified": (programs.get("cloudFortified") or {}).get("status"),
        "stores_personal_data": addon.get("storesPersonalData"),
        "vendor": ((emb.get("vendor") or {}).get("name")),
        "listing_url": (((addon.get("_links") or {}).get("alternate") or {}).get("href")),
    }


def collect(hosting="cloud", limit=None):
    """Постранично собрать все приложения указанного хостинга."""
    out, offset = [], 0
    total = None
    while True:
        page = get(f"/addons?hosting={hosting}&withVersion=true&limit={PAGE}&offset={offset}")
        if total is None:
            total = page.get("count")
            print(f"всего по фильтру hosting={hosting}: {total}", file=sys.stderr)
        batch = (page.get("_embedded") or {}).get("addons") or []
        if not batch:
            break
        out.extend(flatten(a) for a in batch)
        offset += len(batch)
        print(f"\r  собрано {len(out)}", end="", file=sys.stderr)
        if limit and len(out) >= limit:
            break
        if total and offset >= total:
            break
        time.sleep(PAUSE)
    print(file=sys.stderr)
    return out


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--out", default="data/apps.json")
    p.add_argument("--hosting", default="cloud")
    p.add_argument("--limit", type=int, default=None, help="оборвать после N приложений (для пробы)")
    args = p.parse_args()

    apps = collect(args.hosting, args.limit)
    with open(args.out, "w") as f:
        json.dump({"fetched_at": time.strftime("%Y-%m-%d"), "hosting": args.hosting, "apps": apps}, f, ensure_ascii=False)
    print(f"записано {len(apps)} приложений -> {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
