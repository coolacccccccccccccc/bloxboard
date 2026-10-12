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
}

/// <summary>Turns log events into "joined a server" / "left" with the details we know.</summary>
public sealed class SessionTracker
{
    public Session? Current { get; private set; }

    /// <summary>Fired as soon as Roblox starts joining a server ("! Joining game"), so the overlay never waits on later lines.</summary>
    public event Action<Session>? Joined;
    /// <summary>Fired when a later line adds details (public address, universe) to the current session.</summary>
    public event Action<Session>? Updated;
    public event Action<Session>? Left;

    public void Feed(LogEvent ev, DateTime now)
    {
        switch (ev)
        {
            case JoiningEvent j:
                if (Current is not null) Leave(now); // teleport: the old server is done
                Current = new Session { PlaceId = j.PlaceId, JobId = j.JobId, ServerAddress = j.MachineAddress, JoinedAt = now };
                Joined?.Invoke(Current);
                break;
            case UniverseEvent u when Current is not null && Current.UniverseId != u.UniverseId:
                Current.UniverseId = u.UniverseId;
                Updated?.Invoke(Current);
                break;
            case UdmuxEvent x when Current is not null && Current.ServerAddress != x.Address:
                Current.ServerAddress = x.Address; // the public address players actually connect to
                Updated?.Invoke(Current);
                break;
            case DisconnectedEvent:
            case LeftToAppEvent:
                if (Current is not null) Leave(now);
                break;
        }
    }

    private void Leave(DateTime now)
    {
        var s = Current!;
        s.LeftAt = now;
        Current = null;
        Left?.Invoke(s);
    }
}
