#!/bin/bash
set -Eeuo pipefail

CONTAINER="${JELLYFIN_CONTAINER:-jellyfin}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUNDLE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DLL_SOURCE="${BUNDLE_DIR}/Jellyfin.Plugin.AkumaGames.dll"
BRIDGE_SOURCE="${BUNDLE_DIR}/web/akuma-games-bridge.js"
CARD_CLICK_SOURCE="${BUNDLE_DIR}/web/akuma-games-card-click.js"
WEB_DIR="/usr/share/jellyfin/web"
WEB_INDEX="${WEB_DIR}/index.html"
WEB_BRIDGE="${WEB_DIR}/akuma-games-bridge.js"
WEB_CARD_CLICK="${WEB_DIR}/akuma-games-card-click.js"
BRIDGE_QUERY_VERSION="0.2.3.4"

fail() {
  echo "ERRO: $*" >&2
  exit 1
}

[[ "${EUID}" -eq 0 ]] || fail "execute como root no terminal do Unraid."
command -v docker >/dev/null 2>&1 || fail "Docker não foi encontrado."
docker inspect "${CONTAINER}" >/dev/null 2>&1 || fail "container ${CONTAINER} não foi encontrado."
[[ -s "${DLL_SOURCE}" ]] || fail "Jellyfin.Plugin.AkumaGames.dll não foi encontrado no pacote."
[[ -s "${BRIDGE_SOURCE}" ]] || fail "web/akuma-games-bridge.js não foi encontrado no pacote."
[[ -s "${CARD_CLICK_SOURCE}" ]] || fail "web/akuma-games-card-click.js não foi encontrado no pacote."

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
    "${PLUGIN_DIR}/Jellyfin.Plugin.AkumaGames.dll.bak-v0.2.3.4"
fi
cp -f "${DLL_SOURCE}" "${PLUGIN_DIR}/Jellyfin.Plugin.AkumaGames.dll"
chown 99:100 "${PLUGIN_DIR}/Jellyfin.Plugin.AkumaGames.dll" 2>/dev/null || true
chmod 0644 "${PLUGIN_DIR}/Jellyfin.Plugin.AkumaGames.dll"

echo "[3/8] Salvando as pontes na pasta persistente /config..."
mkdir -p "${PERSIST_DIR}" "${INIT_DIR}"
cp -f "${BRIDGE_SOURCE}" "${PERSIST_DIR}/akuma-games-bridge.js"
cp -f "${CARD_CLICK_SOURCE}" "${PERSIST_DIR}/akuma-games-card-click.js"
chmod 0644 "${PERSIST_DIR}/akuma-games-bridge.js" "${PERSIST_DIR}/akuma-games-card-click.js"

cat > "${INIT_SCRIPT}" <<'INIT'
#!/bin/bash
set -Eeuo pipefail

SOURCE_DIR="/config/akuma-games-bridge"
WEB_DIR="/usr/share/jellyfin/web"
INDEX="${WEB_DIR}/index.html"
VERSION="0.2.3.4"

log() {
  echo "[Akuma Games Bridge] $*"
}

[[ -f "${INDEX}" ]] || { log "index.html não encontrado em ${WEB_DIR}"; exit 0; }
[[ -s "${SOURCE_DIR}/akuma-games-bridge.js" ]] || { log "bridge principal não encontrado"; exit 0; }
[[ -s "${SOURCE_DIR}/akuma-games-card-click.js" ]] || { log "bridge de clique não encontrado"; exit 0; }

cp -f "${SOURCE_DIR}/akuma-games-bridge.js" "${WEB_DIR}/akuma-games-bridge.js"
cp -f "${SOURCE_DIR}/akuma-games-card-click.js" "${WEB_DIR}/akuma-games-card-click.js"
chmod 0644 "${WEB_DIR}/akuma-games-bridge.js" "${WEB_DIR}/akuma-games-card-click.js"

sed -i -E 's#<script[^>]+src="akuma-games-bridge\.js\?v=[^"]+"[^>]*></script>##g' "${INDEX}"
sed -i -E 's#<script[^>]+src="akuma-games-card-click\.js\?v=[^"]+"[^>]*></script>##g' "${INDEX}"
sed -i -E 's#<script[^>]+src="akuma-games-(bridge|card-click)\.js"[^>]*></script>##g' "${INDEX}"

SCRIPTS="<script src=\"akuma-games-bridge.js?v=${VERSION}\"></script><script src=\"akuma-games-card-click.js?v=${VERSION}\"></script>"
if grep -q '</body>' "${INDEX}"; then
  sed -i "s#</body>#${SCRIPTS}</body>#" "${INDEX}"
else
  printf '\n%s\n' "${SCRIPTS}" >> "${INDEX}"
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

