using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Reflection;
using System.Text.Json;

namespace Bloxboard.Companion;

/// <summary>What the service needs from the app around it (the Windows app, or the test host).</summary>
public interface ICompanionHost
{
    /// <summary>Open a roblox:// or https:// link with the system.</summary>
    void OpenUrl(string url);
    /// <summary>Settings changed from the panel (overlay visibility etc.).</summary>
    void SettingsChanged();
    /// <summary>Is the Roblox player running? null = can't tell (tests).</summary>
    bool? IsRobloxRunning() => null;
}

/// <summary>
/// The companion's brain: follows Roblox's log, keeps playtime, runs the local panel server and
/// the browser-extension link, and answers the panel's API. No UI code in here, so it also runs
/// headless on Linux for tests.
/// </summary>
public sealed class CompanionService : IDisposable
{
    public string Version { get; }
    public Store Store { get; }
    public Settings Settings { get; }
    public SessionStore Sessions { get; }
    public RobloxApi Api { get; }
    public Bridge Bridge { get; } = new();
    public SessionTracker Tracker { get; } = new();
    public LogWatcher Watcher { get; }
    public LocalServer Server { get; }
    public string LogDirectory { get; }

    public event Action<Session>? Joined;
    public event Action<Session, string?, int>? DetailsReady;
    public event Action<Session>? Left;

    private readonly ICompanionHost _host;
    private readonly ConcurrentDictionary<string, (DateTime At, object Value)> _cache = new();
    private readonly ConcurrentDictionary<string, FindJob> _finds = new();
    private readonly object _libLock = new();
    private Library _library;
    private DateTime _lastPlaytimePush = DateTime.MinValue;

    public CompanionService(ICompanionHost host, Store store, string? logDirectory = null, RobloxApi? api = null, string version = "2.0.0")
    {
        _host = host;
        Version = version;
        Store = store;
        Settings = store.LoadSettings();
        Sessions = new SessionStore(store.Directory);
        Api = api ?? new RobloxApi();
        _library = store.LoadLibrary();
        LogDirectory = logDirectory ?? LogWatcher.DefaultDirectory;
        Bridge.Log = m => Store.Log(m);
        Bridge.Changed += () => { if (Bridge.Connected) _ = PushPlaytime(); };

        Tracker.Joined += s => { Store.Log($"joined place {s.PlaceId} server {s.JobId} at {s.ServerAddress}"); RecordLive(s); Joined?.Invoke(s); _ = LoadDetails(s); };
        Tracker.Updated += s => { Store.Log($"server details: universe {s.UniverseId} at {s.ServerAddress}"); RecordLive(s); _ = LoadDetails(s); };
        Tracker.Left += s => { Store.Log($"left server {s.JobId}"); RecordLive(s); Store.AddToHistory(s); Left?.Invoke(s); _ = PushPlaytime(); };

        Watcher = new LogWatcher(LogDirectory, line =>
        {
            if (LogParser.Parse(line) is not { } ev) return;
            Store.Log($"log: {ev}");
            lock (Tracker) Tracker.Feed(ev, LogParser.Timestamp(line) ?? DateTime.Now);
        });
        Watcher.OnError = e => Store.Log($"watcher error: {e}");
        Watcher.OnFileOpened = f => Store.Log($"reading {Path.GetFileName(f)}");

        Server = new LocalServer(HandleApi, ws => Bridge.Run(ws), StaticFile) { OnError = e => Store.Log($"server error: {e.Message}") };
    }

