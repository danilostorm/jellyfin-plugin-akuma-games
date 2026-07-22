using System.Text.Json;
using Jellyfin.Plugin.AkumaGames.Models;
using MediaBrowser.Common.Configuration;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.AkumaGames.Services;

/// <summary>
/// Persiste o catálogo de games fora da biblioteca de mídia do Jellyfin.
/// Mantém também uma cópia em memória para que a navegação não precise
/// desserializar os 2 mil+ games a cada abertura da biblioteca.
/// </summary>
public sealed class GameCatalogStore
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = false
    };

    private readonly IApplicationPaths _applicationPaths;
    private readonly ILogger<GameCatalogStore> _logger;
    private readonly SemaphoreSlim _catalogLock = new(1, 1);
    private AkumaGame[]? _memoryCache;

    public GameCatalogStore(
        IApplicationPaths applicationPaths,
        ILogger<GameCatalogStore> logger)
    {
        _applicationPaths = applicationPaths;
        _logger = logger;
    }

    public string CatalogDirectory => Path.Combine(_applicationPaths.DataPath, "akuma-games");

    public string CatalogPath => Path.Combine(CatalogDirectory, "catalog.json");

    public async Task SaveAsync(IReadOnlyList<AkumaGame> games, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(games);
        AkumaGame[] snapshot = games.ToArray();

        await _catalogLock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            Directory.CreateDirectory(CatalogDirectory);
            string temporaryPath = CatalogPath + ".tmp";
            await using (FileStream stream = new(
                temporaryPath,
                FileMode.Create,
                FileAccess.Write,
                FileShare.None,
                81920,
                true))
            {
                await JsonSerializer.SerializeAsync(stream, snapshot, JsonOptions, cancellationToken).ConfigureAwait(false);
            }

            File.Move(temporaryPath, CatalogPath, true);
            Volatile.Write(ref _memoryCache, snapshot);
            _logger.LogInformation("Akuma Games: catálogo persistido com {Count} games.", snapshot.Length);
        }
        finally
        {
            _catalogLock.Release();
        }
    }

    public async Task<IReadOnlyList<AkumaGame>> LoadAsync(CancellationToken cancellationToken)
    {
        AkumaGame[]? cached = Volatile.Read(ref _memoryCache);
        if (cached is not null)
        {
            return cached;
        }

        await _catalogLock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            cached = Volatile.Read(ref _memoryCache);
            if (cached is not null)
            {
                return cached;
            }

            if (!File.Exists(CatalogPath))
            {
                return Array.Empty<AkumaGame>();
            }

            await using FileStream stream = new(
                CatalogPath,
                FileMode.Open,
                FileAccess.Read,
                FileShare.Read,
                81920,
                true);

            AkumaGame[]? games = await JsonSerializer
                .DeserializeAsync<AkumaGame[]>(stream, JsonOptions, cancellationToken)
                .ConfigureAwait(false);

            games ??= Array.Empty<AkumaGame>();
            Volatile.Write(ref _memoryCache, games);
            return games;
        }
        catch (JsonException ex)
        {
            _logger.LogWarning(ex, "Akuma Games: o cache do catálogo está inválido e será recriado.");
            return Array.Empty<AkumaGame>();
        }
        finally
        {
            _catalogLock.Release();
        }
    }

    public async Task<AkumaGame?> FindAsync(int id, CancellationToken cancellationToken)
    {
        IReadOnlyList<AkumaGame> games = await LoadAsync(cancellationToken).ConfigureAwait(false);
        return games.FirstOrDefault(game => game.Id == id);
    }
}
