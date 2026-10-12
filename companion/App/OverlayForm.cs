using System.Diagnostics;

namespace Bloxboard.Companion.App;

/// <summary>
/// The small always-on-top window next to Roblox. It's a normal, separate window:
/// it never draws inside Roblox or touches its process.
/// </summary>
sealed class OverlayForm : Form
{
    public event Action? ShowRecentRequested;
    public event Action? HideRequested;
    public event Action? PanelRequested;
    public event Action? OverlayHotkey;

    private readonly RobloxApi _api;
    private readonly Settings _settings;
    private readonly Action _saveSettings;

    private readonly PictureBox _icon = new() { Size = new Size(48, 48), SizeMode = PictureBoxSizeMode.Zoom, BackColor = Theme.Panel, Margin = new Padding(0, 0, 10, 0) };
    private readonly Label _title = Theme.Label("Waiting for Roblox…", 11f, Theme.Text, FontStyle.Bold);
    private readonly Label _line1 = Theme.Label("Join a game and your server shows up here.", 9f, Theme.Muted);
    private readonly Label _line2 = Theme.Label("", 8.5f, Theme.Muted);
    private readonly Label _status = Theme.Label("", 8.5f, Theme.Good);
    private readonly FlowLayoutPanel _buttons = new() { AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, FlowDirection = FlowDirection.LeftToRight, WrapContents = true, BackColor = Color.Transparent, Margin = new Padding(0, 10, 0, 0), MaximumSize = new Size(300, 0) };
    private readonly System.Windows.Forms.Timer _clock = new() { Interval = 1000 };
    private readonly System.Windows.Forms.Timer _statusTimer = new() { Interval = 2500 };
    private Session? _session;
    private bool _loaded;

