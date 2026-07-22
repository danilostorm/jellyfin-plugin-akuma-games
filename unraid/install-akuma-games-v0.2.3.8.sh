#!/bin/bash
set -Eeuo pipefail

CONTAINER="${JELLYFIN_CONTAINER:-jellyfin}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUNDLE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DLL_SOURCE="${BUNDLE_DIR}/Jellyfin.Plugin.AkumaGames.dll"
BRIDGE_SOURCE="${BUNDLE_DIR}/web/akuma-games-bridge.js"
FAST_ROOT_SOURCE="${BUNDLE_DIR}/web/akuma-games-fast-root.js"
CARD_CLICK_SOURCE="${BUNDLE_DIR}/web/akuma-games-card-click.js"
VERSION="0.2.3.8"

fail() {
  echo "ERRO: $*" >&2
  exit 1
}

[[ "${EUID}" -eq 0 ]] || fail "execute como root no terminal do Unraid."
command -v docker >/dev/null 2>&1 || fail "Docker não foi encontrado."
docker inspect "${CONTAINER}" >/dev/null 2>&1 || fail "container ${CONTAINER} não foi encontrado."
[[ -s "${DLL_SOURCE}" ]] || fail "Jellyfin.Plugin.AkumaGames.dll não foi encontrado no pacote."
[[ -s "${BRIDGE_SOURCE}" ]] || fail "web/akuma-games-bridge.js não foi encontrado no pacote."
[[ -s "${FAST_ROOT_SOURCE}" ]] || fail "web/akuma-games-fast-root.js não foi encontrado no pacote."
[[ -s "${CARD_CLICK_SOURCE}" ]] || fail "web/akuma-games-card-click.js não foi encontrado no pacote."

APPDATA="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/config"}}{{.Source}}{{end}}{{end}}' "${CONTAINER}")"
[[ -n "${APPDATA}" ]] || APPDATA="/mnt/user/appdata/jellyfin"
PLUGIN_DIR="${APPDATA}/data/plugins/Akuma Games"
PERSIST_DIR="${APPDATA}/akuma-games-bridge"
INIT_DIR="${APPDATA}/custom-cont-init.d"
INIT_SCRIPT="${INIT_DIR}/99-akuma-games-bridge.sh"

echo "Pasta /config detectada: ${APPDATA}"
echo "[1/6] Parando o Jellyfin..."
docker stop "${CONTAINER}" >/dev/null

echo "[2/6] Atualizando o plugin..."
mkdir -p "${PLUGIN_DIR}"
if [[ -f "${PLUGIN_DIR}/Jellyfin.Plugin.AkumaGames.dll" ]]; then
  cp -f "${PLUGIN_DIR}/Jellyfin.Plugin.AkumaGames.dll" \
    "${PLUGIN_DIR}/Jellyfin.Plugin.AkumaGames.dll.bak-${VERSION}"
fi
cp -f "${DLL_SOURCE}" "${PLUGIN_DIR}/Jellyfin.Plugin.AkumaGames.dll"
chown 99:100 "${PLUGIN_DIR}/Jellyfin.Plugin.AkumaGames.dll" 2>/dev/null || true
chmod 0644 "${PLUGIN_DIR}/Jellyfin.Plugin.AkumaGames.dll"

echo "[3/6] Salvando os bridges em /config..."
mkdir -p "${PERSIST_DIR}" "${INIT_DIR}"
cp -f "${BRIDGE_SOURCE}" "${PERSIST_DIR}/akuma-games-bridge.js"
cp -f "${FAST_ROOT_SOURCE}" "${PERSIST_DIR}/akuma-games-fast-root.js"
cp -f "${CARD_CLICK_SOURCE}" "${PERSIST_DIR}/akuma-games-card-click.js"
chmod 0644 "${PERSIST_DIR}"/*.js

cat > "${INIT_SCRIPT}" <<'INIT'
#!/bin/sh
set -eu

SOURCE_DIR="/config/akuma-games-bridge"
WEB_DIR="/usr/share/jellyfin/web"
INDEX="${WEB_DIR}/index.html"
VERSION="0.2.3.8"

[ -f "${INDEX}" ] || exit 0
[ -s "${SOURCE_DIR}/akuma-games-bridge.js" ] || exit 0
[ -s "${SOURCE_DIR}/akuma-games-fast-root.js" ] || exit 0
[ -s "${SOURCE_DIR}/akuma-games-card-click.js" ] || exit 0

cp -f "${SOURCE_DIR}/akuma-games-bridge.js" "${WEB_DIR}/akuma-games-bridge.js"
cp -f "${SOURCE_DIR}/akuma-games-fast-root.js" "${WEB_DIR}/akuma-games-fast-root.js"
cp -f "${SOURCE_DIR}/akuma-games-card-click.js" "${WEB_DIR}/akuma-games-card-click.js"
chmod 0644 "${WEB_DIR}/akuma-games-bridge.js" "${WEB_DIR}/akuma-games-fast-root.js" "${WEB_DIR}/akuma-games-card-click.js"

sed -i -E 's#<script[^>]+src="akuma-games-bridge\.js(\?v=[^"]+)?"[^>]*></script>##g' "${INDEX}"
sed -i -E 's#<script[^>]+src="akuma-games-fast-root\.js(\?v=[^"]+)?"[^>]*></script>##g' "${INDEX}"
sed -i -E 's#<script[^>]+src="akuma-games-card-click\.js(\?v=[^"]+)?"[^>]*></script>##g' "${INDEX}"

SCRIPTS="<script src=\"akuma-games-bridge.js?v=${VERSION}\"></script><script src=\"akuma-games-fast-root.js?v=${VERSION}\"></script><script src=\"akuma-games-card-click.js?v=${VERSION}\"></script>"
if grep -q '</body>' "${INDEX}"; then
  sed -i "s#</body>#${SCRIPTS}</body>#" "${INDEX}"
else
  printf '\n%s\n' "${SCRIPTS}" >> "${INDEX}"
fi

echo "[Akuma Games Bridge] v${VERSION} aplicada."
INIT

chmod 0755 "${INIT_SCRIPT}"

echo "[4/6] Iniciando o Jellyfin..."
docker start "${CONTAINER}" >/dev/null
for _ in $(seq 1 40); do
  docker exec "${CONTAINER}" test -f /usr/share/jellyfin/web/index.html 2>/dev/null && break
  sleep 1
done

echo "[5/6] Aplicando o bridge imediatamente..."
docker exec "${CONTAINER}" sh /config/custom-cont-init.d/99-akuma-games-bridge.sh

echo "[6/6] Verificando..."
docker exec "${CONTAINER}" sh -c "
  test -s /usr/share/jellyfin/web/akuma-games-bridge.js &&
  test -s /usr/share/jellyfin/web/akuma-games-fast-root.js &&
  test -s /usr/share/jellyfin/web/akuma-games-card-click.js &&
  grep -q 'akuma-games-fast-root.js?v=${VERSION}' /usr/share/jellyfin/web/index.html
" || fail "o catálogo público rápido não foi instalado corretamente."

docker exec "${CONTAINER}" sh -c "grep -n 'akuma-games-.*.js?v=${VERSION}' /usr/share/jellyfin/web/index.html"

echo
echo "Akuma Games v${VERSION} instalado."
echo "A biblioteca Games agora abre o mesmo catálogo rápido da página do plugin."
echo "Não é necessário sincronizar os games novamente."
echo "Feche todas as abas do Jellyfin e teste em janela anônima."
