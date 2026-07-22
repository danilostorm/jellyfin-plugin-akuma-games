/* Akuma Games Persistent Web Bridge v0.2.3
 * Liga os itens da biblioteca nativa Games ao PlayerUrl HTML5 da API Akumanimes.
 * Não usa o player de vídeo nem o visualizador de imagens do Jellyfin.
 */
(function () {
    'use strict';

    const VERSION = '0.2.3';
    if (window.__akumaGamesBridgeLoaded === VERSION) return;
    window.__akumaGamesBridgeLoaded = VERSION;

    const state = {
        itemId: '',
        game: null,
        resolving: false,
        pendingLaunch: false,
        autoLaunchedFor: '',
        lastHash: '',
        routeTimer: 0,
        observer: null
    };

    function currentHash() {
        return String(window.location.hash || '');
    }

    function getItemIdFromHash() {
        const hash = currentHash();
        const queryIndex = hash.indexOf('?');
        if (queryIndex < 0) return '';

        try {
            const params = new URLSearchParams(hash.slice(queryIndex + 1));
            return String(params.get('id') || '').trim();
        } catch (_) {
            const match = hash.match(/[?&]id=([0-9a-fA-F-]{32,36})/);
            return match ? match[1] : '';
        }
    }

    function valueOf(object, camel, pascal) {
        if (!object) return undefined;
        return object[camel] !== undefined ? object[camel] : object[pascal];
    }

    function waitForApiClient(timeoutMs) {
        const startedAt = Date.now();
        return new Promise(function (resolve, reject) {
            (function check() {
                if (window.ApiClient && typeof window.ApiClient.ajax === 'function') {
                    resolve(window.ApiClient);
                    return;
                }
                if (Date.now() - startedAt >= timeoutMs) {
                    reject(new Error('ApiClient não ficou disponível.'));
                    return;
                }
                window.setTimeout(check, 120);
            })();
        });
    }

    async function apiGet(path) {
        const client = await waitForApiClient(15000);
        return client.ajax({
            type: 'GET',
            url: client.getUrl(path),
            dataType: 'json'
        });
    }

    function ensureStyles() {
        if (document.getElementById('AkumaPersistentBridgeStyles')) return;

        const style = document.createElement('style');
        style.id = 'AkumaPersistentBridgeStyles';
        style.textContent = [
            '#AkumaNativeGameOverlay{position:fixed;inset:0;z-index:2147483646;display:none;flex-direction:column;background:#050505;color:#fff}',
            '#AkumaNativeGameOverlay.akuma-open{display:flex}',
            '#AkumaNativeGameBar{min-height:58px;display:flex;align-items:center;gap:10px;padding:8px 12px;background:#151515;box-shadow:0 1px 0 rgba(255,255,255,.1)}',
            '#AkumaNativeGameTitle{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700}',
            '.akuma-native-game-button{min-height:40px;border:0;border-radius:8px;padding:0 16px;background:#2d2d2d;color:#fff;cursor:pointer;font:inherit}',
            '.akuma-native-game-button:hover,.akuma-native-game-button:focus{background:#3b3b3b}',
            '#AkumaNativeGameFrame{width:100%;flex:1;border:0;background:#000}',
            'body.akuma-native-game-active{overflow:hidden!important}',
            '#AkumaGameLaunchButton{display:inline-flex!important;align-items:center;justify-content:center;gap:.55em;min-width:9.5em}',
            '#AkumaGameLaunchButton:before{content:"🎮"}',
            '.akuma-game-detail .btnPlay:not(#AkumaGameLaunchButton),.akuma-game-detail .playActionButton:not(#AkumaGameLaunchButton),.akuma-game-detail [data-action="play"]:not(#AkumaGameLaunchButton){display:none!important}',
            '.akuma-game-detail .detailImageContainer,.akuma-game-detail .itemDetailImage,.akuma-game-detail .primaryImageWrapper{cursor:pointer}',
            '#AkumaBridgeBadge{position:fixed;right:12px;bottom:12px;z-index:2147483000;padding:7px 10px;border-radius:999px;background:rgba(0,0,0,.78);color:#8ee7ff;font-size:12px;line-height:1;display:none;box-shadow:0 2px 12px rgba(0,0,0,.35)}',
            '#AkumaBridgeBadge.show{display:block}',
            '@media(max-width:600px){#AkumaNativeGameBar{flex-wrap:wrap}#AkumaNativeGameTitle{flex-basis:100%}.akuma-native-game-button{flex:1}#AkumaGameLaunchButton{width:100%}}'
        ].join('');
        document.head.appendChild(style);
    }

    function ensureBadge() {
        let badge = document.getElementById('AkumaBridgeBadge');
        if (!badge) {
            badge = document.createElement('div');
            badge.id = 'AkumaBridgeBadge';
            badge.textContent = 'Akuma Bridge ' + VERSION;
            document.body.appendChild(badge);
        }
        return badge;
    }

    function flashBadge(text, duration) {
        const badge = ensureBadge();
        badge.textContent = text;
        badge.classList.add('show');
        window.clearTimeout(badge.__akumaTimer);
        badge.__akumaTimer = window.setTimeout(function () {
            badge.classList.remove('show');
        }, duration || 2200);
    }

    function ensureOverlay() {
        let overlay = document.getElementById('AkumaNativeGameOverlay');
        if (overlay) return overlay;

        overlay = document.createElement('div');
        overlay.id = 'AkumaNativeGameOverlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', 'Executando game');
        overlay.innerHTML = [
            '<div id="AkumaNativeGameBar">',
            '<div id="AkumaNativeGameTitle">Game</div>',
            '<button id="AkumaNativeGameFullscreen" class="akuma-native-game-button" type="button">Tela cheia</button>',
            '<button id="AkumaNativeGameExternal" class="akuma-native-game-button" type="button">Nova janela</button>',
            '<button id="AkumaNativeGameClose" class="akuma-native-game-button" type="button">Fechar</button>',
            '</div>',
            '<iframe id="AkumaNativeGameFrame" allow="autoplay; fullscreen; gamepad; clipboard-read; clipboard-write" allowfullscreen></iframe>'
        ].join('');
        document.body.appendChild(overlay);

        overlay.querySelector('#AkumaNativeGameClose').addEventListener('click', closeGame);
        overlay.querySelector('#AkumaNativeGameExternal').addEventListener('click', function () {
            if (state.game && state.game.playerUrl) {
                window.open(state.game.playerUrl, '_blank', 'noopener,noreferrer');
            }
        });
        overlay.querySelector('#AkumaNativeGameFullscreen').addEventListener('click', async function () {
            try {
                if (overlay.requestFullscreen) await overlay.requestFullscreen();
            } catch (error) {
                console.warn('Akuma Games: não foi possível ativar tela cheia.', error);
            }
        });

        return overlay;
    }

    function openGame(game) {
        if (!game || !game.playerUrl) return;

        state.game = game;
        state.pendingLaunch = false;
        const overlay = ensureOverlay();
        overlay.querySelector('#AkumaNativeGameTitle').textContent = game.title || 'Game';
        overlay.querySelector('#AkumaNativeGameFrame').src = game.playerUrl;
        overlay.classList.add('akuma-open');
        document.body.classList.add('akuma-native-game-active');
        flashBadge('Abrindo ' + (game.title || 'game') + '…', 1400);
    }

    function closeGame() {
        const overlay = document.getElementById('AkumaNativeGameOverlay');
        if (!overlay) return;

        overlay.classList.remove('akuma-open');
        const frame = overlay.querySelector('#AkumaNativeGameFrame');
        if (frame) frame.src = 'about:blank';
        document.body.classList.remove('akuma-native-game-active');
    }

    function normalizeLaunchResponse(response) {
        const playerUrl = String(valueOf(response, 'playerUrl', 'PlayerUrl') || '');
        if (!playerUrl) return null;

        return {
            id: Number(valueOf(response, 'id', 'Id') || 0),
            title: String(valueOf(response, 'title', 'Title') || 'Game'),
            playerUrl: playerUrl
        };
    }

    function findDetailPage() {
        return document.querySelector('#itemDetailPage, .itemDetailPage, [data-role="page"].itemDetailPage');
    }

    function findActionContainer(page) {
        if (!page) return null;
        return page.querySelector('.mainDetailButtons, .detailButtons, .itemDetailActions, .detailPagePrimaryContainer .buttons, .itemDetailsGroup');
    }

    function ensureLaunchButton() {
        if (!state.game) return;

        const page = findDetailPage();
        if (!page) return;
        page.classList.add('akuma-game-detail');

        let button = page.querySelector('#AkumaGameLaunchButton');
        if (!button) {
            button = document.createElement('button');
            button.id = 'AkumaGameLaunchButton';
            button.type = 'button';
            button.className = 'raised button-submit emby-button akumaGameLaunchButton';
            button.textContent = 'Jogar agora';
            button.setAttribute('aria-label', 'Jogar agora');
            button.addEventListener('click', function (event) {
                event.preventDefault();
                event.stopPropagation();
                openGame(state.game);
            }, true);

            const container = findActionContainer(page);
            if (container) {
                container.insertBefore(button, container.firstChild);
            } else {
                button.style.position = 'fixed';
                button.style.right = '1.5em';
                button.style.bottom = '1.5em';
                button.style.zIndex = '2147482000';
                page.appendChild(button);
            }
        }

        const nativeButtons = page.querySelectorAll('.btnPlay, .playActionButton, [data-action="play"]');
        nativeButtons.forEach(function (nativeButton) {
            if (nativeButton.id === 'AkumaGameLaunchButton') return;
            nativeButton.setAttribute('data-akuma-native-disabled', '1');
            nativeButton.setAttribute('aria-hidden', 'true');
            nativeButton.tabIndex = -1;
        });
    }

    function clearDetailDecoration() {
        document.querySelectorAll('.akuma-game-detail').forEach(function (page) {
            page.classList.remove('akuma-game-detail');
        });
        document.querySelectorAll('#AkumaGameLaunchButton').forEach(function (button) {
            button.remove();
        });
    }

    function shouldCaptureNativeMediaTarget(target) {
        if (!(target instanceof Element)) return false;
        const page = target.closest('#itemDetailPage, .itemDetailPage');
        if (!page || !page.classList.contains('akuma-game-detail')) return false;

        return Boolean(target.closest([
            '.btnPlay',
            '.playActionButton',
            '[data-action="play"]',
            '.detailImageContainer',
            '.itemDetailImage',
            '.primaryImageWrapper',
            '.cardImageContainer',
            '.detailImageContainerInner',
            '.itemDetailImageContainer'
        ].join(',')));
    }

    function captureNativeAction(event) {
        if (!state.game || getItemIdFromHash() !== state.itemId) return;
        if (!shouldCaptureNativeMediaTarget(event.target)) return;

        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
        openGame(state.game);
    }

    async function resolveCurrentRoute() {
        const itemId = getItemIdFromHash();
        if (!itemId) {
            state.itemId = '';
            state.game = null;
            state.resolving = false;
            state.pendingLaunch = false;
            clearDetailDecoration();
            return;
        }

        if (state.itemId === itemId && state.game) {
            ensureLaunchButton();
            return;
        }
        if (state.itemId === itemId && state.resolving) return;

        state.itemId = itemId;
        state.game = null;
        state.resolving = true;
        clearDetailDecoration();

        try {
            const response = await apiGet('AkumaGames/ResolveItem/' + encodeURIComponent(itemId));
            if (state.itemId !== itemId) return;

            state.game = normalizeLaunchResponse(response);
            if (!state.game) throw new Error('PlayerUrl vazio.');

            ensureLaunchButton();
            flashBadge('Game detectado · Bridge ' + VERSION, 2200);

            // Abre automaticamente ao entrar no item da biblioteca. Isso evita que o
            // visualizador de fotos do Jellyfin assuma a capa antes do clique.
            if (state.autoLaunchedFor !== itemId) {
                state.autoLaunchedFor = itemId;
                window.setTimeout(function () {
                    if (state.game && state.itemId === itemId && getItemIdFromHash() === itemId) {
                        openGame(state.game);
                    }
                }, 320);
            } else if (state.pendingLaunch) {
                openGame(state.game);
            }
        } catch (error) {
            if (state.itemId === itemId) {
                state.game = null;
                state.pendingLaunch = false;
                clearDetailDecoration();
            }
            if (error && Number(error.status) !== 404) {
                console.warn('Akuma Games Bridge: falha ao resolver item.', error);
            }
        } finally {
            if (state.itemId === itemId) state.resolving = false;
        }
    }

    function scheduleRouteCheck(delay) {
        window.clearTimeout(state.routeTimer);
        state.routeTimer = window.setTimeout(resolveCurrentRoute, delay || 80);
    }

    function onRouteMutation() {
        const hash = currentHash();
        if (hash !== state.lastHash) {
            state.lastHash = hash;
            closeGame();
            state.autoLaunchedFor = '';
            scheduleRouteCheck(80);
        } else if (state.game) {
            ensureLaunchButton();
        }
    }

    function status() {
        return {
            version: VERSION,
            loaded: true,
            itemId: state.itemId,
            resolving: state.resolving,
            game: state.game,
            hash: currentHash(),
            overlayOpen: Boolean(document.querySelector('#AkumaNativeGameOverlay.akuma-open'))
        };
    }

    function start() {
        ensureStyles();
        ensureOverlay();
        ensureBadge();

        document.addEventListener('pointerdown', captureNativeAction, true);
        document.addEventListener('mousedown', captureNativeAction, true);
        document.addEventListener('touchstart', captureNativeAction, { capture: true, passive: false });
        document.addEventListener('click', captureNativeAction, true);

        document.addEventListener('keydown', function (event) {
            if (event.key !== 'Escape') return;
            const overlay = document.getElementById('AkumaNativeGameOverlay');
            if (overlay && overlay.classList.contains('akuma-open')) {
                event.preventDefault();
                event.stopPropagation();
                closeGame();
            }
        }, true);

        window.addEventListener('hashchange', function () {
            state.lastHash = currentHash();
            closeGame();
            state.autoLaunchedFor = '';
            scheduleRouteCheck(50);
        });
        window.addEventListener('popstate', function () {
            state.autoLaunchedFor = '';
            scheduleRouteCheck(50);
        });

        state.observer = new MutationObserver(onRouteMutation);
        state.observer.observe(document.documentElement, { childList: true, subtree: true });

        state.lastHash = currentHash();
        scheduleRouteCheck(100);
        window.setInterval(onRouteMutation, 600);

        window.AkumaGamesBridge = {
            version: VERSION,
            status: status,
            open: function () { if (state.game) openGame(state.game); },
            close: closeGame,
            refresh: function () { state.itemId = ''; scheduleRouteCheck(0); }
        };

        console.info('Akuma Games Persistent Web Bridge v' + VERSION + ' carregado.');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
