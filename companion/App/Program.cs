using System.Diagnostics;

namespace Bloxboard.Companion.App;

static class Program
{
    public const string Version = "2.0.0";

    [STAThread]
    static void Main(string[] args)
    {
        using var single = new Mutex(true, "BloxboardCompanion.Single", out bool first);
        using var showPanel = new EventWaitHandle(false, EventResetMode.AutoReset, "BloxboardCompanion.ShowPanel");
        if (!first)
        {
            // Already running (Fishstrap starts it every launch, or a double-click): bring up its panel,
            // unless this is the Fishstrap start, which shouldn't pop anything up.
            if (!args.Contains("--with-roblox")) showPanel.Set();
            return;
        }
        ApplicationConfiguration.Initialize();
        Application.Run(new Companion(args.Contains("--with-roblox"), showPanel));
    }
}

/// <summary>Tray icon, mini overlay and panel window around the <see cref="CompanionService"/>.</summary>
sealed class Companion : ApplicationContext, ICompanionHost
{
    private readonly Store _store = new();
    private readonly CompanionService _svc;
    private readonly OverlayForm _overlay;
    private readonly PanelForm _panel;
    private readonly NotifyIcon _tray;
    private readonly SynchronizationContext _ui;
    private readonly System.Windows.Forms.Timer _robloxCheck = new() { Interval = 5000 };
    private RecentForm? _recent;
    private bool _sawRoblox;
    private DateTime _robloxGoneSince = DateTime.MaxValue;
    private bool _panelFailed;

    private Settings Settings => _svc.Settings;

    public Companion(bool exitWithRoblox, EventWaitHandle showPanel)
    {
        _svc = new CompanionService(this, _store, version: Program.Version);
        _overlay = new OverlayForm(_svc.Api, Settings, () => _store.SaveSettings(Settings));
        _panel = new PanelForm(Settings, () => _store.SaveSettings(Settings), _store.Directory, OpenUrl, m => _store.Log(m));
        _ui = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();

        var menu = new ContextMenuStrip();
        var openPanel = new ToolStripMenuItem("Open panel  (Ctrl+Shift+B)", null, (_, _) => TogglePanel(forceShow: true)) { Font = new Font(menu.Font, FontStyle.Bold) };
        var toggle = new ToolStripMenuItem("Mini overlay  (Ctrl+Shift+N)", null, (_, _) => SetOverlay(!_overlay.Visible));
        var hideIdle = new ToolStripMenuItem("Hide overlay when not in a game", null, (_, _) =>
        {
            Settings.HideWhenNotInGame = !Settings.HideWhenNotInGame;
            _store.SaveSettings(Settings);
            ApplyOverlay();
        });
        menu.Items.Add(openPanel);
        menu.Items.Add(toggle);
        menu.Items.Add(hideIdle);
        menu.Items.Add("Recent servers…", null, (_, _) => ShowRecent());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Open panel in browser", null, (_, _) => Open(_svc.Server.PanelUrl));
        menu.Items.Add("Diagnostics…", null, (_, _) => ShowDiagnostics());
        menu.Items.Add("Bloxboard website", null, (_, _) => Open("https://bloxboard.enesserver.dev/companion.html"));
        menu.Items.Add("Quit", null, (_, _) => Quit());
        menu.Opening += (_, _) => { toggle.Checked = _overlay.Visible; hideIdle.Checked = Settings.HideWhenNotInGame; };

        _tray = new NotifyIcon { Icon = Theme.AppIcon(), Text = "Bloxboard Companion", ContextMenuStrip = menu, Visible = true };
        _tray.MouseClick += (_, e) => { if (e.Button == MouseButtons.Left) TogglePanel(); };

        _overlay.HideRequested += () => SetOverlay(false);
        _overlay.ShowRecentRequested += ShowRecent;
        _overlay.PanelRequested += () => TogglePanel();
        _overlay.OverlayHotkey += () => SetOverlay(!_overlay.Visible);

        _svc.Joined += s => _ui.Post(_ => OnJoined(s), null);
        _svc.DetailsReady += (s, icon, playing) => _ui.Post(_ => _overlay.UpdateDetails(s, icon, playing), null);
        _svc.Left += s => _ui.Post(_ => OnLeft(s), null);
        _svc.Start();

        if (Settings.OverlayVisible && !Settings.HideWhenNotInGame) _overlay.Show();
        else _overlay.CreateControl();
        _ = _overlay.Handle; // registers the hotkeys even while hidden

        // A second launch (double-click) asks us to show the panel.
        var t = new Thread(() =>
        {
            while (showPanel.WaitOne()) _ui.Post(_ => TogglePanel(forceShow: true), null);
        }) { IsBackground = true };
        t.Start();

        if (exitWithRoblox)
        {
            _robloxCheck.Tick += (_, _) => CheckRoblox();
            _robloxCheck.Start();
        }
        else
        {
            // Started by hand: show the panel right away so it's obvious it runs.
            _ui.Post(_ => TogglePanel(forceShow: true), null);
        }
    }

