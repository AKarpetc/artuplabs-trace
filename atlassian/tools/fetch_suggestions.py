"""Фичареквесты в публичном трекере Atlassian, отсортированные по голосам.

Это прямой спрос: пользователи сами просят то, чего в продукте нет, и
голосуют за чужие просьбы. В отличие от ключевых слов в листингах и отзывов
у лидеров, здесь измеряется не занятость рынка, а непокрытая потребность.

Открытое предложение с сотнями голосов = задача, которую Atlassian не сделала
и делать не торопится. Это и есть материал для приложения.

    python3 tools/fetch_suggestions.py --project CONFCLOUD --top 30
    python3 tools/fetch_suggestions.py --text "markdown" --top 20
"""

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://jira.atlassian.com/rest/api/2"
UA = "market-research/1.0 (personal marketplace research; low volume)"


class Unavailable(Exception):
    """Запрос не прошёл. Не путать с «ничего не найдено»."""


def search(jql, fields, limit, start=0):
    params = urllib.parse.urlencode({
        "jql": jql, "fields": ",".join(fields), "maxResults": limit, "startAt": start,
    })
    url = f"{BASE}/search?{params}"
    last = None
    for i in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}"
            if e.code == 400:
                raise Unavailable(f"неверный JQL: {jql}") from e
        except Exception as e:
            last = type(e).__name__
        if i < 2:
            time.sleep(2 ** i)
    raise Unavailable(f"{last} {jql}")


def rows(data):
    out = []
    for issue in data.get("issues", []):
        f = issue.get("fields") or {}
        out.append({
            "key": issue.get("key"),
            "summary": (f.get("summary") or "").strip(),
            "votes": ((f.get("votes") or {}).get("votes")) or 0,
            "watches": ((f.get("watches") or {}).get("watchCount")) or 0,
            "status": ((f.get("status") or {}).get("name")) or "",
            "created": (f.get("created") or "")[:10],
            "type": ((f.get("issuetype") or {}).get("name")) or "",
        })
    return out


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--project", default="CONFCLOUD,JRACLOUD", help="через запятую")
    p.add_argument("--text", default=None, help="искать в тексте предложения")
    p.add_argument("--top", type=int, default=30)
    p.add_argument("--open-only", action="store_true", default=True)
    p.add_argument("--out", default=None)
    args = p.parse_args()

    projects = ",".join(f'"{x.strip()}"' for x in args.project.split(","))
    clauses = [f"project in ({projects})", 'issuetype = "Suggestion"']
    if args.open_only:
        clauses.append("resolution = Unresolved")
    if args.text:
        clauses.append(f'text ~ "{args.text}"')
    jql = " AND ".join(clauses) + " ORDER BY votes DESC"

    data = search(jql, ["summary", "votes", "watches", "status", "created", "issuetype"], args.top)
    total = data.get("total", 0)
    out = rows(data)

    label = f'"{args.text}" ' if args.text else ""
    print(f"открытых предложений {label}в {args.project}: {total}\n")
    print(f"{'голосов':>8}{'следят':>8}{'создано':>12}  предложение")
    print("-" * 96)
    for r in out:
        print(f"{r['votes']:>8}{r['watches']:>8}{r['created']:>12}  {r['summary'][:64]}")
        print(f"{'':>28}  {r['key']}  https://jira.atlassian.com/browse/{r['key']}")

    if args.out:
        json.dump({"jql": jql, "total": total, "issues": out}, open(args.out, "w"), ensure_ascii=False, indent=1)
        print(f"\nзаписано -> {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Unavailable as e:
        sys.exit(f"ОТКАЗ: {e}")
