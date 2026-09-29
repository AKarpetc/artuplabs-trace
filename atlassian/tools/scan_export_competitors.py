"""Кто уже строит экспорт Confluence в git-пригодный Markdown.

Гейт G2 плана ArtUp Export (20_app2_markdown_export.md §3, урок из
10_action_list.md §1: названия лгут, читать описания). Ищет по словам из
Task 0.1 брифа, дедуплицирует по ключу и помечает приложения, чей текст
одновременно обещает стабильные/детерминированные пути, front-matter и
инкрементальный экспорт.

ВАЖНО, измерено 2026-09-28: точечные ресурсы `/rest/2/addons/<key>` и
`/rest/2/addons/<key>/versions/latest` (на них опирались fetch_marketplace.py
и check_forge_native.py) теперь всегда отдают 410 API_DEPRECATED, на любой
User-Agent. Значит: (1) полное описание приложения (то, что раньше отдавал
byKey-ресурс) публичным API больше не достать — используем tagLine + summary
из списочного /addons?text=...&withVersion=true, это короче прежнего, но
это всё, что осталось; (2) признак Forge через ARI-префикс cloud.appId из
versions/latest тоже недоступен. Замена, проверенная на 6 приложениях с
известным статусом из 12_markdown_export_niche.md: HTML-страница листинга
(/apps/<id>/<slug>) несёт встроенный Apollo-кэш со списком scope вида
"CloudAppScope:<id>". У Connect-приложений среди них всегда есть хотя бы один
с подстрокой "connect-" (например read:connect-confluence,
act-as-user:connect-confluence); у проверенных Forge-приложений — ни одного.
Приложение без cloudAppId в кэше вообще считаем не-Forge. Чтобы не гонять
HTML-скрейп по всем найденным приложениям (объём запросов держим низким),
признак Forge считается только для топ-25 по установкам и для всех, кто уже
помечен флагом по тексту — ровно то множество, которое бриф просит прочитать
руками.

    python3 tools/scan_export_competitors.py --out data/export_competitors.json
"""

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

SEARCH_BASE = "https://marketplace.atlassian.com/rest/2/addons"
UA = "market-research/1.0 (personal marketplace research; low volume)"
# byKey-ресурсы отдают 410 на любой агент (см. докстринг), но HTML-листинг
# отдаёт содержимое только браузерному агенту.
UA_BROWSER = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/140.0 Safari/537.36")

WORDS = [
    "export", "markdown", "git", "github", "gitlab", "docs-as-code",
    "static site", "mkdocs", "docusaurus", "hugo", "backup",
]

PATTERNS = {
    "stable_paths": re.compile(r"stable|deterministic|same path|consistent path", re.I),
    "front_matter": re.compile(r"front.?matter|yaml header|metadata header", re.I),
    "incremental": re.compile(r"incremental|only changed|delta|since last", re.I),
}

FAILURES = []


def get_json(path, attempts=4):
    """GET JSON с экспоненциальной паузой. None при устойчивом отказе (см. FAILURES)."""
    url = path if path.startswith("http") else SEARCH_BASE + path
    for i in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 410:
                FAILURES.append(f"410 (API_DEPRECATED) {url}")
                return None
            if e.code in (429, 500, 502, 503, 504) and i < attempts - 1:
                time.sleep(2 ** i)
                continue
        except (urllib.error.URLError, TimeoutError):
            if i < attempts - 1:
                time.sleep(2 ** i)
                continue
        except Exception:
            pass
    FAILURES.append(f"HTTP отказ {url}")
    return None


def get_html(url, attempts=3):
    """GET HTML браузерным агентом. None при устойчивом отказе (см. FAILURES)."""
    for i in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA_BROWSER, "Accept": "text/html"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read().decode("utf-8", errors="ignore")
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError):
            if i < attempts - 1:
                time.sleep(2 ** i)
                continue
    FAILURES.append(f"HTML отказ {url}")
    return None


def search_word(word, limit=50):
    """Все приложения Confluence Cloud, найденные по слову (с withVersion=true)."""
    q = urllib.parse.quote(word)
    d = get_json(f"?text={q}&application=confluence&hosting=cloud&limit={limit}&withVersion=true")
    if not d:
        return []
    return (d.get("_embedded") or {}).get("addons") or []


