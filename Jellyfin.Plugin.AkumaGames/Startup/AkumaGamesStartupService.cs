using Jellyfin.Plugin.AkumaGames.Services;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.AkumaGames.Startup;

public sealed class AkumaGamesStartupService : IHostedService
{
    private readonly GameLibrarySyncService _syncService;
    private readonly ILogger<AkumaGamesStartupService> _logger;
    private CancellationTokenSource? _stoppingTokenSource;

    public AkumaGamesStartupService(
        GameLibrarySyncService syncService,
        ILogger<AkumaGamesStartupService> logger)
    {
        _syncService = syncService;
        _logger = logger;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        if (Plugin.Instance?.Configuration.SyncOnStartup != true)
        {
            return Task.CompletedTask;
        }

        _stoppingTokenSource = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        _ = RunDelayedAsync(_stoppingTokenSource.Token);
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        _stoppingTokenSource?.Cancel();
        _stoppingTokenSource?.Dispose();
        _stoppingTokenSource = null;
        return Task.CompletedTask;
    }

    private async Task RunDelayedAsync(CancellationToken cancellationToken)
    {
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(30), cancellationToken).ConfigureAwait(false);
            await _syncService.SyncAsync(null, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Akuma Games não conseguiu executar a sincronização inicial.");
        }
    }
}
