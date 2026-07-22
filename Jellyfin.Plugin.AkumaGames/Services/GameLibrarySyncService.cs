using System.Text;
using System.Text.Json;
using System.Xml.Linq;
using Jellyfin.Plugin.AkumaGames.Models;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Configuration;
using MediaBrowser.Model.Entities;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.AkumaGames.Services;

/// <summary>
/// Sincroniza o catálogo, cria uma biblioteca nativa visível na página inicial
/// e não gera nenhuma mídia de vídeo reproduzível pelo Jellyfin.
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

                string systemName = SafeSegment(game.System);
                string gameName = SafeSegment($"{game.Title} [{game.Id}]");
                string systemPath = Path.Combine(LibraryPath, systemName);
                string gamePath = Path.Combine(systemPath, gameName);

                Directory.CreateDirectory(gamePath);
                activeDirectories.Add(Path.GetFullPath(gamePath));

                await EnsureSystemMetadataAsync(systemPath, game.System, cancellationToken).ConfigureAwait(false);
                DeleteLegacyVideoFiles(gamePath);

                string metadata = JsonSerializer.Serialize(game, JsonOptions);
                await WriteTextIfChangedAsync(Path.Combine(gamePath, "game.json"), metadata, cancellationToken).ConfigureAwait(false);
                await WriteTextIfChangedAsync(
                    Path.Combine(gamePath, ".akuma-game"),
                    game.Id.ToString(System.Globalization.CultureInfo.InvariantCulture),
                    cancellationToken).ConfigureAwait(false);
                await WriteTextIfChangedAsync(
                    Path.Combine(gamePath, "folder.nfo"),
                    BuildFolderNfo(game),
                    cancellationToken).ConfigureAwait(false);

                if (Plugin.Instance?.Configuration.DownloadImages == true && !string.IsNullOrWhiteSpace(game.ImageUrl))
                {
                    await EnsureGameImagesAsync(game, gamePath, gameName, cancellationToken).ConfigureAwait(false);
                }

                completed++;
                progress?.Report(5 + (completed * 85.0 / Math.Max(1, games.Count)));
            }

            if (Plugin.Instance?.Configuration.RemoveMissingGames == true)
            {
                RemoveMissingDirectories(activeDirectories);
            }

            if (Plugin.Instance?.Configuration.AutoCreateLibrary != false)
            {
                await EnsureNativeLibraryAsync(cancellationToken).ConfigureAwait(false);
            }

            _libraryManager.QueueLibraryScan();
            progress?.Report(100);
            _logger.LogInformation(
                "Akuma Games: catálogo sincronizado com {Count} games. Biblioteca nativa atualizada sem criar vídeos.",
                games.Count);
            return games.Count;
        }
        finally
        {
            _syncLock.Release();
        }
    }

    private async Task EnsureNativeLibraryAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        string libraryName = Plugin.Instance?.Configuration.LibraryName?.Trim() ?? "Games";
        if (string.IsNullOrWhiteSpace(libraryName))
        {
            libraryName = "Games";
        }

        bool exists = _libraryManager.GetVirtualFolders(true)
            .Any(folder =>
                string.Equals(folder.Name, libraryName, StringComparison.OrdinalIgnoreCase)
                || folder.Locations.Any(location =>
                    string.Equals(
                        Path.GetFullPath(location),
                        Path.GetFullPath(LibraryPath),
                        StringComparison.OrdinalIgnoreCase)));

        if (exists)
        {
            return;
        }

        var options = new LibraryOptions
        {
            PathInfos = [new MediaPathInfo(LibraryPath)],
            EnableRealtimeMonitor = false,
            EnablePhotos = true,
            SaveLocalMetadata = true,
            PreferredMetadataLanguage = "pt-BR",
            MetadataCountryCode = "BR"
        };

        // Home videos é usado apenas como contêiner nativo. Como não há .strm, MP4 ou outra
        // mídia de vídeo, os games não são enviados ao FFmpeg nem ao player do Jellyfin.
        await _libraryManager.AddVirtualFolder(
            libraryName,
            CollectionTypeOptions.homevideos,
            options,
            false).ConfigureAwait(false);

        _logger.LogInformation(
            "Akuma Games: biblioteca nativa {LibraryName} criada em {Path}.",
            libraryName,
            LibraryPath);
    }

    private async Task EnsureGameImagesAsync(
        AkumaGame game,
        string gamePath,
        string safeGameName,
        CancellationToken cancellationToken)
    {
        string itemImagePath = Path.Combine(gamePath, safeGameName + ".jpg");
        string folderImagePath = Path.Combine(gamePath, "folder.jpg");
        string legacyPosterPath = Path.Combine(gamePath, "poster.jpg");

        if (!File.Exists(itemImagePath) || new FileInfo(itemImagePath).Length == 0)
        {
            try
            {
                if (File.Exists(legacyPosterPath) && new FileInfo(legacyPosterPath).Length > 0)
                {
                    File.Copy(legacyPosterPath, itemImagePath, true);
                }
                else
                {
                    await _client.DownloadImageAsync(game.ImageUrl, itemImagePath, cancellationToken).ConfigureAwait(false);
                }
            }
            catch (Exception ex) when (ex is HttpRequestException or IOException or UnauthorizedAccessException)
            {
                _logger.LogWarning(ex, "Não foi possível baixar a capa de {Game}.", game.Title);
                return;
            }
        }

        try
        {
            if (File.Exists(itemImagePath)
                && (!File.Exists(folderImagePath) || new FileInfo(folderImagePath).Length == 0))
            {
                File.Copy(itemImagePath, folderImagePath, true);
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            _logger.LogWarning(ex, "Não foi possível criar a imagem de pasta de {Game}.", game.Title);
        }
    }

    private static async Task EnsureSystemMetadataAsync(
        string systemPath,
        string systemName,
        CancellationToken cancellationToken)
    {
        string safeSystemName = string.IsNullOrWhiteSpace(systemName) ? "Outros sistemas" : systemName.Trim();
        var folder = new XElement(
            "folder",
            new XElement("title", safeSystemName),
            new XElement("sorttitle", safeSystemName),
            new XElement("plot", $"Games de {safeSystemName}"),
            new XElement("tag", "Akuma Games"),
            new XElement("tag", safeSystemName));

        string nfo = new XDocument(new XDeclaration("1.0", "utf-8", null), folder).ToString();
        await WriteTextIfChangedAsync(Path.Combine(systemPath, "folder.nfo"), nfo, cancellationToken).ConfigureAwait(false);
    }

    private static string BuildFolderNfo(AkumaGame game)
    {
        var folder = new XElement(
            "folder",
            new XElement("title", game.Title),
            new XElement("sorttitle", game.Title),
            new XElement("plot", game.Description),
            new XElement("studio", game.System),
            new XElement("genre", string.IsNullOrWhiteSpace(game.Genre) ? "Games" : game.Genre),
            new XElement("tag", "Akuma Games"),
            new XElement("tag", game.System),
            new XElement(
                "uniqueid",
                new XAttribute("type", "akumagames"),
                new XAttribute("default", "true"),
                game.Id),
            new XElement("website", game.PlayerUrl));

        if (!string.IsNullOrWhiteSpace(game.Players))
        {
            folder.Add(new XElement("tag", $"Jogadores: {game.Players}"));
        }

        if (game.PlayCount > 0)
        {
            folder.Add(new XElement("tag", $"Jogadas: {game.PlayCount}"));
        }

        if (game.CreatedAt.HasValue)
        {
            folder.Add(
                new XElement(
                    "dateadded",
                    game.CreatedAt.Value.UtcDateTime.ToString(
                        "yyyy-MM-dd HH:mm:ss",
                        System.Globalization.CultureInfo.InvariantCulture)));
        }

        return new XDocument(new XDeclaration("1.0", "utf-8", null), folder).ToString();
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
            catch (UnauthorizedAccessException ex)
            {
                _logger.LogWarning(ex, "Não foi possível remover o item antigo {Directory}.", directory);
            }
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

    private static async Task WriteTextIfChangedAsync(
        string path,
        string content,
        CancellationToken cancellationToken)
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