    protected override bool ShowWithoutActivation => true; // don't steal focus from Roblox

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.ExStyle |= Native.WS_EX_TOOLWINDOW | Native.WS_EX_TOPMOST; // no taskbar / alt-tab entry
            return cp;
        }
    }

    public OverlayForm(RobloxApi api, Settings settings, Action saveSettings)
    {
        _api = api;
        _settings = settings;
        _saveSettings = saveSettings;

        Text = "Bloxboard Companion";
        Icon = Theme.AppIcon();
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        BackColor = Theme.Bg;
        Opacity = Math.Clamp(settings.Opacity, 0.5, 1.0);
        AutoSize = true;
        AutoSizeMode = AutoSizeMode.GrowAndShrink;
        Padding = new Padding(14, 10, 14, 12);
        StartPosition = FormStartPosition.Manual;

        var brand = Theme.Label("BLOXBOARD", 7.5f, Theme.Accent, FontStyle.Bold);
        var hide = new Label { Text = "✕", AutoSize = true, ForeColor = Theme.Muted, Font = Theme.Font(9f), Cursor = Cursors.Hand, Margin = new Padding(0) };
        hide.Click += (_, _) => HideRequested?.Invoke();
        var hint = Theme.Label("Ctrl+Shift+B  panel", 7.5f, Theme.Muted);

        var head = new TableLayoutPanel { ColumnCount = 3, RowCount = 1, AutoSize = true, Dock = DockStyle.Top, BackColor = Color.Transparent, Margin = new Padding(0, 0, 0, 8) };
        head.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        head.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        head.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        head.Controls.Add(brand, 0, 0);
        hint.Anchor = AnchorStyles.Right;
        head.Controls.Add(hint, 1, 0);
        head.Controls.Add(hide, 2, 0);

        var text = new FlowLayoutPanel { FlowDirection = FlowDirection.TopDown, AutoSize = true, WrapContents = false, BackColor = Color.Transparent, MaximumSize = new Size(250, 0) };
        _title.MaximumSize = new Size(250, 0);
        _line1.MaximumSize = new Size(250, 0);
        _line2.MaximumSize = new Size(250, 0);
        text.Controls.AddRange(new Control[] { _title, _line1, _line2 });

        var info = new FlowLayoutPanel { FlowDirection = FlowDirection.LeftToRight, AutoSize = true, WrapContents = false, BackColor = Color.Transparent };
        info.Controls.Add(_icon);
        info.Controls.Add(text);

        var root = new FlowLayoutPanel { FlowDirection = FlowDirection.TopDown, AutoSize = true, WrapContents = false, BackColor = Color.Transparent, Dock = DockStyle.Fill };
        root.Controls.Add(head);
        root.Controls.Add(info);
        root.Controls.Add(_buttons);
        root.Controls.Add(_status);
        head.Width = 300;
        Controls.Add(root);

        // Drag from anywhere that isn't a button.
        foreach (Control c in new Control[] { this, root, head, brand, hint, info, text, _title, _line1, _line2, _icon, _status })
            c.MouseDown += (_, e) => { if (e.Button == MouseButtons.Left) Native.DragWindow(this); };
        Move += (_, _) => { if (_loaded) { _settings.OverlayX = Left; _settings.OverlayY = Top; } };
        ResizeEnd += (_, _) => _saveSettings();
        MouseUp += (_, _) => _saveSettings();

        _clock.Tick += (_, _) => UpdateClock();
        _statusTimer.Tick += (_, _) => { _status.Text = ""; _statusTimer.Stop(); };
        ShowIdle();
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        Native.RoundCorners(Handle);
        // Ctrl+Shift+B: the big panel. Ctrl+Shift+N: this mini overlay.
        Native.RegisterHotKey(Handle, 1, Native.MOD_CONTROL | Native.MOD_SHIFT | Native.MOD_NOREPEAT, (uint)Keys.B);
        Native.RegisterHotKey(Handle, 2, Native.MOD_CONTROL | Native.MOD_SHIFT | Native.MOD_NOREPEAT, (uint)Keys.N);
    }

    protected override void OnHandleDestroyed(EventArgs e)
    {
        Native.UnregisterHotKey(Handle, 1);
        Native.UnregisterHotKey(Handle, 2);
        base.OnHandleDestroyed(e);
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == Native.WM_HOTKEY)
        {
            if (m.WParam == 1) PanelRequested?.Invoke();
            else OverlayHotkey?.Invoke();
        }
        base.WndProc(ref m);
    }

    protected override void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        var area = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1280, 720);
        var x = _settings.OverlayX >= 0 ? _settings.OverlayX : area.Right - Width - 24;
        var y = _settings.OverlayY >= 0 ? _settings.OverlayY : area.Top + 80;
        // Keep it on a screen if monitors changed.
        var target = new Rectangle(x, y, Width, Height);
        if (!Screen.AllScreens.Any(s => s.WorkingArea.IntersectsWith(target))) { x = area.Right - Width - 24; y = area.Top + 80; }
        Location = new Point(x, y);
        _loaded = true;
        KeepOnScreen();
    }

    // The window grows when a game loads; keep it fully on its screen.
    protected override void OnSizeChanged(EventArgs e)
    {
        base.OnSizeChanged(e);
        if (_loaded) KeepOnScreen();
    }

    private void KeepOnScreen()
    {
        var area = Screen.FromControl(this).WorkingArea;
        int x = Math.Min(Left, area.Right - Width - 8);
        int y = Math.Min(Top, area.Bottom - Height - 8);
        x = Math.Max(x, area.Left + 8);
        y = Math.Max(y, area.Top + 8);
        if (x != Left || y != Top) Location = new Point(x, y);
    }

    private void SetButtons(params Button[] buttons)
    {
        _buttons.Controls.Clear();
        _buttons.Controls.AddRange(buttons);
    }

    private void Flash(string text)
    {
        _status.Text = text;
        _statusTimer.Stop();
        _statusTimer.Start();
    }

    private static void Open(string url)
    {
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { /* no handler */ }
    }

    public void ShowIdle()
    {
        _session = null;
        _clock.Stop();
        _icon.Image = null;
        _icon.Visible = false;
        _title.Text = "Waiting for Roblox…";
        _line1.Text = "Join a game and your server shows up here.";
        _line2.Text = "";
        var panel = Theme.Button("Open panel", primary: true);
        panel.Click += (_, _) => PanelRequested?.Invoke();
        var recent = Theme.Button("Recent servers");
        recent.Click += (_, _) => ShowRecentRequested?.Invoke();
        SetButtons(panel, recent);
    }

    public void ShowSession(Session s)
    {
        _session = s;
        _icon.Visible = true;
        _title.Text = string.IsNullOrEmpty(s.GameName) ? $"Place {s.PlaceId}" : s.GameName;
        _line2.Text = $"Server {s.JobId[..8]}";
        UpdateClock();
        _clock.Start();

        var invite = Theme.Button("Copy invite", primary: true);
        invite.Click += (_, _) =>
        {
            try { Clipboard.SetText(RobloxApi.InviteUrl(s.PlaceId, s.JobId)); Flash("Invite link copied. Paste it to a friend."); }
            catch { Flash("Couldn't reach the clipboard. Try again."); }
        };

        var hop = Theme.Button("Server hop ▾");
        var hopMenu = new ContextMenuStrip { ShowImageMargin = false, BackColor = Theme.Panel, ForeColor = Theme.Text, Font = Theme.Font(9f), RenderMode = ToolStripRenderMode.System };
        hopMenu.Items.Add("Smallest server", null, async (_, _) => await Hop(s, "small"));
        hopMenu.Items.Add("Random server", null, async (_, _) => await Hop(s, "random"));
        hopMenu.Items.Add("Busiest server with room", null, async (_, _) => await Hop(s, "busy"));
        hop.Click += (_, _) => hopMenu.Show(hop, new Point(0, hop.Height));

        var rejoin = Theme.Button("Rejoin");
        rejoin.Click += (_, _) => { Open(RobloxApi.JoinUrl(s.PlaceId, s.JobId)); Flash("Rejoining this server…"); };

        var web = Theme.Button("Bloxboard ↗");
        web.Click += (_, _) => Open($"https://www.roblox.com/games/{s.PlaceId}#bbx-find");

        var panel = Theme.Button("Panel");
        panel.Click += (_, _) => PanelRequested?.Invoke();

        SetButtons(invite, hop, rejoin, panel, web);
    }

    public void UpdateDetails(Session s, string? iconUrl, int playing)
    {
        if (_session != s) return;
        if (!string.IsNullOrEmpty(s.GameName)) _title.Text = s.GameName;
        _line2.Text = playing > 0 ? $"Server {s.JobId[..8]} · {playing:N0} playing this game" : $"Server {s.JobId[..8]}";
        UpdateClock();
        if (!string.IsNullOrEmpty(iconUrl)) _icon.LoadAsync(iconUrl);
    }

    private void UpdateClock()
    {
        if (_session is null) return;
        var t = DateTime.Now - _session.JoinedAt;
        var time = t.TotalHours >= 1 ? $"{(int)t.TotalHours}h {t.Minutes}m" : $"{Math.Max(0, t.Minutes)}m";
        _line1.Text = string.IsNullOrEmpty(_session.Location) ? $"In this server for {time}" : $"{_session.Location} · here {time}";
    }

    public void ApplyOpacity() => Opacity = Math.Clamp(_settings.Opacity, 0.5, 1.0);

    private async Task Hop(Session s, string mode)
    {
        Flash("Looking for another server…");
        try
        {
            var servers = (await _api.Servers(s.PlaceId, mode == "random" ? 3 : 2)).Where(x => x.Id != s.JobId && x.Playing < x.MaxPlayers).ToList();
            if (servers.Count == 0) { Flash("No other server with room right now."); return; }
            var pick = mode switch
            {
                "small" => servers.OrderBy(x => x.Playing).First(),
                "busy" => servers.OrderByDescending(x => x.Playing).First(),
                _ => servers[Random.Shared.Next(servers.Count)],
            };
            Open(RobloxApi.JoinUrl(s.PlaceId, pick.Id));
            Flash($"Joining a server with {pick.Playing}/{pick.MaxPlayers} players…");
        }
        catch (Exception e)
        {
            Flash($"Couldn't load servers: {e.Message}");
        }
    }
}
