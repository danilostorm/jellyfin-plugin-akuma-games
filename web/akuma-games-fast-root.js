/* Akuma Games Unified PC + Android Catalog Bridge v0.2.3.9
 * Substitui a raiz nativa lenta da biblioteca Games pelo catálogo rápido
 * em navegadores desktop e no cliente Android baseado no Jellyfin Web.
 */
(function () {
    'use strict';

    const VERSION = '0.2.3.9';
    const STORAGE_KEY = 'akuma-public-catalog:v0.2.3.9';
    const CACHE_TTL = 24 * 60 * 60 * 1000;

    if (window.__akumaGamesFastRootLoaded === VERSION) return;
    window.__akumaGamesFastRootLoaded = VERSION;

    const state = {
        games: [],
        filtered: [],
        rendered: 0,
        promise: null,
        loadedAt: 0,
        lastError: '',
        aliases: new Set(),
        nonRoots: new Set(),
        catalogOpen: false,
        gameOpen: false,
        catalogHistory: false,
        gameHistory: false,
        activeGameUrl: '',
        activeGameTitle: '',
        routeSequence: 0,
        searchTimer: 0,
        loadObserver: null,
        scrollTop: 0,
        lastActivationAt: 0
    };

    function valueOf(object, camel, pascal) {
        if (!object) return undefined;
        return object[camel] !== undefined ? object[camel] : object[pascal];
    }

    function normalizeText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('pt-BR');
    }

    function isCompact() {
        return window.matchMedia('(max-width: 900px), (pointer: coarse)').matches;
    }

    function pageSize() {
        return isCompact() ? 48 : 120;
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

                window.setTimeout(check, 100);
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

    function currentServerId() {
        try {
            if (window.ApiClient && typeof window.ApiClient.serverId === 'function') {
                return String(window.ApiClient.serverId() || '');
            }
        } catch (_) {
            // serverId é opcional.
        }

        try {
            const hash = String(window.location.hash || '');
            const queryIndex = hash.indexOf('?');
            if (queryIndex >= 0) {
                return String(new URLSearchParams(hash.slice(queryIndex + 1)).get('serverId') || '');
            }
        } catch (_) {
            // Sem ação.
        }

        return '';
    }

    function normalizeGame(item) {
        return {
            id: Number(valueOf(item, 'id', 'Id') || 0),
            title: String(valueOf(item, 'title', 'Title') || 'Sem nome'),
            imageUrl: String(valueOf(item, 'imageUrl', 'ImageUrl') || ''),
            system: String(valueOf(item, 'system', 'System') || 'Outros'),
            genre: String(valueOf(item, 'genre', 'Genre') || ''),
            players: String(valueOf(item, 'players', 'Players') || ''),
            playCount: Number(valueOf(item, 'playCount', 'PlayCount') || 0)
        };
    }

    function loadCache() {
        if (state.games.length) return state.games;

        try {
            const raw = window.localStorage.getItem(STORAGE_KEY);
            if (!raw) return [];

            const cached = JSON.parse(raw);
            if (!cached || Date.now() - Number(cached.savedAt || 0) > CACHE_TTL) return [];

            const items = Array.isArray(cached.games) ? cached.games : [];
            state.games = items.map(normalizeGame).filter(function (game) { return game.id > 0; });
            state.loadedAt = Number(cached.savedAt || Date.now());

            (cached.aliases || []).forEach(function (id) {
                if (id) state.aliases.add(String(id));
            });

            return state.games;
        } catch (_) {
            return [];
        }
    }

    function saveCache() {
        if (!state.games.length) return;

        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
                savedAt: state.loadedAt || Date.now(),
                games: state.games,
                aliases: Array.from(state.aliases)
            }));
        } catch (_) {
            // Cache local é apenas uma otimização.
        }
    }

    async function loadCatalog(forceRefresh) {
        if (!forceRefresh && state.games.length) return state.games;
        if (state.promise) return state.promise;

        state.promise = (async function () {
            try {
                const response = await apiGet('AkumaGames/Catalog' + (forceRefresh ? '?refresh=true' : ''));
                const items = valueOf(response, 'items', 'Items') || [];
                state.games = items.map(normalizeGame).filter(function (game) { return game.id > 0; });
                state.loadedAt = Date.now();
                state.lastError = '';
                saveCache();
                return state.games;
            } catch (error) {
                state.lastError = String((error && (error.statusText || error.message || error.status)) || 'Falha ao carregar o catálogo.');
                throw error;
            } finally {
                state.promise = null;
            }
        })();

        return state.promise;
    }

    function ensureStyles() {
        if (document.getElementById('AkumaPublicCatalogStyles')) return;

        const style = document.createElement('style');
        style.id = 'AkumaPublicCatalogStyles';
        style.textContent = [
            'body.akumaPublicCatalogOpen{overflow:hidden!important}',
            '#AkumaFastRoot{position:fixed;left:0;right:0;bottom:0;z-index:2147482000;display:none;background:var(--theme-background-primary,#0b0c0d);color:var(--theme-text-primary,#eee);overflow:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;touch-action:pan-y}',
            '#AkumaFastRoot.open{display:block}',
            '.akumaPublicMobileBar{display:none;position:sticky;top:0;z-index:8;align-items:center;gap:.65em;min-height:3.6em;padding:env(safe-area-inset-top,0) .7em 0;background:rgba(17,18,19,.96);backdrop-filter:blur(14px);box-shadow:0 1px 0 rgba(255,255,255,.08)}',
            '.akumaPublicMobileBack{width:2.8em;height:2.8em;border:0;border-radius:50%;background:transparent;color:inherit;font-size:1.4em;cursor:pointer}',
            '.akumaPublicMobileTitle{font-size:1.08em;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
            '.akumaPublicShell{padding:2.2em 3.2% calc(4em + env(safe-area-inset-bottom,0));max-width:1900px;margin:0 auto}',
            '.akumaPublicHero{display:flex;align-items:center;justify-content:space-between;gap:1.5em;margin-bottom:1.5em}',
            '.akumaPublicTitleWrap{display:flex;align-items:center;gap:1em;min-width:0}',
            '.akumaPublicIcon{width:3.2em;height:3.2em;border-radius:1em;display:grid;place-items:center;background:rgba(0,164,220,.18);font-size:1.4em;flex:0 0 auto}',
            '.akumaPublicHero h1{margin:0;font-size:2.1em;line-height:1.05}',
            '.akumaPublicHero p{margin:.45em 0 0;opacity:.72}',
            '.akumaPublicStats{display:flex;gap:.7em;flex-wrap:wrap;justify-content:flex-end}',
            '.akumaPublicPill{padding:.72em 1em;border-radius:.7em;background:rgba(255,255,255,.08);white-space:nowrap}',
            '.akumaPublicToolbar{position:sticky;top:0;z-index:7;display:grid;grid-template-columns:minmax(240px,1fr) minmax(180px,.34fr) minmax(180px,.34fr) auto;gap:.8em;margin:0 0 1.3em;padding:.75em 0;background:linear-gradient(var(--theme-background-primary,#0b0c0d) 82%,transparent)}',
            '.akumaPublicToolbar input,.akumaPublicToolbar select{width:100%;box-sizing:border-box;min-height:3.2em;border:1px solid rgba(255,255,255,.08);border-radius:.7em;padding:0 1em;background:rgba(255,255,255,.1);color:inherit;font:inherit}',
            '.akumaPublicToolbar input:focus,.akumaPublicToolbar select:focus{outline:2px solid rgba(0,164,220,.8);outline-offset:1px}',
            '.akumaPublicToolbar select option{color:#111}',
            '.akumaPublicRefresh{min-height:3.2em;border:0;border-radius:.7em;padding:0 1.2em;cursor:pointer;font:inherit}',
            '.akumaPublicStatus{min-height:1.6em;margin:-.35em 0 .8em;opacity:.72}',
            '.akumaPublicGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:1.15em}',
            '.akumaPublicCard{position:relative;min-width:0;border-radius:.85em;overflow:hidden;background:rgba(255,255,255,.065);box-shadow:0 .35em 1.2em rgba(0,0,0,.18);transition:transform .16s ease,background .16s ease;cursor:pointer;outline:none}',
            '.akumaPublicCard:focus,.akumaPublicCard:focus-within,.akumaPublicCard:hover{transform:translateY(-.25em);background:rgba(255,255,255,.1);box-shadow:0 0 0 2px rgba(0,164,220,.78),0 .45em 1.4em rgba(0,0,0,.28)}',
            '.akumaPublicPoster{aspect-ratio:3/4;width:100%;object-fit:cover;display:block;background:rgba(255,255,255,.06)}',
            '.akumaPublicBody{padding:.85em}',
            '.akumaPublicTitle{font-size:1.02em;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:.45em}',
            '.akumaPublicMeta{font-size:.82em;opacity:.68;min-height:2.4em;line-height:1.35}',
            '.akumaPublicPlay{width:100%;margin-top:.8em;min-height:2.8em;border:0;border-radius:.58em;cursor:pointer;font-weight:700;background:#00a4dc;color:#fff;font:inherit}',
            '.akumaPublicMoreWrap{display:flex;justify-content:center;padding:1.8em 0 3em}',
            '.akumaPublicMore{min-width:12em;min-height:3em;border:0;border-radius:.7em;cursor:pointer;font:inherit}',
            '.akumaPublicSentinel{height:1px;width:100%}',
            '.akumaPublicEmpty{grid-column:1/-1;text-align:center;padding:5em 1em;opacity:.72}',
            '#AkumaPublicGameOverlay{position:fixed;inset:0;z-index:2147483646;display:none;flex-direction:column;background:#080808;color:#fff;width:100vw;height:100vh;height:100dvh}',
            '#AkumaPublicGameOverlay.open{display:flex}',
            '.akumaPublicGameBar{min-height:3.8em;display:flex;align-items:center;gap:.8em;padding:env(safe-area-inset-top,0) .8em 0;background:#171717;box-shadow:0 1px 0 rgba(255,255,255,.09)}',
            '.akumaPublicGameTitle{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600}',
            '.akumaPublicGameButton{min-height:2.7em;border:0;border-radius:.55em;padding:0 1em;cursor:pointer;font:inherit}',
            '.akumaPublicGameFrame{border:0;width:100%;flex:1;min-height:0;background:#000}',
            '@media(max-width:900px),(pointer:coarse){.akumaPublicMobileBar{display:flex}.akumaPublicShell{padding:1em 3.2% calc(2.5em + env(safe-area-inset-bottom,0))}.akumaPublicHero{align-items:flex-start;flex-direction:column;margin-bottom:1em}.akumaPublicHero h1{font-size:1.65em}.akumaPublicHero p{font-size:.92em}.akumaPublicStats{justify-content:flex-start}.akumaPublicPill{padding:.55em .72em;font-size:.86em}.akumaPublicToolbar{top:3.6em;grid-template-columns:1fr 1fr;padding:.65em 0}.akumaPublicToolbar input{grid-column:1/-1}.akumaPublicRefresh{grid-column:1/-1}.akumaPublicGrid{grid-template-columns:repeat(3,minmax(0,1fr));gap:.8em}.akumaPublicCard:hover{transform:none}.akumaPublicPlay{min-height:3em}.akumaPublicGameBar{min-height:4.2em;padding-left:.55em;padding-right:.55em}.akumaPublicGameButton{min-height:3em;padding:0 .85em}}',
            '@media(max-width:600px){.akumaPublicGrid{grid-template-columns:repeat(2,minmax(0,1fr));gap:.7em}.akumaPublicBody{padding:.68em}.akumaPublicTitle{font-size:.94em}.akumaPublicMeta{font-size:.76em;min-height:2.25em}.akumaPublicToolbar{grid-template-columns:1fr}.akumaPublicToolbar input,.akumaPublicRefresh{grid-column:auto}.akumaPublicGameBar{flex-wrap:wrap;padding-bottom:.45em}.akumaPublicGameTitle{flex-basis:100%;order:-1}.akumaPublicGameButton{flex:1}}',
            '@media(max-width:380px){.akumaPublicGrid{grid-template-columns:1fr 1fr}.akumaPublicShell{padding-left:2.4%;padding-right:2.4%}.akumaPublicBody{padding:.58em}.akumaPublicPlay{font-size:.9em}}'
        ].join('');
        document.head.appendChild(style);
    }

    function ensureRoot() {
        ensureStyles();

        let root = document.getElementById('AkumaFastRoot');
        if (root) return root;

        root = document.createElement('section');
        root.id = 'AkumaFastRoot';
        root.setAttribute('aria-label', 'Catálogo Games');
        root.innerHTML = [
            '<div class="akumaPublicMobileBar"><button id="AkumaPublicMobileBack" class="akumaPublicMobileBack" type="button" aria-label="Voltar">‹</button><div class="akumaPublicMobileTitle">Games</div></div>',
            '<div class="akumaPublicShell">',
            '<header class="akumaPublicHero">',
            '<div class="akumaPublicTitleWrap"><div class="akumaPublicIcon" aria-hidden="true">🎮</div><div><h1>Games</h1><p>Escolha um game e jogue dentro do Jellyfin sem usar o player de vídeo.</p></div></div>',
            '<div class="akumaPublicStats"><div class="akumaPublicPill"><strong id="AkumaPublicCount">0</strong> games</div><div class="akumaPublicPill"><strong id="AkumaPublicVisible">0</strong> exibidos</div></div>',
            '</header>',
            '<section class="akumaPublicToolbar" aria-label="Filtros do catálogo">',
            '<input id="AkumaPublicSearch" type="search" placeholder="Buscar um game..." autocomplete="off" inputmode="search">',
            '<select id="AkumaPublicSystem" aria-label="Sistema"><option value="">Todos os sistemas</option></select>',
            '<select id="AkumaPublicGenre" aria-label="Gênero"><option value="">Todos os gêneros</option></select>',
            '<button id="AkumaPublicRefresh" class="raised button-submit akumaPublicRefresh" type="button">Atualizar</button>',
            '</section>',
            '<div id="AkumaPublicStatus" class="akumaPublicStatus" role="status"></div>',
            '<main id="AkumaPublicGrid" class="akumaPublicGrid"></main>',
            '<div id="AkumaPublicSentinel" class="akumaPublicSentinel" aria-hidden="true"></div>',
            '<div class="akumaPublicMoreWrap"><button id="AkumaPublicMore" class="raised akumaPublicMore" type="button" hidden>Carregar mais</button></div>',
            '</div>'
        ].join('');
        document.body.appendChild(root);

        const gameOverlay = document.createElement('div');
        gameOverlay.id = 'AkumaPublicGameOverlay';
        gameOverlay.setAttribute('role', 'dialog');
        gameOverlay.setAttribute('aria-modal', 'true');
        gameOverlay.innerHTML = [
            '<div class="akumaPublicGameBar">',
            '<button id="AkumaPublicGameClose" class="akumaPublicGameButton" type="button">Voltar</button>',
            '<div id="AkumaPublicGameTitle" class="akumaPublicGameTitle">Game</div>',
            '<button id="AkumaPublicGameFullscreen" class="akumaPublicGameButton" type="button">Tela cheia</button>',
            '<button id="AkumaPublicGameNewWindow" class="akumaPublicGameButton" type="button">Nova janela</button>',
            '</div>',
            '<iframe id="AkumaPublicGameFrame" class="akumaPublicGameFrame" allow="autoplay; fullscreen; gamepad; clipboard-read; clipboard-write" allowfullscreen></iframe>'
        ].join('');
        document.body.appendChild(gameOverlay);

        bindRootEvents(root, gameOverlay);
        setupLoadObserver(root);
        return root;
    }

    function updateTop(root) {
        if (isCompact()) {
            root.style.top = '0px';
            return;
        }

        const header = document.querySelector('.skinHeader,.headerTop');
        const bottom = header ? Math.max(0, Math.round(header.getBoundingClientRect().bottom)) : 64;
        root.style.top = Math.max(50, bottom) + 'px';
    }

    function escapeHtml(value) {
        return String(value || '').replace(/[&<>'"]/g, function (character) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character];
        });
    }

    function fallbackImage() {
        return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="100%" height="100%" fill="#202020"/><text x="50%" y="50%" fill="#aaa" font-size="70" text-anchor="middle">🎮</text></svg>');
    }

    function setOptions(select, values, firstLabel) {
        const current = select.value;
        const unique = Array.from(new Set(values.filter(Boolean))).sort(function (a, b) {
            return a.localeCompare(b, 'pt-BR');
        });

        select.innerHTML = '<option value="">' + escapeHtml(firstLabel) + '</option>' + unique.map(function (item) {
            return '<option value="' + escapeHtml(item) + '">' + escapeHtml(item) + '</option>';
        }).join('');
        select.value = unique.includes(current) ? current : '';
    }

    function rootElements() {
        const root = ensureRoot();
        return {
            root: root,
            search: root.querySelector('#AkumaPublicSearch'),
            system: root.querySelector('#AkumaPublicSystem'),
            genre: root.querySelector('#AkumaPublicGenre'),
            status: root.querySelector('#AkumaPublicStatus'),
            grid: root.querySelector('#AkumaPublicGrid'),
            count: root.querySelector('#AkumaPublicCount'),
            visible: root.querySelector('#AkumaPublicVisible'),
            more: root.querySelector('#AkumaPublicMore'),
            sentinel: root.querySelector('#AkumaPublicSentinel')
        };
    }

    function prepareFilters() {
        const elements = rootElements();
        setOptions(elements.system, state.games.map(function (game) { return game.system; }), 'Todos os sistemas');

        const genres = state.games.flatMap(function (game) {
            return game.genre ? game.genre.split(' / ').map(function (item) { return item.trim(); }) : [];
        });
        setOptions(elements.genre, genres, 'Todos os gêneros');
    }

    function applyFilters() {
        const elements = rootElements();
        const query = elements.search.value.trim().toLocaleLowerCase('pt-BR');
        const selectedSystem = elements.system.value;
        const selectedGenre = elements.genre.value;

        state.filtered = state.games.filter(function (game) {
            const searchable = (game.title + ' ' + game.system + ' ' + game.genre).toLocaleLowerCase('pt-BR');
            return (!query || searchable.includes(query))
                && (!selectedSystem || game.system === selectedSystem)
                && (!selectedGenre || game.genre.split(' / ').includes(selectedGenre) || game.genre === selectedGenre);
        });

        state.rendered = 0;
        elements.grid.innerHTML = '';
        renderNext();
        elements.root.scrollTop = 0;
    }

    function renderNext() {
        const elements = rootElements();
        const next = state.filtered.slice(state.rendered, state.rendered + pageSize());

        if (!next.length && state.rendered === 0) {
            elements.grid.innerHTML = '<div class="akumaPublicEmpty">Nenhum game encontrado com esses filtros.</div>';
        } else if (next.length) {
            const html = next.map(function (game, index) {
                const meta = [game.system, game.genre].filter(Boolean).join(' · ');
                const image = game.imageUrl || fallbackImage();
                const loading = state.rendered + index < 18 ? 'eager' : 'lazy';

                return '<article class="akumaPublicCard" tabindex="0" role="button" aria-label="Jogar ' + escapeHtml(game.title) + '" data-akuma-public-game-id="' + game.id + '">'
                    + '<img class="akumaPublicPoster" loading="' + loading + '" decoding="async" src="' + escapeHtml(image) + '" alt="Capa de ' + escapeHtml(game.title) + '">'
                    + '<div class="akumaPublicBody">'
                    + '<div class="akumaPublicTitle" title="' + escapeHtml(game.title) + '">' + escapeHtml(game.title) + '</div>'
                    + '<div class="akumaPublicMeta">' + escapeHtml(meta || 'Game') + '</div>'
                    + '<button class="raised button-submit akumaPublicPlay" type="button" data-akuma-public-game-id="' + game.id + '">Jogar</button>'
                    + '</div></article>';
            }).join('');
            elements.grid.insertAdjacentHTML('beforeend', html);
        }

        state.rendered += next.length;
        elements.count.textContent = String(state.games.length);
        elements.visible.textContent = String(state.filtered.length);
        elements.more.hidden = state.rendered >= state.filtered.length;
    }

    function setupLoadObserver(root) {
        if (state.loadObserver) state.loadObserver.disconnect();
        const sentinel = root.querySelector('#AkumaPublicSentinel');
        if (!sentinel || typeof IntersectionObserver !== 'function') return;

        state.loadObserver = new IntersectionObserver(function (entries) {
            if (!state.catalogOpen) return;
            if (entries.some(function (entry) { return entry.isIntersecting; }) && state.rendered < state.filtered.length) {
                renderNext();
            }
        }, { root: root, rootMargin: '700px 0px' });
        state.loadObserver.observe(sentinel);
    }

    function showLoading(message) {
        const elements = rootElements();
        updateTop(elements.root);
        elements.root.classList.add('open');
        document.body.classList.add('akumaPublicCatalogOpen');
        elements.status.textContent = message || 'Carregando catálogo...';
        elements.grid.innerHTML = '<div class="akumaPublicEmpty">Carregando games…</div>';
        elements.more.hidden = true;
        state.catalogOpen = true;
    }

    function showCatalog() {
        const elements = rootElements();
        updateTop(elements.root);
        elements.root.classList.add('open');
        document.body.classList.add('akumaPublicCatalogOpen');
        elements.status.textContent = 'Catálogo pronto.';
        prepareFilters();
        applyFilters();
        state.catalogOpen = true;
        window.setTimeout(function () { elements.search.focus({ preventScroll: true }); }, isCompact() ? 0 : 120);
    }

    function closeGame(useHistory) {
        const overlay = document.getElementById('AkumaPublicGameOverlay');
        const frame = document.getElementById('AkumaPublicGameFrame');

        if (useHistory !== false && state.gameHistory) {
            window.history.back();
            return;
        }

        if (overlay) overlay.classList.remove('open');
        if (frame) frame.src = 'about:blank';
        state.activeGameUrl = '';
        state.activeGameTitle = '';
        state.gameOpen = false;
        state.gameHistory = false;

        const root = document.getElementById('AkumaFastRoot');
        if (root && state.catalogOpen) {
            root.classList.add('open');
            root.scrollTop = state.scrollTop;
        }
    }

    function hideCatalog(useHistory) {
        if (state.gameOpen) {
            closeGame(useHistory);
            return;
        }

        if (useHistory !== false && state.catalogHistory) {
            window.history.back();
            return;
        }

        const root = document.getElementById('AkumaFastRoot');
        if (root) root.classList.remove('open');
        document.body.classList.remove('akumaPublicCatalogOpen');
        state.catalogOpen = false;
        state.catalogHistory = false;
    }

    async function launchGame(id) {
        const elements = rootElements();
        elements.status.textContent = 'Preparando o game...';

        try {
            const response = await apiGet('AkumaGames/Games/' + encodeURIComponent(id) + '/Launch');
            state.activeGameUrl = String(valueOf(response, 'playerUrl', 'PlayerUrl') || '');
            state.activeGameTitle = String(valueOf(response, 'title', 'Title') || 'Game');
            if (!state.activeGameUrl) throw new Error('URL de execução vazia');

            state.scrollTop = elements.root.scrollTop;
            document.getElementById('AkumaPublicGameTitle').textContent = state.activeGameTitle;
            document.getElementById('AkumaPublicGameFrame').src = state.activeGameUrl;
            document.getElementById('AkumaPublicGameOverlay').classList.add('open');
            elements.status.textContent = '';
            state.gameOpen = true;

            if (!state.gameHistory) {
                window.history.pushState({ akumaGamesGame: true }, '', window.location.href);
                state.gameHistory = true;
            }

            if (isCompact()) {
                const overlay = document.getElementById('AkumaPublicGameOverlay');
                try {
                    if (overlay.requestFullscreen && !document.fullscreenElement) {
                        await overlay.requestFullscreen();
                    }
                } catch (_) {
                    // Alguns WebViews não permitem tela cheia via API; o overlay já ocupa 100dvh.
                }
            }
        } catch (error) {
            console.error('Akuma Games:', error);
            elements.status.textContent = 'Não foi possível abrir este game.';
        }
    }

    function activateGameFromElement(element) {
        if (!(element instanceof Element)) return;
        const target = element.closest('[data-akuma-public-game-id]');
        if (!target) return;
        const id = Number(target.getAttribute('data-akuma-public-game-id') || 0);
        if (id > 0) void launchGame(id);
    }

    function bindRootEvents(root, gameOverlay) {
        root.querySelector('#AkumaPublicSearch').addEventListener('input', function () {
            window.clearTimeout(state.searchTimer);
            state.searchTimer = window.setTimeout(applyFilters, 110);
        });
        root.querySelector('#AkumaPublicSystem').addEventListener('change', applyFilters);
        root.querySelector('#AkumaPublicGenre').addEventListener('change', applyFilters);
        root.querySelector('#AkumaPublicMore').addEventListener('click', renderNext);
        root.querySelector('#AkumaPublicMobileBack').addEventListener('click', function () { hideCatalog(true); });

        root.querySelector('#AkumaPublicRefresh').addEventListener('click', async function () {
            showLoading('Atualizando catálogo...');
            try {
                await loadCatalog(true);
                showCatalog();
            } catch (_) {
                const elements = rootElements();
                elements.status.textContent = 'Não foi possível atualizar o catálogo.';
                elements.grid.innerHTML = '<div class="akumaPublicEmpty">Falha ao carregar os games.</div>';
            }
        });

        root.addEventListener('click', function (event) {
            const target = event.target.closest('[data-akuma-public-game-id]');
            if (!target) return;
            event.preventDefault();
            event.stopPropagation();
            activateGameFromElement(target);
        });

        root.addEventListener('keydown', function (event) {
            if ((event.key === 'Enter' || event.key === ' ') && event.target.closest('.akumaPublicCard')) {
                event.preventDefault();
                activateGameFromElement(event.target);
            }
        });

        root.addEventListener('error', function (event) {
            if (event.target instanceof HTMLImageElement && event.target.classList.contains('akumaPublicPoster')) {
                event.target.src = fallbackImage();
            }
        }, true);

        gameOverlay.querySelector('#AkumaPublicGameClose').addEventListener('click', function () { closeGame(true); });
        gameOverlay.querySelector('#AkumaPublicGameNewWindow').addEventListener('click', function () {
            if (state.activeGameUrl) window.open(state.activeGameUrl, '_blank', 'noopener,noreferrer');
        });
        gameOverlay.querySelector('#AkumaPublicGameFullscreen').addEventListener('click', async function () {
            try {
                if (!document.fullscreenElement && gameOverlay.requestFullscreen) await gameOverlay.requestFullscreen();
                else if (document.exitFullscreen) await document.exitFullscreen();
            } catch (_) {
                // Tela cheia é opcional.
            }
        });
    }

    function findCard(target) {
        if (!(target instanceof Element)) return null;
        return target.closest('.card,.cardBox,.visualCardBox,[data-id],[data-itemid],[data-item-id]');
    }

    function readTargetTitle(target, wrapper) {
        const candidates = [];
        if (wrapper) candidates.push(wrapper);
        if (target instanceof Element) candidates.push(target);

        for (const candidate of candidates) {
            const titleElement = candidate.querySelector && candidate.querySelector('.cardText-first,.cardText-primary,.cardText,[data-title],[title]');
            const text = titleElement
                ? titleElement.getAttribute('data-title') || titleElement.getAttribute('title') || titleElement.textContent
                : candidate.getAttribute && (candidate.getAttribute('data-title') || candidate.getAttribute('title')) || candidate.textContent;
            if (String(text || '').trim()) return String(text).trim();
        }

        return '';
    }

    function routeFromHref(href) {
        if (!href) return null;

        try {
            const url = new URL(href, window.location.href);
            const source = url.hash && url.hash.includes('?')
                ? url.hash.slice(url.hash.indexOf('?') + 1)
                : url.search.slice(1);
            const params = new URLSearchParams(source);
            const parentId = String(params.get('parentId') || '').trim();
            if (!parentId) return null;

            return {
                parentId: parentId,
                serverId: String(params.get('serverId') || '').trim()
            };
        } catch (_) {
            return null;
        }
    }

    function routeFromTarget(target) {
        if (!(target instanceof Element)) return null;
        const directLink = target.closest('a[href]');
        if (directLink) return routeFromHref(directLink.href);

        const card = findCard(target);
        if (!card) return null;

        const link = card.querySelector('a[href*="parentId="],a[href*="#/list?"],a[href]');
        if (link) return routeFromHref(link.href);

        const itemId = card.getAttribute('data-id')
            || card.getAttribute('data-itemid')
            || card.getAttribute('data-item-id')
            || (card.dataset && (card.dataset.id || card.dataset.itemid || card.dataset.itemId));

        return itemId ? { parentId: String(itemId), serverId: currentServerId() } : null;
    }

    function currentListRoute() {
        const hash = String(window.location.hash || '');
        if (!hash.toLowerCase().startsWith('#/list?')) return null;
        return routeFromHref(window.location.href);
    }

    function isGamesTarget(target, card, route) {
        if (!route) return false;
        if (state.aliases.has(route.parentId)) return true;
        return normalizeText(readTargetTitle(target, card)) === 'games';
    }

    async function validateDirectRoute(route) {
        if (!route || state.nonRoots.has(route.parentId)) return false;
        if (state.aliases.has(route.parentId)) return true;

        try {
            await apiGet('AkumaGames/FastRoot/Validate/' + encodeURIComponent(route.parentId));
            state.aliases.add(route.parentId);
            saveCache();
            return true;
        } catch (error) {
            if (Number(error && error.status) === 404) state.nonRoots.add(route.parentId);
            return false;
        }
    }

    async function openCatalog(pushHistory) {
        if (pushHistory && !state.catalogHistory) {
            window.history.pushState({ akumaGamesCatalog: true }, '', window.location.href);
            state.catalogHistory = true;
        }

        if (state.games.length || loadCache().length) {
            showCatalog();
            return;
        }

        showLoading('Carregando catálogo...');
        try {
            await loadCatalog(false);
            showCatalog();
        } catch (_) {
            const elements = rootElements();
            elements.status.textContent = 'Não foi possível carregar o catálogo.';
            elements.grid.innerHTML = '<div class="akumaPublicEmpty">Falha ao carregar os games.</div>';
        }
    }

    function interceptGamesActivation(event) {
        if (event.defaultPrevented || !(event.target instanceof Element)) return;
        if (event.button !== undefined && event.button !== 0) return;
        if (event.target.closest('#AkumaFastRoot,#AkumaPublicGameOverlay,#AkumaNativeGameOverlay')) return;

        const card = findCard(event.target);
        const route = routeFromTarget(event.target);
        if (!isGamesTarget(event.target, card, route)) return;

        const now = Date.now();
        if (now - state.lastActivationAt < 450) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        state.lastActivationAt = now;

        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();

        state.aliases.add(route.parentId);
        saveCache();
        void openCatalog(true);
    }

    document.addEventListener('click', interceptGamesActivation, true);

    document.addEventListener('click', function (event) {
        if (!(event.target instanceof Element)) return;

        if (state.catalogOpen) {
            const back = event.target.closest('.headerBackButton,[data-action="back"],[aria-label="Voltar"]');
            if (back) {
                event.preventDefault();
                event.stopPropagation();
                if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
                hideCatalog(true);
                return;
            }

            const navigation = event.target.closest('.headerHomeButton,.mainDrawerButton,.headerSearchButton,.headerUserButton,[data-action="home"],[aria-label="Início"],[aria-label="Home"]');
            if (navigation) hideCatalog(false);
        }
    }, true);

    window.addEventListener('popstate', function () {
        if (state.gameOpen) {
            closeGame(false);
            return;
        }

        if (state.catalogOpen) hideCatalog(false);
    });

    window.addEventListener('hashchange', async function () {
        if (state.catalogOpen || state.gameOpen) return;
        const route = currentListRoute();
        if (!route) return;

        const sequence = ++state.routeSequence;
        const valid = await validateDirectRoute(route);
        if (sequence !== state.routeSequence || !valid) return;
        void openCatalog(false);
    });

    window.addEventListener('resize', function () {
        const root = document.getElementById('AkumaFastRoot');
        if (root && root.classList.contains('open')) updateTop(root);
    });

    document.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape') return;

        if (state.gameOpen) {
            event.preventDefault();
            closeGame(true);
            return;
        }

        if (state.catalogOpen) {
            event.preventDefault();
            hideCatalog(true);
        }
    }, true);

    window.AkumaGamesFastRootBridge = {
        version: VERSION,
        loaded: true,
        status: function () {
            return {
                version: VERSION,
                mode: isCompact() ? 'android-mobile' : 'desktop',
                cached: Boolean(state.games.length),
                games: state.games.length,
                loadedAt: state.loadedAt,
                aliases: Array.from(state.aliases),
                lastError: state.lastError,
                catalogOpen: state.catalogOpen,
                gameOpen: state.gameOpen
            };
        },
        open: function () { void openCatalog(true); },
        close: function () { hideCatalog(true); },
        refresh: async function () {
            try { window.localStorage.removeItem(STORAGE_KEY); } catch (_) { /* sem ação */ }
            state.games = [];
            state.filtered = [];
            state.loadedAt = 0;
            await loadCatalog(true);
            if (state.catalogOpen) showCatalog();
        }
    };

    loadCache();
    ensureRoot();

    window.setTimeout(function () {
        void loadCatalog(false).catch(function () {
            window.setTimeout(function () {
                void loadCatalog(false).catch(function () { /* tenta novamente ao abrir */ });
            }, 5000);
        });
    }, 250);

    window.setTimeout(async function () {
        const route = currentListRoute();
        if (!route) return;
        if (await validateDirectRoute(route)) void openCatalog(false);
    }, 650);

    console.info('Akuma Games Unified PC + Android Catalog Bridge v' + VERSION + ' carregado.');
})();
