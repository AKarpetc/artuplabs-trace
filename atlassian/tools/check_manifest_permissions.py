"""Гейт мажорных версий Forge.

Изменение scopes или egress делает версию мажорной: обновление не применяется
к установленным приложениям, пока админ явно не подтвердит новые разрешения.
Проехать такое изменение незаметно — значит оставить часть клиентов на старой
версии без исправлений.

Скрипт сравнивает permissions в manifest.yml с зафиксированным слепком и роняет
сборку при расхождении.

    python3 tools/check_manifest_permissions.py            # проверить
    python3 tools/check_manifest_permissions.py --update   # принять изменение
"""

import argparse
import json
import os
import sys

try:
    import yaml
except ImportError:
    sys.exit("нужен pyyaml: pip install pyyaml")

BASELINE = ".forge-permissions.json"


def extract(manifest_path):
    """Разрешения из манифеста в сравнимом виде."""
    with open(manifest_path) as f:
        manifest = yaml.safe_load(f) or {}
    perms = manifest.get("permissions") or {}
    external = perms.get("external") or {}
    return {
        "scopes": sorted(perms.get("scopes") or []),
        "external": {k: sorted(v) if isinstance(v, list) else v for k, v in sorted(external.items())},
    }


def report(baseline, current):
    """Печатает расхождения. Возвращает True, если они есть."""
    old, new = set(baseline["scopes"]), set(current["scopes"])
    added, removed = sorted(new - old), sorted(old - new)
    egress_changed = baseline["external"] != current["external"]

    if not (added or removed or egress_changed):
        return False

    print("МАЖОРНАЯ ВЕРСИЯ: разрешения изменились.\n")
    for s in added:
        print(f"  + scope {s}")
    for s in removed:
        print(f"  - scope {s}")
    if egress_changed:
        print(f"  ! external (egress): {json.dumps(baseline['external'])} -> {json.dumps(current['external'])}")
        print("    egress отбирает бейдж Runs on Atlassian — проверить forge eligibility")
    print(
        "\nОбновление не применится к установленным приложениям без согласия админа,"
        "\nа bulk-апгрейд блокируется при повышении привилегий."
        "\nЕсли это осознанно: python3 tools/check_manifest_permissions.py --update"
    )
    return True


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--manifest", default="manifest.yml")
    p.add_argument("--baseline", default=BASELINE)
    p.add_argument("--update", action="store_true", help="принять текущие разрешения как новый слепок")
    args = p.parse_args()

    if not os.path.exists(args.manifest):
        sys.exit(f"нет {args.manifest} — запускать из корня приложения Forge")

    current = extract(args.manifest)

    if args.update or not os.path.exists(args.baseline):
        with open(args.baseline, "w") as f:
            json.dump(current, f, indent=2, sort_keys=True)
        print(f"слепок записан: {args.baseline}")
        print(f"  scopes: {len(current['scopes'])}, egress: {'есть' if current['external'] else 'нет'}")
        return 0

    with open(args.baseline) as f:
        baseline = json.load(f)

    if report(baseline, current):
        return 1

    print(f"разрешения не менялись ({len(current['scopes'])} scopes, egress: {'есть' if current['external'] else 'нет'})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
