using System.Text;
using System.Text.Json;
using Jellyfin.Plugin.AkumaGames.Models;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Controller.Library;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.AkumaGames.Services;

/// <summary>
/// Sincroniza os dados do catálogo sem criar mídias reproduzíveis pelo Jellyfin.
/// </summary>
public sealed class GameLibrarySyncService
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    private readonly IApplicationPaths _applicationPaths;
    private readonly ILibraryManager _libraryManager;
    private readonly AkumaGamesClient _client;
    private readonly GameCatalogStore _catalogStore;
    private readonly ILogger<GameLibrarySyncService> _logger;
    private readonly SemaphoreSlim _syncLock = new(1, 1);

    public GameLibrarySyncService(
        IApplicationPaths applicationPaths,
        ILibraryManager libraryManager,
        AkumaGamesClient client,
        GameCatalogStore catalogStore,
        ILogger<GameLibrarySyncService> logger)
    {
        _applicationPaths = applicationPaths;
        _libraryManager = libraryManager;
        _client = client;
        _catalogStore = catalogStore;
        _logger = logger;
    }

    public string LibraryPath => Path.Combine(_applicationPaths.DataPath, "akuma-games-library");

    public async Task<int> SyncAsync(IProgress<double>? progress, CancellationToken cancellationToken)
    {
        await _syncLock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            Directory.CreateDirectory(LibraryPath);
            IReadOnlyList<AkumaGame> games = await _client.GetAllGamesAsync(cancellationToken).ConfigureAwait(false);
            await _catalogStore.SaveAsync(games, cancellationToken).ConfigureAwait(false);
            progress?.Report(5);

            var activeDirectories = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            int completed = 0;

            foreach (AkumaGame game in games)
            {
                cancellationToken.ThrowIfCancellationRequested();
                string systemPath = Path.Combine(LibraryPath, SafeSegment(game.System));
                string gamePath = Path.Combine(systemPath, SafeSegment($"{game.Title} [{game.Id}]"));
                Directory.CreateDirectory(gamePath);
                activeDirectories.Add(Path.GetFullPath(gamePath));

                DeleteLegacyVideoFiles(gamePath);

                string metadata = JsonSerializer.Serialize(game, JsonOptions);
                await WriteTextIfChangedAsync(Path.Combine(gamePath, "game.json"), metadata, cancellationToken).ConfigureAwait(false);
                await WriteTextIfChangedAsync(
                    Path.Combine(gamePath, ".akuma-game"),
                    game.Id.ToString(System.Globalization.CultureInfo.InvariantCulture),
                    cancellationToken).ConfigureAwait(false);

                if (Plugin.Instance?.Configuration.DownloadImages == true && !string.IsNullOrWhiteSpace(game.ImageUrl))
                {
                    string imagePath = Path.Combine(gamePath, "poster.jpg");
                    if (!File.Exists(imagePath) || new FileInfo(imagePath).Length == 0)
                    {
                        try
                        {
                            await _client.DownloadImageAsync(game.ImageUrl, imagePath, cancellationToken).ConfigureAwait(false);
                        }
                        catch (Exception ex) when (ex is HttpRequestException or IOException)
                        {
                            _logger.LogWarning(ex, "Não foi possível baixar a capa de {Game}.", game.Title);
                        }
                    }
                }

                completed++;
                progress?.Report(5 + (completed * 90.0 / Math.Max(1, games.Count)));
            }

            if (Plugin.Instance?.Configuration.RemoveMissingGames == true)
            {
                RemoveMissingDirectories(activeDirectories);
            }

            // Solicita uma varredura para que itens .strm antigos desapareçam da biblioteca legada.
            // A v0.2 usa uma página própria e não envia mais os games ao player de vídeo.
            _libraryManager.QueueLibraryScan();
            progress?.Report(100);
            _logger.LogInformation(
                "Akuma Games: catálogo sincronizado com {Count} games. Nenhum item de vídeo foi criado.",
                games.Count);
            return games.Count;
        }
        finally
        {
            _syncLock.Release();
        }
    }

    private static void DeleteLegacyVideoFiles(string gamePath)
    {
        DeleteIfExists(Path.Combine(gamePath, "game.strm"));
        DeleteIfExists(Path.Combine(gamePath, "game.nfo"));
    }

    private static void DeleteIfExists(string path)
    {
        try
        {
            if (File.Exists(path))
            {
                File.Delete(path);
            }
        }
        catch (IOException)
        {
            // A próxima sincronização tentará novamente.
        }
        catch (UnauthorizedAccessException)
        {
            // A próxima sincronização tentará novamente.
        }
    }

    private void RemoveMissingDirectories(HashSet<string> activeDirectories)
    {
        foreach (string marker in Directory.EnumerateFiles(LibraryPath, ".akuma-game", SearchOption.AllDirectories))
        {
            string? directory = Path.GetDirectoryName(marker);
            if (directory is null || activeDirectories.Contains(Path.GetFullPath(directory)))
            {
                continue;
            }

            try
            {
                Directory.Delete(directory, true);
            }
            catch (IOException ex)
            {
                _logger.LogWarning(ex, "Não foi possível remover o item antigo {Directory}.", directory);
            }
        }
    }

    private static string SafeSegment(string value)
    {
        string cleaned = string.Join("_", value.Split(Path.GetInvalidFileNameChars(), StringSplitOptions.RemoveEmptyEntries)).Trim();
        if (string.IsNullOrWhiteSpace(cleaned))
        {
            cleaned = "Sem nome";
        }

        return cleaned.Length <= 120 ? cleaned : cleaned[..120].Trim();
    }

    private static async Task WriteTextIfChangedAsync(string path, string content, CancellationToken cancellationToken)
    {
        content ??= string.Empty;
        if (File.Exists(path))
        {
            string existing = await File.ReadAllTextAsync(path, cancellationToken).ConfigureAwait(false);
            if (string.Equals(existing, content, StringComparison.Ordinal))
            {
                return;
            }
        }

        await File.WriteAllTextAsync(path, content, new UTF8Encoding(false), cancellationToken).ConfigureAwait(false);
    }
}
