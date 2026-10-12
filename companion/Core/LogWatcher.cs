namespace Bloxboard.Companion;

/// <summary>
/// Follows Roblox's player logs and hands each new line to a callback. It tails every recent
/// *Player* log that grows (not only the newest one), so an extra log file Roblox opens can't
/// make it lose the game. Files are read by size, not by Windows' last-write time, which lags
/// while Roblox keeps a file open.
/// </summary>
public sealed class LogWatcher : IDisposable
{
    private const int MaxFiles = 6;
    private readonly string _dir;
    private readonly Action<string> _onLine;
    private readonly CancellationTokenSource _cts = new();
    private readonly Dictionary<string, long> _pos = new(StringComparer.OrdinalIgnoreCase);
    private string? _lastError;

    /// <summary>The log that most recently gave us new lines.</summary>
    public string? CurrentFile { get; private set; }

    /// <summary>Lines read since start (for diagnostics).</summary>
    public long LinesRead { get; private set; }

    /// <summary>Called with unexpected errors (the watcher keeps going).</summary>
    public Action<Exception>? OnError { get; set; }

    /// <summary>Called the first time a log file gives us lines.</summary>
    public Action<string>? OnFileOpened { get; set; }

    public LogWatcher(string dir, Action<string> onLine)
    {
        _dir = dir;
        _onLine = onLine;
    }

    public static string DefaultDirectory =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Roblox", "logs");

    /// <param name="fromStartOfNewest">Read the newest log that already exists from its start, so a
    /// mid-game start still finds the current server. Older existing logs are skipped; logs that
    /// appear later are read from their start.</param>
    public Task Start(bool fromStartOfNewest = false) => Task.Run(async () =>
    {
        bool first = true;
        while (!_cts.IsCancellationRequested)
        {
            try
            {
                var files = PlayerLogs();
                if (first)
                {
                    for (int i = 0; i < files.Count; i++)
                        _pos[files[i].FullName] = i == 0 && fromStartOfNewest ? 0 : files[i].Length;
                    first = false;
                }
                // Oldest first, so lines from an older log are handled before a newer one's.
                foreach (var f in files.AsEnumerable().Reverse()) ReadNew(f.FullName);
            }
            catch (Exception e)
            {
                if (e.Message != _lastError) { _lastError = e.Message; OnError?.Invoke(e); }
            }
            await Task.Delay(500, _cts.Token).ContinueWith(_ => { });
        }
    });

    private List<FileInfo> PlayerLogs()
    {
        if (!Directory.Exists(_dir)) return new();
        return new DirectoryInfo(_dir).GetFiles("*.log")
            .Where(f => f.Name.Contains("Player", StringComparison.OrdinalIgnoreCase))
            .OrderByDescending(f => f.CreationTimeUtc)
            .ThenByDescending(f => f.Name, StringComparer.Ordinal)
            .Take(MaxFiles)
            .ToList();
    }

    private void ReadNew(string path)
    {
        long pos = _pos.TryGetValue(path, out var p) ? p : 0; // a log we haven't seen: new, read it all
        FileStream fs;
        try { fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete); }
        catch (IOException) { return; } // busy/locked: next round
        using (fs)
        {
            if (fs.Length < pos) pos = 0; // truncated
            if (fs.Length == pos) { _pos[path] = pos; return; }
            fs.Seek(pos, SeekOrigin.Begin);
            var buf = new byte[Math.Min(fs.Length - pos, 32 * 1024 * 1024)];
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
            if (lastNewline < 0) { _pos[path] = pos; return; }
            if (!string.Equals(CurrentFile, path, StringComparison.OrdinalIgnoreCase))
            {
                CurrentFile = path;
                OnFileOpened?.Invoke(path);
            }
            var text = System.Text.Encoding.UTF8.GetString(buf, 0, lastNewline + 1);
            foreach (var line in text.Split('\n'))
            {
                var l = line.TrimEnd('\r');
                if (l.Length == 0) continue;
                LinesRead++;
                try { _onLine(l); }
                catch (Exception e) { OnError?.Invoke(e); } // one bad line must not stall the file
            }
            _pos[path] = pos + lastNewline + 1;
        }
    }

    public void Dispose() => _cts.Cancel();
}
