# syntax=docker/dockerfile:1
#
# Image du proxy d'extraction (aiohttp, Python 3.13).
#
# Python 3.13 est obligatoire : les wheels lxml publiées pour 3.14 ne sont pas
# compatibles avec cette version du service (voir le README du module).
#
# Les dépendances vivent dans un venv construit à part, pour que l'image finale
# ne transporte ni chaîne de compilation ni cache pip.

FROM python:3.13-slim AS dependencies
ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential libssl-dev libffi-dev \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt ./
RUN python -m venv /opt/venv \
 && /opt/venv/bin/pip install --upgrade pip \
 && /opt/venv/bin/pip install -r requirements.txt

FROM python:3.13-slim AS runtime
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HOME=/tmp \
    PORT=25569
WORKDIR /app
COPY --from=dependencies /opt/venv /opt/venv
COPY --chown=nobody:nogroup . .

# Utilisateur non-root : le service n'a besoin d'écrire nulle part, ses caches
# sont en mémoire.
USER nobody

EXPOSE 25569

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD python -c "import os,sys,urllib.request;r=urllib.request.urlopen('http://127.0.0.1:%d/health'%int(os.environ.get('PORT') or 25569),timeout=4);sys.exit(0 if r.status==200 else 1)"

CMD ["python", "server.py"]
