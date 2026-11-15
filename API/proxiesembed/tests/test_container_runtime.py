"""Cycle de vie du conteneur proxiesembed.

Le service est lancé (ou rejoint via `PROXY_BASE_URL`) et interrogé en HTTP réel.
Ce qui est vérifié :

  - `PORT` remplace le port codé en dur 25569, et l'ancien port n'est plus écouté ;
  - `/health` répond 200 sans aucune authentification, clé VIP ou secret ;
  - son corps ne contient ni nom de dépendance, ni secret d'environnement.

Ce qui échappe volontairement à ce test : le streaming lui-même (206, chunked,
abandon client, egress) et l'extraction DRM. Ils demandent une origine contrôlée
et relèvent du scénario staging `tests/proxyCloudflareSmoke.py` (Task 6).

Usage :

    python tests/test_container_runtime.py                  # lance server.py sur un port libre
    PROXY_BASE_URL=http://127.0.0.1:25569 python tests/test_container_runtime.py   # instance déjà lancée
"""

import json
import os
import socket
import subprocess
import sys
import time
import unittest
import urllib.request

SERVICE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_PORT = 25569
SECRET_ENV_KEYS = (
    "MEDIA_SIGNING_SECRET",
    "INTERNAL_API_KEY",
    "DEEPBRID_API_KEY",
    "REAL_DEBRID_API_KEY",
    "DEBRIDR_ACCOUNT_KEY",
)


def free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def http_get(url, timeout=5):
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return response.status, response.read().decode("utf-8", errors="replace")


def port_accepts_connections(port, timeout=1.5):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as client:
        client.settimeout(timeout)
        return client.connect_ex(("127.0.0.1", port)) == 0


class ContainerRuntimeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.external = (os.environ.get("PROXY_BASE_URL") or "").strip().rstrip("/")
        cls.process = None
        cls.port = None

        if cls.external:
            cls.base_url = cls.external
            return

        cls.port = free_port()
        env = dict(os.environ)
        env["PORT"] = str(cls.port)
        env.setdefault("LOG_LEVEL", "WARNING")
        cls.process = subprocess.Popen(
            [sys.executable, os.path.join(SERVICE_DIR, "server.py")],
            cwd=SERVICE_DIR,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )
        cls.base_url = f"http://127.0.0.1:{cls.port}"
        cls.wait_until_healthy()

    @classmethod
    def wait_until_healthy(cls, timeout=90.0):
        deadline = time.time() + timeout
        last_error = None
        while time.time() < deadline:
            if cls.process.poll() is not None:
                output = cls.process.stdout.read().decode("utf-8", errors="replace") if cls.process.stdout else ""
                raise AssertionError(
                    f"server exited during startup (code {cls.process.returncode}):\n{output[-3000:]}"
                )
            try:
                http_get(f"{cls.base_url}/health", timeout=2)
                return
            except Exception as error:  # connexion refusée tant que l'écoute n'est pas ouverte
                last_error = error
                time.sleep(0.3)
        raise AssertionError(f"server never became healthy: {last_error}")

    @classmethod
    def tearDownClass(cls):
        if cls.process and cls.process.poll() is None:
            cls.process.terminate()
            try:
                cls.process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                cls.process.kill()
                cls.process.wait(timeout=5)

    def test_health_answers_without_credentials(self):
        status, body = http_get(f"{self.base_url}/health")
        self.assertEqual(status, 200)
        payload = json.loads(body)
        self.assertEqual(payload.get("status"), "ok")

    def test_health_body_has_no_secret_or_dependency_details(self):
        _, body = http_get(f"{self.base_url}/health")
        lowered = body.lower()
        for marker in ("password", "secret", "token", "api_key", "socks", "http://", "https://"):
            self.assertNotIn(marker, lowered, f"/health must not mention {marker!r}: {body}")
        for key in SECRET_ENV_KEYS:
            value = os.environ.get(key) or ""
            if len(value) >= 8:
                self.assertNotIn(value, body, f"/health must not echo {key}")

    def test_port_env_replaces_the_hardcoded_port(self):
        if self.external:
            self.skipTest("PROXY_BASE_URL probes an already running instance")
        self.assertNotEqual(self.port, DEFAULT_PORT, "the test must allocate a port other than 25569")
        self.assertTrue(port_accepts_connections(self.port), "the configured PORT must be listening")
        self.assertFalse(
            port_accepts_connections(DEFAULT_PORT),
            "the hardcoded 25569 must not be listening when PORT is set",
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
