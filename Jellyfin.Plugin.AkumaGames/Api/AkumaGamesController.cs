using System.Net.Mime;
using Jellyfin.Plugin.AkumaGames.Models;
using Jellyfin.Plugin.AkumaGames.Services;
using MediaBrowser.Common.Api;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.AkumaGames.Api;

[ApiController]
[Route("AkumaGames")]
[Authorize]
[Produces(MediaTypeNames.Application.Json)]
public sealed class AkumaGamesController : ControllerBase
{
    private readonly AkumaGamesClient _client;
    private readonly GameCatalogStore _catalogStore;
    private readonly GameLibrarySyncService _syncService;
    private readonly ILibraryManager _libraryManager;

    public AkumaGamesController(
        AkumaGamesClient client,
        GameCatalogStore catalogStore,
        GameLibrarySyncService syncService,
        ILibraryManager libraryManager)
    {
        _client = client;
        _catalogStore = catalogStore;
        _syncService = syncService;
        _libraryManager = libraryManager;
    }

    [HttpGet("Catalog")]
    public async Task<ActionResult<GameCatalogResponse>> GetCatalog(
        [FromQuery] bool refresh,
        CancellationToken cancellationToken)
    {
        IReadOnlyList<AkumaGame> games = refresh
            ? Array.Empty<AkumaGame>()
            : await _catalogStore.LoadAsync(cancellationToken).ConfigureAwait(false);

        if (games.Count == 0)
        {
            games = await _client.GetAllGamesAsync(cancellationToken).ConfigureAwait(false);
            await _catalogStore.SaveAsync(games, cancellationToken).ConfigureAwait(false);
        }

        GameCatalogItem[] items = games
            .Select(GameCatalogItem.FromGame)
            .OrderBy(game => game.Title, StringComparer.CurrentCultureIgnoreCase)
            .ToArray();

        return Ok(new GameCatalogResponse(DateTimeOffset.UtcNow, items.Length, items));
    }

    /// <summary>
    /// Retorna somente as poucas categorias da raiz Games. O Jellyfin Web usa este
    /// endpoint para desenhar a tela imediatamente, sem esperar a consulta nativa
    /// percorrer os milhares de diretórios de games.
    /// </summary>
    [HttpGet("FastLibrary/{parentId:guid}")]
    public async Task<ActionResult<object>> GetFastLibrary(
        Guid parentId,
        CancellationToken cancellationToken)
    {
        var parent = _libraryManager.GetItemById(parentId);
        if (parent is null || !PathsEqual(parent.Path, _syncService.LibraryPath))
        {
            return NotFound();
        }

        IReadOnlyList<AkumaGame> games = await _catalogStore.LoadAsync(cancellationToken).ConfigureAwait(false);
        if (games.Count == 0)
        {
            return NotFound();
        }

        var categories = games
            .GroupBy(
                game => string.IsNullOrWhiteSpace(game.System) ? "Outros sistemas" : game.System.Trim(),
                StringComparer.OrdinalIgnoreCase)
            .Select(group =>
            {
                string systemPath = Path.Combine(_syncService.LibraryPath, SafeSegment(group.Key));
                var folder = _libraryManager.FindByPath(systemPath, true);
                AkumaGame representative = group
                    .OrderByDescending(game => !string.IsNullOrWhiteSpace(game.ImageUrl))
                    .ThenBy(game => game.Title, StringComparer.CurrentCultureIgnoreCase)
                    .First();

                return new
                {
                    name = group.Key,
                    count = group.Count(),
                    itemId = folder?.Id ?? Guid.Empty,
                    imageUrl = representative.ImageUrl ?? string.Empty
                };
            })
            .OrderBy(category => category.name, StringComparer.CurrentCultureIgnoreCase)
            .ToArray();

        return Ok(new
        {
            kind = "root",
            parentId,
            title = Plugin.Instance?.Configuration.LibraryName?.Trim() ?? "Games",
            totalGames = games.Count,
            categories
        });
    }

    [HttpGet("Games/{id:int}")]
    public async Task<ActionResult<GameCatalogItem>> GetGame(
        int id,
        CancellationToken cancellationToken)
    {
        AkumaGame? game = await FindGameAsync(id, cancellationToken).ConfigureAwait(false);
        if (game is null)
        {
            return NotFound();
        }

        return Ok(GameCatalogItem.FromGame(game));
    }