    public void Start(int[]? ports = null)
    {
        Store.Log($"started v{Version}, watching {LogDirectory}");
        try { Server.Start(ports); Store.Log($"panel on {Server.BaseUrl}"); }
        catch (Exception e) { Store.Log($"panel server failed: {e.Message}"); }
        _ = Watcher.Start(fromStartOfNewest: true);
        _ = Task.Run(ImportOldLogs);
        _ = Task.Run(async () =>
        {
            // Roblox closed (or crashed without a disconnect line): end the session after ~10 s.
            int gone = 0;
            while (true)
            {
                await Task.Delay(5000);
                bool inGame;
                lock (Tracker) inGame = Tracker.Current is not null;
                if (!inGame) { gone = 0; continue; }
                bool? running;
                try { running = _host.IsRobloxRunning(); } catch { running = null; }
                gone = running == false ? gone + 1 : 0;
                if (gone >= 2)
                {
                    Store.Log("Roblox isn't running anymore: ending the session");
                    lock (Tracker) Tracker.RobloxClosed(DateTime.Now);
                    gone = 0;
                }
            }
        });
        _ = Task.Run(async () =>
        {
            // While playing, save the running session every minute so a crash loses little.
            while (true)
            {
                await Task.Delay(60000);
                Session? cur;
                lock (Tracker) cur = Tracker.Current;
                if (cur is not null) { RecordLive(cur); }
                if (Bridge.Connected && DateTime.Now - _lastPlaytimePush > TimeSpan.FromMinutes(5)) _ = PushPlaytime();
            }
        });
    }

    private void ImportOldLogs()
    {
        try
        {
            var imported = new HashSet<string>(Settings.ImportedLogs);
            int n = LogImporter.ImportFolder(LogDirectory, Sessions, imported, Watcher.CurrentFile);
            Settings.ImportedLogs = imported.TakeLast(500).ToList();
            Store.SaveSettings(Settings);
            Sessions.Save();
            Store.Log($"imported {n} sessions from older logs");
            _ = FillMissingGames();
        }
        catch (Exception e) { Store.Log($"import failed: {e.Message}"); }
    }

    /// <summary>Old logs often lack the universe line: look up universe + name per place once.</summary>
    private async Task FillMissingGames()
    {
        foreach (var place in Sessions.All().Where(s => s.UniverseId == 0 || s.GameName == "").Select(s => s.PlaceId).Distinct().Take(60))
        {
            try
            {
                var u = await Api.UniverseOf(place);
                var (name, _) = await Api.Game(u);
                Sessions.Fill(place, u, name);
            }
            catch (Exception e) { Store.Log($"fill {place}: {e.Message}"); }
        }
        Sessions.Save();
    }

    private void RecordLive(Session s)
    {
        if (s.UserId != 0 && Settings.MeUserId != s.UserId) { Settings.MeUserId = s.UserId; Store.SaveSettings(Settings); }
        Sessions.Upsert(new PlaySession
        {
            PlaceId = s.PlaceId, UniverseId = s.UniverseId, JobId = s.JobId, Start = s.JoinedAt,
            End = s.LeftAt ?? DateTime.Now, GameName = s.GameName, Location = s.Location,
        });
        try { Sessions.Save(); } catch (IOException) { }
    }

    private async Task LoadDetails(Session s)
    {
        try
        {
            if (s.UniverseId == 0) s.UniverseId = await Api.UniverseOf(s.PlaceId);
            var (name, playing) = await Api.Game(s.UniverseId);
            s.GameName = name;
            s.Location = await Api.Location(s.ServerAddress);
            var icon = await Api.GameIconUrl(s.UniverseId);
            RecordLive(s);
            Store.AddToHistory(s);
            DetailsReady?.Invoke(s, icon, playing);
        }
        catch (Exception e) { Store.Log($"details failed: {e.Message}"); }
    }

    /// <summary>Sends per-day playtime to the extension, which merges it into its own stats (max per day+game).</summary>
    private async Task PushPlaytime()
    {
        if (!Bridge.Connected) return;
        _lastPlaytimePush = DateTime.Now;
        try
        {
            var all = Sessions.All();
            var perDay = SessionStore.PerDay(all).Where(kv => DateTime.Parse(kv.Key) >= DateTime.Today.AddDays(-90))
                .ToDictionary(kv => kv.Key, kv => kv.Value.ToDictionary(g => g.Key.ToString(), g => (int)Math.Round(g.Value)));
            var games = all.Where(s => s.UniverseId != 0 && s.GameName != "").GroupBy(s => s.UniverseId)
                .ToDictionary(g => g.Key.ToString(), g => new { name = g.Last().GameName, placeId = g.Last().PlaceId });
            await Bridge.Call("playtime", new { days = perDay, games });
        }
        catch (Exception e) { Store.Log($"playtime push: {e.Message}"); }
    }

