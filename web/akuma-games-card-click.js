/* Akuma Games Card Click + Fast Library Bridge v0.2.3.6
 * - Clicar na capa de um game usa a mesma rota do título.
 * - A raiz da biblioteca Games é desenhada pelo cache do plugin em vez de
 *   esperar o Jellyfin percorrer os milhares de diretórios para achar 7 categorias.
 */
(function () {
    'use strict';

    const VERSION = '0.2.3.6';
    if (window.__akumaGamesCardClickLoaded === VERSION) return;
    window.__akumaGamesCardClickLoaded = VERSION;

    const pendingItems = new Set();
    const confirmedGames = new Set();
    const confirmedNonGames = new Set();
    const fastNonRoots = new Set();
    let bypassNextClick = false;
    let fastRequestSequence = 0;
    let fastRouteTimer = 0;
    let fastLastHash = '';

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

    function isImageArea(target) {
        if (!(target instanceof Element)) return false;

        return Boolean(target.closest([
            '.cardImageContainer',
            '.cardImageContainerInner',
            '.cardImage',
            '.cardImageIcon',
            '.cardOverlayContainer',
            '.cardScalable',
            '.cardContent',
            '.visualCardBox',
            '.itemDetailImage',
            '.primaryImageWrapper',
            'img'
        ].join(',')));
    }

    function findCard(target) {
        if (!(target instanceof Element)) return null;

        return target.closest([
            '.card',
            '.cardBox',
            '.visualCardBox',
            '[data-id]',
            '[data-itemid]',
            '[data-item-id]'
        ].join(','));
    }

    function readIdFromText(value) {
        if (!value) return '';
        const text = String(value);

        try {
            const url = new URL(text, window.location.href);
            const id = url.searchParams.get('id');
            if (id) return id.trim();

            const hashIndex = text.indexOf('?');
            if (hashIndex >= 0) {
                const params = new URLSearchParams(text.slice(hashIndex + 1));
                const hashId = params.get('id');
                if (hashId) return hashId.trim();
            }
        } catch (_) {
            const match = text.match(/[?&]id=([0-9a-fA-F-]{32,36})/);
            if (match) return match[1];
        }

        const plainMatch = text.match(/^[0-9a-fA-F-]{32,36}$/);
        return plainMatch ? plainMatch[0] : '';
    }

    function findItemId(target, card) {
        const candidates = [];

        [target, card].forEach(function (element) {
            if (!(element instanceof Element)) return;

            candidates.push(
                element.getAttribute('data-id'),
                element.getAttribute('data-itemid'),
                element.getAttribute('data-item-id'),
                element.getAttribute('data-item')
            );

            if (element.dataset) {
                candidates.push(
                    element.dataset.id,
                    element.dataset.itemid,
                    element.dataset.itemId,
                    element.dataset.item
                );
            }
        });

        const link = target.closest('a[href]')
            || (card && card.querySelector('a[href*="id="]'));
        if (link) candidates.push(link.getAttribute('href'));

        if (card) {
            const nested = card.querySelector('[data-id], [data-itemid], [data-item-id]');
            if (nested) {
                candidates.push(
                    nested.getAttribute('data-id'),
                    nested.getAttribute('data-itemid'),
                    nested.getAttribute('data-item-id')
                );
            }
        }

        for (const candidate of candidates) {
            const id = readIdFromText(candidate);
            if (id) return id;
        }

        return '';
    }

    function findOriginalHref(target, card) {
        const directLink = target.closest('a[href]');
        if (directLink) return directLink.href;

        if (!card) return '';

        const preferred = card.querySelector([
            '.cardText-first a[href]',
            '.cardText a[href]',
            'a[href*="#/details?"]',
            'a[href*="/details?"]',
            'a[href*="id="]',
            'a[href*="parentId="]'
        ].join(','));

        return preferred ? preferred.href : '';
    }

    function findTitleHref(card) {
        if (!card) return '';

        const titleLink = card.querySelector([
            '.cardText-first a[href]',
            '.cardText a[href]',
            '.cardText-secondary a[href]',
            'a.itemAction[href]',
            'a[href*="#/details?"]',
            'a[href*="/details?"]',
            'a[href*="parentId="]'
        ].join(','));

        return titleLink ? titleLink.href : '';
    }

    function isDetailsRoute(href) {
        if (!href) return false;
        const text = String(href).toLowerCase();
        return text.includes('/details?') || text.includes('#/details?');
    }

    function isContainerRoute(href) {
        if (!href) return false;
        const text = String(href).toLowerCase();

        return text.includes('parentid=')
            || text.includes('#/list?')
            || text.includes('/list?')
            || text.includes('#/home')
            || text.includes('collectiontype=')
            || text.includes('#/movies')
            || text.includes('#/tv')
            || text.includes('#/livetv')
            || text.includes('#/collections');
    }

    function readCardType(card) {
        if (!(card instanceof Element)) return '';

        const elements = [
            card,
            card.querySelector('[data-type]'),
            card.querySelector('[data-itemtype]'),
            card.querySelector('[data-item-type]')
        ];

        for (const element of elements) {
            if (!(element instanceof Element)) continue;
            const value = element.getAttribute('data-type')
                || element.getAttribute('data-itemtype')
                || element.getAttribute('data-item-type');
            if (value) return String(value).toLowerCase();
        }

        return '';
    }

    function isFolderCard(card, originalHref, titleHref) {
        if (isContainerRoute(originalHref) || isContainerRoute(titleHref)) return true;

        if (titleHref && !isDetailsRoute(titleHref)) return true;

        const type = readCardType(card);
        return type.includes('folder')
            || type === 'userview'
            || type === 'aggregatefolder'
            || type === 'collectionfolder'
            || type === 'boxset';
    }

    function currentServerId(client) {
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
            if (client && typeof client.serverId === 'function') {
                return String(client.serverId() || '');
            }
        } catch (_) {
            // serverId é opcional.
        }

        return '';
    }

    function navigateToDetails(itemId, titleHref, client) {
        if (titleHref) {
            const titleUrl = new URL(titleHref, window.location.href);
            if (titleUrl.hash) {
                window.location.hash = titleUrl.hash;
                return;
            }

            window.location.href = titleUrl.href;
            return;
        }

        const serverId = currentServerId(client);
        const params = new URLSearchParams();
        params.set('id', itemId);
        if (serverId) params.set('serverId', serverId);
        window.location.hash = '#/details?' + params.toString();
    }

    function restoreOriginalAction(originalHref) {
        if (!originalHref) return;
        bypassNextClick = true;
        window.location.href = originalHref;
        window.setTimeout(function () {
            bypassNextClick = false;
        }, 250);
    }

    async function handleImageClick(event) {
        if (bypassNextClick || event.defaultPrevented) return;
        if (event.button !== undefined && event.button !== 0) return;
        if (!isImageArea(event.target)) return;
        if (event.target.closest('#AkumaNativeGameOverlay, #AkumaFastLibraryRoot')) return;

        const card = findCard(event.target);
        if (!card) return;

        const originalHref = findOriginalHref(event.target, card);
        const titleHref = findTitleHref(card);

        if (isFolderCard(card, originalHref, titleHref)) return;

        const itemId = findItemId(event.target, card);
        if (!itemId || pendingItems.has(itemId)) return;

        if (confirmedNonGames.has(itemId)) return;

        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') {
            event.stopImmediatePropagation();
        }

        if (confirmedGames.has(itemId)) {
            navigateToDetails(itemId, titleHref, window.ApiClient);
            return;
        }

        pendingItems.add(itemId);

        try {
            const client = await waitForApiClient(10000);
            await client.ajax({
                type: 'GET',
                url: client.getUrl('AkumaGames/ResolveItem/' + encodeURIComponent(itemId)),
                dataType: 'json'
            });

            confirmedGames.add(itemId);
            navigateToDetails(itemId, titleHref, client);
        } catch (error) {
            confirmedNonGames.add(itemId);
            restoreOriginalAction(originalHref);
        } finally {
            pendingItems.delete(itemId);
        }
    }

    function valueOf(object, camel, pascal) {
        if (!object) return undefined;
        return object[camel] !== undefined ? object[camel] : object[pascal];
    }

    function readListRoute() {
        const hash = String(window.location.hash || '');
        if (!hash.toLowerCase().startsWith('#/list?')) return null;

        const queryIndex = hash.indexOf('?');
        if (queryIndex < 0) return null;

        try {
            const params = new URLSearchParams(hash.slice(queryIndex + 1));
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

    function fastCacheKey(route) {
        return 'akuma-fast-library:' + VERSION + ':' + (route.serverId || 'server') + ':' + route.parentId;
    }

    function loadFastCache(route) {
        try {
            const raw = window.sessionStorage.getItem(fastCacheKey(route));
            if (!raw) return null;
            const cached = JSON.parse(raw);
            if (!cached || Date.now() - Number(cached.savedAt || 0) > 30 * 60 * 1000) return null;
            return cached.payload || null;
        } catch (_) {
            return null;
        }
    }

    function saveFastCache(route, payload) {
        try {
            window.sessionStorage.setItem(fastCacheKey(route), JSON.stringify({
                savedAt: Date.now(),
                payload: payload
            }));
        } catch (_) {
            // Cache é opcional.
        }
    }

    function ensureFastStyles() {
        let style = document.getElementById('AkumaFastLibraryStyles');
        if (style) return;

        style = document.createElement('style');
        style.id = 'AkumaFastLibraryStyles';
        style.textContent = [
            '#AkumaFastLibraryRoot{position:fixed;left:0;right:0;bottom:0;z-index:9000;display:none;background:#0b0c0d;color:#eee;overflow:auto;overscroll-behavior:contain}',
            '#AkumaFastLibraryRoot.akuma-fast-open{display:block}',
            '.akumaFastShell{max-width:1540px;margin:0 auto;padding:2.1em 3.2% 4em}',
            '.akumaFastHeader{display:flex;align-items:end;justify-content:space-between;gap:1em;margin:0 0 1.6em}',
            '.akumaFastHeader h1{font-size:2em;line-height:1;margin:0 0 .3em}',
            '.akumaFastHeader p{margin:0;opacity:.68}',
            '.akumaFastCount{padding:.75em 1em;border-radius:.7em;background:rgba(255,255,255,.08);white-space:nowrap}',
            '.akumaFastGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:1.15em}',
            '.akumaFastCard{display:block;min-width:0;padding:0;border:0;border-radius:.7em;overflow:hidden;background:rgba(255,255,255,.06);color:inherit;text-align:left;cursor:pointer;box-shadow:0 .3em 1em rgba(0,0,0,.28);transition:transform .15s ease,background .15s ease}',
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

    function ensureFastRoot() {
        ensureFastStyles();
        let root = document.getElementById('AkumaFastLibraryRoot');
        if (root) return root;

        root = document.createElement('section');
        root.id = 'AkumaFastLibraryRoot';
        root.setAttribute('aria-label', 'Biblioteca Games rápida');
        document.body.appendChild(root);
        return root;
    }

    function updateFastRootTop(root) {
        const header = document.querySelector('.skinHeader, .headerTop');
        const bottom = header ? Math.max(0, Math.round(header.getBoundingClientRect().bottom)) : 64;
        root.style.top = Math.max(50, bottom) + 'px';
    }

    function hideFastRoot() {
        const root = document.getElementById('AkumaFastLibraryRoot');
        if (!root) return;
        root.classList.remove('akuma-fast-open');
        root.replaceChildren();
    }

    function showFastLoading() {
        const root = ensureFastRoot();
        updateFastRootTop(root);
        root.replaceChildren();
        const loading = document.createElement('div');
        loading.className = 'akumaFastLoading';
        loading.textContent = 'Carregando categorias…';
        root.appendChild(loading);
        root.classList.add('akuma-fast-open');
    }

    function createFallbackImage(name) {
        return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800">'
            + '<rect width="100%" height="100%" fill="#202124"/>'
            + '<text x="50%" y="46%" fill="#00a4dc" font-size="90" text-anchor="middle">🎮</text>'
            + '<text x="50%" y="61%" fill="#ddd" font-size="38" text-anchor="middle">'
            + String(name || 'Games').replace(/[&<>]/g, '')
            + '</text></svg>'
        );
    }

    function renderFastLibrary(route, payload) {
        if (!payload || String(valueOf(payload, 'kind', 'Kind') || '') !== 'root') return false;

        const root = ensureFastRoot();
        updateFastRootTop(root);
        root.replaceChildren();

        const shell = document.createElement('div');
        shell.className = 'akumaFastShell';

        const header = document.createElement('header');
        header.className = 'akumaFastHeader';

        const headingWrap = document.createElement('div');
        const heading = document.createElement('h1');
        heading.textContent = String(valueOf(payload, 'title', 'Title') || 'Games');
        const subtitle = document.createElement('p');
        subtitle.textContent = 'Escolha um sistema para ver os games.';
        headingWrap.append(heading, subtitle);

        const count = document.createElement('div');
        count.className = 'akumaFastCount';
        count.textContent = Number(valueOf(payload, 'totalGames', 'TotalGames') || 0).toLocaleString('pt-BR') + ' games';
        header.append(headingWrap, count);

        const grid = document.createElement('div');
        grid.className = 'akumaFastGrid';

        const categories = valueOf(payload, 'categories', 'Categories') || [];
        categories.forEach(function (item) {
            const name = String(valueOf(item, 'name', 'Name') || 'Outros');
            const itemId = String(valueOf(item, 'itemId', 'ItemId') || '');
            const imageUrl = String(valueOf(item, 'imageUrl', 'ImageUrl') || '');
            const gameCount = Number(valueOf(item, 'count', 'Count') || 0);

            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'akumaFastCard';
            card.dataset.itemId = itemId;
            card.dataset.serverId = route.serverId || '';
            card.disabled = !itemId || /^0{8}-0{4}-0{4}-0{4}-0{12}$/i.test(itemId);

            const image = document.createElement('img');
            image.className = 'akumaFastPoster';
            image.loading = 'eager';
            image.decoding = 'async';
            image.alt = 'Categoria ' + name;
            image.src = imageUrl || createFallbackImage(name);
            image.addEventListener('error', function () {
                image.src = createFallbackImage(name);
            }, { once: true });

            const body = document.createElement('div');
            body.className = 'akumaFastBody';
            const categoryName = document.createElement('div');
            categoryName.className = 'akumaFastName';
            categoryName.textContent = name;
            const meta = document.createElement('div');
            meta.className = 'akumaFastMeta';
            meta.textContent = gameCount.toLocaleString('pt-BR') + (gameCount === 1 ? ' game' : ' games');
            body.append(categoryName, meta);
            card.append(image, body);
            grid.appendChild(card);
        });

        shell.append(header, grid);
        root.appendChild(shell);
        root.classList.add('akuma-fast-open');
        return true;
    }

    async function resolveFastLibraryRoute() {
        const route = readListRoute();
        const requestId = ++fastRequestSequence;

        if (!route || fastNonRoots.has(route.parentId)) {
            hideFastRoot();
            return;
        }

        const cached = loadFastCache(route);
        if (cached) {
            renderFastLibrary(route, cached);
        }

        if (!cached) {
            // O overlay aparece em milissegundos e cobre o spinner lento da consulta nativa.
            showFastLoading();
        }

        try {
            const client = await waitForApiClient(10000);
            const response = await client.ajax({
                type: 'GET',
                url: client.getUrl('AkumaGames/FastLibrary/' + encodeURIComponent(route.parentId)),
                dataType: 'json'
            });

            if (requestId !== fastRequestSequence) return;
            saveFastCache(route, response);
            renderFastLibrary(route, response);
        } catch (error) {
            if (requestId !== fastRequestSequence) return;
            if (Number(error && error.status) === 404) {
                fastNonRoots.add(route.parentId);
            }
            hideFastRoot();
        }
    }

    function scheduleFastRouteCheck(delay) {
        window.clearTimeout(fastRouteTimer);
        fastRouteTimer = window.setTimeout(function () {
            void resolveFastLibraryRoute();
        }, delay || 20);
    }

    document.addEventListener('click', function (event) {
        const card = event.target.closest('#AkumaFastLibraryRoot .akumaFastCard');
        if (!card || card.disabled) return;

        event.preventDefault();
        event.stopPropagation();
        const params = new URLSearchParams();
        params.set('parentId', card.dataset.itemId || '');
        if (card.dataset.serverId) params.set('serverId', card.dataset.serverId);
        hideFastRoot();
        window.location.hash = '#/list?' + params.toString();
    }, true);

    document.addEventListener('click', function (event) {
        void handleImageClick(event);
    }, true);

    window.addEventListener('hashchange', function () {
        fastLastHash = String(window.location.hash || '');
        hideFastRoot();
        scheduleFastRouteCheck(10);
    });

    window.addEventListener('resize', function () {
        const root = document.getElementById('AkumaFastLibraryRoot');
        if (root && root.classList.contains('akuma-fast-open')) updateFastRootTop(root);
    });

    window.setInterval(function () {
        const hash = String(window.location.hash || '');
        if (hash !== fastLastHash) {
            fastLastHash = hash;
            hideFastRoot();
            scheduleFastRouteCheck(10);
        }
    }, 500);

    window.AkumaGamesCardClickBridge = {
        version: VERSION,
        loaded: true,
        pending: function () { return Array.from(pendingItems); },
        gamesCached: function () { return confirmedGames.size; },
        nonGamesCached: function () { return confirmedNonGames.size; },
        refreshFastLibrary: function () {
            const route = readListRoute();
            if (route) {
                try { window.sessionStorage.removeItem(fastCacheKey(route)); } catch (_) { /* sem ação */ }
            }
            scheduleFastRouteCheck(0);
        }
    };

    fastLastHash = String(window.location.hash || '');
    scheduleFastRouteCheck(30);
    console.info('Akuma Games Card Click + Fast Library Bridge v' + VERSION + ' carregado.');
})();
