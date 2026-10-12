namespace Bloxboard.Companion;

/// <summary>
/// Reads Roblox's older log files once, so playtime stats start with the last days of play
/// instead of empty. Roblox keeps these logs for about a week.
/// </summary>
public static class LogImporter
{
    public static List<PlaySession> Read(IEnumerable<string> lines)
    {
        var tracker = new SessionTracker { StrictDisconnect = false };
        var found = new List<PlaySession>();
        DateTime lastTime = default;
        void Close(Session s, DateTime end) => found.Add(new PlaySession
        {
            PlaceId = s.PlaceId, UniverseId = s.UniverseId, JobId = s.JobId, Start = s.JoinedAt, End = end,
        });
        tracker.Left += s => Close(s, s.LeftAt ?? lastTime);
        foreach (var line in lines)
        {
            var ev = LogParser.Parse(line);
            var t = LogParser.Timestamp(line);
            if (t is { } tt) lastTime = tt;
            if (ev is not null) tracker.Feed(ev, t ?? lastTime);
        }
        // Log ended while still in a server (Roblox closed or crashed): count up to the last line.
        if (tracker.Current is { } open) Close(open, lastTime);
        return found.Where(s => s.End > s.Start).ToList();
    }

    /// <summary>Imports every Player log not seen before (skipping <paramref name="skip"/>). Returns how many sessions were new.</summary>
    public static int ImportFolder(string dir, SessionStore store, HashSet<string> imported, string? skip)
    {
        if (!Directory.Exists(dir)) return 0;
        int added = 0;
        foreach (var f in new DirectoryInfo(dir).GetFiles("*.log")
                     .Where(f => f.Name.Contains("Player", StringComparison.OrdinalIgnoreCase))
                     .OrderBy(f => f.CreationTimeUtc))
        {
            if (imported.Contains(f.Name) || f.FullName == skip) continue;
            try
            {
                using var fs = new FileStream(f.FullName, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                using var reader = new StreamReader(fs);
                var lines = new List<string>();
                while (reader.ReadLine() is { } l) lines.Add(l);
                foreach (var s in Read(lines)) if (store.Upsert(s)) added++;
                imported.Add(f.Name);
            }
            catch (IOException) { /* busy: try again next start */ }
        }
        return added;
    }
}
