using System.Globalization;
using Jellyfin.Plugin.AkumaGames.Configuration;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;

namespace Jellyfin.Plugin.AkumaGames;

public sealed class Plugin : BasePlugin<PluginConfiguration>, IHasWebPages
{
    public static readonly Guid PluginId = Guid.Parse("0fe9988e-21a1-4e59-aed7-4cf2e3858143");

    public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
        : base(applicationPaths, xmlSerializer)
    {
        Instance = this;
    }

    public override string Name => "Akuma Games";
    public override string Description => "Cria uma biblioteca nativa de games na página inicial do Jellyfin sem usar o player de vídeo.";
    public override Guid Id => PluginId;
    public static Plugin? Instance { get; private set; }

    public IEnumerable<PluginPageInfo> GetPages()
    {
        string pluginNamespace = GetType().Namespace ?? "Jellyfin.Plugin.AkumaGames";
        return
        [
            new PluginPageInfo
            {
                Name = Name,
                DisplayName = Name,
                EmbeddedResourcePath = string.Format(
                    CultureInfo.InvariantCulture,
                    "{0}.Configuration.configPage.html",
                    pluginNamespace)
            },
            new PluginPageInfo
            {
                Name = "akumagames",
                DisplayName = "Games",
                EmbeddedResourcePath = string.Format(
                    CultureInfo.InvariantCulture,
                    "{0}.Pages.catalogPage.html",
                    pluginNamespace),
                EnableInMainMenu = true,
                MenuIcon = "sports_esports"
            }
        ];
    }
}
