namespace Jellyfin.Plugin.AkumaGames.Models;

public sealed record AkumaGame(
    int Id,
    string Title,
    string Slug,
    string ImageUrl,
    string Description,
    string PlayerUrl,
    string System,
    string Genre,
    string Players,
    string Rating,
    long PlayCount,
    DateTimeOffset? CreatedAt);
