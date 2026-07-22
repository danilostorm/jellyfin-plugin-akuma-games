#!/bin/bash
set -Eeuo pipefail

CONTAINER="${JELLYFIN_CONTAINER:-jellyfin}"
APPDATA="${JELLYFIN_APPDATA:-/mnt/user/appdata/jellyfin}"
PLUGIN_DIR="${APPDATA}/data/plugins/Akuma Games"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUNDLE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DLL_SOURCE="${BUNDLE_DIR}/Jellyfin.Plugin.AkumaGames.dll"
BRIDGE_SOURCE="${BUNDLE_DIR}/web/akuma-games-bridge.js"
WEB_DIR="/usr/share/jellyfin/web"

fail() {
  echo "ERRO: $*" >&2
  exit 1
}

[[ "${EUID}" -eq 0 ]] || fail "execute como root no terminal do Unraid."
command -v docker >/dev/null 2>&1 || fail "Docker não foi encontrado."
docker inspect "${CONTAINER}" >/dev/null 2>&1 || fail "container ${CONTAINER} não foi encontrado."
[[ -f "${DLL_SOURCE}" ]] || fail "arquivo Jellyfin.Plugin.AkumaGames.dll não está no pacote."
[[ -f "${BRIDGE_SOURCE}" ]] || fail "arquivo web/akuma-games-bridge.js não está no pacote."

WAS_RUNNING="$(docker inspect -f '{{.State.Running}}' "${CONTAINER}")"

echo "[1/6] Parando Jellyfin..."
docker stop "${CONTAINER}" >/dev/null

mkdir -p "${PLUGIN_DIR}"
if [[ -f "${PLUGIN_DIR}/Jellyfin.Plugin.AkumaGames.dll" ]]; then
  cp -f "${PLUGIN_DIR}/Jellyfin.Plugin.AkumaGames.dll" "${PLUGIN_DIR}/Jellyfin.Plugin.AkumaGames.dll.bak-v0.2.2"
fi

cp -f "${DLL_SOURCE}" "${PLUGIN_DIR}/Jellyfin.Plugin.AkumaGames.dll"
chown 99:100 "${PLUGIN_DIR}/Jellyfin.Plugin.AkumaGames.dll" 2>/dev/null || true
chmod 0644 "${PLUGIN_DIR}/Jellyfin.Plugin.AkumaGames.dll"

echo "[2/6] Iniciando Jellyfin para aplicar a ponte web..."
docker start "${CONTAINER}" >/dev/null

for _ in $(seq 1 30); do
  if docker exec "${CONTAINER}" test -f "${WEB_DIR}/index.html" 2>/dev/null; then
    break
  fi
  sleep 1
done

docker exec "${CONTAINER}" test -f "${WEB_DIR}/index.html" 2>/dev/null \
  || fail "não encontrei ${WEB_DIR}/index.html dentro do container."

echo "[3/6] Instalando launcher HTML5 no Jellyfin Web..."
docker exec "${CONTAINER}" sh -c "cp -f '${WEB_DIR}/index.html' '${WEB_DIR}/index.html.akuma-before-v0.2.2'"
docker cp "${BRIDGE_SOURCE}" "${CONTAINER}:${WEB_DIR}/akuma-games-bridge.js" >/dev/null

docker exec "${CONTAINER}" sh -c "
  if grep -q 'akuma-games-bridge.js' '${WEB_DIR}/index.html'; then
    sed -i 's/akuma-games-bridge.js?v=[0-9.]*/akuma-games-bridge.js?v=0.2.2/g' '${WEB_DIR}/index.html'
  else
    sed -i 's#</body>#<script src=\"akuma-games-bridge.js?v=0.2.2\"></script></body>#' '${WEB_DIR}/index.html'
  fi
"

echo "[4/6] Reiniciando Jellyfin..."
docker restart "${CONTAINER}" >/dev/null
sleep 5

echo "[5/6] Conferindo arquivos..."
docker exec "${CONTAINER}" sh -c "grep -q 'akuma-games-bridge.js?v=0.2.2' '${WEB_DIR}/index.html' && test -s '${WEB_DIR}/akuma-games-bridge.js'" \
  || fail "a ponte web não foi inserida corretamente."

test -s "${PLUGIN_DIR}/Jellyfin.Plugin.AkumaGames.dll" \
  || fail "a DLL do plugin não foi instalada."

echo "[6/6] Instalação concluída."
echo
echo "Akuma Games v0.2.2 instalado."
echo "Agora execute a sincronização do plugin e depois use Ctrl+F5 no navegador."
echo "Ao abrir um game pela biblioteca Games, o botão Reproduzir será convertido em Jogar."

if [[ "${WAS_RUNNING}" != "true" ]]; then
  echo "Observação: o container estava parado antes da instalação e foi iniciado para aplicar a atualização."
fi
