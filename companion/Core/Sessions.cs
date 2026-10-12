using System.Text.Json;

namespace Bloxboard.Companion;

/// <summary>One stretch of time in one server, as read from Roblox's logs.</summary>
public sealed class PlaySession
{
    public long PlaceId { get; set; }
    public long UniverseId { get; set; }
    public string JobId { get; set; } = "";
    public DateTime Start { get; set; }
    public DateTime End { get; set; }
    public string GameName { get; set; } = "";
    public string Location { get; set; } = "";

    public double Minutes => Math.Max(0, (End - Start).TotalMinutes);
}

/// <summary>All play sessions (sessions.json) plus the stats built from them.</summary>
public sealed class SessionStore
{
    private static readonly JsonSerializerOptions Json = new() { WriteIndented = false };
    private readonly string _path;
    private readonly object _lock = new();
    private List<PlaySession> _items;

    public SessionStore(string dir)
    {
        _path = Path.Combine(dir, "sessions.json");
        try { _items = File.Exists(_path) ? JsonSerializer.Deserialize<List<PlaySession>>(File.ReadAllText(_path)) ?? new() : new(); }
        catch (Exception e) when (e is IOException or JsonException) { _items = new(); }
    }

    public List<PlaySession> All() { lock (_lock) return _items.ToList(); }

    /// <summary>Adds or updates a session (same server + start = same session). Returns true if it was new.</summary>
    public bool Upsert(PlaySession s)
    {
        lock (_lock)
        {
            var hit = _items.FirstOrDefault(x => x.JobId == s.JobId && Math.Abs((x.Start - s.Start).TotalSeconds) < 5);
            if (hit is not null)
            {
                if (s.End > hit.End) hit.End = s.End;
                if (hit.UniverseId == 0) hit.UniverseId = s.UniverseId;
                if (string.IsNullOrEmpty(hit.GameName)) hit.GameName = s.GameName;
                if (string.IsNullOrEmpty(hit.Location)) hit.Location = s.Location;
                return false;
            }
            _items.Add(s);
            _items.Sort((a, b) => a.Start.CompareTo(b.Start));
            if (_items.Count > 20000) _items.RemoveRange(0, _items.Count - 20000);
            return true;
        }
    }

    /// <summary>Fills in universe ids / names for sessions that miss them (old logs often lack the universe line).</summary>
    public void Fill(long placeId, long universeId, string name)
    {
        lock (_lock)
            foreach (var s in _items.Where(x => x.PlaceId == placeId))
            {
                if (s.UniverseId == 0) s.UniverseId = universeId;
                if (string.IsNullOrEmpty(s.GameName)) s.GameName = name;
            }
    }

    public void Save()
    {
        string text;
        lock (_lock) text = JsonSerializer.Serialize(_items, Json);
        var tmp = _path + ".tmp";
        File.WriteAllText(tmp, text);
        File.Move(tmp, _path, overwrite: true);
    }

    public static string DayKey(DateTime local) => local.ToString("yyyy-MM-dd");

    /// <summary>Minutes per local day per universe (sessions over midnight are split).</summary>
    public static Dictionary<string, Dictionary<long, double>> PerDay(IEnumerable<PlaySession> sessions)
    {
        var map = new Dictionary<string, Dictionary<long, double>>();
        foreach (var s in sessions)
        {
            if (s.UniverseId == 0 || s.End <= s.Start) continue;
            var t = s.Start;
            while (t < s.End)
            {
                var next = t.Date.AddDays(1);
                var until = next < s.End ? next : s.End;
                var day = DayKey(t);
                if (!map.TryGetValue(day, out var games)) map[day] = games = new();
                games[s.UniverseId] = games.GetValueOrDefault(s.UniverseId) + (until - t).TotalMinutes;
                t = until;
            }
        }
        return map;
    }

    /// <summary>Everything the Stats page shows.</summary>
    public static object Stats(IReadOnlyList<PlaySession> sessions, DateTime now, int days)
    {
        var perDay = PerDay(sessions);
        double DayTotal(DateTime d) => perDay.TryGetValue(DayKey(d), out var g) ? g.Values.Sum() : 0;

        var today = now.Date;
        var range = Enumerable.Range(0, days).Select(i => today.AddDays(-(days - 1 - i))).ToList();
        var inRange = new HashSet<string>(range.Select(DayKey));

        // Streaks: days with at least 5 minutes played.
        int current = 0, best = 0, run = 0;
        var played = perDay.Where(kv => kv.Value.Values.Sum() >= 5).Select(kv => DateTime.Parse(kv.Key)).OrderBy(d => d).ToList();
        DateTime? prev = null;
        foreach (var d in played)
        {
            run = prev is { } p && (d - p).TotalDays == 1 ? run + 1 : 1;
            best = Math.Max(best, run);
            prev = d;
        }
        if (prev is { } last && (today - last).TotalDays <= 1) current = run;

        var games = new Dictionary<long, (double Minutes, int Sessions, DateTime Last, string Name, long PlaceId)>();
        foreach (var s in sessions)
        {
            if (s.UniverseId == 0) continue;
            double m = 0;
            foreach (var (day, g) in PerDay(new[] { s })) if (inRange.Contains(day)) m += g.Values.Sum();
            if (m <= 0) continue;
            var e = games.GetValueOrDefault(s.UniverseId);
            games[s.UniverseId] = (e.Minutes + m, e.Sessions + 1, s.End > e.Last ? s.End : e.Last,
                string.IsNullOrEmpty(s.GameName) ? e.Name : s.GameName, s.PlaceId);
        }

        // Hour-of-week heatmap over the range: minutes per [weekday 0=Sunday][hour].
        var heat = new double[7][];
        for (int i = 0; i < 7; i++) heat[i] = new double[24];
        var from = range[0];
        foreach (var s in sessions)
        {
            var t = s.Start < from ? from : s.Start;
            while (t < s.End)
            {
                var next = new DateTime(t.Year, t.Month, t.Day, t.Hour, 0, 0).AddHours(1);
                var until = next < s.End ? next : s.End;
                heat[(int)t.DayOfWeek][t.Hour] += (until - t).TotalMinutes;
                t = until;
            }
        }

        return new
        {
            days = range.Select(d => new { day = DayKey(d), minutes = Math.Round(DayTotal(d), 1) }),
            total = Math.Round(range.Sum(DayTotal), 1),
            today = Math.Round(DayTotal(today), 1),
            allTime = Math.Round(perDay.Values.Sum(g => g.Values.Sum()), 1),
            sessions = sessions.Count(s => s.End >= from),
            streak = current,
            bestStreak = best,
            firstDay = sessions.Count > 0 ? DayKey(sessions.Min(s => s.Start)) : null,
            games = games.OrderByDescending(kv => kv.Value.Minutes).Take(30).Select(kv => new
            {
                universeId = kv.Key,
                placeId = kv.Value.PlaceId,
                name = kv.Value.Name,
                minutes = Math.Round(kv.Value.Minutes, 1),
                sessions = kv.Value.Sessions,
                last = kv.Value.Last,
            }),
            heat = heat.Select(r => r.Select(m => Math.Round(m, 1))),
        };
    }
}
