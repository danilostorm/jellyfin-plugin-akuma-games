using System.Net.Mime;
using Jellyfin.Plugin.AkumaGames.Models;
using Jellyfin.Plugin.AkumaGames.Services;
using MediaBrowser.Common.Api;
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

    public AkumaGamesController(
        AkumaGamesClient client,
        GameCatalogStore catalogStore,
        GameLibrarySyncService syncService)
    {
        _client = client;
        _catalogStore = catalogStore;
        _syncService = syncService;
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

    [HttpPost("Sync")]
    [Authorize(Policy = Policies.RequiresElevation)]
    public async Task<ActionResult<GameSyncResponse>> Sync(CancellationToken cancellationToken)
    {
        int count = await _syncService.SyncAsync(null, cancellationToken).ConfigureAwait(false);
        return Ok(new GameSyncResponse(count, "Catálogo sincronizado sem criar vídeos no Jellyfin."));
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
}
