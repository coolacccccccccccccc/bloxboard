using System.Text.RegularExpressions;

namespace Bloxboard.Companion;

/// <summary>What a single Roblox log line tells us, if anything.</summary>
public abstract record LogEvent;
public sealed record JoiningEvent(string JobId, long PlaceId, string MachineAddress) : LogEvent;
public sealed record UniverseEvent(long UniverseId, long UserId) : LogEvent;
public sealed record UdmuxEvent(string Address) : LogEvent;
public sealed record JoinedEvent(string ServerAddress) : LogEvent;
public sealed record DisconnectedEvent : LogEvent;
public sealed record LeftToAppEvent : LogEvent;
public sealed record ServerStartEvent(DateTime StartedUtc) : LogEvent;

/// <summary>
/// Reads the lines Roblox writes to %LOCALAPPDATA%\Roblox\logs. These are plain text files
/// Roblox writes for everyone; reading them doesn't touch the game itself.
/// </summary>
public static partial class LogParser
{
    [GeneratedRegex(@"! Joining game '?([0-9a-f\-]{36})'? place ([0-9]+) at ([0-9\.]+)")]
    private static partial Regex Joining();

    [GeneratedRegex(@"universeid:([0-9]+).*userid:([0-9]+)")]
    private static partial Regex Universe();

    [GeneratedRegex(@"UDMUX Address = ([0-9\.]+), Port = [0-9]+")]
    private static partial Regex Udmux();

    [GeneratedRegex(@"Server Prefix:.+_(\d{8}T\d{6}Z)_RCC_[0-9a-z]+")]
    private static partial Regex ServerPrefix();

    [GeneratedRegex(@"serverId: ([0-9\.]+)\|[0-9]+")]
    private static partial Regex Joined();

    /// <summary>The time at the start of a log line ("2026-10-11T18:01:02.123Z,..."), in local time.</summary>
    public static DateTime? Timestamp(string line)
    {
        int comma = line.IndexOf(',');
        if (comma < 10) return null;
        return DateTime.TryParse(line[..comma], System.Globalization.CultureInfo.InvariantCulture,
            System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal, out var utc)
            ? utc.ToLocalTime() : null;
    }

    public static LogEvent? Parse(string line)
    {
        // Lines look like "2026-10-11T18:01:02.123Z,123.45,1a2b,6 [FLog::Output] ! Joining game ..."
        int space = line.IndexOf(' ');
        if (space < 0) return null;
        string msg = line[(space + 1)..];

        if (msg.StartsWith("[FLog::Output] ! Joining game"))
        {
            var m = Joining().Match(msg);
            return m.Success ? new JoiningEvent(m.Groups[1].Value, long.Parse(m.Groups[2].Value), m.Groups[3].Value) : null;
        }
        if (msg.StartsWith("[FLog::GameJoinLoadTime] Report game_join_loadtime:"))
        {
            var m = Universe().Match(msg);
            return m.Success ? new UniverseEvent(long.Parse(m.Groups[1].Value), long.Parse(m.Groups[2].Value)) : null;
        }
        if (msg.StartsWith("[FLog::Network] UDMUX Address = "))
        {
            var m = Udmux().Match(msg);
            return m.Success ? new UdmuxEvent(m.Groups[1].Value) : null;
        }
        if (msg.StartsWith("[FLog::Network] Replicator created: ") || msg.StartsWith("[FLog::Network] serverId:"))
        {
            var m = Joined().Match(msg);
            return new JoinedEvent(m.Success ? m.Groups[1].Value : "");
        }
        if (msg.StartsWith("[FLog::Output] Server Prefix: "))
        {
            var m = ServerPrefix().Match(msg);
            return m.Success && DateTime.TryParseExact(m.Groups[1].Value, "yyyyMMdd'T'HHmmss'Z'", System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal, out var t)
                ? new ServerStartEvent(t) : null;
        }
        if (msg.StartsWith("[FLog::Network] Time to disconnect replication data:")) return new DisconnectedEvent();
        if (msg.StartsWith("[FLog::SingleSurfaceApp] leaveUGCGameInternal")) return new LeftToAppEvent();
        return null;
    }
}
