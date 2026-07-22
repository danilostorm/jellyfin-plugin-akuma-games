/* Akuma Games Web Bridge v0.2.2
 * Intercepta o botão Reproduzir dos itens da biblioteca Games e abre o game HTML5.
 */
(function () {
    'use strict';

    if (window.__akumaGamesBridgeLoaded) return;
    window.__akumaGamesBridgeLoaded = true;

    const state = {
        itemId: '',
        game: null,
        resolving: false,
        lastHash: '',
        routeTimer: 0
    };

    function getItemIdFromHash() {
        const match = String(window.location.hash || '').match(/[?&]id=([0-9a-fA-F-]{32,36})/);
        return match ? match[1] : '';
    }

    function valueOf(object, camel, pascal) {
        if (!object) return undefined;
        return object[camel] !== undefined ? object[camel] : object[pascal];
    }

    async function apiGet(path) {
        if (!window.ApiClient || typeof ApiClient.ajax !== 'function') {
            throw new Error('ApiClient ainda não está disponível');
        }

        return ApiClient.ajax({
            type: 'GET',
            url: ApiClient.getUrl(path),
            dataType: 'json'
        });
    }

    function ensureOverlay() {
        let overlay = document.getElementById('AkumaNativeGameOverlay');
        if (overlay) return overlay;

        const style = document.createElement('style');
        style.id = 'AkumaNativeGameStyles';
        style.textContent = [
            '#AkumaNativeGameOverlay{position:fixed;inset:0;z-index:2147483646;display:none;flex-direction:column;background:#050505;color:#fff}',
            '#AkumaNativeGameOverlay.akuma-open{display:flex}',
            '#AkumaNativeGameBar{min-height:58px;display:flex;align-items:center;gap:10px;padding:8px 12px;background:#151515;box-shadow:0 1px 0 rgba(255,255,255,.1)}',
            '#AkumaNativeGameTitle{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700}',
            '.akuma-native-game-button{min-height:40px;border:0;border-radius:8px;padding:0 16px;background:#2d2d2d;color:#fff;cursor:pointer;font:inherit}',
            '.akuma-native-game-button:hover,.akuma-native-game-button:focus{background:#3b3b3b}',
            '#AkumaNativeGameFrame{width:100%;flex:1;border:0;background:#000}',
            'body.akuma-native-game-active{overflow:hidden!important}',
            '#itemDetailPage.akuma-game-detail .btnPlay .buttonText:after{content:"Jogar"}',
            '#itemDetailPage.akuma-game-detail .btnPlay .buttonText{font-size:0}',
            '#itemDetailPage.akuma-game-detail .btnPlay .buttonText:after{font-size:initial}',
            '@media(max-width:600px){#AkumaNativeGameBar{flex-wrap:wrap}#AkumaNativeGameTitle{flex-basis:100%}.akuma-native-game-button{flex:1}}'
        ].join('');
        document.head.appendChild(style);

        overlay = document.createElement('div');
        overlay.id = 'AkumaNativeGameOverlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
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
        const overlay = ensureOverlay();
        overlay.querySelector('#AkumaNativeGameTitle').textContent = game.title || 'Game';
        overlay.querySelector('#AkumaNativeGameFrame').src = game.playerUrl;
        overlay.classList.add('akuma-open');
        document.body.classList.add('akuma-native-game-active');
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

    function markDetailPage(isGame) {
        const page = document.querySelector('#itemDetailPage');
        if (!page) return;
        page.classList.toggle('akuma-game-detail', Boolean(isGame));

        if (!isGame) return;
        const playButtons = page.querySelectorAll('.btnPlay, .playActionButton, [data-action="play"]');
        playButtons.forEach(function (button) {
            button.setAttribute('data-akuma-game-play', '1');
            button.setAttribute('aria-label', 'Jogar');
            button.setAttribute('title', 'Jogar');
            const text = button.querySelector('.buttonText');
            if (text) text.textContent = 'Jogar';
        });
    }

    async function resolveCurrentRoute() {
        const itemId = getItemIdFromHash();
        if (!itemId) {
            state.itemId = '';
            state.game = null;
            markDetailPage(false);
            return;
        }

        if (state.itemId === itemId && (state.game || state.resolving)) {
            markDetailPage(Boolean(state.game));
            return;
        }

        state.itemId = itemId;
        state.game = null;
        state.resolving = true;
        markDetailPage(false);

        try {
            const response = await apiGet('AkumaGames/ResolveItem/' + encodeURIComponent(itemId));
            if (state.itemId !== itemId) return;
            state.game = normalizeLaunchResponse(response);
            markDetailPage(Boolean(state.game));
        } catch (error) {
            if (state.itemId === itemId) {
                state.game = null;
                markDetailPage(false);
            }
        } finally {
            if (state.itemId === itemId) state.resolving = false;
        }
    }

    function scheduleRouteCheck() {
        window.clearTimeout(state.routeTimer);
        state.routeTimer = window.setTimeout(resolveCurrentRoute, 100);
    }

    document.addEventListener('click', function (event) {
        const button = event.target.closest('.btnPlay, .playActionButton, [data-action="play"], [data-akuma-game-play="1"]');
        if (!button || !state.game || getItemIdFromHash() !== state.itemId) return;

        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
        openGame(state.game);
    }, true);

    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
            const overlay = document.getElementById('AkumaNativeGameOverlay');
            if (overlay && overlay.classList.contains('akuma-open')) {
                event.preventDefault();
                closeGame();
            }
        }
    }, true);

    window.addEventListener('hashchange', scheduleRouteCheck);
    window.addEventListener('popstate', scheduleRouteCheck);

    const observer = new MutationObserver(function () {
        const hash = String(window.location.hash || '');
        if (hash !== state.lastHash) {
            state.lastHash = hash;
            scheduleRouteCheck();
        } else if (state.game) {
            markDetailPage(true);
        }
    });

    function start() {
        ensureOverlay();
        observer.observe(document.documentElement, { childList: true, subtree: true });
        state.lastHash = String(window.location.hash || '');
        scheduleRouteCheck();
        window.setInterval(function () {
            const hash = String(window.location.hash || '');
            if (hash !== state.lastHash) {
                state.lastHash = hash;
                scheduleRouteCheck();
            }
        }, 750);
        console.info('Akuma Games Web Bridge v0.2.2 carregado.');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
