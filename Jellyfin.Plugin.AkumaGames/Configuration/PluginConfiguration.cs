using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.AkumaGames.Configuration;

public sealed class PluginConfiguration : BasePluginConfiguration
{
    public string ApiUrl { get; set; } = "https://play.hoststorm.cloud/api/akumanimes";

    public string LibraryName { get; set; } = "Games";
    public bool AutoCreateLibrary { get; set; } = true;

    public bool SyncOnStartup { get; set; } = true;
    public bool DownloadImages { get; set; } = true;
    public bool RemoveMissingGames { get; set; } = true;
    public int SyncIntervalHours { get; set; } = 12;
}