def flatten(addon):
    """Одно приложение поиска -> плоская запись с текстом для флагов."""
    emb = addon.get("_embedded", {})
    ver = emb.get("version") or {}
    dist = emb.get("distribution") or {}
    dep = ver.get("deployment") or {}
    alt = ((addon.get("_links") or {}).get("alternate") or {}).get("href") or ""
    text = f"{addon.get('tagLine') or ''} {addon.get('summary') or ''}"
    return {
        "key": addon.get("key"),
        "name": addon.get("name"),
        "installs": dist.get("totalInstalls"),
        "tagLine": addon.get("tagLine"),
        "summary": addon.get("summary"),
        "connect_flag_from_list": dep.get("connect"),  # см. check_forge_native.py: не различает Forge/Connect
        "listing_url": ("https://marketplace.atlassian.com" + alt) if alt.startswith("/") else alt,
        "flags": {
            "stable_paths": bool(PATTERNS["stable_paths"].search(text)),
            "front_matter": bool(PATTERNS["front_matter"].search(text)),
            "incremental": bool(PATTERNS["incremental"].search(text)),
        },
    }


def is_forge(listing_url):
    """True/False/None (не проверено) по эвристике connect-scope из HTML-листинга."""
    if not listing_url:
        return None
    html = get_html(listing_url + ("&hosting=cloud" if "?" in listing_url else "?hosting=cloud"))
    if html is None:
        return None
    if "cloudAppId" not in html:
        return False  # не зарегистрировано в едином реестре ecosystem -> не Forge
    scope_refs = re.findall(r'CloudAppScope:([a-zA-Z0-9:_.\-]+)', html)
    if not scope_refs:
        return None
    return not any("connect-" in s for s in scope_refs)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--out", default="data/export_competitors.json")
    p.add_argument("--words", default=",".join(WORDS))
    p.add_argument("--limit", type=int, default=50, help="лимит на слово (макс. отдаёт API)")
    p.add_argument("--forge-check-top", type=int, default=25, help="сколько лидеров по установкам проверять на Forge")
    args = p.parse_args()

    words = [w.strip() for w in args.words.split(",") if w.strip()]
    by_key = {}
    for w in words:
        found = search_word(w, args.limit)
        print(f"'{w}': найдено {len(found)}", file=sys.stderr)
        for a in found:
            rec = flatten(a)
            if rec["key"] and rec["key"] not in by_key:
                by_key[rec["key"]] = rec
        time.sleep(0.25)

    apps = list(by_key.values())
    with_installs = [a for a in apps if isinstance(a["installs"], int)]
    top = sorted(with_installs, key=lambda a: -a["installs"])[: args.forge_check_top]
    flagged = [a for a in apps if all(a["flags"].values())]
    to_check = {a["key"]: a for a in (top + flagged)}
    print(f"всего уникальных приложений: {len(apps)}; проверяю Forge у {len(to_check)} (топ-{args.forge_check_top} + все флагованные)", file=sys.stderr)

    for a in to_check.values():
        a["forge"] = is_forge(a["listing_url"])
        time.sleep(0.3)
    for a in apps:
        a.setdefault("forge", None)

    out = {
        "fetched_at": time.strftime("%Y-%m-%d"),
        "words": words,
        "apps": apps,
    }
    with open(args.out, "w") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"записано {len(apps)} приложений -> {args.out}", file=sys.stderr)

    n_flagged = len(flagged)
    n_flagged_forge_200 = sum(
        1 for a in flagged
        if a.get("forge") is True and isinstance(a["installs"], int) and a["installs"] >= 200
    )
    print(f"флагованных (все три признака в tagLine+summary): {n_flagged}", file=sys.stderr)
    print(f"из них Forge и установок >=200: {n_flagged_forge_200}", file=sys.stderr)

    if FAILURES:
        print(f"ОТКАЗОВ: {len(FAILURES)}", file=sys.stderr)
        for f in FAILURES[:8]:
            print(f"    {f}", file=sys.stderr)


if __name__ == "__main__":
    main()
