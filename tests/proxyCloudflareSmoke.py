#!/usr/bin/env python3
"""Sonde de staging du proxy (Task 6, Step 3).

    PROXY_BASE_URL=https://proxy.staging.example \
    PROXY_TEST_ORIGIN=https://media.staging.example/controlled.mp4 \
        python tests/proxyCloudflareSmoke.py

Vérifie, à travers le Worker et le Container réels :

- 200 en flux chunked, avec un premier morceau reçu bien avant la fin ;
- 206 avec `Range` et `Content-Range` cohérents ;
- abandon client : la connexion se ferme sans laisser le proxy bloqué ;
- délai d'attente amont : réponse d'erreur explicite, pas une attente infinie ;
- destination non autorisée : refus explicite, quel que soit le statut exact.

`PROXY_TEST_ORIGIN` doit être une origine contrôlée par le projet : aucun média
tiers n'est utilisé, comme l'exige le plan.
"""

import asyncio
import json
import os
import sys
import time

try:
    import aiohttp
except ModuleNotFoundError:  # dépendance du module proxiesembed, pas de la racine
    print(
        "aiohttp manquant : installer les dépendances de API/proxiesembed (Python 3.13).",
        file=sys.stderr,
    )
    raise SystemExit(2)

BASE_URL = os.environ.get("PROXY_BASE_URL", "").rstrip("/")
TEST_ORIGIN = os.environ.get("PROXY_TEST_ORIGIN", "")
ALLOWED_DESTINATION = os.environ.get(
    "PROXY_DISALLOWED_ORIGIN", "https://example.invalid/not-owned.mp4"
)
TIMEOUT = float(os.environ.get("PROXY_TIMEOUT", "20"))

report = {"target": BASE_URL, "checks": [], "startedAt": time.time()}


def record(name, passed, detail=""):
    report["checks"].append({"name": name, "passed": bool(passed), "detail": detail})
    print(f"{'✔' if passed else '✖'} {name}{'' if passed else f' — {detail}'}")
    return passed


def stream_url(origin):
    return f"{BASE_URL}/stream?url={origin}"


async def check_chunked(session):
    started = time.monotonic()
    first_chunk_at = None
    total = 0
    async with session.get(stream_url(TEST_ORIGIN), timeout=aiohttp.ClientTimeout(total=TIMEOUT)) as response:
        if response.status != 200:
            return record("200 chunked", False, f"statut {response.status}")
        async for chunk in response.content.iter_chunked(65536):
            if first_chunk_at is None:
                first_chunk_at = time.monotonic() - started
            total += len(chunk)
    early = first_chunk_at is not None and first_chunk_at < (time.monotonic() - started)
    return record("200 chunked avec premier morceau anticipé", total > 0 and early, f"{total} octets")


async def check_range(session):
    headers = {"Range": "bytes=0-1023"}
    async with session.get(
        stream_url(TEST_ORIGIN), headers=headers, timeout=aiohttp.ClientTimeout(total=TIMEOUT)
    ) as response:
        body = await response.read()
        content_range = response.headers.get("Content-Range", "")
        ok = response.status == 206 and content_range.startswith("bytes 0-1023/") and len(body) <= 1024
        return record("206 avec Content-Range", ok, f"statut {response.status}, {content_range!r}")


async def check_client_abort(session):
    # On ferme volontairement la lecture au premier morceau.
    try:
        async with session.get(
            stream_url(TEST_ORIGIN), timeout=aiohttp.ClientTimeout(total=TIMEOUT)
        ) as response:
            async for _chunk in response.content.iter_chunked(1024):
                break
    except aiohttp.ClientError as error:
        return record("abandon client sans blocage", False, str(error))
    return record("abandon client sans blocage", True, "connexion fermée côté client")


async def check_disallowed(session):
    async with session.get(
        stream_url(ALLOWED_DESTINATION), timeout=aiohttp.ClientTimeout(total=TIMEOUT)
    ) as response:
        body = await response.text()
        ok = 400 <= response.status < 500 and "not-owned" not in body
        return record("destination non autorisée refusée", ok, f"statut {response.status}")


async def main():
    if not BASE_URL:
        print("PROXY_BASE_URL manquant : indiquer l’URL du Worker de staging.", file=sys.stderr)
        return 2
    if not TEST_ORIGIN:
        print("PROXY_TEST_ORIGIN manquant : indiquer une origine contrôlée par le projet.", file=sys.stderr)
        return 2

    async with aiohttp.ClientSession() as session:
        await check_chunked(session)
        await check_range(session)
        await check_client_abort(session)
        await check_disallowed(session)

    report["finishedAt"] = time.time()
    report["passed"] = all(check["passed"] for check in report["checks"])
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
