#!/bin/bash
set -Eeuo pipefail

CONTAINER="${JELLYFIN_CONTAINER:-jellyfin}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUNDLE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DLL_SOURCE="${BUNDLE_DIR}/Jellyfin.Plugin.AkumaGames.dll"
BRIDGE_SOURCE="${BUNDLE_DIR}/web/akuma-games-bridge.js"
WEB_DIR="/usr/share/jellyfin/web"
WEB_INDEX="${WEB_DIR}/index.html"
WEB_BRIDGE="${WEB_DIR}/akuma-games-bridge.js"
BRIDGE_QUERY_VERSION="0.2.3.1"

fail() {
  echo "ERRO: $*" >&2
  exit 1
}

[[ "${EUID}" -eq 0 ]] || fail "execute como root no terminal do Unraid."
command -v docker >/dev/null 2>&1 || fail "Docker não foi encontrado."
docker inspect "${CONTAINER}" >/dev/null 2>&1 || fail "container ${CONTAINER} não foi encontrado."
[[ -s "${DLL_SOURCE}" ]] || fail "Jellyfin.Plugin.AkumaGames.dll não foi encontrado no pacote."
[[ -s "${BRIDGE_SOURCE}" ]] || fail "web/akuma-games-bridge.js não foi encontrado no pacote."

CONFIG_SOURCE="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/config"}}{{.Source}}{{end}}{{end}}' "${CONTAINER}")"
if [[ -z "${CONFIG_SOURCE}" ]]; then
  CONFIG_SOURCE="/mnt/user/appdata/jellyfin"
fi
APPDATA="${JELLYFIN_APPDATA:-${CONFIG_SOURCE}}"
PLUGIN_DIR="${APPDATA}/data/plugins/Akuma Games"
PERSIST_DIR="${APPDATA}/akuma-games-bridge"
INIT_DIR="${APPDATA}/custom-cont-init.d"
INIT_SCRIPT="${INIT_DIR}/99-akuma-games-bridge.sh"
WAS_RUNNING="$(docker inspect -f '{{.State.Running}}' "${CONTAINER}")"

echo "Pasta /config detectada: ${APPDATA}"

echo "[1/8] Parando o Jellyfin..."
docker stop "${CONTAINER}" >/dev/null

echo "[2/8] Atualizando o plugin Akuma Games..."
mkdir -p "${PLUGIN_DIR}"
if [[ -f "${PLUGIN_DIR}/Jellyfin.Plugin.AkumaGames.dll" ]]; then
  cp -f "${PLUGIN_DIR}/Jellyfin.Plugin.AkumaGames.dll" \
    "${PLUGIN_DIR}/Jellyfin.Plugin.AkumaGames.dll.bak-v0.2.3.1"
fi
cp -f "${DLL_SOURCE}" "${PLUGIN_DIR}/Jellyfin.Plugin.AkumaGames.dll"
chown 99:100 "${PLUGIN_DIR}/Jellyfin.Plugin.AkumaGames.dll" 2>/dev/null || true
chmod 0644 "${PLUGIN_DIR}/Jellyfin.Plugin.AkumaGames.dll"

echo "[3/8] Instalando a ponte persistente na pasta /config..."
mkdir -p "${PERSIST_DIR}" "${INIT_DIR}"
cp -f "${BRIDGE_SOURCE}" "${PERSIST_DIR}/akuma-games-bridge.js"
chmod 0644 "${PERSIST_DIR}/akuma-games-bridge.js"

cat > "${INIT_SCRIPT}" <<'INIT'
#!/bin/bash
set -Eeuo pipefail

SOURCE="/config/akuma-games-bridge/akuma-games-bridge.js"
WEB_DIR="/usr/share/jellyfin/web"
TARGET="${WEB_DIR}/akuma-games-bridge.js"
INDEX="${WEB_DIR}/index.html"
VERSION="0.2.3.1"

log() {
  echo "[Akuma Games Bridge] $*"
}

[[ -s "${SOURCE}" ]] || { log "arquivo persistente não encontrado: ${SOURCE}"; exit 0; }
[[ -f "${INDEX}" ]] || { log "index.html não encontrado em ${WEB_DIR}"; exit 0; }

cp -f "${SOURCE}" "${TARGET}"
chmod 0644 "${TARGET}"
sed -i -E 's#<script[^>]+src="akuma-games-bridge\.js\?v=[^"]+"[^>]*></script>##g' "${INDEX}"
sed -i -E 's#<script[^>]+src="akuma-games-bridge\.js"[^>]*></script>##g' "${INDEX}"

