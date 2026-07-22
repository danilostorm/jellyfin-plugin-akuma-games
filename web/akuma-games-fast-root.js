/* Akuma Games Public Catalog Bridge v0.2.3.8
 * Faz a biblioteca Games abrir o mesmo catálogo rápido exibido na página do plugin,
 * sem aguardar a listagem nativa de milhares de diretórios do Jellyfin.
 */
(function () {
    'use strict';

    const VERSION = '0.2.3.8';
    const STORAGE_KEY = 'akuma-public-catalog:v0.2.3.8';
    const CACHE_TTL = 24 * 60 * 60 * 1000;
    const PAGE_SIZE = 96;

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
        open: false,
        historyPushed: false,
        activeGameUrl: '',
        routeSequence: 0
    };

    function valueOf(object, camel, pascal) {
        if (!object) return undefined;
        return object[camel] !== undefined ? object[camel] : object[pascal];
    }

    function normalizeText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('pt-BR');
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
            // Cache é apenas uma otimização.
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
            '#AkumaFastRoot{position:fixed;left:0;right:0;bottom:0;z-index:2147482000;display:none;background:#0b0c0d;color:#eee;overflow:auto;overscroll-behavior:contain}',
            '#AkumaFastRoot.open{display:block}',
            '.akumaPublicShell{padding:2.2em 3.2% 4em;max-width:1800px;margin:0 auto}',
            '.akumaPublicHero{display:flex;align-items:center;justify-content:space-between;gap:1.5em;margin-bottom:1.5em}',
            '.akumaPublicTitleWrap{display:flex;align-items:center;gap:1em;min-width:0}',
            '.akumaPublicIcon{width:3.2em;height:3.2em;border-radius:1em;display:grid;place-items:center;background:rgba(0,164,220,.18);font-size:1.4em}',
            '.akumaPublicHero h1{margin:0;font-size:2.1em;line-height:1.05}',
            '.akumaPublicHero p{margin:.45em 0 0;opacity:.72}',
            '.akumaPublicStats{display:flex;gap:.7em;flex-wrap:wrap;justify-content:flex-end}',
            '.akumaPublicPill{padding:.72em 1em;border-radius:.7em;background:rgba(255,255,255,.08);white-space:nowrap}',
            '.akumaPublicToolbar{display:grid;grid-template-columns:minmax(240px,1fr) minmax(180px,.34fr) minmax(180px,.34fr) auto;gap:.8em;margin-bottom:1.8em}',
            '.akumaPublicToolbar input,.akumaPublicToolbar select{width:100%;box-sizing:border-box;min-height:3.1em;border:0;border-radius:.65em;padding:0 1em;background:rgba(255,255,255,.1);color:inherit}',
            '.akumaPublicToolbar select option{color:#111}',
            '.akumaPublicRefresh{min-height:3.1em;border:0;border-radius:.65em;padding:0 1.2em;cursor:pointer}',
            '.akumaPublicStatus{min-height:2em;margin:-.7em 0 1em;opacity:.75}',
            '.akumaPublicGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:1.15em}',
            '.akumaPublicCard{min-width:0;border-radius:.85em;overflow:hidden;background:rgba(255,255,255,.065);box-shadow:0 .35em 1.2em rgba(0,0,0,.18);transition:transform .16s ease,background .16s ease}',
            '.akumaPublicCard:focus-within,.akumaPublicCard:hover{transform:translateY(-.25em);background:rgba(255,255,255,.1)}',
            '.akumaPublicPoster{aspect-ratio:3/4;width:100%;object-fit:cover;display:block;background:rgba(255,255,255,.06)}',
            '.akumaPublicBody{padding:.85em}',
            '.akumaPublicTitle{font-size:1.02em;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:.45em}',
            '.akumaPublicMeta{font-size:.82em;opacity:.68;min-height:2.4em;line-height:1.35}',
            '.akumaPublicPlay{width:100%;margin-top:.8em;min-height:2.75em;border:0;border-radius:.55em;cursor:pointer;font-weight:600;background:#00a4dc;color:#fff}',
            '.akumaPublicMoreWrap{display:flex;justify-content:center;padding:1.8em 0 3em}',
            '.akumaPublicMore{min-width:12em;min-height:3em;border:0;border-radius:.7em;cursor:pointer}',
            '.akumaPublicEmpty{grid-column:1/-1;text-align:center;padding:5em 1em;opacity:.72}',
            '#AkumaPublicGameOverlay{position:fixed;inset:0;z-index:2147483646;display:none;flex-direction:column;background:#080808;color:#fff}',
            '#AkumaPublicGameOverlay.open{display:flex}',
            '.akumaPublicGameBar{min-height:3.7em;display:flex;align-items:center;gap:.8em;padding:0 .8em;background:#171717}',
            '.akumaPublicGameTitle{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600}',
            '.akumaPublicGameButton{min-height:2.6em;border:0;border-radius:.55em;padding:0 1em;cursor:pointer}',
            '.akumaPublicGameFrame{border:0;width:100%;flex:1;background:#000}',
            '@media(max-width:900px){.akumaPublicShell{padding:1.4em 3.5%}.akumaPublicHero{align-items:flex-start;flex-direction:column}.akumaPublicStats{justify-content:flex-start}.akumaPublicToolbar{grid-template-columns:1fr 1fr}.akumaPublicToolbar input{grid-column:1/-1}}',
            '@media(max-width:560px){.akumaPublicHero h1{font-size:1.65em}.akumaPublicToolbar{grid-template-columns:1fr}.akumaPublicToolbar input{grid-column:auto}.akumaPublicGrid{grid-template-columns:repeat(2,minmax(0,1fr));gap:.75em}.akumaPublicBody{padding:.7em}.akumaPublicGameBar{flex-wrap:wrap;padding:.5em}.akumaPublicGameTitle{flex-basis:100%}}'
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
            '<div class="akumaPublicShell">',
            '<header class="akumaPublicHero">',
            '<div class="akumaPublicTitleWrap"><div class="akumaPublicIcon" aria-hidden="true">🎮</div><div><h1>Games</h1><p>Escolha um game e jogue dentro do Jellyfin sem usar o player de vídeo.</p></div></div>',
            '<div class="akumaPublicStats"><div class="akumaPublicPill"><strong id="AkumaPublicCount">0</strong> games</div><div class="akumaPublicPill"><strong id="AkumaPublicVisible">0</strong> exibidos</div></div>',
            '</header>',
            '<section class="akumaPublicToolbar" aria-label="Filtros do catálogo">',
            '<input id="AkumaPublicSearch" type="search" placeholder="Buscar um game..." autocomplete="off">',
            '<select id="AkumaPublicSystem" aria-label="Sistema"><option value="">Todos os sistemas</option></select>',
            '<select id="AkumaPublicGenre" aria-label="Gênero"><option value="">Todos os gêneros</option></select>',
            '<button id="AkumaPublicRefresh" class="raised button-submit akumaPublicRefresh" type="button">Atualizar</button>',
            '</section>',
            '<div id="AkumaPublicStatus" class="akumaPublicStatus" role="status"></div>',
            '<main id="AkumaPublicGrid" class="akumaPublicGrid"></main>',
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
            '<div id="AkumaPublicGameTitle" class="akumaPublicGameTitle">Game</div>',
            '<button id="AkumaPublicGameNewWindow" class="akumaPublicGameButton" type="button">Abrir em nova tela</button>',
            '<button id="AkumaPublicGameClose" class="akumaPublicGameButton" type="button">Fechar</button>',
            '</div>',
            '<iframe id="AkumaPublicGameFrame" class="akumaPublicGameFrame" allow="autoplay; fullscreen; gamepad; clipboard-read; clipboard-write" allowfullscreen></iframe>'
        ].join('');
        document.body.appendChild(gameOverlay);

        bindRootEvents(root, gameOverlay);
        return root;
    }

    function updateTop(root) {
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
        const unique = Array.from(new Set(values.filter(Boolean))).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
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
            more: root.querySelector('#AkumaPublicMore')
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
    }

    function renderNext() {
        const elements = rootElements();
        const next = state.filtered.slice(state.rendered, state.rendered + PAGE_SIZE);

        if (!next.length && state.rendered === 0) {
            elements.grid.innerHTML = '<div class="akumaPublicEmpty">Nenhum game encontrado com esses filtros.</div>';
        } else {
            const html = next.map(function (game) {
                const meta = [game.system, game.genre].filter(Boolean).join(' · ');
                const image = game.imageUrl || fallbackImage();
                return '<article class="akumaPublicCard">'
                    + '<img class="akumaPublicPoster" loading="lazy" src="' + escapeHtml(image) + '" alt="Capa de ' + escapeHtml(game.title) + '">'
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

    function showLoading(message) {
        const elements = rootElements();
        updateTop(elements.root);
        elements.root.classList.add('open');
        elements.status.textContent = message || 'Carregando catálogo...';
        elements.grid.innerHTML = '<div class="akumaPublicEmpty">Carregando games…</div>';
        elements.more.hidden = true;
        state.open = true;
    }

    function showCatalog() {
        const elements = rootElements();
        updateTop(elements.root);
        elements.root.classList.add('open');
        elements.status.textContent = 'Catálogo pronto.';
        prepareFilters();
        applyFilters();
        state.open = true;
    }

    function closeGame() {
        const overlay = document.getElementById('AkumaPublicGameOverlay');
        const frame = document.getElementById('AkumaPublicGameFrame');
        if (overlay) overlay.classList.remove('open');
        if (frame) frame.src = 'about:blank';
        state.activeGameUrl = '';
    }

    function hideCatalog() {
        closeGame();
        const root = document.getElementById('AkumaFastRoot');
        if (root) root.classList.remove('open');
        state.open = false;
        state.historyPushed = false;
    }

    async function launchGame(id) {
        const elements = rootElements();
        elements.status.textContent = 'Preparando o game...';
        try {
            const response = await apiGet('AkumaGames/Games/' + encodeURIComponent(id) + '/Launch');
            state.activeGameUrl = String(valueOf(response, 'playerUrl', 'PlayerUrl') || '');
            const title = String(valueOf(response, 'title', 'Title') || 'Game');
            if (!state.activeGameUrl) throw new Error('URL de execução vazia');

            document.getElementById('AkumaPublicGameTitle').textContent = title;
            document.getElementById('AkumaPublicGameFrame').src = state.activeGameUrl;
            document.getElementById('AkumaPublicGameOverlay').classList.add('open');
            elements.status.textContent = '';
        } catch (error) {
            console.error('Akuma Games:', error);
            elements.status.textContent = 'Não foi possível abrir este game.';
        }
    }

    function bindRootEvents(root, gameOverlay) {
        root.querySelector('#AkumaPublicSearch').addEventListener('input', applyFilters);
        root.querySelector('#AkumaPublicSystem').addEventListener('change', applyFilters);
        root.querySelector('#AkumaPublicGenre').addEventListener('change', applyFilters);
        root.querySelector('#AkumaPublicMore').addEventListener('click', renderNext);
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
            const button = event.target.closest('[data-akuma-public-game-id]');
            if (button) void launchGame(button.dataset.akumaPublicGameId);
        });

        gameOverlay.querySelector('#AkumaPublicGameClose').addEventListener('click', closeGame);
        gameOverlay.querySelector('#AkumaPublicGameNewWindow').addEventListener('click', function () {
            if (state.activeGameUrl) window.open(state.activeGameUrl, '_blank', 'noopener,noreferrer');
        });
    }

    function findHrefTarget(target) {
        if (!(target instanceof Element)) return null;
        const link = target.closest('a[href]');
        if (link) return { element: link, href: link.href };

        const card = target.closest('.card,.cardBox,.visualCardBox,[data-id],[data-itemid],[data-item-id]');
        if (!card) return null;
        const cardLink = card.querySelector('a[href*="parentId="],a[href*="#/list?"],a[href]');
        return cardLink ? { element: card, href: cardLink.href } : null;
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

    function currentListRoute() {
        const hash = String(window.location.hash || '');
        if (!hash.toLowerCase().startsWith('#/list?')) return null;
        return routeFromHref(window.location.href);
    }

    function isGamesTarget(target, wrapper, route) {
        if (!route) return false;
        if (state.aliases.has(route.parentId)) return true;
        const title = normalizeText(readTargetTitle(target, wrapper));
        return title === 'games';
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
        if (pushHistory && !state.historyPushed) {
            try {
                window.history.pushState({ akumaGamesCatalog: true }, '', window.location.href);
                state.historyPushed = true;
            } catch (_) {
                state.historyPushed = false;
            }
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

    function interceptGamesClick(event) {
        if (event.defaultPrevented || !(event.target instanceof Element)) return;
        if (event.button !== undefined && event.button !== 0) return;
        if (event.target.closest('#AkumaFastRoot,#AkumaPublicGameOverlay,#AkumaNativeGameOverlay')) return;

        const targetInfo = findHrefTarget(event.target);
        if (!targetInfo) return;
        const route = routeFromHref(targetInfo.href);
        if (!isGamesTarget(event.target, targetInfo.element, route)) return;

        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
        state.aliases.add(route.parentId);
        saveCache();
        void openCatalog(true);
    }

    document.addEventListener('click', interceptGamesClick, true);

    document.addEventListener('click', function (event) {
        if (!state.open || !(event.target instanceof Element)) return;
        const back = event.target.closest('.headerBackButton,[data-action="back"],[aria-label="Voltar"]');
        if (back) {
            event.preventDefault();
            event.stopPropagation();
            if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
            if (state.historyPushed) window.history.back();
            else hideCatalog();
            return;
        }

        const home = event.target.closest('.headerHomeButton,[data-action="home"],[aria-label="Início"],[aria-label="Home"]');
        if (home) hideCatalog();
    }, true);

    window.addEventListener('popstate', function () {
        if (state.open) hideCatalog();
    });

    window.addEventListener('hashchange', async function () {
        if (state.open) return;
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
        const gameOverlay = document.getElementById('AkumaPublicGameOverlay');
        if (gameOverlay && gameOverlay.classList.contains('open')) {
            event.preventDefault();
            closeGame();
            return;
        }
        if (state.open) {
            event.preventDefault();
            if (state.historyPushed) window.history.back();
            else hideCatalog();
        }
    }, true);

    window.AkumaGamesFastRootBridge = {
        version: VERSION,
        loaded: true,
        status: function () {
            return {
                version: VERSION,
                cached: Boolean(state.games.length),
                games: state.games.length,
                loadedAt: state.loadedAt,
                aliases: Array.from(state.aliases),
                lastError: state.lastError,
                open: state.open
            };
        },
        open: function () { void openCatalog(true); },
        close: hideCatalog,
        refresh: async function () {
            try { window.localStorage.removeItem(STORAGE_KEY); } catch (_) { /* sem ação */ }
            state.games = [];
            state.filtered = [];
            state.loadedAt = 0;
            await loadCatalog(true);
            if (state.open) showCatalog();
        }
    };

    loadCache();
    ensureRoot();

    window.setTimeout(function () {
        void loadCatalog(false).catch(function () {
            window.setTimeout(function () { void loadCatalog(false).catch(function () { /* tenta novamente ao abrir */ }); }, 5000);
        });
    }, 300);

    window.setTimeout(async function () {
        const route = currentListRoute();
        if (!route) return;
        if (await validateDirectRoute(route)) void openCatalog(false);
    }, 700);

    console.info('Akuma Games Public Catalog Bridge v' + VERSION + ' carregado.');
})();
