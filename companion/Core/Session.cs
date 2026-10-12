namespace Bloxboard.Companion;

public sealed class Session
{
    public long PlaceId { get; set; }
    public long UniverseId { get; set; }
    public string JobId { get; set; } = "";
    public string ServerAddress { get; set; } = "";
    public DateTime JoinedAt { get; set; }
    public DateTime? LeftAt { get; set; }
    public string GameName { get; set; } = "";
    public string Location { get; set; } = "";
    public long UserId { get; set; }
    /// <summary>When the Roblox server itself started (from the "Server Prefix" line), UTC.</summary>
    public DateTime? ServerStartedUtc { get; set; }
}

/// <summary>
/// Turns log events into "joined a server" / "left". Same rules as Fishstrap's ActivityWatcher:
/// a server counts as joined once Roblox confirms the connection; disconnect lines only end a
/// session that was joined; "back to the app" only cancels a join that never connected (it can
/// show up during teleports). We show the server already while joining, so nothing waits.
/// </summary>
public sealed class SessionTracker
{
    public Session? Current { get; private set; }
    /// <summary>True once Roblox confirmed the connection to the current server.</summary>
    public bool Connected { get; private set; }

    /// <summary>Live: a disconnect line only ends a connected session (Fishstrap's rule). The old-log
    /// importer turns this off, since some logs lack the "connected" line.</summary>
    public bool StrictDisconnect { get; init; } = true;

    public event Action<Session>? Joined;
    public event Action<Session>? Updated;
    public event Action<Session>? Left;

    public void Feed(LogEvent ev, DateTime now)
    {
        switch (ev)
        {
            case JoiningEvent j:
                if (Current is not null && Current.JobId == j.JobId && !Connected) break; // same join logged twice
                if (Current is not null) Leave(now); // teleport or a missed disconnect: the old server is done
                Current = new Session { PlaceId = j.PlaceId, JobId = j.JobId, ServerAddress = j.MachineAddress, JoinedAt = now };
                Connected = false;
                Joined?.Invoke(Current);
                break;
            case UniverseEvent u when Current is not null:
                Current.UserId = u.UserId;
                if (Current.UniverseId == u.UniverseId) break;
                Current.UniverseId = u.UniverseId;
                Updated?.Invoke(Current);
                break;
            case ServerStartEvent st when Current is not null:
                Current.ServerStartedUtc = st.StartedUtc;
                Updated?.Invoke(Current);
                break;
            case UdmuxEvent x when Current is not null && Current.ServerAddress != x.Address:
                Current.ServerAddress = x.Address; // the public address players actually connect to
                Updated?.Invoke(Current);
                break;
            case JoinedEvent when Current is not null:
                Connected = true;
                break;
            case DisconnectedEvent when Current is not null && (Connected || !StrictDisconnect):
                Leave(now);
                break;
            case LeftToAppEvent when Current is not null && !Connected:
                Leave(now); // a join that was cancelled or failed
                break;
        }
    }

    /// <summary>Roblox itself closed (or a crash left a session open): end it.</summary>
    public void RobloxClosed(DateTime now)
    {
        if (Current is not null) Leave(now);
    }

    private void Leave(DateTime now)
    {
        var s = Current!;
        s.LeftAt = now;
        Current = null;
        Connected = false;
        Left?.Invoke(s);
    }
}
