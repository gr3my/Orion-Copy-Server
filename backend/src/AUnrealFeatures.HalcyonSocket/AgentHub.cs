using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;

namespace AUnrealFeatures.HalcyonSocket;

// One connected allocator agent (a game box). Newline-delimited JSON both directions.
public sealed class AgentConnection
{
    public TcpClient     Client { get; init; } = null!;
    public NetworkStream Stream { get; init; } = null!;
    public string   Box      { get; set; } = "?";
    public int      Capacity { get; set; }
    public int      Running  { get; set; }
    public DateTime LastSeen { get; set; } = DateTime.UtcNow;
    // True once the connection proved who it is: loopback peers are trusted by
    // address; remote peers must present ORION_AGENT_KEY in their hello. No
    // agent message is honored until this is set (see AgentHub.Authenticate).
    public bool Authenticated { get; set; }
    public bool IsLoopback { get; init; }

    // When this connection came up. The watchdog waits this long again before judging a server on
    // SILENCE: whatever took the agent away (a box reboot, a network blip) may have been blocking the
    // game server's heartbeats too, and the backlog of quiet that follows a reconnect is not evidence
    // that the game is wedged.
    public DateTime ConnectedAt { get; } = DateTime.UtcNow;

    private readonly object _writeLock = new();

    public int Free => Math.Max(0, Capacity - Running);

    public bool SendLine(string json)
    {
        try
        {
            var bytes = Encoding.UTF8.GetBytes(json + "\n");
            lock (_writeLock) { Stream.Write(bytes, 0, bytes.Length); Stream.Flush(); }
            return true;
        }
        catch { return false; }
    }
}

// Raw-TCP hub for allocator agents. Newline-delimited JSON, matching the
// allocator agent script (both ends are ours). See Authenticate for the handshake.
public sealed class AgentHub
{
    private readonly TcpListener _listener;
    private readonly ConcurrentDictionary<Guid, AgentConnection> _agents = new();

    // Agent wire credential. Loopback agents skip it (trusted by address); every
    // REMOTE agent must present this in its hello.key. Unset/placeholder means
    // remote agents are refused outright -- set ORION_AGENT_KEY for multi-machine
    // fleets. The value itself is never logged.
    static readonly string AgentKey = LoadAgentKey();
    static string LoadAgentKey()
    {
        var v = Environment.GetEnvironmentVariable("ORION_AGENT_KEY");
        if (string.IsNullOrWhiteSpace(v) || IsAgentPlaceholder(v)) return "";
        return v.Trim();
    }
    static bool IsAgentPlaceholder(string v)
        => v.StartsWith("CHANGE_ME", StringComparison.OrdinalIgnoreCase)
        || v.StartsWith("YOUR_", StringComparison.OrdinalIgnoreCase)
        || v.StartsWith("<FILL_ME", StringComparison.OrdinalIgnoreCase);

    static bool KeysEqual(string? presented)
    {
        if (string.IsNullOrEmpty(presented) || string.IsNullOrEmpty(AgentKey)) return false;
        var a = System.Text.Encoding.UTF8.GetBytes(presented);
        var b = System.Text.Encoding.UTF8.GetBytes(AgentKey);
        return a.Length == b.Length
            && System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(a, b);
    }

    // First-message gate. Returns true once the connection may speak.
    // Loopback: trusted by address (single-box / SSH-tunnel operation).
    // Remote: requires hello.key == ORION_AGENT_KEY (constant-time). Anything else
    // -- wrong key, missing key, unconfigured key, or any non-hello first message --
    // is rejected immediately and the connection is closed. Failures log the remote
    // address only, never key material.
    static bool Authenticate(AgentConnection conn, string remote, string line)
    {
        if (conn.Authenticated) return true;
        string type, key = "", box = "?";
        try
        {
            using var doc = JsonDocument.Parse(line);
            var root = doc.RootElement;
            type = root.TryGetProperty("type", out var t) ? t.ToString() : "";
            if (root.TryGetProperty("key", out var k)) key = k.ToString();
            if (root.TryGetProperty("box", out var b)) box = b.ToString();
        }
        catch { return false; }
        if (type != "hello") return false;
        if (conn.IsLoopback) { conn.Authenticated = true; return true; }
        if (string.IsNullOrEmpty(AgentKey))
        {
            Console.WriteLine($"[HalcyonSocket] REJECT agent '{box}' from {remote}: remote agents require ORION_AGENT_KEY, which is not configured.");
            return false;
        }
        if (!KeysEqual(key))
        {
            Console.WriteLine($"[HalcyonSocket] REJECT agent '{box}' from {remote}: bad or missing agent key.");
            return false;
        }
        conn.Authenticated = true;
        return true;
    }