    [HttpGet("Games/{id:int}/Launch")]
    public async Task<ActionResult<GameLaunchResponse>> GetLaunchInformation(
        int id,
        CancellationToken cancellationToken)
    {
        return await BuildLaunchResponseAsync(id, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// Resolve um item da biblioteca nativa para o game correspondente.
    /// Isso permite que o Jellyfin Web troque o player de foto/vídeo pelo launcher HTML5.
    /// </summary>
    [HttpGet("ResolveItem/{itemId:guid}")]
    public async Task<ActionResult<GameLaunchResponse>> ResolveLibraryItem(
        Guid itemId,
        CancellationToken cancellationToken)
    {
        var item = _libraryManager.GetItemById(itemId);
        if (item is null)
        {
            return NotFound();
        }

        int? gameId = TryResolveGameId(item.Path, item.ProviderIds);
        if (!gameId.HasValue)
        {
            return NotFound();
        }

        return await BuildLaunchResponseAsync(gameId.Value, cancellationToken).ConfigureAwait(false);
    }

    [HttpPost("Sync")]
    [Authorize(Policy = Policies.RequiresElevation)]
    public async Task<ActionResult<GameSyncResponse>> Sync(CancellationToken cancellationToken)
    {
        int count = await _syncService.SyncAsync(null, cancellationToken).ConfigureAwait(false);
        return Ok(new GameSyncResponse(count, "Catálogo sincronizado sem criar vídeos no Jellyfin."));
    }

    private async Task<ActionResult<GameLaunchResponse>> BuildLaunchResponseAsync(
        int id,
        CancellationToken cancellationToken)
    {
        AkumaGame? game = await FindGameAsync(id, cancellationToken).ConfigureAwait(false);
        if (game is null)
        {
            return NotFound();
        }

        if (string.IsNullOrWhiteSpace(game.PlayerUrl)
            || !Uri.TryCreate(game.PlayerUrl, UriKind.Absolute, out Uri? playerUri)
            || (playerUri.Scheme != Uri.UriSchemeHttp && playerUri.Scheme != Uri.UriSchemeHttps))
        {
            return UnprocessableEntity(new { message = "Este game não possui uma URL de execução válida." });
        }

        return Ok(new GameLaunchResponse(game.Id, game.Title, playerUri.AbsoluteUri));
    }

    private int? TryResolveGameId(
        string? itemPath,
        IReadOnlyDictionary<string, string>? providerIds)
    {
        if (providerIds is not null)
        {
            foreach (KeyValuePair<string, string> provider in providerIds)
            {
                if (string.Equals(provider.Key, "akumagames", StringComparison.OrdinalIgnoreCase)
                    && int.TryParse(provider.Value, out int providerGameId)
                    && providerGameId > 0)
                {
                    return providerGameId;
                }
            }
        }

        if (string.IsNullOrWhiteSpace(itemPath))
        {
            return null;
        }

        string libraryRoot;
        try
        {
            libraryRoot = Path.GetFullPath(_syncService.LibraryPath)
                .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        }
        catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException)
        {
            return null;
        }

        string? currentPath = itemPath;
        if (!Directory.Exists(currentPath))
        {
            currentPath = Path.GetDirectoryName(currentPath);
        }

        for (int depth = 0; depth < 8 && !string.IsNullOrWhiteSpace(currentPath); depth++)
        {
            string fullPath;
            try
            {
                fullPath = Path.GetFullPath(currentPath)
                    .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            }
            catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException)
            {
                break;
            }

            bool isInsideLibrary = string.Equals(fullPath, libraryRoot, StringComparison.OrdinalIgnoreCase)
                || fullPath.StartsWith(
                    libraryRoot + Path.DirectorySeparatorChar,
                    StringComparison.OrdinalIgnoreCase)
                || fullPath.StartsWith(
                    libraryRoot + Path.AltDirectorySeparatorChar,
                    StringComparison.OrdinalIgnoreCase);

            if (!isInsideLibrary)
            {
                break;
            }

            string markerPath = Path.Combine(fullPath, ".akuma-game");
            if (System.IO.File.Exists(markerPath))
            {
                try
                {
                    string marker = System.IO.File.ReadAllText(markerPath).Trim();
                    if (int.TryParse(marker, out int markerGameId) && markerGameId > 0)
                    {
                        return markerGameId;
                    }
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                {
                    return null;
                }
            }

            string directoryName = Path.GetFileName(fullPath);
            int openBracket = directoryName.LastIndexOf('[');
            int closeBracket = directoryName.LastIndexOf(']');
            if (openBracket >= 0
                && closeBracket > openBracket
                && int.TryParse(directoryName[(openBracket + 1)..closeBracket], out int pathGameId)
                && pathGameId > 0)
            {
                return pathGameId;
            }

            if (string.Equals(fullPath, libraryRoot, StringComparison.OrdinalIgnoreCase))
            {
                break;
            }

            currentPath = Path.GetDirectoryName(fullPath);
        }

        return null;
    }

    private async Task<AkumaGame?> FindGameAsync(int id, CancellationToken cancellationToken)
    {
        AkumaGame? game = await _catalogStore.FindAsync(id, cancellationToken).ConfigureAwait(false);
        if (game is not null)
        {
            return game;
        }

        IReadOnlyList<AkumaGame> games = await _client.GetAllGamesAsync(cancellationToken).ConfigureAwait(false);
        await _catalogStore.SaveAsync(games, cancellationToken).ConfigureAwait(false);
        return games.FirstOrDefault(item => item.Id == id);
    }

    private static bool PathsEqual(string? left, string right)
    {
        if (string.IsNullOrWhiteSpace(left))
        {
            return false;
        }

        try
        {
            string normalizedLeft = Path.GetFullPath(left)
                .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            string normalizedRight = Path.GetFullPath(right)
                .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            return string.Equals(normalizedLeft, normalizedRight, StringComparison.OrdinalIgnoreCase);
        }
        catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException)
        {
            return false;
        }
    }

    private static string SafeSegment(string value)
    {
        string cleaned = string.Join(
            "_",
            (value ?? string.Empty).Split(
                Path.GetInvalidFileNameChars(),
                StringSplitOptions.RemoveEmptyEntries)).Trim();

        if (string.IsNullOrWhiteSpace(cleaned))
        {
            cleaned = "Sem nome";
        }

        return cleaned.Length <= 120 ? cleaned : cleaned[..120].Trim();
    }
}
