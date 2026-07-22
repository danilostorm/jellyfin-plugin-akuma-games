/* Akuma Games Card Click Bridge v0.2.3.2
 * Faz o clique na capa usar a mesma rota do título do game.
 * O bridge principal detecta a página de detalhes e abre o PlayerUrl HTML5.
 */
(function () {
    'use strict';

    const VERSION = '0.2.3.2';
    if (window.__akumaGamesCardClickLoaded === VERSION) return;
    window.__akumaGamesCardClickLoaded = VERSION;

    const pendingItems = new Set();
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
            'a[href*="id="]'
        ].join(','));

        return preferred ? preferred.href : '';
    }

    function findTitleHref(card) {
        if (!card) return '';

        const titleLink = card.querySelector([
            '.cardText-first a[href]',
            '.cardText a[href]',
            '.cardText-secondary a[href]',
            'a.itemAction[href*="id="]',
            'a[href*="#/details?"]',
            'a[href*="/details?"]'
        ].join(','));

        return titleLink ? titleLink.href : '';
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

        const itemId = findItemId(event.target, card);
        if (!itemId || pendingItems.has(itemId)) return;

        const originalHref = findOriginalHref(event.target, card);
        const titleHref = findTitleHref(card);

        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') {
            event.stopImmediatePropagation();
        }

        pendingItems.add(itemId);

        try {
            const client = await waitForApiClient(10000);
            await client.ajax({
                type: 'GET',
                url: client.getUrl('AkumaGames/ResolveItem/' + encodeURIComponent(itemId)),
                dataType: 'json'
            });

            navigateToDetails(itemId, titleHref, client);
        } catch (error) {
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
        pending: function () { return Array.from(pendingItems); }
    };

    console.info('Akuma Games Card Click Bridge v' + VERSION + ' carregado.');
})();
