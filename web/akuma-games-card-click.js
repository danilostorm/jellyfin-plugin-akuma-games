/* Akuma Games Card Click Bridge v0.2.3.5
 * Faz o clique na capa de um GAME usar a mesma rota do título.
 * Bibliotecas e categorias continuam com a navegação nativa instantânea do Jellyfin.
 */
(function () {
    'use strict';

    const VERSION = '0.2.3.5';
    if (window.__akumaGamesCardClickLoaded === VERSION) return;
    window.__akumaGamesCardClickLoaded = VERSION;

    const pendingItems = new Set();
    const confirmedGames = new Set();
    const confirmedNonGames = new Set();
    let bypassNextClick = false;

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

        // Se o título possui uma rota conhecida e ela não é /details, trata como
        // biblioteca/categoria e deixa o Jellyfin navegar sem consultar o plugin.
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
        if (event.target.closest('#AkumaNativeGameOverlay')) return;

        const card = findCard(event.target);
        if (!card) return;

        const originalHref = findOriginalHref(event.target, card);
        const titleHref = findTitleHref(card);

        // Esta é a otimização principal: biblioteca Games e pastas Arcade, NES,
        // PlayStation etc. seguem a rota nativa imediatamente, sem aguardar uma
        // chamada ResolveItem que inevitavelmente retornaria 404.
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
            const client = window.ApiClient;
            navigateToDetails(itemId, titleHref, client);
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
            // Não é um game Akuma: devolve o comportamento original do Jellyfin.
            restoreOriginalAction(originalHref);
        } finally {
            pendingItems.delete(itemId);
        }
    }

    document.addEventListener('click', function (event) {
        void handleImageClick(event);
    }, true);

    window.AkumaGamesCardClickBridge = {
        version: VERSION,
        loaded: true,
        pending: function () { return Array.from(pendingItems); },
        gamesCached: function () { return confirmedGames.size; },
        nonGamesCached: function () { return confirmedNonGames.size; }
    };

    console.info('Akuma Games Card Click Bridge v' + VERSION + ' carregado.');
})();
