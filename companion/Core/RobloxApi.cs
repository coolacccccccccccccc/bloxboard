using System.Net.Http.Json;
using System.Text.Json;

namespace Bloxboard.Companion;

public sealed record ServerInfo(string Id, int Playing, int MaxPlayers, int? Ping, double? Fps);

/// <summary>
/// Public Roblox web APIs only, without any login. Nothing here talks to the Roblox client.
/// </summary>
public sealed class RobloxApi
{
    private readonly HttpClient _http;
    private readonly Dictionary<string, string> _geoCache = new();

    public RobloxApi(HttpClient? http = null)
    {
        _http = http ?? new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        if (!_http.DefaultRequestHeaders.UserAgent.Any())
            _http.DefaultRequestHeaders.UserAgent.ParseAdd("BloxboardCompanion/1.0");
    }

    private async Task<JsonElement> Get(string url, CancellationToken ct)
    {
        for (int attempt = 0; ; attempt++)
        {
            using var res = await _http.GetAsync(url, ct);
            if ((int)res.StatusCode == 429 && attempt < 4)
            {
                await Task.Delay(1500 * (attempt + 1), ct);
                continue;
            }
            res.EnsureSuccessStatusCode();
            return await res.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: ct);
        }
    }

    public async Task<long> UniverseOf(long placeId, CancellationToken ct = default)
        => (await Get($"https://apis.roblox.com/universes/v1/places/{placeId}/universe", ct)).GetProperty("universeId").GetInt64();

    public async Task<(string Name, int Playing)> Game(long universeId, CancellationToken ct = default)
    {
        var data = (await Get($"https://games.roblox.com/v1/games?universeIds={universeId}", ct)).GetProperty("data");
        if (data.GetArrayLength() == 0) return ("", 0);
        var g = data[0];
        return (g.GetProperty("name").GetString() ?? "", g.TryGetProperty("playing", out var p) && p.ValueKind == JsonValueKind.Number ? p.GetInt32() : 0);
    }

    public async Task<string?> GameIconUrl(long universeId, CancellationToken ct = default)
    {
        var data = (await Get($"https://thumbnails.roblox.com/v1/games/icons?universeIds={universeId}&size=150x150&format=Png&isCircular=false", ct)).GetProperty("data");
        return data.GetArrayLength() > 0 ? data[0].GetProperty("imageUrl").GetString() : null;
    }

    /// <summary>Public servers, newest list from Roblox. Stops after maxPages pages of 100.</summary>
    public async Task<List<ServerInfo>> Servers(long placeId, int maxPages = 3, CancellationToken ct = default)
    {
        var list = new List<ServerInfo>();
        string? cursor = null;
        for (int i = 0; i < maxPages; i++)
        {
            var url = $"https://games.roblox.com/v1/games/{placeId}/servers/Public?limit=100&sortOrder=Asc&excludeFullGames=true"
                      + (cursor is null ? "" : $"&cursor={Uri.EscapeDataString(cursor)}");
            var page = await Get(url, ct);
            foreach (var s in page.GetProperty("data").EnumerateArray())
            {
                list.Add(new ServerInfo(
                    s.GetProperty("id").GetString() ?? "",
                    s.TryGetProperty("playing", out var pl) && pl.ValueKind == JsonValueKind.Number ? pl.GetInt32() : 0,
                    s.GetProperty("maxPlayers").GetInt32(),
                    s.TryGetProperty("ping", out var pi) && pi.ValueKind == JsonValueKind.Number ? pi.GetInt32() : null,
                    s.TryGetProperty("fps", out var f) && f.ValueKind == JsonValueKind.Number ? f.GetDouble() : null));
            }
            cursor = page.TryGetProperty("nextPageCursor", out var c) && c.ValueKind == JsonValueKind.String ? c.GetString() : null;
            if (cursor is null) break;
        }
        return list;
    }

    /// <summary>"City, CC" for a server address, cached per /24.</summary>
    public async Task<string> Location(string ip, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(ip)) return "";
        var key = string.Join('.', ip.Split('.').Take(3));
        if (_geoCache.TryGetValue(key, out var hit)) return hit;
        try
        {
            var j = await Get($"https://ipwho.is/{ip}?fields=success,city,region,country_code", ct);
            if (!j.TryGetProperty("success", out var ok) || !ok.GetBoolean()) return "";
            var city = j.TryGetProperty("city", out var c) ? c.GetString() : null;
            var cc = j.TryGetProperty("country_code", out var cco) ? cco.GetString() : null;
            var label = string.IsNullOrEmpty(city) ? cc ?? "" : string.IsNullOrEmpty(cc) ? city : $"{city}, {cc}";
            _geoCache[key] = label;
            return label;
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or JsonException)
        {
            return "";
        }
    }

    public static string JoinUrl(long placeId, string? jobId = null)
        => jobId is null ? $"roblox://experiences/start?placeId={placeId}" : $"roblox://experiences/start?placeId={placeId}&gameInstanceId={jobId}";

    public static string InviteUrl(long placeId, string jobId)
        => $"https://www.roblox.com/games/start?placeId={placeId}&gameInstanceId={jobId}";
}
