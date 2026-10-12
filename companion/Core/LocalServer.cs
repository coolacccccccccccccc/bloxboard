using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Bloxboard.Companion;

public sealed record HttpRequestData(string Method, string Path, Dictionary<string, string> Query, string Body)
{
    public string Q(string key, string fallback = "") => Query.TryGetValue(key, out var v) ? v : fallback;
    public long QLong(string key) => long.TryParse(Q(key), out var v) ? v : 0;
    public JsonElement Json() => string.IsNullOrWhiteSpace(Body) ? default : JsonDocument.Parse(Body).RootElement.Clone();
}

public sealed record HttpResponseData(int Status, string ContentType, byte[] Body)
{
    private static readonly JsonSerializerOptions Opts = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    public static HttpResponseData Json(object? value, int status = 200) =>
        new(status, "application/json; charset=utf-8", JsonSerializer.SerializeToUtf8Bytes(value, Opts));
    public static HttpResponseData Error(string message, int status = 400) => Json(new { error = message }, status);
}

/// <summary>
/// A tiny web server on 127.0.0.1 only. It serves the panel UI, the panel's API (which needs the
/// per-run token) and the WebSocket the Bloxboard browser extension links through. Nothing is
/// reachable from other computers.
/// </summary>
public sealed class LocalServer : IDisposable
{
    public static readonly int[] Ports = { 47823, 47824, 47825 };

    private readonly Func<HttpRequestData, Task<HttpResponseData>> _api;
    private readonly Func<WebSocket, Task> _bridge;
    private readonly Func<string, (byte[] Data, string Type)?> _static;
    private readonly CancellationTokenSource _cts = new();
    private TcpListener? _listener;

    public int Port { get; private set; }
    public string Token { get; } = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
    public string BaseUrl => $"http://127.0.0.1:{Port}";
    public string PanelUrl => $"{BaseUrl}/#t={Token}";
    public Action<Exception>? OnError { get; set; }

    public LocalServer(Func<HttpRequestData, Task<HttpResponseData>> api, Func<WebSocket, Task> bridge, Func<string, (byte[] Data, string Type)?> staticFiles)
    {
        _api = api;
        _bridge = bridge;
        _static = staticFiles;
    }

    public void Start(int[]? ports = null)
    {
        foreach (var p in ports ?? Ports)
        {
            try
            {
                var l = new TcpListener(IPAddress.Loopback, p);
                l.Start();
                _listener = l;
                Port = ((IPEndPoint)l.LocalEndpoint).Port;
                break;
            }
            catch (SocketException) { }
        }
        if (_listener is null) throw new InvalidOperationException("No free local port for the panel (47823-47825).");
        _ = Task.Run(AcceptLoop);
    }

    private async Task AcceptLoop()
    {
        while (!_cts.IsCancellationRequested)
        {
            TcpClient client;
            try { client = await _listener!.AcceptTcpClientAsync(_cts.Token); }
            catch (OperationCanceledException) { return; }
            catch (Exception e) { OnError?.Invoke(e); continue; }
            _ = Task.Run(() => Handle(client));
        }
    }