if grep -q '</body>' "${INDEX}"; then
  sed -i "s#</body>#<script src=\"akuma-games-bridge.js?v=${VERSION}\"></script></body>#" "${INDEX}"
else
  printf '\n<script src="akuma-games-bridge.js?v=%s"></script>\n' "${VERSION}" >> "${INDEX}"
fi

log "v${VERSION} aplicada em ${INDEX}"
INIT

chmod 0755 "${INIT_SCRIPT}"
chown root:root "${INIT_SCRIPT}" 2>/dev/null || true

echo "[4/8] Iniciando o Jellyfin..."
docker start "${CONTAINER}" >/dev/null

for _ in $(seq 1 40); do
  if docker exec "${CONTAINER}" test -f "${WEB_INDEX}" 2>/dev/null; then
    break
  fi
  sleep 1
done

docker exec "${CONTAINER}" test -f "${WEB_INDEX}" 2>/dev/null \
  || fail "não encontrei ${WEB_INDEX} dentro do container."

echo "[5/8] Aplicando a ponte imediatamente dentro do container..."
docker cp "${BRIDGE_SOURCE}" "${CONTAINER}:/tmp/akuma-games-bridge.js" >/dev/null
docker exec "${CONTAINER}" sh -c "
  set -e
  cp -f /tmp/akuma-games-bridge.js '${WEB_BRIDGE}'
  chmod 0644 '${WEB_BRIDGE}'
  cp -f '${WEB_INDEX}' '${WEB_INDEX}.akuma-backup-v0.2.3.1'
  sed -i -E 's#<script[^>]+src=\"akuma-games-bridge\\.js\\?v=[^\"]+\"[^>]*></script>##g' '${WEB_INDEX}'
  sed -i -E 's#<script[^>]+src=\"akuma-games-bridge\\.js\"[^>]*></script>##g' '${WEB_INDEX}'
  if grep -q '</body>' '${WEB_INDEX}'; then
    sed -i 's#</body>#<script src=\"akuma-games-bridge.js?v=${BRIDGE_QUERY_VERSION}\"></script></body>#' '${WEB_INDEX}'
  else
    printf '\n<script src=\"akuma-games-bridge.js?v=${BRIDGE_QUERY_VERSION}\"></script>\n' >> '${WEB_INDEX}'
  fi
  rm -f /tmp/akuma-games-bridge.js
"

echo "[6/8] Verificando a aplicação imediata..."
docker exec "${CONTAINER}" sh -c \
  "test -s '${WEB_BRIDGE}' && grep -q 'akuma-games-bridge.js?v=${BRIDGE_QUERY_VERSION}' '${WEB_INDEX}'" \
  || fail "a ponte não foi aplicada diretamente dentro do container."

echo "[7/8] Reiniciando para testar a persistência..."
docker restart "${CONTAINER}" >/dev/null
sleep 7

# Mesmo que a imagem não execute custom-cont-init.d, reaplica diretamente para garantir funcionamento.
if ! docker exec "${CONTAINER}" sh -c \
  "test -s '${WEB_BRIDGE}' && grep -q 'akuma-games-bridge.js?v=${BRIDGE_QUERY_VERSION}' '${WEB_INDEX}'" 2>/dev/null; then
  echo "Aviso: custom-cont-init.d não executou; reaplicando diretamente."
  docker cp "${BRIDGE_SOURCE}" "${CONTAINER}:${WEB_BRIDGE}" >/dev/null
  docker exec "${CONTAINER}" sh -c "
    sed -i -E 's#<script[^>]+src=\"akuma-games-bridge\\.js\\?v=[^\"]+\"[^>]*></script>##g' '${WEB_INDEX}'
    sed -i 's#</body>#<script src=\"akuma-games-bridge.js?v=${BRIDGE_QUERY_VERSION}\"></script></body>#' '${WEB_INDEX}'
  "
fi

echo "[8/8] Instalação concluída."
docker exec "${CONTAINER}" sh -c \
  "grep -n 'akuma-games-bridge.js?v=${BRIDGE_QUERY_VERSION}' '${WEB_INDEX}' && ls -lh '${WEB_BRIDGE}'"

echo
echo "Akuma Games v0.2.3.1 instalado."
echo "A ponte foi aplicada imediatamente e também ficou salva em /config para reinicializações."
echo "Agora limpe os dados do site do Jellyfin ou teste em janela anônima."

if [[ "${WAS_RUNNING}" != "true" ]]; then
  echo "Observação: o container estava parado antes da instalação e permaneceu iniciado."
fi
