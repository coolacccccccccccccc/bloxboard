using System.Diagnostics;

namespace Bloxboard.Companion.App;

static class Program
{
    [STAThread]
    static void Main(string[] args)
    {
        using var single = new Mutex(true, "BloxboardCompanion.Single", out bool first);
        if (!first) return; // already running (Fishstrap may start it every launch)
        ApplicationConfiguration.Initialize();
        Application.Run(new Companion(args.Contains("--with-roblox")));
    }
}

/// <summary>Tray icon + overlay + the log watcher that drives them.</summary>
sealed class Companion : ApplicationContext
{
    private readonly Store _store = new();
    private readonly Settings _settings;
    private readonly RobloxApi _api = new();
    private readonly SessionTracker _tracker = new();
    private readonly LogWatcher _watcher;
    private readonly OverlayForm _overlay;
    private readonly NotifyIcon _tray;
    private readonly SynchronizationContext _ui;
    private readonly System.Windows.Forms.Timer _robloxCheck = new() { Interval = 5000 };
    private RecentForm? _recent;
    private bool _sawRoblox;
    private DateTime _robloxGoneSince = DateTime.MaxValue;

    public Companion(bool exitWithRoblox)
    {
        _settings = _store.LoadSettings();
        _overlay = new OverlayForm(_api, _settings, () => _store.SaveSettings(_settings));
        _ui = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();

        var menu = new ContextMenuStrip();
        var toggle = new ToolStripMenuItem("Show overlay  (Ctrl+Shift+B)", null, (_, _) => SetOverlay(!_overlay.Visible));
        var hideIdle = new ToolStripMenuItem("Hide overlay when not in a game", null, (_, _) =>
        {
            _settings.HideWhenNotInGame = !_settings.HideWhenNotInGame;
            _store.SaveSettings(_settings);
            if (_tracker.Current is null && _settings.HideWhenNotInGame) _overlay.Hide();
        }) { Checked = _settings.HideWhenNotInGame };
        menu.Items.Add(toggle);
        menu.Items.Add("Recent servers…", null, (_, _) => ShowRecent());
        menu.Items.Add(hideIdle);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Bloxboard website", null, (_, _) => Open("https://bloxboard.enesserver.dev/companion.html"));
        menu.Items.Add("Quit", null, (_, _) => Quit());
        menu.Opening += (_, _) => { toggle.Checked = _overlay.Visible; hideIdle.Checked = _settings.HideWhenNotInGame; };

        _tray = new NotifyIcon { Icon = Theme.AppIcon(), Text = "Bloxboard Companion", ContextMenuStrip = menu, Visible = true };
        _tray.MouseClick += (_, e) => { if (e.Button == MouseButtons.Left) SetOverlay(!_overlay.Visible); };

        _overlay.HideRequested += () => SetOverlay(false);
        _overlay.ShowRecentRequested += ShowRecent;

        _tracker.Joined += s => _ui.Post(_ => OnJoined(s), null);
        _tracker.Left += s => _ui.Post(_ => OnLeft(s), null);
        // Read the log that was already open from the start, so starting mid-game still finds the server.
        _watcher = new LogWatcher(LogWatcher.DefaultDirectory, line =>
        {
            if (LogParser.Parse(line) is { } ev) lock (_tracker) _tracker.Feed(ev, LogParser.Timestamp(line) ?? DateTime.Now);
        });
        _watcher.OnError = e => _store.Log($"watcher error: {e}");
        _watcher.OnFileOpened = f => _store.Log($"reading {Path.GetFileName(f)}");
        _store.Log($"started, watching {LogWatcher.DefaultDirectory}");
        _ = _watcher.Start(fromStartOfNewest: true);

        if (_settings.OverlayVisible && !_settings.HideWhenNotInGame) _overlay.Show();
        else _overlay.CreateControl();
        _ = _overlay.Handle; // registers the hotkey even while hidden

        if (exitWithRoblox)
        {
            _robloxCheck.Tick += (_, _) => CheckRoblox();
            _robloxCheck.Start();
        }
    }

    private void SetOverlay(bool visible)
    {
        if (visible) _overlay.Show(); else _overlay.Hide();
        _settings.OverlayVisible = visible;
        _store.SaveSettings(_settings);
    }

    private async void OnJoined(Session s)
    {
        _store.Log($"joined place {s.PlaceId} server {s.JobId} at {s.ServerAddress}");
        _overlay.ShowSession(s);
        if (_settings.OverlayVisible && !_overlay.Visible) _overlay.Show();
        _store.AddToHistory(s);
        try
        {
            if (s.UniverseId == 0) s.UniverseId = await _api.UniverseOf(s.PlaceId);
            var (name, playing) = await _api.Game(s.UniverseId);
            s.GameName = name;
            s.Location = await _api.Location(s.ServerAddress);
            var icon = await _api.GameIconUrl(s.UniverseId);
            _overlay.UpdateDetails(s, icon, playing);
            _store.AddToHistory(s);
        }
        catch (Exception e)
        {
            // offline or Roblox API hiccup: the overlay still shows the server and timer
            _store.Log($"details failed: {e.Message}");
        }
    }

    private void OnLeft(Session s)
    {
        _store.Log($"left server {s.JobId}");
        _store.AddToHistory(s);
        if (_tracker.Current is not null) return; // teleported straight into another server
        _overlay.ShowIdle();
        if (_settings.HideWhenNotInGame) _overlay.Hide();
    }

    private void ShowRecent()
    {
        if (_recent is { IsDisposed: false }) { _recent.Activate(); return; }
        _recent = new RecentForm(_store.LoadHistory());
        _recent.Show();
    }

    // Started by Fishstrap/Bloxstrap with --with-roblox: quit ~15 s after Roblox closes.
    private void CheckRoblox()
    {
        bool running = Process.GetProcessesByName("RobloxPlayerBeta").Length > 0;
        if (running) { _sawRoblox = true; _robloxGoneSince = DateTime.MaxValue; return; }
        if (!_sawRoblox) return;
        if (_robloxGoneSince == DateTime.MaxValue) _robloxGoneSince = DateTime.Now;
        else if (DateTime.Now - _robloxGoneSince > TimeSpan.FromSeconds(15)) Quit();
    }

    private static void Open(string url)
    {
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { }
    }

    private void Quit()
    {
        _store.SaveSettings(_settings);
        _watcher.Dispose();
        _tray.Visible = false;
        _tray.Dispose();
        ExitThread();
    }
}
