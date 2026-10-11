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
    private Session? _pending;
    public Session? Current { get; private set; }

    public event Action<Session>? Joined;
    public event Action<Session>? Left;

    public void Feed(LogEvent ev, DateTime now)
    {
        switch (ev)
        {
            case JoiningEvent j:
                if (Current is not null) Leave(now); // teleport: the old server is done
                _pending = new Session { PlaceId = j.PlaceId, JobId = j.JobId, ServerAddress = j.MachineAddress, JoinedAt = now };
                break;
            case UniverseEvent u when _pending is not null:
                _pending.UniverseId = u.UniverseId;
                break;
            case UniverseEvent u when Current is not null:
                Current.UniverseId = u.UniverseId;
                break;
            case UdmuxEvent x when _pending is not null:
                _pending.ServerAddress = x.Address; // the public address players actually connect to
                break;
            case JoinedEvent when _pending is not null:
                Current = _pending;
                Current.JoinedAt = now;
                _pending = null;
                Joined?.Invoke(Current);
                break;
            case DisconnectedEvent:
            case LeftToAppEvent:
                _pending = null;
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
