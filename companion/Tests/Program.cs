// Plain console tests (no test framework needed): log parsing, session tracking, the file watcher,
// history storage and the live public Roblox APIs.
using Bloxboard.Companion;

int failed = 0;
void Check(bool ok, string what)
{
    Console.WriteLine($"{(ok ? "PASS" : "FAIL")}  {what}");
    if (!ok) failed++;
}

const string Job = "f038d614-34b8-4fdf-a97e-2d5289c7567c";
string[] lines =
{
    "2026-10-11T18:00:00.000Z,1.0,1a2b,6 [FLog::Output] Settings Date header was Sun, 11 Oct 2026",
    $"2026-10-11T18:00:01.000Z,2.0,1a2b,6 [FLog::Output] ! Joining game '{Job}' place 14823220100 at 10.0.0.1",
    "2026-10-11T18:00:02.000Z,3.0,1a2b,6 [FLog::Network] UDMUX Address = 128.116.5.31, Port = 55555 | RCC Server Address = 10.0.0.1, Port = 1234",
    "2026-10-11T18:00:03.000Z,4.0,1a2b,6 [FLog::Network] Replicator created: 0x1234 serverId: 10.0.0.1|1234",
    "2026-10-11T18:00:04.000Z,5.0,1a2b,6 [FLog::GameJoinLoadTime] Report game_join_loadtime: placeid:14823220100, universeid:5108158764, userid:1, joinTime:1.2",
    "2026-10-11T18:30:00.000Z,6.0,1a2b,6 [FLog::Network] Time to disconnect replication data: 0.1",
};

Check(LogParser.Parse(lines[0]) is null, "unrelated line is ignored");
Check(LogParser.Parse(lines[1]) is JoiningEvent { PlaceId: 14823220100, JobId: Job }, "joining line gives place + job id");
Check(LogParser.Parse(lines[2]) is UdmuxEvent { Address: "128.116.5.31" }, "UDMUX line gives the public server address");
Check(LogParser.Parse(lines[3]) is JoinedEvent, "replicator line means joined");
Check(LogParser.Parse(lines[4]) is UniverseEvent { UniverseId: 5108158764 }, "load-time line gives universe id");
Check(LogParser.Parse(lines[5]) is DisconnectedEvent, "disconnect line");
Check(LogParser.Parse("no-space-here") is null, "line without a space is ignored");
Check(LogParser.Timestamp(lines[1])?.ToUniversalTime() == new DateTime(2026, 10, 11, 18, 0, 1, DateTimeKind.Utc), "timestamp read from the log line");

var tracker = new SessionTracker();
Session? joined = null, left = null;
int updates = 0;
tracker.Joined += s => joined = s;
tracker.Updated += _ => updates++;
tracker.Left += s => left = s;
var t = new DateTime(2026, 10, 11, 18, 0, 0);
tracker.Feed(LogParser.Parse(lines[1])!, t);
Check(joined is { PlaceId: 14823220100, JobId: Job }, "session: shows up on the joining line alone (no network lines needed)");
foreach (var l in lines.Skip(2).Take(3)) if (LogParser.Parse(l) is { } ev) tracker.Feed(ev, t);
Check(updates == 2, $"session: address + universe arrive as updates ({updates})");
Check(joined is { PlaceId: 14823220100, JobId: Job, ServerAddress: "128.116.5.31", UniverseId: 5108158764 }, "session: joined with public address and universe");
tracker.Feed(LogParser.Parse(lines[5])!, t.AddMinutes(30));
Check(left is { LeftAt: not null } && tracker.Current is null, "session: left after disconnect");

// Teleport: a new join while in a server ends the old one first.
var t2 = new SessionTracker();
var leaves = 0;
t2.Left += _ => leaves++;
foreach (var l in lines.Take(4)) if (LogParser.Parse(l) is { } ev) t2.Feed(ev, t);
t2.Feed(new JoiningEvent("11111111-2222-3333-4444-555555555555", 1, "1.2.3.4"), t);
Check(leaves == 1 && t2.Current?.PlaceId == 1, "teleport ends the old session and starts the new one");

