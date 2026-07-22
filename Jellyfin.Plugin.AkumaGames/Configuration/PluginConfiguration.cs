using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.AkumaGames.Configuration;

public sealed class PluginConfiguration : BasePluginConfiguration
{
    public string ApiUrl { get; set; } = "https://play.hoststorm.cloud/api/akumanimes";

    // Mantidos para migração de configurações da v0.1. A v0.2 não cria biblioteca de vídeo.
    public string LibraryName { get; set; } = "Games";
    public bool AutoCreateLibrary { get; set; } = false;

    public bool SyncOnStartup { get; set; } = true;
    public bool DownloadImages { get; set; } = true;
    public bool RemoveMissingGames { get; set; } = true;
    public int SyncIntervalHours { get; set; } = 12;
}
