using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace Bloxboard.Companion;

public sealed class BridgeOfflineException : Exception
{
    public BridgeOfflineException() : base("Not linked to the Bloxboard extension. Open your browser (with Bloxboard installed and linked) to use this.") { }
}

/// <summary>
/// The link with the Bloxboard browser extension. The extension is logged in to Roblox in your
/// browser, so it can do the things that need a login (server regions, friends online, player
/// finder). The companion only sends it requests; it never sees your cookies.
/// Messages are JSON: we send {id,type,args}; it answers {id,data} / {id,error} / {id,progress}.
/// It opens with {type:"hello",version,userId,userName}.
/// </summary>
public sealed class Bridge
{
    private sealed record Pending(TaskCompletionSource<JsonElement> Tcs, Action<JsonElement>? Progress);

    private readonly ConcurrentDictionary<string, Pending> _pending = new();
    private readonly SemaphoreSlim _sendLock = new(1, 1);
    private WebSocket? _ws;

    public bool Connected => _ws?.State == WebSocketState.Open;
    public string Version { get; private set; } = "";
    public long UserId { get; private set; }
    public string UserName { get; private set; } = "";
    public DateTime? Since { get; private set; }
    public event Action? Changed;
    public Action<string>? Log { get; set; }

    /// <summary>Runs one extension connection until it closes. A newer connection replaces an older one.</summary>
    public async Task Run(WebSocket ws)
    {
        var old = _ws;
        _ws = ws;
        if (old is not null) try { old.Abort(); } catch { }
        Since = DateTime.Now;
        Log?.Invoke("extension connected");
        using var pinger = new CancellationTokenSource();
        _ = Task.Run(async () =>
        {
            // App-level pings: WebSocket traffic is what keeps the extension's service worker awake.
            while (!pinger.IsCancellationRequested && ws.State == WebSocketState.Open)
            {
                try { await Task.Delay(20000, pinger.Token); await Send(ws, new { type = "ping" }); } catch { break; }
            }
        });
        try
        {
            var buf = new byte[64 * 1024];
            while (ws.State == WebSocketState.Open)
            {
                using var ms = new MemoryStream();
                WebSocketReceiveResult r;
                do
                {
                    r = await ws.ReceiveAsync(buf, CancellationToken.None);
                    if (r.MessageType == WebSocketMessageType.Close)
                    {
                        try { await ws.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "", CancellationToken.None); } catch { }
                        return;
                    }
                    ms.Write(buf, 0, r.Count);
                    if (ms.Length > 8_000_000) throw new InvalidDataException("message too big");
                } while (!r.EndOfMessage);
                Handle(Encoding.UTF8.GetString(ms.ToArray()));
            }
        }
        catch (Exception e) when (e is WebSocketException or IOException or ObjectDisposedException or OperationCanceledException) { }
        finally
        {
            pinger.Cancel();
            if (ReferenceEquals(_ws, ws))
            {
                _ws = null;
                Since = null;
                foreach (var (id, p) in _pending)
                    if (_pending.TryRemove(id, out _)) p.Tcs.TrySetException(new BridgeOfflineException());
                Log?.Invoke("extension disconnected");
                Changed?.Invoke();
            }
        }
    }

    private void Handle(string text)
    {
        JsonElement msg;
        try { msg = JsonDocument.Parse(text).RootElement.Clone(); }
        catch (JsonException) { return; }
        if (msg.ValueKind != JsonValueKind.Object) return;
        var type = msg.TryGetProperty("type", out var t) ? t.GetString() : null;
        if (type == "hello")
        {
            Version = msg.TryGetProperty("version", out var v) ? v.GetString() ?? "" : "";
            UserId = msg.TryGetProperty("userId", out var u) && u.ValueKind == JsonValueKind.Number ? u.GetInt64() : 0;
            UserName = msg.TryGetProperty("userName", out var n) ? n.GetString() ?? "" : "";
            Log?.Invoke($"extension hello: v{Version}, user {UserId}");
            Changed?.Invoke();
            return;
        }
        if (type == "pong") return;
        if (!msg.TryGetProperty("id", out var idEl) || idEl.GetString() is not { } id || !_pending.TryGetValue(id, out var p)) return;
        if (msg.TryGetProperty("progress", out var prog)) { p.Progress?.Invoke(prog); return; }
        _pending.TryRemove(id, out _);
        if (msg.TryGetProperty("error", out var err)) p.Tcs.TrySetException(new InvalidOperationException(err.GetString() ?? "Extension error"));
        else p.Tcs.TrySetResult(msg.TryGetProperty("data", out var d) ? d : default);
    }

    private async Task Send(WebSocket ws, object value)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(value);
        await _sendLock.WaitAsync();
        try { await ws.SendAsync(bytes, WebSocketMessageType.Text, true, CancellationToken.None); }
        finally { _sendLock.Release(); }
    }

    /// <summary>Asks the extension to do something. Throws <see cref="BridgeOfflineException"/> when not linked.</summary>
    public async Task<JsonElement> Call(string type, object args, Action<JsonElement>? progress = null, TimeSpan? timeout = null, CancellationToken ct = default)
    {
        var ws = _ws;
        if (ws is null || ws.State != WebSocketState.Open) throw new BridgeOfflineException();
        var id = Guid.NewGuid().ToString("N");
        var p = new Pending(new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously), progress);
        _pending[id] = p;
        await Send(ws, new { id, type, args });
        using var timer = new CancellationTokenSource(timeout ?? TimeSpan.FromSeconds(60));
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(timer.Token, ct);
        using var reg = linked.Token.Register(() =>
        {
            if (!_pending.TryRemove(id, out _)) return;
            _ = Send(ws, new { id, type = "cancel" }).ContinueWith(_ => { });
            p.Tcs.TrySetException(ct.IsCancellationRequested ? new OperationCanceledException() : new TimeoutException("The browser extension didn't answer in time."));
        });
        return await p.Tcs.Task;
    }
}
