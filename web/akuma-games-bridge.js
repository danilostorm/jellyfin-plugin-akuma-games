/* Akuma Games Persistent Web Bridge v0.2.3.4
 * Liga os itens da biblioteca nativa Games ao PlayerUrl HTML5 da API Akumanimes.
 * Não usa o player de vídeo nem o visualizador de imagens do Jellyfin.
 */
(function () {
    'use strict';

    const VERSION = '0.2.3.4';
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
        observer: null,
        focusBeforeLaunch: null
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
        let style = document.getElementById('AkumaPersistentBridgeStyles');
        if (!style) {
            style = document.createElement('style');
            style.id = 'AkumaPersistentBridgeStyles';
            document.head.appendChild(style);
        }

        style.textContent = [
            '#AkumaNativeGameOverlay{position:fixed;inset:0;z-index:2147483646;display:none!important;visibility:hidden!important;pointer-events:none!important;opacity:0;flex-direction:column;background:#050505;color:#fff}',
            '#AkumaNativeGameOverlay.akuma-open{display:flex!important;visibility:visible!important;pointer-events:auto!important;opacity:1}',
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

    function setOverlayInteractive(overlay, interactive) {
        if (!overlay) return;

        // Remove os atributos usados na v0.2.3.3. Eles podiam deixar o iframe
        // permanentemente oculto em alguns navegadores mesmo após abrir o game.
        if (overlay.hasAttribute('hidden')) overlay.removeAttribute('hidden');
        if (overlay.hasAttribute('inert')) overlay.removeAttribute('inert');

        const pointerEvents = interactive ? 'auto' : 'none';
        const visibility = interactive ? 'visible' : 'hidden';
        const ariaHidden = interactive ? 'false' : 'true';

        if (overlay.style.pointerEvents !== pointerEvents) overlay.style.pointerEvents = pointerEvents;
        if (overlay.style.visibility !== visibility) overlay.style.visibility = visibility;
        if (overlay.getAttribute('aria-hidden') !== ariaHidden) overlay.setAttribute('aria-hidden', ariaHidden);
    }

    function ensureOverlay() {
        let overlay = document.getElementById('AkumaNativeGameOverlay');
        if (overlay) {
            if (!overlay.classList.contains('akuma-open')) setOverlayInteractive(overlay, false);
            return overlay;
        }

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
        setOverlayInteractive(overlay, false);

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
        state.focusBeforeLaunch = document.activeElement instanceof HTMLElement ? document.activeElement : null;

        const overlay = ensureOverlay();
        const frame = overlay.querySelector('#AkumaNativeGameFrame');
        const requestedUrl = String(game.playerUrl);

        overlay.querySelector('#AkumaNativeGameTitle').textContent = game.title || 'Game';
        overlay.classList.add('akuma-open');
        setOverlayInteractive(overlay, true);
        document.body.classList.add('akuma-native-game-active');

        // pointerdown, mousedown e click podem disparar na mesma ação. Não recarrega
        // o iframe se o mesmo game já estiver sendo aberto.
        if (frame && frame.dataset.akumaPlayerUrl !== requestedUrl) {
            frame.dataset.akumaPlayerUrl = requestedUrl;
            frame.src = requestedUrl;
        }

        flashBadge('Abrindo ' + (game.title || 'game') + '…', 1400);
    }

    async function closeGame() {
        const overlay = document.getElementById('AkumaNativeGameOverlay');
        if (!overlay) return;

        overlay.classList.remove('akuma-open');
        setOverlayInteractive(overlay, false);

        const frame = overlay.querySelector('#AkumaNativeGameFrame');
        if (frame) {
            try { frame.blur(); } catch (_) { /* sem ação */ }
            delete frame.dataset.akumaPlayerUrl;
            frame.src = 'about:blank';
        }

        document.body.classList.remove('akuma-native-game-active');

        try {
            if (document.fullscreenElement === overlay && document.exitFullscreen) {
                await document.exitFullscreen();
            }
        } catch (_) {
            // O navegador pode negar a saída de tela cheia fora de um gesto do usuário.
        }

        if (state.focusBeforeLaunch && document.contains(state.focusBeforeLaunch)) {
            try { state.focusBeforeLaunch.focus(); } catch (_) { /* sem ação */ }
        }
        state.focusBeforeLaunch = null;
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

    function isJellyfinNavigationTarget(target) {
        if (!(target instanceof Element)) return false;

        return Boolean(target.closest([
            '.skinHeader',
            '.headerTop',
            '.headerBackButton',
            '.headerHomeButton',
            '.mainDrawerButton',
            '.headerButton',
            '.headerSyncButton',
            '.headerUserButton',
            '.headerSearchButton',
            '.headerCastButton',
            '.btnUserViewHeader',
            '[data-action="back"]',
            '[data-action="home"]',
            '[aria-label="Voltar"]',
            '[aria-label="Início"]',
            '[aria-label="Home"]',
            'nav',
            '[role="navigation"]'
        ].join(',')));
    }

    function shouldCaptureNativeMediaTarget(target) {
        if (!(target instanceof Element)) return false;
        if (isJellyfinNavigationTarget(target)) return false;

        const page = target.closest('#itemDetailPage, .itemDetailPage');
        if (!page || !page.classList.contains('akuma-game-detail')) return false;

        const playTarget = target.closest('.btnPlay, .playActionButton, [data-action="play"]');
        if (playTarget) return true;

        if (target.closest('button, a, input, select, textarea, [role="button"], [role="link"]')) {
            return false;
        }

        const imageTarget = target.closest([
            'img.itemDetailImage',
            '.itemDetailImage',
            '.primaryImageWrapper',
            '.detailImageContainerInner',
            '.itemDetailImageContainer'
        ].join(','));

        return Boolean(imageTarget && page.contains(imageTarget));
    }

    function captureNativeAction(event) {
        if (!state.game || getItemIdFromHash() !== state.itemId) return;
        if (isJellyfinNavigationTarget(event.target)) return;
        if (!shouldCaptureNativeMediaTarget(event.target)) return;

        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
        openGame(state.game);
    }

    function releaseNavigation(event) {
        if (!isJellyfinNavigationTarget(event.target)) return;
        const overlay = document.getElementById('AkumaNativeGameOverlay');
        if (overlay && overlay.classList.contains('akuma-open')) {
            void closeGame();
        }
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
            void closeGame();
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
        const overlay = ensureOverlay();
        ensureBadge();
        overlay.classList.remove('akuma-open');
        setOverlayInteractive(overlay, false);
        document.body.classList.remove('akuma-native-game-active');

        document.addEventListener('pointerdown', releaseNavigation, true);
        document.addEventListener('mousedown', releaseNavigation, true);
        document.addEventListener('touchstart', releaseNavigation, { capture: true, passive: true });
        document.addEventListener('click', releaseNavigation, true);

        document.addEventListener('pointerdown', captureNativeAction, true);
        document.addEventListener('mousedown', captureNativeAction, true);
        document.addEventListener('touchstart', captureNativeAction, { capture: true, passive: false });
        document.addEventListener('click', captureNativeAction, true);

        document.addEventListener('keydown', function (event) {
            if (event.key !== 'Escape') return;
            const currentOverlay = document.getElementById('AkumaNativeGameOverlay');
            if (currentOverlay && currentOverlay.classList.contains('akuma-open')) {
                event.preventDefault();
                event.stopPropagation();
                void closeGame();
            }
        }, true);

        window.addEventListener('hashchange', function () {
            state.lastHash = currentHash();
            void closeGame();
            state.autoLaunchedFor = '';
            scheduleRouteCheck(50);
        });
        window.addEventListener('popstate', function () {
            void closeGame();
            state.autoLaunchedFor = '';
            scheduleRouteCheck(50);
        });

        // Observa somente alterações estruturais. A v0.2.3.3 também observava
        // class/style/hidden e podia criar um ciclo contínuo de mutações, travando
        // o carregamento do iframe e da própria interface.
        state.observer = new MutationObserver(onRouteMutation);
        state.observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });

        state.lastHash = currentHash();
        scheduleRouteCheck(100);
        window.setInterval(onRouteMutation, 600);

        window.AkumaGamesBridge = {
            version: VERSION,
            status: status,
            open: function () { if (state.game) openGame(state.game); },
            close: function () { void closeGame(); },
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