    // Set by HalcyonSocketServer once the watchdog exists. Kept as callbacks so the hub stays a dumb
    // transport and every decision lives in one place (ServerWatchdog).
    public Action<string /*reqId*/, string /*pid*/, string /*status*/, string /*box*/>? OnSpunUp;
    public Action<string /*box*/,   string /*pid*/, string /*code*/>?                   OnExited;
    public Action<string /*box*/,   string /*pid*/, bool   /*alive*/>?                  OnProbeResult;

    public AgentHub(int port) => _listener = new TcpListener(AgentBindAddress(), port);

    // The agent protocol authenticates remote peers (see Authenticate); the hub
    // still binds loopback by default and the port must stay private regardless.
    // Set ORION_AGENT_BIND=0.0.0.0 (or a LAN IP) only when agents run on other hosts,
    // and firewall the port to those hosts. See docs/PORTS.md.
    static System.Net.IPAddress AgentBindAddress()
    {
        var v = (Environment.GetEnvironmentVariable("ORION_AGENT_BIND") ?? "").Trim();
        if (string.IsNullOrEmpty(v)) return System.Net.IPAddress.Loopback;
        if (v == "*" || v == "0.0.0.0") return System.Net.IPAddress.Any;
        return System.Net.IPAddress.TryParse(v, out var ip) ? ip : System.Net.IPAddress.Loopback;
    }

    public void Start()
    {
        _listener.Start();
        _ = Task.Run(AcceptLoop);
        _ = Task.Run(ReapLoop);
        Console.WriteLine($"[HalcyonSocket] agent hub listening on TCP {((IPEndPoint)_listener.LocalEndpoint).Port}");
    }

    private async Task AcceptLoop()
    {
        while (true)
        {
            TcpClient client;
            try { client = await _listener.AcceptTcpClientAsync(); }
            catch { break; }
            var remote = "?";
            bool loopback = false;
            try
            {
                var ep = client.Client.RemoteEndPoint as IPEndPoint;
                if (ep != null)
                {
                    remote = ep.Address.ToString();
                    loopback = IPAddress.IsLoopback(ep.Address);
                }
            }
            catch { }
            var conn = new AgentConnection { Client = client, Stream = client.GetStream(), IsLoopback = loopback };
            var id = Guid.NewGuid();
            _agents[id] = conn;
            _ = Task.Run(() => ClientLoop(id, conn, remote));
        }
    }

    // Inbound limits: a single protocol message must fit (legitimate agent
    // messages are small JSON lines), and the hello handshake must complete
    // quickly. Disconnect violators; agent state is cleaned up on the way out.
    const int MaxAgentMessageBytes = 64 * 1024;
    static readonly TimeSpan PreAuthTimeout = TimeSpan.FromSeconds(10);

    private async Task ClientLoop(Guid id, AgentConnection conn, string remote)
    {
        var buf = new byte[4096];
        var acc = new StringBuilder();
        // Pre-authentication deadline: a peer that has not completed the hello
        // handshake within this long is dropped. Bounds slow/incomplete opens.
        using var preAuthCts = new CancellationTokenSource(PreAuthTimeout);
        try
        {
            while (true)
            {
                int n;
                try
                {
                    var token = conn.Authenticated ? CancellationToken.None : preAuthCts.Token;
                    n = await conn.Stream.ReadAsync(buf, 0, buf.Length, token);
                }
                catch (OperationCanceledException) { break; }   // pre-auth timeout
                if (n <= 0) break;
                acc.Append(Encoding.UTF8.GetString(buf, 0, n));
                // No single protocol message may exceed the cap: drop peers that
                // stream bytes without newlines (memory-abuse guard). Legitimate
                // agent messages are small JSON lines, far below this.
                if (acc.Length > MaxAgentMessageBytes) break;
                var s = acc.ToString();
                int nl;
                while ((nl = s.IndexOf('\n')) >= 0)
                {
                    var line = s.Substring(0, nl).Trim();
                    s = s.Substring(nl + 1);
                    if (line.Length == 0) continue;
                    if (line.Length > MaxAgentMessageBytes) break;
                    // Handshake first: unauthenticated peers (and any non-hello
                    // opener) are dropped immediately, before any state changes.
                    if (!Authenticate(conn, remote, line)) break;
                    HandleAgentMessage(conn, line);
                }
                if (!conn.Authenticated) break;
                acc.Clear();
                acc.Append(s);
            }
        }
        catch { /* fallthrough to disconnect */ }

        _agents.TryRemove(id, out _);
        try { conn.Client.Close(); } catch { }
        if (conn.Authenticated)
            Console.WriteLine($"[HalcyonSocket] agent '{conn.Box}' disconnected");
        else
            Console.WriteLine($"[HalcyonSocket] rejected agent connection from {remote} closed");
    }

