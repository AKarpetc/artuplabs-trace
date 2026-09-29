"""Сводка по отрицательным отзывам лидеров: где жалуются и на что.

    python3 tools/analyze_reviews.py

Читает все data/reviews_*.json, собранные tools/fetch_reviews.py.
Темы размечаются по ключевым словам — это грубо и нужно только чтобы
не читать триста отзывов подряд, а увидеть, что повторяется.
"""

import glob
import json
import os
import re
from collections import Counter, defaultdict

THEMES = {
    "надёжность": r"\b(not load|won'?t load|blank|crash|broken|down|slow|timeout|freez|hang|stuck|error|fail|bug|unstable|unusable)\w*",
    "производительность": r"\b(slow|lag|performance|takes? (a )?(long|forever)|unresponsive)\w*",
    "нет функции": r"\b(missing|cannot|can'?t|no way to|doesn'?t support|not support|lack|would be (nice|great)|wish|need[s]? to be able)\w*",
    "цена и лицензии": r"\b(expensive|overpriced|price|pricing|licen[cs]|paywall|upsell|ad[sv]ertis|free version|subscription)\w*",
    "поддержка": r"\b(support|no (reply|response|answer)|ticket|unanswered|ignored)\w*",
    "интерфейс": r"\b(ui|ux|confus|clunky|unintuitive|hard to use|cumbersome|clicks)\w*",
    "данные и экспорт": r"\b(export|import|csv|excel|migrat|backup|data loss|lost data)\w*",
    "права и админ": r"\b(permission|admin|scope|access|role|jql|query)\w*",
}


def load_all(pattern="data/reviews_*.json"):
    """Все выгруженные отзывы, сгруппированные по категории из имени файла."""
    out = {}
    for path in sorted(glob.glob(pattern)):
        cat = os.path.basename(path)[len("reviews_"):-len(".json")].replace("_", " ")
        try:
            out[cat] = json.load(open(path))
        except (json.JSONDecodeError, OSError):
            continue
    return out


def themes_of(text):
    low = text.lower()
    return [name for name, pat in THEMES.items() if re.search(pat, low)]


def main():
    data = load_all()
    if not data:
        print("нет файлов data/reviews_*.json — сначала tools/fetch_reviews.py")
        return

    print("=== ОБЪЁМ НЕДОВОЛЬСТВА ПО КАТЕГОРИЯМ ===")
    print(f"{'категория':<26}{'плохих отзывов':>16}{'приложений':>12}{'самое ругаемое':>16}")
    print("-" * 70)
    for cat, revs in sorted(data.items(), key=lambda kv: -len(kv[1])):
        if not revs:
            print(f"{cat:<26}{0:>16}{0:>12}{'—':>16}")
            continue
        per_app = Counter(r["app"] for r in revs)
        top, n = per_app.most_common(1)[0]
        print(f"{cat:<26}{len(revs):>16}{len(per_app):>12}{n:>16}")

    print("\n=== ТЕМЫ ЖАЛОБ (отзыв может попасть в несколько) ===")
    by_theme = defaultdict(lambda: defaultdict(int))
    for cat, revs in data.items():
        for r in revs:
            for t in themes_of(r.get("text") or ""):
                by_theme[t][cat] += 1
    order = sorted(by_theme, key=lambda t: -sum(by_theme[t].values()))
    cats = sorted(data)
    print(f"{'тема':<22}{'всего':>7}  " + " ".join(f"{c[:9]:>10}" for c in cats))
    for t in order:
        row = by_theme[t]
        print(f"{t:<22}{sum(row.values()):>7}  " + " ".join(f"{row.get(c, 0):>10}" for c in cats))

    print("\n=== САМЫЕ КОНКРЕТНЫЕ ЖАЛОБЫ (длинные отзывы = разобранный случай) ===")
    allr = [(r, cat) for cat, revs in data.items() for r in revs if len(r.get("text") or "") > 200]
    allr.sort(key=lambda rc: -len(rc[0]["text"]))
    for r, cat in allr[:12]:
        print(f"\n[{r['date']}] {r['stars']}★ {r['app'][:44]} — {cat} (уст. {r['installs']})")
        print(f"  {' '.join(r['text'].split())[:330]}")


if __name__ == "__main__":
    main()
