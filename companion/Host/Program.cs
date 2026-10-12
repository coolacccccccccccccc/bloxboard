// Usage: Host <logDir> <dataDir> [tokenFile]
// Runs the companion service without Windows UI. Opened links are appended to <dataDir>/opened.txt.
using Bloxboard.Companion;

var logDir = args.Length > 0 ? args[0] : "/tmp/bbx-logs";
var dataDir = args.Length > 1 ? args[1] : "/tmp/bbx-data";
Directory.CreateDirectory(logDir);
var svc = new CompanionService(new TestHost(dataDir), new Store(dataDir), logDir, version: "2.0.0-test");
svc.Start();
var info = $"{svc.Server.Port} {svc.Server.Token}";
File.WriteAllText(Path.Combine(dataDir, "panel.txt"), info);
Console.WriteLine($"panel {svc.Server.PanelUrl}");
await Task.Delay(Timeout.Infinite);

sealed class TestHost(string dir) : ICompanionHost
{
    public void OpenUrl(string url) => File.AppendAllText(Path.Combine(dir, "opened.txt"), url + "\n");
    public void SettingsChanged() => File.AppendAllText(Path.Combine(dir, "opened.txt"), "settings\n");
}
