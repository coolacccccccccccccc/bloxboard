using System.Text.Json;

namespace Bloxboard.Companion;

public sealed class Settings
{
    public int OverlayX { get; set; } = -1;
    public int OverlayY { get; set; } = -1;
    public bool OverlayVisible { get; set; } = true;
    public bool HideWhenNotInGame { get; set; } = false;
    public double Opacity { get; set; } = 0.94;
    public bool Compact { get; set; } = false;
}

/// <summary>Settings and server history in %APPDATA%\Bloxboard.</summary>
public sealed class Store
{
    private static readonly JsonSerializerOptions Json = new() { WriteIndented = true };
    private readonly string _dir;

    public Store(string? dir = null)
    {
        _dir = dir ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Bloxboard");
        Directory.CreateDirectory(_dir);
    }

    private string P(string name) => Path.Combine(_dir, name);

    private T Load<T>(string name, T fallback)
    {
        try
        {
            return File.Exists(P(name)) ? JsonSerializer.Deserialize<T>(File.ReadAllText(P(name))) ?? fallback : fallback;
        }
        catch (Exception e) when (e is IOException or JsonException)
        {
            return fallback;
        }
    }

    private void Save<T>(string name, T value)
    {
        var tmp = P(name + ".tmp");
        File.WriteAllText(tmp, JsonSerializer.Serialize(value, Json));
        File.Move(tmp, P(name), overwrite: true);
    }

    /// <summary>Small diagnostics log (companion.log), capped at ~200 KB.</summary>
    public void Log(string message)
    {
        try
        {
            var path = P("companion.log");
            if (File.Exists(path) && new FileInfo(path).Length > 200_000) File.Delete(path);
            File.AppendAllText(path, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss}  {message}{Environment.NewLine}");
        }
        catch (IOException) { }
    }

    public Settings LoadSettings() => Load("companion-settings.json", new Settings());
    public void SaveSettings(Settings s) => Save("companion-settings.json", s);

    public List<Session> LoadHistory() => Load("server-history.json", new List<Session>());

    public void AddToHistory(Session s)
    {
        var list = LoadHistory();
        list.RemoveAll(x => x.JobId == s.JobId);
        list.Insert(0, s);
        if (list.Count > 100) list.RemoveRange(100, list.Count - 100);
        Save("server-history.json", list);
    }
}