// Fishstrap rules: stray lines while joining / during teleports don't end a session.
var sm = new SessionTracker();
int smLeft = 0;
sm.Left += _ => smLeft++;
sm.Feed(LogParser.Parse(lines[1])!, t);                       // joining
sm.Feed(new DisconnectedEvent(), t);                           // stray disconnect before connecting
Check(sm.Current is not null && smLeft == 0, "rules: disconnect before connecting is ignored");
sm.Feed(LogParser.Parse(lines[3])!, t);                       // connected
sm.Feed(new LeftToAppEvent(), t);                              // "back to app" line during a teleport
Check(sm.Current is not null && smLeft == 0, "rules: back-to-app while connected doesn't end the session");
sm.Feed(LogParser.Parse(lines[1])!, t);                       // same join logged again while connected = new visit
sm.Feed(LogParser.Parse(lines[3])!, t);
sm.Feed(new DisconnectedEvent(), t);
Check(sm.Current is null, "rules: disconnect after connecting ends the session");
sm.Feed(LogParser.Parse(lines[1])!, t);
sm.Feed(new LeftToAppEvent(), t);
Check(sm.Current is null, "rules: back-to-app cancels a join that never connected");
sm.Feed(LogParser.Parse(lines[1])!, t);
sm.RobloxClosed(t);
Check(sm.Current is null, "rules: Roblox closing ends the session");

