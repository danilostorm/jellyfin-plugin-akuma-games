using Jellyfin.Plugin.AkumaGames.Services;
using Jellyfin.Plugin.AkumaGames.Startup;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using Microsoft.Extensions.DependencyInjection;

namespace Jellyfin.Plugin.AkumaGames;

public sealed class PluginServiceRegistrator : IPluginServiceRegistrator
{
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        serviceCollection.AddSingleton<AkumaGamesClient>();
        serviceCollection.AddSingleton<GameLibrarySyncService>();
        serviceCollection.AddHostedService<AkumaGamesStartupService>();
    }
}
