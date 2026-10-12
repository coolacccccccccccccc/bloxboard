using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Bloxboard.Companion.App;

/// <summary>
/// The big panel: a normal window showing the companion's local page (http://127.0.0.1) in
/// WebView2, the browser engine built into Windows. Like the overlay, it never touches Roblox.
/// </summary>
sealed class PanelForm : Form
{
    private readonly Settings _settings;
    private readonly Action _save;
    private readonly string _dataDir;
    private readonly Action<string> _openExternal;
    private readonly Action<string> _log;
    private readonly WebView2 _web = new() { Dock = DockStyle.Fill };
    private Task<bool>? _init;
    private bool _quitting;
    private string _base = "";

    public PanelForm(Settings settings, Action save, string dataDir, Action<string> openExternal, Action<string> log)
    {
        _settings = settings;
        _save = save;
        _dataDir = dataDir;
        _openExternal = openExternal;
        _log = log;

        Text = "Bloxboard Companion";
        Icon = Theme.AppIcon();
        BackColor = Theme.Bg;
        StartPosition = FormStartPosition.Manual;
        MinimumSize = new Size(720, 480);
        TopMost = settings.PanelOnTop;
        KeyPreview = true;
        _web.DefaultBackgroundColor = Theme.Bg;
        Controls.Add(_web);

        var area = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1280, 720);
        var w = Math.Clamp(settings.PanelW, MinimumSize.Width, area.Width);
        var h = Math.Clamp(settings.PanelH, MinimumSize.Height, area.Height);
        var x = settings.PanelX >= 0 ? settings.PanelX : area.Left + (area.Width - w) / 2;
        var y = settings.PanelY >= 0 ? settings.PanelY : area.Top + (area.Height - h) / 2;
        var bounds = new Rectangle(x, y, w, h);
        if (!Screen.AllScreens.Any(s => s.WorkingArea.IntersectsWith(bounds))) bounds = new Rectangle(area.Left + (area.Width - w) / 2, area.Top + (area.Height - h) / 2, w, h);
        Bounds = bounds;

        // Esc hides the panel (back to the game).
        KeyDown += (_, e) => { if (e.KeyCode == Keys.Escape) Hide(); };
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        int dark = 1; // dark title bar (Windows 10 2004+ / 11)
        try { Native.DwmSetWindowAttribute(Handle, 20, ref dark, sizeof(int)); } catch { }
    }

    public Task<bool> EnsureReady(string url)
    {
        return _init ??= Init(url);
    }

    private async Task<bool> Init(string url)
    {
        try
        {
            _base = new Uri(url).GetLeftPart(UriPartial.Authority);
            var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(_dataDir, "webview"));
            await _web.EnsureCoreWebView2Async(env);
            var core = _web.CoreWebView2;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = true;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;
            core.Settings.IsPasswordAutosaveEnabled = false;
            core.Settings.IsGeneralAutofillEnabled = false;
            // Anything that isn't the panel itself opens in the normal browser.
            core.NewWindowRequested += (_, e) => { e.Handled = true; External(e.Uri); };
            core.NavigationStarting += (_, e) =>
            {
                if (e.Uri.StartsWith(_base + "/")) return;
                e.Cancel = true;
                External(e.Uri);
            };
            core.WebMessageReceived += (_, e) => { try { if (e.TryGetWebMessageAsString() == "hide") Hide(); } catch (ArgumentException) { } };
            core.ProcessFailed += (_, e) => { _log($"panel webview process failed: {e.ProcessFailedKind}"); if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited) _init = null; };
            _web.Source = new Uri(url);
            _log("panel ready (WebView2 " + env.BrowserVersionString + ")");
            return true;
        }
        catch (Exception e)
        {
            _log($"panel unavailable, using the browser: {e.Message}");
            return false;
        }
    }

    private void External(string uri)
    {
        if (Uri.TryCreate(uri, UriKind.Absolute, out var u) && (u.Scheme == "https" || u.Scheme == "roblox")) _openExternal(uri);
    }

    public void ShowAndFocus()
    {
        if (!Visible) Show();
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        Activate();
        BringToFront();
        _web.Focus();
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        // Closing just hides it; the companion keeps running in the tray.
        SaveBounds();
        if (!_quitting && e.CloseReason == CloseReason.UserClosing)
        {
            e.Cancel = true;
            Hide();
            return;
        }
        base.OnFormClosing(e);
    }

    protected override void OnResizeEnd(EventArgs e) { base.OnResizeEnd(e); SaveBounds(); }

    private void SaveBounds()
    {
        if (WindowState != FormWindowState.Normal) return;
        _settings.PanelX = Left; _settings.PanelY = Top; _settings.PanelW = Width; _settings.PanelH = Height;
        _save();
    }

    public void Shutdown()
    {
        _quitting = true;
        Close();
        _web.Dispose();
    }
}
