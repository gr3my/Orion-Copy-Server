using AUnrealFeatures.Ares.Servers;
using AUnrealFeatures.Hosting.Http.Interfaces;
using AUnrealFeatures.Hosting.Http.Preprocessors;
using System.Net;

namespace OrionCopyServer.Tests;

// Minimal IHttpRequest stub: headers + remote socket address + method/uri.
// Everything the guard reads, nothing it doesn't need.
sealed class FakeRequest : IHttpRequest
{
    readonly Dictionary<string, string> _headers;

    public FakeRequest(string method, string uri, IPAddress remote,
        Dictionary<string, string>? headers = null)
    {
        Method = new HttpMethod(method);
        Uri = uri;
        Remote = remote;
        Origin = IPAddress.Loopback;
        _headers = new Dictionary<string, string>(headers ?? new(), StringComparer.OrdinalIgnoreCase);
    }

    public string? GetQueryParameter(string key, string? defaultValue = null)
        => Queries.TryGetValue(key, out var v) ? v : defaultValue;

    public string? GetHeaderValue(string key, string? defaultValue = null)
        => Headers.TryGetValue(key, out var v) ? v : defaultValue;

    public HttpMethod Method { get; }
    public string Host => "127.0.0.1";
    public string RequestId => "test";
    public string Uri { get; }
    public Dictionary<string, string> Headers => _headers;
    public Dictionary<string, string> Queries { get; } = new();
    public byte[] Body => Array.Empty<byte>();
    public Dictionary<string, object> JsonBody => new();
    public Dictionary<string, string> FormBody => new();
    public IPAddress Remote { get; }
    public IPAddress Origin { get; }
}
