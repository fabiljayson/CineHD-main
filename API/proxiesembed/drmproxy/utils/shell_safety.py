"""
Échappement des valeurs injectées dans les commandes du downloader.

Les commandes N_m3u8DL-RE / ffmpeg / mkvmerge sont construites par gabarits
(`utils/constants/configuration.py`) puis exécutées avec `shell=True`, parce
qu'elles contiennent de la syntaxe shell (guillemets, enchaînements). Les
valeurs substituées dans ces gabarits proviennent des fournisseurs amont :
URL de manifeste, clés DRM, noms de collection et d'épisode. Une valeur
contenant un guillemet ferme la chaîne et permet d'ajouter une commande.

`quote_for_shell` échappe une valeur destinée à être insérée **entre
guillemets doubles** (c'est la forme de tous les gabarits concernés). Elle
refuse les caractères de contrôle, qui n'ont aucune raison légitime de
transiter par une URL ou un nom de fichier.
"""

import re

_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")


def quote_for_shell(value) -> str:
    """Échappe une valeur pour une insertion entre guillemets doubles."""
    text = "" if value is None else str(value)
    if _CONTROL_CHARS.search(text):
        raise ValueError("valeur refusée pour une commande shell : caractère de contrôle")
    return (
        text.replace("\\", "\\\\")
        .replace('"', '\\"')
        .replace("$", "\\$")
        .replace("`", "\\`")
    )