echo "[5/8] Aplicando as pontes imediatamente dentro do container..."
docker cp "${BRIDGE_SOURCE}" "${CONTAINER}:/tmp/akuma-games-bridge.js" >/dev/null
docker cp "${CARD_CLICK_SOURCE}" "${CONTAINER}:/tmp/akuma-games-card-click.js" >/dev/null

docker exec "${CONTAINER}" sh -c "
  set -e
  cp -f /tmp/akuma-games-bridge.js '${WEB_BRIDGE}'
  cp -f /tmp/akuma-games-card-click.js '${WEB_CARD_CLICK}'
  chmod 0644 '${WEB_BRIDGE}' '${WEB_CARD_CLICK}'
  cp -f '${WEB_INDEX}' '${WEB_INDEX}.akuma-backup-v0.2.3.4'
  sed -i -E 's#<script[^>]+src=\"akuma-games-bridge\\.js\\?v=[^\"]+\"[^>]*></script>##g' '${WEB_INDEX}'
  sed -i -E 's#<script[^>]+src=\"akuma-games-card-click\\.js\\?v=[^\"]+\"[^>]*></script>##g' '${WEB_INDEX}'
  sed -i -E 's#<script[^>]+src=\"akuma-games-(bridge|card-click)\\.js\"[^>]*></script>##g' '${WEB_INDEX}'
  if grep -q '</body>' '${WEB_INDEX}'; then
    sed -i 's#</body>#<script src=\"akuma-games-bridge.js?v=${BRIDGE_QUERY_VERSION}\"></script><script src=\"akuma-games-card-click.js?v=${BRIDGE_QUERY_VERSION}\"></script></body>#' '${WEB_INDEX}'
  else
    printf '\n<script src=\"akuma-games-bridge.js?v=${BRIDGE_QUERY_VERSION}\"></script><script src=\"akuma-games-card-click.js?v=${BRIDGE_QUERY_VERSION}\"></script>\n' >> '${WEB_INDEX}'
  fi
  rm -f /tmp/akuma-games-bridge.js /tmp/akuma-games-card-click.js
"

echo "[6/8] Verificando a aplicação imediata..."
docker exec "${CONTAINER}" sh -c \
  "test -s '${WEB_BRIDGE}' && test -s '${WEB_CARD_CLICK}' && grep -q 'akuma-games-bridge.js?v=${BRIDGE_QUERY_VERSION}' '${WEB_INDEX}' && grep -q 'akuma-games-card-click.js?v=${BRIDGE_QUERY_VERSION}' '${WEB_INDEX}'" \
  || fail "as pontes não foram aplicadas corretamente dentro do container."

echo "[7/8] Reiniciando para testar a persistência..."
docker restart "${CONTAINER}" >/dev/null
sleep 7

if ! docker exec "${CONTAINER}" sh -c \
  "test -s '${WEB_BRIDGE}' && test -s '${WEB_CARD_CLICK}' && grep -q 'akuma-games-card-click.js?v=${BRIDGE_QUERY_VERSION}' '${WEB_INDEX}'" 2>/dev/null; then
  echo "Aviso: o script persistente não executou; reaplicando diretamente."
  docker cp "${BRIDGE_SOURCE}" "${CONTAINER}:${WEB_BRIDGE}" >/dev/null
  docker cp "${CARD_CLICK_SOURCE}" "${CONTAINER}:${WEB_CARD_CLICK}" >/dev/null
  docker exec "${CONTAINER}" sh -c "
    sed -i -E 's#<script[^>]+src=\"akuma-games-bridge\\.js\\?v=[^\"]+\"[^>]*></script>##g' '${WEB_INDEX}'
    sed -i -E 's#<script[^>]+src=\"akuma-games-card-click\\.js\\?v=[^\"]+\"[^>]*></script>##g' '${WEB_INDEX}'
    sed -i 's#</body>#<script src=\"akuma-games-bridge.js?v=${BRIDGE_QUERY_VERSION}\"></script><script src=\"akuma-games-card-click.js?v=${BRIDGE_QUERY_VERSION}\"></script></body>#' '${WEB_INDEX}'
  "
fi

echo "[8/8] Instalação concluída."
docker exec "${CONTAINER}" sh -c \
  "grep -n 'akuma-games-.*.js?v=${BRIDGE_QUERY_VERSION}' '${WEB_INDEX}' && ls -lh '${WEB_BRIDGE}' '${WEB_CARD_CLICK}'"

echo
echo "Akuma Games v0.2.3.4 instalado."
echo "Corrigido o travamento de carregamento causado pelo ciclo de mutações da v0.2.3.3."
echo "Limpe os dados do site do Jellyfin ou use Ctrl+Shift+R antes de testar."

if [[ "${WAS_RUNNING}" != "true" ]]; then
  echo "Observação: o container estava parado antes da instalação e permaneceu iniciado."
fi
