using System.Net.Mime;
using Jellyfin.Plugin.AkumaGames.Models;
using Jellyfin.Plugin.AkumaGames.Services;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.AkumaGames.Api;

/// <summary>
/// Entrega uma raiz leve da biblioteca Games para o Jellyfin Web.
/// Ela é pré-carregada antes do clique, evitando aguardar a listagem nativa.
/// </summary>
[ApiController]
[Route("AkumaGames")]
[Authorize]
[Produces(MediaTypeNames.Application.Json)]
public sealed class AkumaGamesFastRootController : ControllerBase
{
    private readonly GameCatalogStore _catalogStore;
    private readonly GameLibrarySyncService _syncService;
    private readonly ILibraryManager _libraryManager;

    public AkumaGamesFastRootController(
        GameCatalogStore catalogStore,
        GameLibrarySyncService syncService,
        ILibraryManager libraryManager)
    {
        _catalogStore = catalogStore;
        _syncService = syncService;
        _libraryManager = libraryManager;
    }

    /// <summary>
    /// Pode ser chamado em segundo plano logo após o login. Não depende do ID da
    /// UserView, que muda conforme o usuário e não possui o caminho físico da biblioteca.
    /// </summary>
    [HttpGet("FastRoot")]
    public async Task<ActionResult<object>> GetFastRoot(CancellationToken cancellationToken)
    {
        object? payload = await BuildPayloadAsync(null, cancellationToken).ConfigureAwait(false);
        return payload is null ? NotFound() : Ok(payload);
    }

    /// <summary>
    /// Valida uma rota /list direta. O parentId do Jellyfin Web normalmente aponta
    /// para uma UserView chamada Games, e não para a pasta física da biblioteca.
    /// </summary>
    [HttpGet("FastRoot/Validate/{parentId:guid}")]
    public async Task<ActionResult<object>> ValidateFastRoot(
        Guid parentId,
        CancellationToken cancellationToken)
    {
        BaseItem? parent = _libraryManager.GetItemById(parentId);
        if (parent is null || !IsAkumaGamesRoot(parent))
        {
            return NotFound();
        }

        object? payload = await BuildPayloadAsync(parentId, cancellationToken).ConfigureAwait(false);
        return payload is null ? NotFound() : Ok(payload);
    }

    private bool IsAkumaGamesRoot(BaseItem parent)
    {
        if (PathsEqual(parent.Path, _syncService.LibraryPath))
        {
            return true;
        }

        string libraryName = Plugin.Instance?.Configuration.LibraryName?.Trim() ?? "Games";
        if (string.IsNullOrWhiteSpace(libraryName))
        {
            libraryName = "Games";
        }

        // A página inicial usa uma UserView sem Path. O nome é a identificação
        // confiável dessa view para usuários comuns e administradores.
        if (string.Equals(parent.Name?.Trim(), libraryName, StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        try
        {
            return _libraryManager.GetCollectionFolders(parent)
                .Any(folder => PathsEqual(folder.Path, _syncService.LibraryPath));
        }
        catch (Exception)
        {
            return false;
        }
    }

    private async Task<object?> BuildPayloadAsync(
        Guid? requestedParentId,
        CancellationToken cancellationToken)
    {
        IReadOnlyList<AkumaGame> games = await _catalogStore.LoadAsync(cancellationToken).ConfigureAwait(false);
        if (games.Count == 0)
        {
            return null;
        }

        BaseItem? physicalRoot = _libraryManager.FindByPath(_syncService.LibraryPath, true);

        var categories = games
            .GroupBy(
                game => string.IsNullOrWhiteSpace(game.System) ? "Outros sistemas" : game.System.Trim(),
                StringComparer.OrdinalIgnoreCase)
            .Select(group =>
            {
                string systemPath = Path.Combine(_syncService.LibraryPath, SafeSegment(group.Key));
                BaseItem? folder = _libraryManager.FindByPath(systemPath, true);
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

        string title = Plugin.Instance?.Configuration.LibraryName?.Trim() ?? "Games";
        if (string.IsNullOrWhiteSpace(title))
        {
            title = "Games";
        }

        return new
        {
            kind = "root",
            title,
            rootItemId = physicalRoot?.Id ?? Guid.Empty,
            requestedParentId = requestedParentId ?? Guid.Empty,
            totalGames = games.Count,
            generatedAt = DateTimeOffset.UtcNow,
            categories
        };
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
