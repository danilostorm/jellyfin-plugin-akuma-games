using Jellyfin.Plugin.AkumaGames.Services;
using MediaBrowser.Model.Tasks;

namespace Jellyfin.Plugin.AkumaGames.ScheduledTasks;

public sealed class SyncGamesTask : IScheduledTask
{
    private readonly GameLibrarySyncService _syncService;

    public SyncGamesTask(GameLibrarySyncService syncService)
    {
        _syncService = syncService;
    }

    public string Name => "Sincronizar catálogo de games";
    public string Key => "AkumaGamesSync";
    public string Description => "Atualiza o catálogo Akuma Games sem criar arquivos de vídeo ou acionar o player do Jellyfin.";
    public string Category => "Akuma Games";

    public async Task ExecuteAsync(IProgress<double> progress, CancellationToken cancellationToken)
    {
        await _syncService.SyncAsync(progress, cancellationToken).ConfigureAwait(false);
    }

    public IEnumerable<TaskTriggerInfo> GetDefaultTriggers()
    {
        int hours = Math.Clamp(Plugin.Instance?.Configuration.SyncIntervalHours ?? 12, 1, 168);
        return
        [
            new TaskTriggerInfo
            {
                Type = TaskTriggerInfoType.IntervalTrigger,
                IntervalTicks = TimeSpan.FromHours(hours).Ticks
            }
        ];
    }
}
