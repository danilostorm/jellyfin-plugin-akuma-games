using System.Globalization;
using System.Net.Http.Headers;
using System.Text.Json;
using Jellyfin.Plugin.AkumaGames.Models;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.AkumaGames.Services;

public sealed class AkumaGamesClient : IDisposable
{
    private const int PageSize = 100;
    private readonly HttpClient _httpClient;
    private readonly ILogger<AkumaGamesClient> _logger;

    public AkumaGamesClient(ILogger<AkumaGamesClient> logger)
    {
        _logger = logger;
        _httpClient = new HttpClient { Timeout = TimeSpan.FromSeconds(45) };
        _httpClient.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("Jellyfin-AkumaGames", "0.2.0"));
        _httpClient.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
    }

    public async Task<IReadOnlyList<AkumaGame>> GetAllGamesAsync(CancellationToken cancellationToken)
    {
        string apiUrl = Plugin.Instance?.Configuration.ApiUrl?.Trim() ?? "https://play.hoststorm.cloud/api/akumanimes";
        if (!Uri.TryCreate(apiUrl, UriKind.Absolute, out _))
        {
            throw new InvalidOperationException("A URL configurada para a API de games é inválida.");
        }

        var games = new List<AkumaGame>();
        int offset = 0;
        int? total = null;

        while (!cancellationToken.IsCancellationRequested && games.Count < 10000)
        {
            string separator = apiUrl.Contains('?', StringComparison.Ordinal) ? "&" : "?";
            string pageUrl = string.Create(CultureInfo.InvariantCulture, $"{apiUrl}{separator}limit={PageSize}&offset={offset}&sort=az");
            using HttpResponseMessage response = await _httpClient.GetAsync(pageUrl, cancellationToken).ConfigureAwait(false);
            response.EnsureSuccessStatusCode();
            await using Stream content = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
            using JsonDocument document = await JsonDocument.ParseAsync(content, cancellationToken: cancellationToken).ConfigureAwait(false);

            JsonElement root = document.RootElement;
            JsonElement container = GetObject(root, "data") ?? root;
            JsonElement? itemsElement = FindArray(root, "games", "items", "results") ?? FindArray(container, "games", "items", "results");
            if (itemsElement is null && root.ValueKind == JsonValueKind.Array)
            {
                itemsElement = root;
            }

            if (itemsElement is null)
            {
                throw new InvalidOperationException("A API não retornou uma lista de games reconhecível.");
            }

            total ??= GetInt(root, "total", "count", "totalGames") ?? GetInt(container, "total", "count", "totalGames");
            int received = 0;
            foreach (JsonElement item in itemsElement.Value.EnumerateArray())
            {
                if (TryParseGame(item, out AkumaGame? game))
                {
                    games.Add(game);
                    received++;
                }
            }

            _logger.LogInformation("Akuma Games API: {Received} itens recebidos no offset {Offset}; {Loaded} carregados.", received, offset, games.Count);
            if (received == 0 || received < PageSize || (total.HasValue && games.Count >= total.Value))
            {
                break;
            }

            offset += PageSize;
        }

        return games.GroupBy(game => game.Id).Select(group => group.First()).ToArray();
    }

    public async Task DownloadImageAsync(string imageUrl, string destination, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(imageUrl) || !Uri.TryCreate(imageUrl, UriKind.Absolute, out Uri? uri))
        {
            return;
        }

        using HttpResponseMessage response = await _httpClient.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();
        await using Stream input = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
        await using FileStream output = new(destination, FileMode.Create, FileAccess.Write, FileShare.None, 81920, true);
        await input.CopyToAsync(output, cancellationToken).ConfigureAwait(false);
    }

    public void Dispose() => _httpClient.Dispose();

    private static bool TryParseGame(JsonElement item, out AkumaGame? game)
    {
        game = null;
        int id = GetInt(item, "id", "gameId") ?? 0;
        string title = GetString(item, "title", "name") ?? string.Empty;
        string playerUrl = GetString(item, "playerUrl", "player_url", "url") ?? string.Empty;
        if (id <= 0 || string.IsNullOrWhiteSpace(title))
        {
            return false;
        }

        string system = GetString(item, "systemTitle", "systemName") ?? string.Empty;
        if (TryGetProperty(item, "system", out JsonElement systemElement))
        {
            system = systemElement.ValueKind == JsonValueKind.Object
                ? GetString(systemElement, "title", "name", "slug") ?? system
                : ElementToString(systemElement) ?? system;
        }

        string genre = GetString(item, "genreLabel", "genre") ?? string.Empty;
        if (TryGetProperty(item, "genres", out JsonElement genresElement) && genresElement.ValueKind == JsonValueKind.Array)
        {
            genre = string.Join(
                " / ",
                genresElement
                    .EnumerateArray()
                    .Select(value => value.ValueKind == JsonValueKind.Object
                        ? GetString(value, "label", "title", "name")
                        : ElementToString(value))
                    .Where(value => !string.IsNullOrWhiteSpace(value)));
        }

        DateTimeOffset? createdAt = null;
        string? createdAtText = GetString(item, "createdAt", "created_at", "dateAdded");
        if (DateTimeOffset.TryParse(createdAtText, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out DateTimeOffset parsed))
        {
            createdAt = parsed;
        }

        game = new AkumaGame(
            id,
            title.Trim(),
            GetString(item, "slug") ?? string.Empty,
            GetString(item, "image", "cover", "poster", "imageUrl") ?? string.Empty,
            GetString(item, "description", "plot", "overview") ?? "Game disponível no catálogo Akumanimes.",
            playerUrl,
            string.IsNullOrWhiteSpace(system) ? "Outros" : system,
            genre,
            GetString(item, "players") ?? string.Empty,
            GetString(item, "rating") ?? string.Empty,
            GetLong(item, "playCount", "plays", "views") ?? 0,
            createdAt);
        return true;
    }

    private static JsonElement? FindArray(JsonElement element, params string[] names)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        foreach (string name in names)
        {
            if (TryGetProperty(element, name, out JsonElement value) && value.ValueKind == JsonValueKind.Array)
            {
                return value;
            }
        }

        return null;
    }

    private static JsonElement? GetObject(JsonElement element, string name)
        => TryGetProperty(element, name, out JsonElement value) && value.ValueKind == JsonValueKind.Object ? value : null;

    private static int? GetInt(JsonElement element, params string[] names)
    {
        long? value = GetLong(element, names);
        return value is >= int.MinValue and <= int.MaxValue ? (int)value.Value : null;
    }

    private static long? GetLong(JsonElement element, params string[] names)
    {
        foreach (string name in names)
        {
            if (!TryGetProperty(element, name, out JsonElement value))
            {
                continue;
            }

            if (value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out long number))
            {
                return number;
            }

            if (long.TryParse(ElementToString(value), NumberStyles.Integer, CultureInfo.InvariantCulture, out number))
            {
                return number;
            }
        }

        return null;
    }

    private static string? GetString(JsonElement element, params string[] names)
    {
        foreach (string name in names)
        {
            if (TryGetProperty(element, name, out JsonElement value))
            {
                string? text = ElementToString(value);
                if (!string.IsNullOrWhiteSpace(text))
                {
                    return text;
                }
            }
        }

        return null;
    }

    private static string? ElementToString(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.String => value.GetString(),
        JsonValueKind.Number => value.GetRawText(),
        JsonValueKind.True => "true",
        JsonValueKind.False => "false",
        _ => null
    };

    private static bool TryGetProperty(JsonElement element, string name, out JsonElement value)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            foreach (JsonProperty property in element.EnumerateObject())
            {
                if (string.Equals(property.Name, name, StringComparison.OrdinalIgnoreCase))
                {
                    value = property.Value;
                    return true;
                }
            }
        }

        value = default;
        return false;
    }
}