    private static string GetStr(JsonElement e, string k) => e.TryGetProperty(k, out var v) ? v.ToString() : "";
    private static int    GetInt(JsonElement e, string k) => e.TryGetProperty(k, out var v) && v.TryGetInt32(out var i) ? i : 0;

    private void HandleAgentMessage(AgentConnection conn, string line)
    {
        try
        {
            using var doc = JsonDocument.Parse(line);
            var root = doc.RootElement;
            var type = GetStr(root, "type");
            switch (type)
            {
                case "hello":
                    conn.Box      = GetStr(root, "box");
                    conn.Capacity = GetInt(root, "capacity");
                    conn.Running  = GetInt(root, "running");
                    conn.LastSeen = DateTime.UtcNow;
                    Console.WriteLine($"[HalcyonSocket] agent '{conn.Box}' online (cap={conn.Capacity}, running={conn.Running})");
                    break;
                case "heartbeat":
                    conn.Running  = GetInt(root, "running");
                    conn.LastSeen = DateTime.UtcNow;
                    break;
                case "spunup":
                    Console.WriteLine($"[HalcyonSocket] spunup id={GetStr(root, "id")} pid={GetStr(root, "pid")} status={GetStr(root, "status")} msg={GetStr(root, "msg")}");
                    OnSpunUp?.Invoke(GetStr(root, "id"), GetStr(root, "pid"), GetStr(root, "status"), conn.Box);
                    break;
                case "exited":
                    conn.Running = GetInt(root, "running");
                    Console.WriteLine($"[HalcyonSocket] instance exited pid={GetStr(root, "pid")} code={GetStr(root, "code")}");
                    // The agent holds the Process object, so this is not a guess about the process --
                    // it is the process telling us. The watchdog treats it as certain.
                    OnExited?.Invoke(conn.Box, GetStr(root, "pid"), GetStr(root, "code"));
                    break;
                case "probe_result":
                    OnProbeResult?.Invoke(conn.Box, GetStr(root, "pid"),
                                          root.TryGetProperty("alive", out var al) && al.ValueKind == JsonValueKind.True);
                    break;
            }
        }
        catch { /* ignore malformed */ }
    }

    // Reap agents that haven't heartbeated in 90s (the agent beats every 30s).
    private async Task ReapLoop()
    {
        while (true)
        {
            await Task.Delay(15000);
            var cutoff = DateTime.UtcNow.AddSeconds(-90);
            foreach (var kv in _agents)
            {
                if (kv.Value.LastSeen >= cutoff) continue;
                _agents.TryRemove(kv.Key, out _);
                try { kv.Value.Client.Close(); } catch { }
                Console.WriteLine($"[HalcyonSocket] reaped stale agent '{kv.Value.Box}'");
            }
        }
    }

    public IReadOnlyList<AgentConnection> Agents => _agents.Values.ToList();

    // The agent for a named box, or null when that box is not connected. The watchdog treats null as
    // "cannot verify" and refuses to act -- a missing agent means we cannot tell a dead server from a
    // dead box.
    public AgentConnection? ByBox(string box)
        => string.IsNullOrWhiteSpace(box) ? null : _agents.Values.FirstOrDefault(a => a.Box == box);

    // Ask a box whether a pid is still running. The answer comes back as "probe_result".
    public bool Probe(string box, string pid)
    {
        var a = ByBox(box);
        return a != null && a.SendLine(JsonSerializer.Serialize(new { type = "probe", pid }));
    }

    // Ask EVERY connected box about a pid. Used to find the owner of a server that heartbeats but was
    // not spun up through here (the scheduled-task one), so it can be watched properly instead of being
    // held forever for want of a box. Returns how many boxes were asked.
    public int ProbeAll(string pid)
    {
        var line = JsonSerializer.Serialize(new { type = "probe", pid });
        int n = 0;
        foreach (var a in _agents.Values) if (a.SendLine(line)) n++;
        return n;
    }

    // Force-stop a pid on a box. Used before every replacement launch: a FROZEN server is still alive
    // and still owns its game port, so launching next to it would leave two servers for one station.
    public bool Kill(string box, string pid, string reason)
    {
        var a = ByBox(box);
        return a != null && a.SendLine(JsonSerializer.Serialize(new { type = "kill", pid, reason }));
    }

    // Pick a target agent: exact box name if given (and it has free capacity), else the box with the
    // most free capacity.
    public AgentConnection? Pick(string? box)
    {
        var list = _agents.Values.ToList();
        if (!string.IsNullOrEmpty(box))
            return list.FirstOrDefault(a => a.Box == box && a.Free > 0);
        return list.Where(a => a.Free > 0).OrderByDescending(a => a.Free).FirstOrDefault();
    }
}
