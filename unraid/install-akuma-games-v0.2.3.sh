#!/bin/bash
set -Eeuo pipefail

CONTAINER="${JELLYFIN_CONTAINER:-jellyfin}"
APPDATA="${JELLYFIN_APPDATA:-/mnt/user/appdata/jellyfin}"
PLUGIN_DIR="${APPDATA}/data/plugins/Akuma Games"
PERSIST_DIR="${APPDATA}/akuma-games-bridge"
INIT_DIR="${APPDATA}/custom-cont-init.d"
INIT_SCRIPT="${INIT_DIR}/99-akuma-games-bridge.sh"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUNDLE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DLL_SOURCE="${BUNDLE_DIR}/Jellyfin.Plugin.AkumaGames.dll"
BRIDGE_SOURCE="${BUNDLE_DIR}/web/akuma-games-bridge.js"

fail() {
  echo "ERRO: $*" >&2
  exit 1
}

[[ "${EUID}" -eq 0 ]] || fail "execute como root no terminal do Unraid."
command -v docker >/dev/null 2>&1 || fail "Docker não foi encontrado."
docker inspect "${CONTAINER}" >/dev/null 2>&1 || fail "container ${CONTAINER} não foi encontrado."
[[ -s "${DLL_SOURCE}" ]] || fail "Jellyfin.Plugin.AkumaGames.dll não foi encontrado no pacote."
[[ -s "${BRIDGE_SOURCE}" ]] || fail "web/akuma-games-bridge.js não foi encontrado no pacote."

WAS_RUNNING="$(docker inspect -f '{{.State.Running}}' "${CONTAINER}")"

echo "[1/7] Parando o Jellyfin..."
docker stop "${CONTAINER}" >/dev/null

echo "[2/7] Atualizando o plugin Akuma Games..."
mkdir -p "${PLUGIN_DIR}"
if [[ -f "${PLUGIN_DIR}/Jellyfin.Plugin.AkumaGames.dll" ]]; then
  cp -f "${PLUGIN_DIR}/Jellyfin.Plugin.AkumaGames.dll" \
    "${PLUGIN_DIR}/Jellyfin.Plugin.AkumaGames.dll.bak-v0.2.3"
fi
cp -f "${DLL_SOURCE}" "${PLUGIN_DIR}/Jellyfin.Plugin.AkumaGames.dll"
chown 99:100 "${PLUGIN_DIR}/Jellyfin.Plugin.AkumaGames.dll" 2>/dev/null || true
chmod 0644 "${PLUGIN_DIR}/Jellyfin.Plugin.AkumaGames.dll"

echo "[3/7] Instalando a ponte persistente na pasta /config..."
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
VERSION="0.2.3"

log() {
  echo "[Akuma Games Bridge] $*"
}

[[ -s "${SOURCE}" ]] || { log "arquivo persistente não encontrado: ${SOURCE}"; exit 0; }
[[ -f "${INDEX}" ]] || { log "index.html não encontrado em ${WEB_DIR}"; exit 0; }

cp -f "${SOURCE}" "${TARGET}"
chmod 0644 "${TARGET}"

# Remove referências antigas para evitar carregar duas versões da ponte.
sed -i -E 's#<script[^>]+src="akuma-games-bridge\.js\?v=[^"]+"[^>]*></script>##g' "${INDEX}"
sed -i -E 's#<script[^>]+src="akuma-games-bridge\.js"[^>]*></script>##g' "${INDEX}"

# Insere a versão atual antes do fechamento do body.
if grep -q '</body>' "${INDEX}"; then
  sed -i "s#</body>#<script src=\"akuma-games-bridge.js?v=${VERSION}\"></script></body>#" "${INDEX}"
else
  printf '\n<script src="akuma-games-bridge.js?v=%s"></script>\n' "${VERSION}" >> "${INDEX}"
fi

log "v${VERSION} aplicada em ${INDEX}"
INIT

chmod +x "${INIT_SCRIPT}"

echo "[4/7] Iniciando o Jellyfin para executar a ponte persistente..."
docker start "${CONTAINER}" >/dev/null

for _ in $(seq 1 40); do
  if docker exec "${CONTAINER}" sh -c \
    "test -s /usr/share/jellyfin/web/akuma-games-bridge.js && grep -q 'akuma-games-bridge.js?v=0.2.3' /usr/share/jellyfin/web/index.html" \
    2>/dev/null; then
    break
  fi
  sleep 1
done

echo "[5/7] Verificando a instalação dentro do container..."
docker exec "${CONTAINER}" sh -c \
  "test -s /usr/share/jellyfin/web/akuma-games-bridge.js && grep -q 'akuma-games-bridge.js?v=0.2.3' /usr/share/jellyfin/web/index.html" \
  || fail "a ponte persistente não foi aplicada dentro do container."

echo "[6/7] Limpando versões antigas do arquivo estático..."
docker exec "${CONTAINER}" sh -c \
  "grep -n 'akuma-games-bridge.js?v=0.2.3' /usr/share/jellyfin/web/index.html && ls -lh /usr/share/jellyfin/web/akuma-games-bridge.js"

echo "[7/7] Instalação concluída."
echo
echo "Akuma Games v0.2.3.0 instalado com Persistent Web Bridge."
echo "A ponte será reaplicada automaticamente em cada inicialização do container."
echo "Agora sincronize o catálogo e limpe os dados do site/cache do navegador."
echo "Ao entrar em um game pela biblioteca Games, ele abrirá automaticamente no launcher HTML5."

if [[ "${WAS_RUNNING}" != "true" ]]; then
  echo "Observação: o container estava parado antes da instalação e permaneceu iniciado para aplicar a atualização."
fi
