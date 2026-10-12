namespace Bloxboard.Companion;

/// <summary>Follows the newest Roblox player log and hands each new line to a callback.</summary>
public sealed class LogWatcher : IDisposable
{
    private readonly string _dir;
    private readonly Action<string> _onLine;
    private readonly CancellationTokenSource _cts = new();
    private string? _file;
    private long _pos;
    private string? _lastError;

    public string? CurrentFile => _file;

    /// <summary>Lines read from the current file (for diagnostics).</summary>
    public long LinesRead { get; private set; }

    /// <summary>Called with unexpected errors (the watcher keeps going).</summary>
    public Action<Exception>? OnError { get; set; }

    /// <summary>Called when the watcher switches to a (newer) log file.</summary>
    public Action<string>? OnFileOpened { get; set; }

    public LogWatcher(string dir, Action<string> onLine)
    {
        _dir = dir;
        _onLine = onLine;
    }

    public static string DefaultDirectory =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Roblox", "logs");

    public Task Start(bool fromStartOfNewest = false) => Task.Run(async () =>
    {
        bool first = true;
        while (!_cts.IsCancellationRequested)
        {
            try
            {
                var newest = Newest();
                if (newest is not null && newest != _file)
                {
                    _file = newest;
                    LinesRead = 0;
                    OnFileOpened?.Invoke(newest);
                    // The log that was already open when we started: read it from the start only if asked,
                    // so a mid-game start still picks up the current server. Later logs: from the start.
                    _pos = first && !fromStartOfNewest ? new FileInfo(newest).Length : 0;
                }
                first = false;
                if (_file is not null) ReadNew();
            }
            catch (Exception e)
            {
                // Busy/rotated files are normal and retried; report each distinct problem once.
                if (e.Message != _lastError) { _lastError = e.Message; OnError?.Invoke(e); }
            }
            await Task.Delay(500, _cts.Token).ContinueWith(_ => { });
        }
    });

    private string? Newest()
    {
        if (!Directory.Exists(_dir)) return null;
        return new DirectoryInfo(_dir).GetFiles("*.log")
            .Where(f => f.Name.Contains("Player", StringComparison.OrdinalIgnoreCase))
            // Same pick as Fishstrap/Bloxstrap: newest by creation time. Windows updates a log's
            // last-write time lazily while Roblox keeps it open, so that one can point at an old log.
            .OrderByDescending(f => f.CreationTimeUtc)
            .ThenByDescending(f => f.LastWriteTimeUtc)
            .FirstOrDefault()?.FullName;
    }

    private void ReadNew()
    {
        using var fs = new FileStream(_file!, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        if (fs.Length < _pos) _pos = 0; // file was truncated
        if (fs.Length == _pos) return;
        fs.Seek(_pos, SeekOrigin.Begin);
        var buf = new byte[fs.Length - _pos];
        int read = 0;
        while (read < buf.Length)
        {
            int n = fs.Read(buf, read, buf.Length - read);
            if (n == 0) break;
            read += n;
        }
        if (read == 0) return;
        // Only hand over complete lines; an unfinished last line is picked up next time.
        int lastNewline = Array.LastIndexOf(buf, (byte)'\n', read - 1);
        if (lastNewline < 0) return;
        var text = System.Text.Encoding.UTF8.GetString(buf, 0, lastNewline + 1);
        foreach (var line in text.Split('\n'))
        {
            var l = line.TrimEnd('\r');
            if (l.Length == 0) continue;
            LinesRead++;
            try { _onLine(l); }
            catch (Exception e) { OnError?.Invoke(e); } // one bad line must not stall the file
        }
        _pos += lastNewline + 1;
    }

    public void Dispose() => _cts.Cancel();
}