    // ---------- static UI ----------

    private static readonly Assembly Asm = typeof(CompanionService).Assembly;

    private static (byte[] Data, string Type)? StaticFile(string path)
    {
        if (path.Contains("..")) return null;
        using var s = Asm.GetManifestResourceStream("ui/" + path);
        if (s is null) return null;
        using var ms = new MemoryStream();
        s.CopyTo(ms);
        var type = Path.GetExtension(path) switch
        {
            ".html" => "text/html; charset=utf-8",
            ".css" => "text/css; charset=utf-8",
            ".js" => "text/javascript; charset=utf-8",
            ".svg" => "image/svg+xml",
            ".png" => "image/png",
            ".ico" => "image/x-icon",
            _ => "application/octet-stream",
        };
        return (ms.ToArray(), type);
    }

    // ---------- API ----------

    private async Task<T> Cached<T>(string key, TimeSpan ttl, Func<Task<T>> make) where T : notnull
    {
        if (_cache.TryGetValue(key, out var hit) && DateTime.Now - hit.At < ttl) return (T)hit.Value;
        var v = await make();
        _cache[key] = (DateTime.Now, v);
        return v;
    }

    private static string Ids(string csv) => string.Join(',', csv.Split(',').Select(x => long.TryParse(x, out var v) ? v : 0).Where(v => v > 0).Distinct().Take(100));