    private async Task Handle(TcpClient client)
    {
        bool keep = false;
        var stream = client.GetStream();
        try
        {
            var head = await ReadHead(stream);
            if (head is null) return;
            var lines = head.Split("\r\n");
            var parts = lines[0].Split(' ');
            if (parts.Length < 2) return;
            var method = parts[0];
            var target = parts[1];
            var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var l in lines.Skip(1))
            {
                int c = l.IndexOf(':');
                if (c > 0) headers[l[..c].Trim()] = l[(c + 1)..].Trim();
            }

            // DNS-rebinding guard: only answer requests addressed to us by loopback name.
            var host = headers.GetValueOrDefault("Host", "");
            if (host != $"127.0.0.1:{Port}" && host != $"localhost:{Port}")
            {
                await Write(stream, HttpResponseData.Error("wrong host", 421));
                return;
            }

            var q = target.IndexOf('?');
            var path = Uri.UnescapeDataString(q < 0 ? target : target[..q]);
            var query = new Dictionary<string, string>();
            if (q >= 0)
                foreach (var kv in target[(q + 1)..].Split('&', StringSplitOptions.RemoveEmptyEntries))
                {
                    int e = kv.IndexOf('=');
                    if (e < 0) query[Uri.UnescapeDataString(kv)] = "";
                    else query[Uri.UnescapeDataString(kv[..e])] = Uri.UnescapeDataString(kv[(e + 1)..].Replace('+', ' '));
                }
            var origin = headers.GetValueOrDefault("Origin", "");

            if (path == "/bridge" && headers.GetValueOrDefault("Upgrade", "").Equals("websocket", StringComparison.OrdinalIgnoreCase))
            {
                // Only browser extensions may link (websites can open WebSockets to localhost too).
                if (!origin.StartsWith("chrome-extension://") && !origin.StartsWith("extension://"))
                {
                    await Write(stream, HttpResponseData.Error("extensions only", 403));
                    return;
                }
                var key = headers.GetValueOrDefault("Sec-WebSocket-Key", "");
                var accept = Convert.ToBase64String(SHA1.HashData(Encoding.ASCII.GetBytes(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")));
                var resp = $"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {accept}\r\n\r\n";
                await stream.WriteAsync(Encoding.ASCII.GetBytes(resp));
                var ws = WebSocket.CreateFromStream(stream, new WebSocketCreationOptions { IsServer = true, KeepAliveInterval = TimeSpan.FromSeconds(20) });
                keep = true;
                try { await _bridge(ws); }
                finally { ws.Dispose(); client.Dispose(); }
                return;
            }

            if (path.StartsWith("/api/"))
            {
                // The panel sends the per-run token; other pages (and other sites) don't have it.
                var token = headers.GetValueOrDefault("X-Bbx-Token", query.GetValueOrDefault("t", ""));
                if (token != Token || (origin.Length > 0 && origin != BaseUrl && origin != $"http://localhost:{Port}"))
                {
                    await Write(stream, HttpResponseData.Error("not allowed", 403));
                    return;
                }
                int len = int.TryParse(headers.GetValueOrDefault("Content-Length", "0"), out var n) ? n : 0;
                if (len > 1_000_000) { await Write(stream, HttpResponseData.Error("too big", 413)); return; }
                var body = new byte[len];
                int read = 0;
                while (read < len)
                {
                    int r = await stream.ReadAsync(body.AsMemory(read, len - read));
                    if (r == 0) break;
                    read += r;
                }
                HttpResponseData res;
                try { res = await _api(new HttpRequestData(method, path, query, Encoding.UTF8.GetString(body, 0, read))); }
                catch (BridgeOfflineException e) { res = HttpResponseData.Error(e.Message, 409); }
                catch (Exception e) { OnError?.Invoke(e); res = HttpResponseData.Error(e.Message, 500); }
                await Write(stream, res);
                return;
            }

            if (method != "GET") { await Write(stream, HttpResponseData.Error("not found", 404)); return; }
            var file = _static(path == "/" ? "index.html" : path.TrimStart('/'));
            await Write(stream, file is { } f ? new HttpResponseData(200, f.Type, f.Data) : HttpResponseData.Error("not found", 404));
        }
        catch (Exception e) when (e is IOException or SocketException or ObjectDisposedException) { }
        catch (Exception e) { OnError?.Invoke(e); }
        finally
        {
            if (!keep) client.Dispose();
        }
    }

    private static async Task<string?> ReadHead(NetworkStream s)
    {
        var buf = new List<byte>(1024);
        var one = new byte[1];
        while (buf.Count < 16384)
        {
            int r = await s.ReadAsync(one);
            if (r == 0) return null;
            buf.Add(one[0]);
            int c = buf.Count;
            if (c >= 4 && buf[c - 4] == '\r' && buf[c - 3] == '\n' && buf[c - 2] == '\r' && buf[c - 1] == '\n')
                return Encoding.ASCII.GetString(buf.ToArray(), 0, c - 4);
        }
        return null;
    }

    private static async Task Write(NetworkStream s, HttpResponseData r)
    {
        var reason = r.Status switch { 200 => "OK", 403 => "Forbidden", 404 => "Not Found", 409 => "Conflict", 421 => "Misdirected Request", 500 => "Internal Server Error", _ => "Status" };
        var head = $"HTTP/1.1 {r.Status} {reason}\r\nContent-Type: {r.ContentType}\r\nContent-Length: {r.Body.Length}\r\n" +
                   "Cache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n";
        await s.WriteAsync(Encoding.ASCII.GetBytes(head));
        await s.WriteAsync(r.Body);
        await s.FlushAsync();
    }

    public void Dispose()
    {
        _cts.Cancel();
        try { _listener?.Stop(); } catch { }
    }
}
