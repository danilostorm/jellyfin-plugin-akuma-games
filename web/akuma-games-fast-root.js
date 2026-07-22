/* Akuma Games Instant Root Bridge v0.2.3.7
 * Pré-carrega as categorias e intercepta a entrada na biblioteca Games antes
 * de o Jellyfin iniciar a listagem nativa lenta.
 */
(function () {
    'use strict';

    const VERSION = '0.2.3.7';
    const STORAGE_KEY = 'akuma-fast-root:v0.2.3.7';
    const CACHE_TTL = 24 * 60 * 60 * 1000;

    if (window.__akumaGamesFastRootLoaded === VERSION) return;
    window.__akumaGamesFastRootLoaded = VERSION;

    const state = {
        payload: null,
        promise: null,
        aliases: new Set(),
        nonRoots: new Set(),
        lastError: '',
        loadedAt: 0,
        lastHash: '',
        requestSequence: 0,
        routeTimer: 0
    };

    function valueOf(object, camel, pascal) {
        if (!object) return undefined;
        return object[camel] !== undefined ? object[camel] : object[pascal];
    }

    function normalize(value) {
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

    function currentServerId() {
        try {
            const hash = String(window.location.hash || '');
            const queryIndex = hash.indexOf('?');
            if (queryIndex >= 0) {
                const params = new URLSearchParams(hash.slice(queryIndex + 1));
                const serverId = params.get('serverId');
                if (serverId) return serverId;
            }
        } catch (_) {
            // Continua para o ApiClient.
        }

        try {
            return window.ApiClient && typeof window.ApiClient.serverId === 'function'
                ? String(window.ApiClient.serverId() || '')
                : '';
        } catch (_) {
            return '';
        }
    }

    function loadCache() {
        if (state.payload) return state.payload;
        try {
            const raw = window.localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            const cached = JSON.parse(raw);
            if (!cached || Date.now() - Number(cached.savedAt || 0) > CACHE_TTL) return null;
            const payload = cached.payload;
            if (!payload || String(valueOf(payload, 'kind', 'Kind') || '') !== 'root') return null;
            state.payload = payload;
            state.loadedAt = Number(cached.savedAt || Date.now());
            (cached.aliases || []).forEach(function (id) {
                if (id) state.aliases.add(String(id));
            });
            return payload;
        } catch (_) {
            return null;
        }
    }

    function saveCache(payload) {
        if (!payload) return;
        state.payload = payload;
        state.loadedAt = Date.now();
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
                savedAt: state.loadedAt,
                payload: payload,
                aliases: Array.from(state.aliases)
            }));
        } catch (_) {
            // Cache persistente é opcional.
        }
    }

    async function prefetch(force) {
        if (!force && state.payload) return state.payload;
        if (state.promise) return state.promise;

        state.promise = (async function () {
            try {
                const client = await waitForApiClient(15000);
                const payload = await client.ajax({
                    type: 'GET',
                    url: client.getUrl('AkumaGames/FastRoot'),
                    dataType: 'json'
                });
                state.lastError = '';
                saveCache(payload);
                return payload;
            } catch (error) {
                state.lastError = String((error && (error.statusText || error.message || error.status)) || 'Falha ao carregar raiz rápida.');
                throw error;
            } finally {
                state.promise = null;
            }
        })();

        return state.promise;
    }

    function findCard(target) {
        if (!(target instanceof Element)) return null;
        return target.closest('.card,.cardBox,.visualCardBox,[data-id],[data-itemid],[data-item-id]');
    }

    function findHref(target, card) {
        const direct = target instanceof Element ? target.closest('a[href]') : null;
        if (direct) return direct.href;
        if (!card) return '';
        const link = card.querySelector('.cardText-first a[href],.cardText a[href],a[href*="parentId="],a[href*="#/list?"]');
        return link ? link.href : '';
    }

    function readCardTitle(card) {
        if (!(card instanceof Element)) return '';
        const selectors = ['.cardText-first', '.cardText-primary', '.cardText', '.cardText-secondary', '[data-title]', '[title]'];
        for (const selector of selectors) {
            const element = card.querySelector(selector);
            if (!element) continue;
            const text = element.getAttribute('data-title') || element.getAttribute('title') || element.textContent;
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
                serverId: String(params.get('serverId') || '').trim(),
                hash: url.hash || ('#/list?' + params.toString())
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

    function isGamesCard(card, route) {
        if (!card || !route) return false;
        const title = String(valueOf(state.payload, 'title', 'Title') || 'Games');
        if (normalize(readCardTitle(card)) === normalize(title)) return true;

        const rootItemId = String(valueOf(state.payload, 'rootItemId', 'RootItemId') || '');
        return Boolean((rootItemId && route.parentId === rootItemId) || state.aliases.has(route.parentId));
    }

    function ensureStyles() {
        if (document.getElementById('AkumaFastRootStyles')) return;
        const style = document.createElement('style');
        style.id = 'AkumaFastRootStyles';
        style.textContent = [
            '#AkumaFastRoot{position:fixed;left:0;right:0;bottom:0;z-index:2147482000;display:none;background:#0b0c0d;color:#eee;overflow:auto;overscroll-behavior:contain;pointer-events:auto}',
            '#AkumaFastRoot.open{display:block}',
            '.akumaFastShell{max-width:1540px;margin:0 auto;padding:2.1em 3.2% 4em}',
            '.akumaFastHeader{display:flex;align-items:end;justify-content:space-between;gap:1em;margin:0 0 1.6em}',
            '.akumaFastHeader h1{font-size:2em;line-height:1;margin:0 0 .3em}',
            '.akumaFastHeader p{margin:0;opacity:.68}',
            '.akumaFastCount{padding:.75em 1em;border-radius:.7em;background:rgba(255,255,255,.08);white-space:nowrap}',
            '.akumaFastGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:1.15em}',
            '.akumaFastCard{display:block;min-width:0;padding:0;border:0;border-radius:.7em;overflow:hidden;background:rgba(255,255,255,.06);color:inherit;text-align:left;cursor:pointer;box-shadow:0 .3em 1em rgba(0,0,0,.28)}',
            '.akumaFastCard:hover,.akumaFastCard:focus{transform:translateY(-.2em);background:rgba(255,255,255,.1);outline:2px solid rgba(0,164,220,.75);outline-offset:2px}',
            '.akumaFastPoster{display:block;width:100%;aspect-ratio:3/4;object-fit:cover;background:#202124}',
            '.akumaFastBody{padding:.75em .8em .9em}',
            '.akumaFastName{font-size:1em;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
            '.akumaFastMeta{margin-top:.32em;font-size:.82em;opacity:.65}',
            '.akumaFastLoading{display:grid;place-items:center;min-height:45vh;font-size:1.05em;opacity:.75}',
            '@media(max-width:700px){.akumaFastShell{padding:1.25em 3.5% 3em}.akumaFastHeader{align-items:flex-start;flex-direction:column}.akumaFastGrid{grid-template-columns:repeat(2,minmax(0,1fr));gap:.75em}}'
        ].join('');
        document.head.appendChild(style);
    }

    function ensureRoot() {
        ensureStyles();
        let root = document.getElementById('AkumaFastRoot');
        if (root) return root;
        root = document.createElement('section');
        root.id = 'AkumaFastRoot';
        root.setAttribute('aria-label', 'Biblioteca Games');
        document.body.appendChild(root);
        return root;
    }

    function updateTop(root) {
        const header = document.querySelector('.skinHeader,.headerTop');
        const bottom = header ? Math.max(0, Math.round(header.getBoundingClientRect().bottom)) : 64;
        root.style.top = Math.max(50, bottom) + 'px';
    }

    function hide() {
        const root = document.getElementById('AkumaFastRoot');
        if (!root) return;
        root.classList.remove('open');
        root.replaceChildren();
    }

    function showLoading() {
        const root = ensureRoot();
        updateTop(root);
        root.replaceChildren();
        const loading = document.createElement('div');
        loading.className = 'akumaFastLoading';
        loading.textContent = 'Carregando categorias…';
        root.appendChild(loading);
        root.classList.add('open');
    }

    function fallbackImage(name) {
        return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="100%" height="100%" fill="#202124"/><text x="50%" y="46%" fill="#00a4dc" font-size="90" text-anchor="middle">🎮</text><text x="50%" y="61%" fill="#ddd" font-size="38" text-anchor="middle">'
            + String(name || 'Games').replace(/[&<>]/g, '') + '</text></svg>'
        );
    }

    function render(route, payload) {
        if (!payload || String(valueOf(payload, 'kind', 'Kind') || '') !== 'root') return false;
        const root = ensureRoot();
        updateTop(root);
        root.replaceChildren();

        const shell = document.createElement('div');
        shell.className = 'akumaFastShell';
        const header = document.createElement('header');
        header.className = 'akumaFastHeader';
        const titleWrap = document.createElement('div');
        const title = document.createElement('h1');
        title.textContent = String(valueOf(payload, 'title', 'Title') || 'Games');
        const subtitle = document.createElement('p');
        subtitle.textContent = 'Escolha um sistema para ver os games.';
        titleWrap.append(title, subtitle);
        const count = document.createElement('div');
        count.className = 'akumaFastCount';
        count.textContent = Number(valueOf(payload, 'totalGames', 'TotalGames') || 0).toLocaleString('pt-BR') + ' games';
        header.append(titleWrap, count);

        const grid = document.createElement('div');
        grid.className = 'akumaFastGrid';
        const categories = valueOf(payload, 'categories', 'Categories') || [];
        categories.forEach(function (item) {
            const name = String(valueOf(item, 'name', 'Name') || 'Outros');
            const itemId = String(valueOf(item, 'itemId', 'ItemId') || '');
            const imageUrl = String(valueOf(item, 'imageUrl', 'ImageUrl') || '');
            const total = Number(valueOf(item, 'count', 'Count') || 0);

            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'akumaFastCard';
            card.dataset.itemId = itemId;
            card.dataset.serverId = route.serverId || currentServerId();
            card.disabled = !itemId || /^0{8}-0{4}-0{4}-0{4}-0{12}$/i.test(itemId);

            const image = document.createElement('img');
            image.className = 'akumaFastPoster';
            image.loading = 'eager';
            image.decoding = 'async';
            image.alt = 'Categoria ' + name;
            image.src = imageUrl || fallbackImage(name);
            image.addEventListener('error', function () { image.src = fallbackImage(name); }, { once: true });

            const body = document.createElement('div');
            body.className = 'akumaFastBody';
            const label = document.createElement('div');
            label.className = 'akumaFastName';
            label.textContent = name;
            const meta = document.createElement('div');
            meta.className = 'akumaFastMeta';
            meta.textContent = total.toLocaleString('pt-BR') + (total === 1 ? ' game' : ' games');
            body.append(label, meta);
            card.append(image, body);
            grid.appendChild(card);
        });

        shell.append(header, grid);
        root.appendChild(shell);
        root.classList.add('open');
        return true;
    }

    async function validateRoute(route) {
        if (!route || state.nonRoots.has(route.parentId)) return null;
        if (state.aliases.has(route.parentId) && state.payload) return state.payload;
        const rootItemId = String(valueOf(state.payload, 'rootItemId', 'RootItemId') || '');
        if (rootItemId && route.parentId === rootItemId) {
            state.aliases.add(route.parentId);
            return state.payload;
        }

        try {
            const client = await waitForApiClient(10000);
            const payload = await client.ajax({
                type: 'GET',
                url: client.getUrl('AkumaGames/FastRoot/Validate/' + encodeURIComponent(route.parentId)),
                dataType: 'json'
            });
            state.aliases.add(route.parentId);
            saveCache(payload);
            return payload;
        } catch (error) {
            if (Number(error && error.status) === 404) state.nonRoots.add(route.parentId);
            return null;
        }
    }

    async function resolveRoute() {
        const route = currentListRoute();
        const requestId = ++state.requestSequence;
        if (!route) {
            hide();
            return;
        }

        const payload = state.payload || loadCache();
        const rootItemId = String(valueOf(payload, 'rootItemId', 'RootItemId') || '');
        const known = state.aliases.has(route.parentId) || (rootItemId && route.parentId === rootItemId);
        if (known && payload) {
            render(route, payload);
            return;
        }

        const validated = await validateRoute(route);
        if (requestId !== state.requestSequence) return;
        if (validated) render(route, validated);
        else hide();
    }

    function scheduleRoute(delay) {
        window.clearTimeout(state.routeTimer);
        state.routeTimer = window.setTimeout(function () { void resolveRoute(); }, delay || 20);
    }

    function interceptLibraryClick(event) {
        if (event.defaultPrevented || !(event.target instanceof Element)) return;
        if (event.button !== undefined && event.button !== 0) return;
        if (event.target.closest('#AkumaFastRoot,#AkumaNativeGameOverlay')) return;
        const card = findCard(event.target);
        if (!card) return;
        const route = routeFromHref(findHref(event.target, card));
        if (!route || !isGamesCard(card, route)) return;

        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();

        state.aliases.add(route.parentId);
        const payload = state.payload || loadCache();
        if (payload) {
            render(route, payload);
        } else {
            showLoading();
            void prefetch(true).then(function (fresh) {
                render(route, fresh);
            }).catch(function () {
                hide();
                window.location.hash = route.hash;
            });
        }
        if (payload) saveCache(payload);

        // Entrega a tela rápida ao navegador antes de iniciar a rota nativa.
        window.requestAnimationFrame(function () {
            window.requestAnimationFrame(function () {
                window.location.hash = route.hash;
            });
        });
    }

    document.addEventListener('click', interceptLibraryClick, true);

    document.addEventListener('click', function (event) {
        const card = event.target instanceof Element
            ? event.target.closest('#AkumaFastRoot .akumaFastCard')
            : null;
        if (!card || card.disabled) return;
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
        const params = new URLSearchParams();
        params.set('parentId', card.dataset.itemId || '');
        if (card.dataset.serverId) params.set('serverId', card.dataset.serverId);
        hide();
        window.location.hash = '#/list?' + params.toString();
    }, true);

    document.addEventListener('click', function (event) {
        if (!(event.target instanceof Element)) return;
        if (!event.target.closest('.skinHeader,.headerTop,.headerBackButton,.headerHomeButton,.mainDrawerButton,[data-action="back"],[data-action="home"]')) return;
        hide();
    }, true);

    window.addEventListener('hashchange', function () {
        state.lastHash = String(window.location.hash || '');
        const route = currentListRoute();
        if (route && state.aliases.has(route.parentId) && state.payload) render(route, state.payload);
        else hide();
        scheduleRoute(10);
    });

    window.addEventListener('resize', function () {
        const root = document.getElementById('AkumaFastRoot');
        if (root && root.classList.contains('open')) updateTop(root);
    });

    window.AkumaGamesFastRootBridge = {
        version: VERSION,
        loaded: true,
        status: function () {
            return {
                cached: Boolean(state.payload),
                loadedAt: state.loadedAt,
                aliases: Array.from(state.aliases),
                lastError: state.lastError,
                route: currentListRoute(),
                open: Boolean(document.querySelector('#AkumaFastRoot.open'))
            };
        },
        refresh: function () {
            try { window.localStorage.removeItem(STORAGE_KEY); } catch (_) { /* sem ação */ }
            state.payload = null;
            state.loadedAt = 0;
            void prefetch(true).then(function () { scheduleRoute(0); }).catch(function () { /* status mostra o erro */ });
        }
    };

    loadCache();
    state.lastHash = String(window.location.hash || '');
    scheduleRoute(30);
    window.setTimeout(function () {
        void prefetch(false).catch(function () {
            window.setTimeout(function () { void prefetch(true).catch(function () { /* nova tentativa na navegação */ }); }, 4000);
        });
    }, 300);

    console.info('Akuma Games Instant Root Bridge v' + VERSION + ' carregado.');
})();