    private async Task<HttpResponseData> HandleApi(HttpRequestData r)
    {
        var J = HttpResponseData.Json;
        switch (r.Method, r.Path)
        {
            case ("GET", "/api/state"):
                return J(State());

            case ("GET", "/api/game"):
            {
                var u = r.QLong("universe");
                if (u == 0 && r.QLong("place") is var pl and > 0) u = await Cached($"uni:{pl}", TimeSpan.FromDays(1), () => Api.UniverseOf(pl));
                if (u == 0) return HttpResponseData.Error("no game");
                return J(await Cached($"game:{u}", TimeSpan.FromSeconds(45), async () =>
                {
                    var g = await Api.GetJson($"https://games.roblox.com/v1/games?universeIds={u}");
                    var v = await Api.GetJson($"https://games.roblox.com/v1/games/votes?universeIds={u}");
                    var i = await Api.GetJson($"https://thumbnails.roblox.com/v1/games/icons?universeIds={u}&size=256x256&format=Png&isCircular=false");
                    var data = g.GetProperty("data");
                    return (object)new
                    {
                        universeId = u,
                        game = data.GetArrayLength() > 0 ? data[0] : (JsonElement?)null,
                        votes = v.GetProperty("data").GetArrayLength() > 0 ? v.GetProperty("data")[0] : (JsonElement?)null,
                        icon = i.GetProperty("data").GetArrayLength() > 0 ? i.GetProperty("data")[0].GetProperty("imageUrl").GetString() : null,
                        note = Note(u),
                        favorite = IsFavorite(u),
                    };
                }));
            }

            case ("GET", "/api/servers"):
            {
                var place = r.QLong("place");
                if (place == 0) return HttpResponseData.Error("no place");
                var order = r.Q("order") == "Desc" ? "Desc" : "Asc";
                var cursor = r.Q("cursor");
                var url = $"https://games.roblox.com/v1/games/{place}/servers/Public?limit=100&sortOrder={order}" +
                          (r.Q("full") == "0" ? "&excludeFullGames=true" : "") +
                          (cursor.Length > 0 ? $"&cursor={Uri.EscapeDataString(cursor)}" : "");
                // Short cache: the Now page and the Servers page ask for the same pages, and Roblox rate limits this.
                var page = (JsonElement)await Cached($"srv:{url}", TimeSpan.FromSeconds(20), async () => (object)await Api.GetJson(url));
                var visited = Sessions.All().Where(s => s.PlaceId == place).Select(s => s.JobId).ToHashSet();
                Session? cur;
                lock (Tracker) cur = Tracker.Current;
                return J(new
                {
                    data = page.GetProperty("data").EnumerateArray().Select(s => new
                    {
                        id = s.GetProperty("id").GetString(),
                        playing = s.TryGetProperty("playing", out var p) && p.ValueKind == JsonValueKind.Number ? p.GetInt32() : 0,
                        maxPlayers = s.GetProperty("maxPlayers").GetInt32(),
                        ping = s.TryGetProperty("ping", out var pi) && pi.ValueKind == JsonValueKind.Number ? pi.GetInt32() : (int?)null,
                        fps = s.TryGetProperty("fps", out var f) && f.ValueKind == JsonValueKind.Number ? Math.Round(f.GetDouble(), 1) : (double?)null,
                        visited = visited.Contains(s.GetProperty("id").GetString() ?? ""),
                        current = cur?.JobId == s.GetProperty("id").GetString(),
                    }),
                    nextPageCursor = page.TryGetProperty("nextPageCursor", out var c) && c.ValueKind == JsonValueKind.String ? c.GetString() : null,
                });
            }

            case ("POST", "/api/regions"):
            {
                var body = r.Json();
                var data = await Bridge.Call("regions", new { placeId = body.GetProperty("placeId").GetInt64(), serverIds = body.GetProperty("serverIds") }, timeout: TimeSpan.FromSeconds(90));
                return J(data);
            }

            case ("POST", "/api/find"):
            {
                var body = r.Json();
                if (!Bridge.Connected) throw new BridgeOfflineException();
                var job = new FindJob();
                _finds[job.Id] = job;
                foreach (var old in _finds.Where(kv => DateTime.Now - kv.Value.Started > TimeSpan.FromHours(1)).Select(kv => kv.Key)) _finds.TryRemove(old, out _);
                var args = new { placeId = body.GetProperty("placeId").GetInt64(), query = body.GetProperty("query").GetString(), mode = body.TryGetProperty("mode", out var m) ? m.GetString() : "username" };
                _ = Task.Run(async () =>
                {
                    try
                    {
                        var res = await Bridge.Call("find", args, p => job.Progress = p, TimeSpan.FromMinutes(10), job.Cancel.Token);
                        job.Result = res;
                    }
                    catch (OperationCanceledException) { job.Error = "Canceled."; }
                    catch (Exception e) { job.Error = e.Message; }
                    finally { job.Done = true; }
                });
                return J(new { job = job.Id });
            }

            case ("GET", "/api/find"):
                return _finds.TryGetValue(r.Q("job"), out var fj)
                    ? J(new { done = fj.Done, progress = fj.Progress, result = fj.Result, error = fj.Error })
                    : HttpResponseData.Error("no such search", 404);

            case ("POST", "/api/find/cancel"):
                if (_finds.TryGetValue(r.Json().GetProperty("job").GetString() ?? "", out var cj)) cj.Cancel.Cancel();
                return J(new { ok = true });

            case ("GET", "/api/friends"):
            {
                if (Bridge.Connected)
                {
                    try { return J(new { linked = true, data = await Bridge.Call("friends", new { }, timeout: TimeSpan.FromSeconds(45)) }); }
                    catch (Exception e) when (e is not BridgeOfflineException) { Store.Log($"friends via extension: {e.Message}"); }
                }
                var me = Bridge.UserId != 0 ? Bridge.UserId : Settings.MeUserId;
                if (me == 0) return J(new { linked = false, data = Array.Empty<object>(), needUser = true });
                var list = await Cached($"friends:{me}", TimeSpan.FromMinutes(5), async () =>
                {
                    var f = await Api.GetJson($"https://friends.roblox.com/v1/users/{me}/friends");
                    var ids = f.GetProperty("data").EnumerateArray().Select(x => x.GetProperty("id").GetInt64()).Take(200).ToArray();
                    var users = new List<JsonElement>();
                    foreach (var chunk in ids.Chunk(100))
                    {
                        var u = await Api.PostJson("https://users.roblox.com/v1/users", new { userIds = chunk, excludeBannedUsers = true });
                        users.AddRange(u.GetProperty("data").EnumerateArray());
                    }
                    return (object)users.Select(u => new { id = u.GetProperty("id").GetInt64(), name = u.GetProperty("name").GetString(), displayName = u.GetProperty("displayName").GetString() }).ToList();
                });
                return J(new { linked = false, data = list });
            }

            case ("GET", "/api/search"):
            {
                var q = r.Q("q").Trim();
                if (q.Length == 0) return J(new { data = Array.Empty<object>() });
                var res = await Cached($"search:{q.ToLowerInvariant()}", TimeSpan.FromMinutes(5), async () =>
                {
                    var j = await Api.GetJson($"https://apis.roblox.com/search-api/omni-search?searchQuery={Uri.EscapeDataString(q)}&sessionId={Guid.NewGuid()}&pageType=all");
                    var games = new List<object>();
                    foreach (var grp in j.GetProperty("searchResults").EnumerateArray())
                    {
                        if (grp.GetProperty("contentGroupType").GetString() != "Game") continue;
                        foreach (var g in grp.GetProperty("contents").EnumerateArray())
                            games.Add(new
                            {
                                universeId = g.GetProperty("universeId").GetInt64(),
                                placeId = g.TryGetProperty("rootPlaceId", out var rp) ? rp.GetInt64() : 0,
                                name = g.GetProperty("name").GetString(),
                                playing = g.TryGetProperty("playerCount", out var pc) && pc.ValueKind == JsonValueKind.Number ? pc.GetInt32() : 0,
                                up = g.TryGetProperty("totalUpVotes", out var up) && up.ValueKind == JsonValueKind.Number ? up.GetInt64() : 0,
                                down = g.TryGetProperty("totalDownVotes", out var dn) && dn.ValueKind == JsonValueKind.Number ? dn.GetInt64() : 0,
                            });
                    }
                    return (object)games.Take(30).ToList();
                });
                return J(new { data = res });
            }

            case ("GET", "/api/icons"):
            {
                var ids = Ids(r.Q("ids"));
                if (ids.Length == 0) return J(new { });
                var j = await Cached($"icons:{ids}", TimeSpan.FromHours(1), async () => (object)await Api.GetJson($"https://thumbnails.roblox.com/v1/games/icons?universeIds={ids}&size=150x150&format=Png&isCircular=false"));
                return J(((JsonElement)j).GetProperty("data").EnumerateArray().ToDictionary(x => x.GetProperty("targetId").GetInt64().ToString(), x => x.GetProperty("imageUrl").GetString()));
            }

            case ("GET", "/api/heads"):
            {
                var ids = Ids(r.Q("ids"));
                if (ids.Length == 0) return J(new { });
                var j = await Cached($"heads:{ids}", TimeSpan.FromHours(1), async () => (object)await Api.GetJson($"https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds={ids}&size=150x150&format=Png&isCircular=false"));
                return J(((JsonElement)j).GetProperty("data").EnumerateArray().ToDictionary(x => x.GetProperty("targetId").GetInt64().ToString(), x => x.GetProperty("imageUrl").GetString()));
            }

            case ("GET", "/api/me"):
            {
                var me = Bridge.UserId != 0 ? Bridge.UserId : Settings.MeUserId;
                if (me == 0) return J(new { });
                return J(await Cached($"me:{me}", TimeSpan.FromMinutes(30), async () => (object)await Api.GetJson($"https://users.roblox.com/v1/users/{me}")));
            }

            case ("GET", "/api/favorites"):
                lock (_libLock) return J(_library.Favorites.OrderByDescending(f => f.Added).ToList());

            case ("POST", "/api/favorites"):
            {
                var b = r.Json();
                var u = b.GetProperty("universeId").GetInt64();
                lock (_libLock)
                {
                    _library.Favorites.RemoveAll(f => f.UniverseId == u);
                    if (b.GetProperty("on").GetBoolean())
                        _library.Favorites.Add(new FavoriteGame { UniverseId = u, PlaceId = b.GetProperty("placeId").GetInt64(), Name = b.GetProperty("name").GetString() ?? "", Added = DateTime.Now });
                    Store.SaveLibrary(_library);
                }
                return J(new { ok = true });
            }

            case ("POST", "/api/note"):
            {
                var b = r.Json();
                var u = b.GetProperty("universeId").GetInt64();
                var text = (b.GetProperty("text").GetString() ?? "").Trim();
                if (text.Length > 4000) text = text[..4000];
                lock (_libLock)
                {
                    if (text.Length == 0) _library.Notes.Remove(u); else _library.Notes[u] = text;
                    Store.SaveLibrary(_library);
                }
                return J(new { ok = true });
            }

            case ("GET", "/api/notes"):
                lock (_libLock) return J(_library.Notes.Select(kv => new { universeId = kv.Key, text = kv.Value }).ToList());

            case ("GET", "/api/stats"):
            {
                var d = r.QLong("days");
                var days = d == 0 ? 30 : (int)Math.Clamp(d, 1, 365);
                return J(SessionStore.Stats(Sessions.All(), DateTime.Now, days));
            }

            case ("GET", "/api/recent"):
            {
                var list = Sessions.All().AsEnumerable().Reverse()
                    .GroupBy(s => s.JobId).Select(g => new
                    {
                        jobId = g.Key,
                        placeId = g.First().PlaceId,
                        universeId = g.First().UniverseId,
                        name = g.First().GameName,
                        location = g.Select(x => x.Location).FirstOrDefault(x => x != "") ?? "",
                        start = g.Min(x => x.Start),
                        end = g.Max(x => x.End),
                        minutes = Math.Round(g.Sum(x => x.Minutes), 1),
                    }).Take(60).ToList();
                return J(list);
            }

            case ("POST", "/api/open"):
            {
                var b = r.Json();
                string url;
                if (b.TryGetProperty("placeId", out var pid))
                {
                    var job = b.TryGetProperty("jobId", out var jid) && jid.ValueKind == JsonValueKind.String ? jid.GetString() : null;
                    if (job is not null && !Guid.TryParse(job, out _)) return HttpResponseData.Error("bad server id");
                    url = RobloxApi.JoinUrl(pid.GetInt64(), job);
                }
                else
                {
                    url = b.GetProperty("url").GetString() ?? "";
                    if (!Uri.TryCreate(url, UriKind.Absolute, out var u) || u.Scheme != "https" ||
                        !(u.Host == "www.roblox.com" || u.Host == "roblox.com" || u.Host == "bloxboard.enesserver.dev" || u.Host == "github.com"))
                        return HttpResponseData.Error("link not allowed");
                }
                Store.Log($"open {url}");
                _host.OpenUrl(url);
                return J(new { ok = true });
            }

            case ("POST", "/api/hop"):
            {
                Session? cur;
                lock (Tracker) cur = Tracker.Current;
                var b = r.Json();
                var place = b.TryGetProperty("placeId", out var p) ? p.GetInt64() : cur?.PlaceId ?? 0;
                if (place == 0) return HttpResponseData.Error("Join a game first.");
                var mode = b.TryGetProperty("mode", out var m) ? m.GetString() : "small";
                var servers = (await Api.Servers(place, 2)).Where(s => s.Id != cur?.JobId && s.Playing < s.MaxPlayers).ToList();
                if (servers.Count == 0) return HttpResponseData.Error("No other server with room right now.");
                var pick = mode switch
                {
                    "busy" => servers.OrderByDescending(s => s.Playing).First(),
                    "random" => servers[Random.Shared.Next(servers.Count)],
                    "ping" => servers.Where(s => s.Ping is not null).OrderBy(s => s.Ping).FirstOrDefault() ?? servers[0],
                    _ => servers.Where(s => s.Playing > 0).OrderBy(s => s.Playing).FirstOrDefault() ?? servers[0],
                };
                _host.OpenUrl(RobloxApi.JoinUrl(place, pick.Id));
                return J(new { ok = true, server = pick });
            }

            case ("POST", "/api/settings"):
            {
                var b = r.Json();
                if (b.TryGetProperty("overlayVisible", out var ov)) Settings.OverlayVisible = ov.GetBoolean();
                if (b.TryGetProperty("hideWhenNotInGame", out var hw)) Settings.HideWhenNotInGame = hw.GetBoolean();
                if (b.TryGetProperty("panelOnTop", out var pt)) Settings.PanelOnTop = pt.GetBoolean();
                if (b.TryGetProperty("openPanelOnJoin", out var oj)) Settings.OpenPanelOnJoin = oj.GetBoolean();
                if (b.TryGetProperty("opacity", out var op)) Settings.Opacity = Math.Clamp(op.GetDouble(), 0.5, 1.0);
                Store.SaveSettings(Settings);
                _host.SettingsChanged();
                return J(new { ok = true });
            }

            case ("POST", "/api/import"):
                await Task.Run(ImportOldLogs);
                return J(new { ok = true, sessions = Sessions.All().Count });

            case ("GET", "/api/diagnostics"):
            {
                var dir = new DirectoryInfo(LogDirectory);
                return J(new
                {
                    logDirectory = LogDirectory,
                    exists = dir.Exists,
                    reading = Watcher.CurrentFile is { } f ? Path.GetFileName(f) : null,
                    linesRead = Watcher.LinesRead,
                    connected = Tracker.Connected,
                    newest = dir.Exists ? dir.GetFiles("*.log").OrderByDescending(x => x.CreationTimeUtc).Take(5)
                        .Select(x => new { name = x.Name, created = x.CreationTime, kb = x.Length / 1024 }).ToArray() : Array.Empty<object>(),
                    dataFolder = Store.Directory,
                    sessions = Sessions.All().Count,
                    port = Server.Port,
                });
            }
        }
        return HttpResponseData.Error("not found", 404);
    }

