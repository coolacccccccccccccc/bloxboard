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
tracker.Joined += s => joined = s;
tracker.Left += s => left = s;
var t = new DateTime(2026, 10, 11, 18, 0, 0);
foreach (var l in lines.Take(5)) if (LogParser.Parse(l) is { } ev) tracker.Feed(ev, t);
Check(joined is { PlaceId: 14823220100, JobId: Job, ServerAddress: "128.116.5.31", UniverseId: 5108158764 }, "session: joined with public address and universe");
tracker.Feed(LogParser.Parse(lines[5])!, t.AddMinutes(30));
Check(left is { LeftAt: not null } && tracker.Current is null, "session: left after disconnect");

// Teleport: a new join while in a server ends the old one first.
var t2 = new SessionTracker();
var leaves = 0;
t2.Left += _ => leaves++;
foreach (var l in lines.Take(4)) if (LogParser.Parse(l) is { } ev) t2.Feed(ev, t);
t2.Feed(new JoiningEvent("11111111-2222-3333-4444-555555555555", 1, "1.2.3.4"), t);
t2.Feed(new JoinedEvent("1.2.3.4"), t);
Check(leaves == 1 && t2.Current?.PlaceId == 1, "teleport ends the old session and starts the new one");

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

Console.WriteLine(failed == 0 ? "ALL PASSED" : $"{failed} FAILED");
return failed == 0 ? 0 : 1;
