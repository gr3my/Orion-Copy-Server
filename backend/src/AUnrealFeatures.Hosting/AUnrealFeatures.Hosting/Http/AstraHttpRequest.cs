using AUnrealFeatures.Hosting.Http.Interfaces;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.IO;
using System.Text.Json;
using System.Web;

namespace AUnrealFeatures.Hosting.Http
{
    public sealed class AstraHttpRequest : IHttpRequest
    {
        private readonly HttpListenerRequest _request;

        private byte[]? _body;
        private Dictionary<string, object>? _jsonBody;
        private Dictionary<string, string>? _formBody;

        private AstraHttpRequest(HttpListenerRequest request)
        {
            _request = request;
        }

        public static IHttpRequest New(HttpListenerRequest httpListenerRequest)
            => new AstraHttpRequest(httpListenerRequest);

        public string? GetHeaderValue(string key, [Optional] string? defaultValue) => Headers.TryGetValue(key, out var value) ? value : defaultValue;
        public string? GetQueryParameter(string key, [Optional] string? defaultValue) => Queries.TryGetValue(key, out var value) ? value : defaultValue;

        private HttpMethod _method;
        public HttpMethod Method
        {
            get
            {
                if (_method == null)
                    _method = new HttpMethod(_request.HttpMethod);
                return _method;
            }
        }

        public string Host => _request.Url?.Host ?? "";
        public string RequestId => _request.RequestTraceIdentifier.ToString();
        // Some clients build URLs as "{base}/{route}" where base already ends in '/',
        // producing a doubled leading slash (e.g. the A2 Mothership "//v2/player/...").
        // The route table stores single-slash paths, so collapse runs of '/' before
        // matching, otherwise the request 404s and the client reports an auth failure.
        public string Uri => CollapseSlashes(_request.Url?.AbsolutePath ?? "/");

        private static string CollapseSlashes(string path)
        {
            if (string.IsNullOrEmpty(path) || path.IndexOf("//", StringComparison.Ordinal) < 0)
                return path;
            var sb = new StringBuilder(path.Length);
            var prevSlash = false;
            foreach (var c in path)
            {
                if (c == '/')
                {
                    if (prevSlash) continue;
                    prevSlash = true;
                }
                else prevSlash = false;
                sb.Append(c);
            }
            return sb.ToString();
        }

        // HTTP header names are case-insensitive (RFC 7230 §3.2). Proxies
        // normalize header names, so a case-sensitive lookup can miss and return 401
        // even when the right header is present. Build the dict with OrdinalIgnoreCase
        // so lookups always work. Duplicate/case-variant and keyless entries are folded
        // defensively instead of throwing.
        public Dictionary<string, string> Headers
        {
            get
            {
                var dict = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                foreach (var k in _request.Headers.AllKeys)
                {
                    if (string.IsNullOrEmpty(k)) continue;
                    try { dict[k] = _request.Headers[k] ?? ""; } catch { /* keep first */ }
                }
                return dict;
            }
        }
        public Dictionary<string, string> Queries
        {
            get
            {
                var dict = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                foreach (var k in _request.QueryString.AllKeys)
                {
                    if (string.IsNullOrEmpty(k)) continue;
                    try { dict[k] = _request.QueryString[k] ?? ""; } catch { /* keep first */ }
                }
                return dict;
            }
        }

        public byte[] Body
        {
            get
            {
                if (_body == null)
                {
                    using var ms = new MemoryStream();
                    _request.InputStream.CopyTo(ms);
                    _body = ms.ToArray();
                }
                return _body;
            }
        }

        public Dictionary<string, object> JsonBody
        {
            get
            {
                if (_jsonBody == null)
                {
                    // A missing Content-Type must not crash the backend: treat as non-JSON.
                    if ((_request.ContentType ?? "").StartsWith("application/json", StringComparison.OrdinalIgnoreCase))
                    {
                        _jsonBody = JsonSerializer.Deserialize<Dictionary<string, object>>(Body) ?? new Dictionary<string, object>();
                    }
                    else throw new InvalidOperationException("The request body is not in JSON format.");
                }
                return _jsonBody;
            }
        }

        public Dictionary<string, string> FormBody
        {
            get
            {
                if (_formBody == null)
                {
                    if ((_request.ContentType ?? "").StartsWith("application/x-www-form-urlencoded", StringComparison.OrdinalIgnoreCase))
                    {
                        var parsed = HttpUtility.ParseQueryString(Encoding.UTF8.GetString(Body));
                        var dict = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                        foreach (var k in parsed.AllKeys)
                        {
                            if (string.IsNullOrEmpty(k)) continue;
                            dict[k] = parsed[k] ?? "";
                        }
                        _formBody = dict;
                    }
                    else throw new InvalidOperationException("The request body is not in URL-encoded format.");
                }
                return _formBody;
            }
        }

        public IPAddress Remote
        {
            get
            {
                // Proxy forwarding headers are only honored when the operator explicitly
                // trusts the reverse proxy (ORION_TRUST_PROXY_HEADERS=true). Otherwise the
                // actual socket address is used, so a direct client cannot spoof its IP
                // (which gating decisions depend on). Enable only behind a trusted proxy.
                if (TrustProxyHeaders())
                {
                    if (Headers.TryGetValue("Cf-Connecting-Ip", out var cf)
                        && IPAddress.TryParse(cf?.Trim(), out var cfIp)) return cfIp;
                    if (Headers.TryGetValue("X-Real-Ip", out var xr)
                        && IPAddress.TryParse(xr?.Trim(), out var xrIp)) return xrIp;
                    var fwd = Headers.TryGetValue("X-Forwarded-For", out var xff) ? xff : null;
                    var first = fwd?.Split(',').Select(s => s.Trim()).FirstOrDefault(s => s.Length > 0);
                    if (first != null && IPAddress.TryParse(first, out var fwdIp)) return fwdIp;
                }
                return _request.RemoteEndPoint?.Address ?? IPAddress.Loopback;
            }
        }

        static bool TrustProxyHeaders()
            => (Environment.GetEnvironmentVariable("ORION_TRUST_PROXY_HEADERS") ?? "")
                is "1" or "true" or "TRUE" or "yes";

        public IPAddress Origin => _request.LocalEndPoint?.Address ?? IPAddress.Loopback;
    }
}