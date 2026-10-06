using AUnrealFeatures.Hosting.Http.Actions;
using AUnrealFeatures.Hosting.Http.Interfaces;
using AUnrealFeatures.Hosting.Http.Preprocessors;
using System;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

namespace AUnrealFeatures.Ares.Servers
{
    // Gates the station API on :78. Without this, anyone who can reach :78 could
    // delete stations and deployments (which also kills their servers), grant
    // themselves roles, ban users and rewrite station config. Keep :78 off the
    // public internet (see docs/PORTS.md).
    //
    // The rule: a request from OUTSIDE may read (GET), may log in, and may make
    // the game's own reporting calls; every other write needs the dashboard admin
    // key (x-dashboard-key). Requests from this machine are the game servers and
    // local tooling (DashboardApiUrl=http://127.0.0.1:78) and pass untouched, so
    // nothing a running server does changes. The dashboard's /game proxy verifies
    // its session cookie and attaches the admin key (dashboard/app/game).
    //
    // PROXY MARKER: the public reverse proxy connects to StationDb over loopback,
    // which would otherwise look "internal". Caddy therefore stamps public traffic
    // with X-Orion-Public-Proxy: 1 (see deploy/Caddyfile.example), and any request
    // carrying that marker is ALWAYS treated as external -- but only when the
    // immediate socket peer is loopback. A direct remote client sending the header
    // itself gains nothing: remote is already external, and the marker is ignored.
    // STATION_GUARD_ENFORCE=0 turns it into log-only.
    public sealed class StationApiGuard : IHttpRequestPreprocessor
    {
        public static bool Enforce = (Environment.GetEnvironmentVariable("STATION_GUARD_ENFORCE") ?? "1") != "0";

        // Value Caddy sets on requests arriving via the PUBLIC proxy host.
        // Compared exactly; anything else (including absent) means "not proxied".
        const string PublicProxyHeader = "X-Orion-Public-Proxy";
        const string PublicProxyValue  = "1";

        // writes anyone may make: players logging in, servers reporting, event sign-ups (and routes with their own key)
        static readonly Regex OpenWrites = new(
            @"^/(users/log_in|users/log_in_with_key|users/log_in_server|v1/users/log_in_with_key|v2/users/log_in|" +
            @"server_heartbeat|update_player_count|register_server|stations/create|v1/board/upload|" +
            @"deployments/[^/]+/server_events|v1/spec/.*|" +
            @"v1/stations/[^/]+/event/[^/]+/users/[^/]+/signup|v1/stations/[^/]+/event/[^/]+/signup)/?$",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        public Task<HttpPreprocessorContainer> TryPreprocessRequest(IHttpRequest request, IHttpResponse response)
        {
            var method = request.Method.Method.ToUpperInvariant();
            if (method == "GET" || method == "HEAD" || method == "OPTIONS") return Ok();
            var path = (request.Uri ?? "").Split('?')[0];
            if (!path.StartsWith("/")) path = "/" + path;
            if (OpenWrites.IsMatch(path)) return Ok();
            if (!IsExternal(request)) return Ok();
            if (HasAdminKey(request)) return Ok();

            var who = request.Remote?.ToString() ?? "?";
            Console.WriteLine($"[STATION-GUARD] {(Enforce ? "401" : "would-401")} {method} {path} from {who}");
            if (!Enforce) return Ok();
            return Task.FromResult(new HttpPreprocessorContainer
            {
                result = HttpPreprocessorResult.FAIL | HttpPreprocessorResult.STOP_AFTER,
                actionResult = Results.Configurable(HttpStatusCode.Unauthorized, "application/json", "{\"error\":\"unauthorized\"}")
            });
        }

        // External = must present the admin key for non-open writes. A request is
        // external when it arrives on a non-loopback socket, carries a trusted
        // proxy indicator, or carries the public-proxy marker on a loopback socket
        // (i.e. it came through the public reverse proxy, which dials us locally).
        // The marker is ONLY honored on loopback sockets: a remote client sending
        // X-Orion-Public-Proxy itself is already external, and the marker grants it
        // nothing. Forwarding headers (CF-*/X-Real-IP/X-Forwarded-For) are treated
        // as external indicators only -- they can never make a request internal.
        internal static bool IsExternal(IHttpRequest req)
        {
            if (!string.IsNullOrEmpty(req.GetHeaderValue("CF-Connecting-IP")) || !string.IsNullOrEmpty(req.GetHeaderValue("CF-Ray")))
                return true;                                   // arrived via a forwarding proxy
            var ip = req.Remote;
            var loopback = ip != null && IPAddress.IsLoopback(ip.IsIPv4MappedToIPv6 ? ip.MapToIPv4() : ip);
            if (!loopback) return true;                        // direct remote client
            // Loopback socket: internal UNLESS the local reverse proxy stamped it
            // as public traffic. Exact match only.
            var marker = req.GetHeaderValue(PublicProxyHeader);
            return marker != null && string.Equals(marker.Trim(), PublicProxyValue, StringComparison.Ordinal);
        }

        // Exposed for unit tests (see StationApiGuardTests).
        internal static bool IsPublicProxyMarked(IHttpRequest req)
            => string.Equals((req.GetHeaderValue(PublicProxyHeader) ?? "").Trim(),
                PublicProxyValue, StringComparison.Ordinal);

        static bool HasAdminKey(IHttpRequest req)
        {
            var k = req.GetHeaderValue("x-dashboard-key") ?? "";
            var want = DashboardAuthPreprocessor.AdminKeyForDisplay;
            if (string.IsNullOrEmpty(k) || string.IsNullOrEmpty(want)) return false;
            var a = Encoding.UTF8.GetBytes(k);
            var b = Encoding.UTF8.GetBytes(want);
            return a.Length == b.Length && CryptographicOperations.FixedTimeEquals(a, b);
        }

        static Task<HttpPreprocessorContainer> Ok()
            => Task.FromResult(new HttpPreprocessorContainer { result = HttpPreprocessorResult.OK });
    }
}
