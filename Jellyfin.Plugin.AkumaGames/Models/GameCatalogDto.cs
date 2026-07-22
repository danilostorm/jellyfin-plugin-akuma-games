namespace Jellyfin.Plugin.AkumaGames.Models;

public sealed record GameCatalogItem(
    int Id,
    string Title,
    string Slug,
    string ImageUrl,
    string Description,
    string System,
    string Genre,
    string Players,
    string Rating,
    long PlayCount,
    DateTimeOffset? CreatedAt)
{
    public static GameCatalogItem FromGame(AkumaGame game)
    {
        ArgumentNullException.ThrowIfNull(game);
        return new GameCatalogItem(
            game.Id,
            game.Title,
            game.Slug,
            game.ImageUrl,
            game.Description,
            game.System,
            game.Genre,
            game.Players,
            game.Rating,
            game.PlayCount,
            game.CreatedAt);
    }
}

public sealed record GameCatalogResponse(
    DateTimeOffset GeneratedAt,
    int Count,
    IReadOnlyList<GameCatalogItem> Items);

public sealed record GameLaunchResponse(
    int Id,
    string Title,
    string PlayerUrl);

public sealed record GameSyncResponse(
    int Count,
    string Message);