// Watcher: follows the newest *Player* log, delivers complete lines only, and picks up the rest later.
var dir = Path.Combine(Path.GetTempPath(), "bbx-logs-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(dir);
var got = new List<string>();
using (var w = new LogWatcher(dir, l => { lock (got) got.Add(l); }))
{
    _ = w.Start();
    await Task.Delay(700);
    var file = Path.Combine(dir, "0.700.0_20261011T180000Z_Player_ABC_last.log");
    await File.WriteAllTextAsync(file, lines[0] + "\n" + lines[1] + "\n" + "2026-10-11T18:00:02.000Z,3.0,1a2b,6 [FLog::Net");
    await Task.Delay(1300);
    int afterFirst;
    lock (got) afterFirst = got.Count;
    await File.AppendAllTextAsync(file, "work] UDMUX Address = 128.116.5.31, Port = 1 | RCC Server Address = 10.0.0.1, Port = 2\n");
    await Task.Delay(1300);
    lock (got)
    {
        Check(afterFirst == 2, $"watcher: delivered 2 complete lines first (got {afterFirst})");
        Check(got.Count == 3 && LogParser.Parse(got[2]) is UdmuxEvent, "watcher: finished line delivered once complete");
    }
    File.WriteAllText(Path.Combine(dir, "0.700.0_20261011T190000Z_Studio_ABC_last.log"), "studio\n");
    await Task.Delay(800);
    Check(w.CurrentFile == file, "watcher: ignores Studio logs");
    // A newer Player log (new Roblox run) takes over. (Creation time decides on Windows; Linux
    // containers often have no birth time, so this only checks the switch itself.)
    var file2 = Path.Combine(dir, "0.700.0_20261011T200000Z_Player_DEF_last.log");
    await File.WriteAllTextAsync(file2, lines[1] + "\n");
    await Task.Delay(1300);
    Check(w.CurrentFile == file2, "watcher: a new Player log is picked up");
    Check(w.LinesRead == 4, $"watcher: counts lines ({w.LinesRead})");
    // The older log keeps being read too (Roblox can have more than one Player log open).
    await File.AppendAllTextAsync(file, lines[2] + "\n");
    await Task.Delay(1300);
    lock (got) Check(got.Count == 5 && LogParser.Parse(got[^1]) is UdmuxEvent, "watcher: lines added to an older log still arrive");
}
Directory.Delete(dir, true);

// History storage
var store = new Store(Path.Combine(Path.GetTempPath(), "bbx-store-" + Guid.NewGuid().ToString("N")));
store.AddToHistory(joined!);
store.AddToHistory(joined!);
Check(store.LoadHistory().Count == 1, "history: same server stored once");
var st = store.LoadSettings();
st.OverlayX = 42;
store.SaveSettings(st);
Check(store.LoadSettings().OverlayX == 42, "settings round-trip");

// Live public APIs (no login)
var api = new RobloxApi();
try
{
    var uni = await api.UniverseOf(14823220100);
    Check(uni == 5108158764, $"api: place -> universe ({uni})");
    var (name, playing) = await api.Game(uni);
    Check(name.Length > 0, $"api: game name '{name}', {playing} playing");
    var servers = await api.Servers(14823220100, 1);
    Check(servers.Count > 0 && servers.All(s => s.Playing < s.MaxPlayers), $"api: {servers.Count} public servers with room");
    var loc = await api.Location("128.116.5.31");
    Check(loc.Length > 0, $"api: location of 128.116.5.31 = '{loc}'");
}
catch (Exception e)
{
    Check(false, $"api: {e.Message}");
}

// Server start time ("Server Prefix") gives uptime.
var prefix = "2026-10-11T18:00:05.000Z,5.5,1a2b,6 [FLog::Output] Server Prefix: 0.700.0.7000_20261011T120000Z_RCC_ab12c";
Check(LogParser.Parse(prefix) is ServerStartEvent { StartedUtc: var su } && su == new DateTime(2026, 10, 11, 12, 0, 0, DateTimeKind.Utc), "server prefix line gives server start time");

// Old log import: two sessions in one file, the second ends with the file.
var oldLog = new[]
{
    lines[0], lines[1], lines[2], lines[3], lines[4],
    "2026-10-11T18:30:00.000Z,6.0,1a2b,6 [FLog::Network] Time to disconnect replication data: 0.1",
    "2026-10-11T19:00:00.000Z,7.0,1a2b,6 [FLog::Output] ! Joining game '11111111-2222-3333-4444-555555555555' place 1 at 1.2.3.4",
    "2026-10-11T19:45:00.000Z,8.0,1a2b,6 [FLog::Output] something at the end",
};
var imported = LogImporter.Read(oldLog);
Check(imported.Count == 2 && Math.Abs(imported[0].Minutes - 30) < 0.1 && Math.Abs(imported[1].Minutes - 45) < 0.1, $"import: 2 sessions, 30 + 45 min ({string.Join(", ", imported.Select(x => x.Minutes))})");

// Stats: minutes per day, split over midnight, streaks.
var sdir = Path.Combine(Path.GetTempPath(), "bbx-sess-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(sdir);
var ss = new SessionStore(sdir);
var today = DateTime.Today;
ss.Upsert(new PlaySession { PlaceId = 1, UniverseId = 10, JobId = "a", Start = today.AddDays(-1).AddHours(23), End = today.AddHours(1), GameName = "A" });
ss.Upsert(new PlaySession { PlaceId = 2, UniverseId = 20, JobId = "b", Start = today.AddDays(-2).AddHours(12), End = today.AddDays(-2).AddHours(13), GameName = "B" });
Check(!ss.Upsert(new PlaySession { PlaceId = 1, UniverseId = 10, JobId = "a", Start = today.AddDays(-1).AddHours(23), End = today.AddHours(2) }), "sessions: same server+start updates instead of duplicating");
var per = SessionStore.PerDay(ss.All());
Check(Math.Abs(per[SessionStore.DayKey(today)][10] - 120) < 0.1 && Math.Abs(per[SessionStore.DayKey(today.AddDays(-1))][10] - 60) < 0.1, "stats: session over midnight split per day");
var statsJson = System.Text.Json.JsonSerializer.Serialize(SessionStore.Stats(ss.All(), DateTime.Now, 7));
Check(statsJson.Contains("\"streak\":3") && statsJson.Contains("\"name\":\"A\""), $"stats: 3-day streak and top game ({statsJson[..Math.Min(200, statsJson.Length)]}…)");
ss.Save();
Check(new SessionStore(sdir).All().Count == 2, "sessions saved and loaded");

// Local server + browser link
var hostDir = Path.Combine(Path.GetTempPath(), "bbx-host-" + Guid.NewGuid().ToString("N"));
var logDir2 = Path.Combine(hostDir, "logs");
Directory.CreateDirectory(logDir2);
var opened = new List<string>();
var svc = new CompanionService(new FakeHost(opened), new Store(Path.Combine(hostDir, "data")), logDir2);
svc.Start(new[] { 0 }); // any free port
var http = new HttpClient { BaseAddress = new Uri(svc.Server.BaseUrl) };
async Task<(int, string)> Req(HttpMethod m, string path, string? body = null, bool token = true, string? origin = null)
{
    var r = new HttpRequestMessage(m, path);
    if (token) r.Headers.Add("X-Bbx-Token", svc.Server.Token);
    if (origin is not null) r.Headers.Add("Origin", origin);
    if (body is not null) r.Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json");
    var res = await http.SendAsync(r);
    return ((int)res.StatusCode, await res.Content.ReadAsStringAsync());
}
var (st1, idx) = await Req(HttpMethod.Get, "/", token: false);
Check(st1 == 200 && idx.Contains("app.js"), "server: panel page served");
Check((await Req(HttpMethod.Get, "/api/state", token: false)).Item1 == 403, "server: API without token refused");
Check((await Req(HttpMethod.Get, "/api/state", origin: "https://evil.example")).Item1 == 403, "server: API from another site refused even with token");
var (st2, stateJson) = await Req(HttpMethod.Get, "/api/state");
Check(st2 == 200 && stateJson.Contains("\"connected\":false"), "server: state with token");
var badHost = new HttpRequestMessage(HttpMethod.Get, "/api/state");
badHost.Headers.Host = "attacker.example";
badHost.Headers.Add("X-Bbx-Token", svc.Server.Token);
Check((int)(await http.SendAsync(badHost)).StatusCode == 421, "server: wrong Host header refused (DNS rebinding)");
Check((await Req(HttpMethod.Post, "/api/open", "{\"url\":\"https://evil.example/x\"}")).Item1 == 400, "server: open refuses other sites");
Check((await Req(HttpMethod.Post, "/api/open", "{\"placeId\":1,\"jobId\":\"not-a-guid\"}")).Item1 == 400, "server: open refuses bad server ids");
await Req(HttpMethod.Post, "/api/open", $"{{\"placeId\":14823220100,\"jobId\":\"{Job}\"}}");
Check(opened.LastOrDefault() == RobloxApi.JoinUrl(14823220100, Job), "server: join opens a roblox:// link");
Check((await Req(HttpMethod.Post, "/api/regions", "{\"placeId\":1,\"serverIds\":[]}")).Item1 == 409, "server: regions need the browser link (409)");

// A website can't link (origin check); an extension can.
var wsUrl = new Uri($"ws://127.0.0.1:{svc.Server.Port}/bridge");
var evil = new System.Net.WebSockets.ClientWebSocket();
evil.Options.SetRequestHeader("Origin", "https://evil.example");
var evilOk = true;
try { await evil.ConnectAsync(wsUrl, CancellationToken.None); } catch { evilOk = false; }
Check(!evilOk, "bridge: websites can't connect");

var ext = new System.Net.WebSockets.ClientWebSocket();
ext.Options.SetRequestHeader("Origin", "chrome-extension://mmophpckpdilgbnghpaafdjpicefopee");
await ext.ConnectAsync(wsUrl, CancellationToken.None);
async Task SendJ(object o) => await ext.SendAsync(System.Text.Json.JsonSerializer.SerializeToUtf8Bytes(o), System.Net.WebSockets.WebSocketMessageType.Text, true, CancellationToken.None);
async Task<System.Text.Json.JsonElement> RecvJ()
{
    var buf = new byte[65536];
    var r = await ext.ReceiveAsync(buf, CancellationToken.None);
    return System.Text.Json.JsonDocument.Parse(buf.AsMemory(0, r.Count)).RootElement.Clone();
}
await SendJ(new { type = "hello", version = "0.8.0", userId = 1001, userName = "enes_dev" });
await Task.Delay(200);
Check(svc.Bridge.Connected && svc.Bridge.UserName == "enes_dev", "bridge: extension linked with hello");
// Linking pushes playtime first.
var push = await RecvJ();
Check(push.GetProperty("type").GetString() == "playtime", "bridge: playtime pushed on link");
await SendJ(new { id = push.GetProperty("id").GetString(), data = new { changed = 0 } });
// Panel asks for regions -> the extension gets the request and answers.
var regionTask = Req(HttpMethod.Post, "/api/regions", $"{{\"placeId\":1,\"serverIds\":[\"{Job}\"]}}");
var regionReq = await RecvJ();
Check(regionReq.GetProperty("type").GetString() == "regions", "bridge: regions request forwarded to the extension");
await SendJ(new Dictionary<string, object> { ["id"] = regionReq.GetProperty("id").GetString()!, ["data"] = new Dictionary<string, object> { [Job] = new { city = "Amsterdam", cc = "NL" } } });
var (st3, regionBody) = await regionTask;
Check(st3 == 200 && regionBody.Contains("Amsterdam"), "bridge: region answer reaches the panel");
// Find: progress then result.
var (st4, findStart) = await Req(HttpMethod.Post, "/api/find", "{\"placeId\":1,\"query\":\"Builderman\",\"mode\":\"username\"}");
var findJobId = System.Text.Json.JsonDocument.Parse(findStart).RootElement.GetProperty("job").GetString();
var findReq = await RecvJ();
var fid = findReq.GetProperty("id").GetString()!;
await SendJ(new { id = fid, progress = new { text = "Pass 1/8", pct = 40 } });
await Task.Delay(150);
var (_, mid) = await Req(HttpMethod.Get, $"/api/find?job={findJobId}");
Check(mid.Contains("Pass 1/8") && mid.Contains("\"done\":false"), "bridge: find progress visible to the panel");
await SendJ(new { id = fid, data = new { found = new[] { new { title = "Found @Builderman", gameId = Job, placeId = 1 } }, text = "Found." } });
await Task.Delay(150);
var (_, end) = await Req(HttpMethod.Get, $"/api/find?job={findJobId}");
Check(end.Contains("\"done\":true") && end.Contains("Found @Builderman"), "bridge: find result reaches the panel");
await ext.CloseAsync(System.Net.WebSockets.WebSocketCloseStatus.NormalClosure, "", CancellationToken.None);
await Task.Delay(200);
Check(!svc.Bridge.Connected, "bridge: unlink detected");
svc.Dispose();

Console.WriteLine(failed == 0 ? "ALL PASSED" : $"{failed} FAILED");
return failed == 0 ? 0 : 1;

sealed class FakeHost(List<string> opened) : ICompanionHost
{
    public void OpenUrl(string url) { lock (opened) opened.Add(url); }
    public void SettingsChanged() { }
}