    public object State()
    {
        Session? s;
        lock (Tracker) s = Tracker.Current;
        return new
        {
            version = Version,
            session = s is null ? null : new
            {
                placeId = s.PlaceId,
                universeId = s.UniverseId,
                jobId = s.JobId,
                joinedAt = s.JoinedAt,
                gameName = s.GameName,
                location = s.Location,
                address = s.ServerAddress,
                serverStarted = s.ServerStartedUtc?.ToLocalTime(),
                invite = RobloxApi.InviteUrl(s.PlaceId, s.JobId),
            },
            link = new { connected = Bridge.Connected, version = Bridge.Version, userId = Bridge.UserId, userName = Bridge.UserName, since = Bridge.Since },
            meUserId = Bridge.UserId != 0 ? Bridge.UserId : Settings.MeUserId,
            settings = new
            {
                overlayVisible = Settings.OverlayVisible,
                hideWhenNotInGame = Settings.HideWhenNotInGame,
                panelOnTop = Settings.PanelOnTop,
                openPanelOnJoin = Settings.OpenPanelOnJoin,
                opacity = Settings.Opacity,
            },
            reading = Watcher.CurrentFile is { } f ? Path.GetFileName(f) : null,
        };
    }

    private string Note(long universe) { lock (_libLock) return _library.Notes.GetValueOrDefault(universe, ""); }
    private bool IsFavorite(long universe) { lock (_libLock) return _library.Favorites.Any(f => f.UniverseId == universe); }

    public void Dispose()
    {
        Watcher.Dispose();
        Server.Dispose();
        try { Sessions.Save(); } catch { }
    }

    private sealed class FindJob
    {
        public string Id { get; } = Guid.NewGuid().ToString("N");
        public DateTime Started { get; } = DateTime.Now;
        public CancellationTokenSource Cancel { get; } = new();
        public JsonElement? Progress { get; set; }
        public JsonElement? Result { get; set; }
        public string? Error { get; set; }
        public bool Done { get; set; }
    }
}