    // ---------- ICompanionHost (called from any thread) ----------

    public void OpenUrl(string url) => Open(url);

    public void SettingsChanged() => _ui.Post(_ =>
    {
        _overlay.ApplyOpacity();
        _panel.TopMost = Settings.PanelOnTop;
        ApplyOverlay();
    }, null);

    // ---------- windows ----------

    private async void TogglePanel(bool forceShow = false)
    {
        if (_panelFailed) { Open(_svc.Server.PanelUrl); return; }
        if (_panel.Visible && !forceShow && Form.ActiveForm == _panel) { _panel.Hide(); return; }
        if (!await _panel.EnsureReady(_svc.Server.PanelUrl))
        {
            // No WebView2 runtime (rare on Windows 10/11): the same panel opens in the browser.
            _panelFailed = true;
            _tray.ShowBalloonTip(5000, "Bloxboard Companion", "The panel opens in your browser on this PC.", ToolTipIcon.Info);
            Open(_svc.Server.PanelUrl);
            return;
        }
        _panel.ShowAndFocus();
    }

    private void SetOverlay(bool visible)
    {
        Settings.OverlayVisible = visible;
        _store.SaveSettings(Settings);
        ApplyOverlay();
    }

    private void ApplyOverlay()
    {
        bool inGame;
        lock (_svc.Tracker) inGame = _svc.Tracker.Current is not null;
        bool show = Settings.OverlayVisible && (inGame || !Settings.HideWhenNotInGame);
        if (show && !_overlay.Visible) _overlay.Show();
        else if (!show && _overlay.Visible) _overlay.Hide();
    }

    private void OnJoined(Session s)
    {
        _overlay.ShowSession(s);
        ApplyOverlay();
        if (Settings.OpenPanelOnJoin && !_panel.Visible) TogglePanel(forceShow: true);
    }

    private void OnLeft(Session s)
    {
        lock (_svc.Tracker) if (_svc.Tracker.Current is not null) return; // teleported straight into another server
        _overlay.ShowIdle();
        ApplyOverlay();
    }

    private void ShowRecent()
    {
        if (_recent is { IsDisposed: false }) { _recent.Activate(); return; }
        _recent = new RecentForm(_store.LoadHistory());
        _recent.Show();
    }

    // Works without the panel, so "nothing shows up" can be pinned down without guessing.
    private void ShowDiagnostics()
    {
        var file = _svc.Watcher.CurrentFile;
        string newest = "none";
        try
        {
            var dir = new DirectoryInfo(_svc.LogDirectory);
            if (dir.Exists)
                newest = Environment.NewLine + string.Join(Environment.NewLine, dir.GetFiles("*.log").OrderByDescending(f => f.CreationTimeUtc).Take(3)
                    .Select(f => $"  {f.Name}  ({f.CreationTime:HH:mm:ss}, {f.Length / 1024} KB)"));
        }
        catch (Exception e) { newest = e.Message; }
        Session? s;
        lock (_svc.Tracker) s = _svc.Tracker.Current;
        var l = _svc.Bridge;
        var text =
            $"Bloxboard Companion v{Program.Version}{Environment.NewLine}" +
            $"Roblox logs folder: {_svc.LogDirectory}{Environment.NewLine}" +
            $"Folder exists: {Directory.Exists(_svc.LogDirectory)}{Environment.NewLine}" +
            $"Reading: {(file is null ? "nothing yet" : Path.GetFileName(file))}{Environment.NewLine}" +
            $"Lines read from it: {_svc.Watcher.LinesRead:N0}{Environment.NewLine}" +
            $"Current server: {(s is null ? "none" : $"place {s.PlaceId}, job {s.JobId}, {s.ServerAddress}")}{Environment.NewLine}" +
            $"Roblox running: {Process.GetProcessesByName("RobloxPlayerBeta").Length > 0}{Environment.NewLine}" +
            $"Panel: {_svc.Server.BaseUrl}{(_panelFailed ? " (browser fallback)" : "")}{Environment.NewLine}" +
            $"Browser link: {(l.Connected ? $"linked, extension v{l.Version}, @{l.UserName}" : "not linked")}{Environment.NewLine}" +
            $"Sessions saved: {_svc.Sessions.All().Count}{Environment.NewLine}" +
            $"Newest logs:{newest}{Environment.NewLine}{Environment.NewLine}" +
            "Ctrl+C copies this text. Yes opens the folder with companion.log.";
        if (MessageBox.Show(text, "Bloxboard Companion diagnostics", MessageBoxButtons.YesNo, MessageBoxIcon.Information) == DialogResult.Yes)
            Open(_store.Directory);
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
        _store.SaveSettings(Settings);
        _svc.Dispose();
        _panel.Shutdown();
        _tray.Visible = false;
        _tray.Dispose();
        ExitThread();
    }
}
