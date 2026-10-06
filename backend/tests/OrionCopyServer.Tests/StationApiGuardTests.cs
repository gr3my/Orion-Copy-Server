using AUnrealFeatures.Ares.Servers;
using AUnrealFeatures.Hosting.Http.Actions;
using AUnrealFeatures.Hosting.Http.Interfaces;
using AUnrealFeatures.Hosting.Http.Preprocessors;
using System.Net;
using Xunit;

namespace OrionCopyServer.Tests;

// StationApiGuard classification contract: public Internet traffic arriving via
// the local reverse proxy must NEVER look like trusted localhost traffic just
// because Caddy dials StationDb over 127.0.0.1.
public sealed class StationApiGuardTests
{
    static StationApiGuardTests()
    {
        // Fixed dashboard key for the auth cases below. Set before the backend
        // statics initialize (xunit runs one assembly in one process, and this
        // static ctor runs before any test in this class touches them).
        Environment.SetEnvironmentVariable("ORION_DASHBOARD_ADMIN_KEY",
            "test-only-dashboard-admin-key-0123456789");
    }

    static FakeRequest Req(string method, string path, IPAddress remote,
        Dictionary<string, string>? headers = null)
        => new(method, path, remote, headers);

    static readonly IPAddress Loopback = IPAddress.Loopback;
    static readonly IPAddress Public = IPAddress.Parse("203.0.113.7");

    const string MutationPath = "/stations/abc/users/u1/roles/r1";

    // CASE 1: loopback, no marker -> internal.
    [Fact]
    public void LoopbackWithoutMarker_IsInternal()
    {
        Assert.False(StationApiGuard.IsExternal(Req("POST", MutationPath, Loopback)));
    }

    // CASE 2: loopback + marker -> EXTERNAL (public Caddy traffic).
    [Fact]
    public void LoopbackWithMarker_IsExternal()
    {
        var req = Req("POST", MutationPath, Loopback,
            new() { ["X-Orion-Public-Proxy"] = "1" });
        Assert.True(StationApiGuard.IsExternal(req));
    }

    // CASE 3: remote + marker -> external, marker grants nothing special.
    [Fact]
    public void RemoteWithMarker_IsExternal()
    {
        var withMarker = Req("POST", MutationPath, Public,
            new() { ["X-Orion-Public-Proxy"] = "1" });
        var withoutMarker = Req("POST", MutationPath, Public);
        Assert.True(StationApiGuard.IsExternal(withMarker));
        Assert.True(StationApiGuard.IsExternal(withoutMarker));
    }

    // CASE 4: remote, no marker -> external.
    [Fact]
    public void RemoteWithoutMarker_IsExternal()
    {
        Assert.True(StationApiGuard.IsExternal(Req("POST", MutationPath, Public)));
    }

    // CASE 5: Caddy public request (loopback + marker) to a protected mutation
    // route without credentials -> rejected.
    [Fact]
    public async Task PublicProxiedMutationWithoutKey_IsRejected()
    {
        var guard = new StationApiGuard();
        var req = Req("DELETE", "/stations/abc", Loopback,
            new() { ["X-Orion-Public-Proxy"] = "1" });
        var res = await guard.TryPreprocessRequest(req, new FakeResponse());
        Assert.True(res.result.HasFlag(HttpPreprocessorResult.STOP_AFTER));
    }

    // CASE 6: same request with the valid admin key -> authorized.
    [Fact]
    public async Task PublicProxiedMutationWithKey_IsAllowed()
    {
        var guard = new StationApiGuard();
        var req = Req("DELETE", "/stations/abc", Loopback,
            new()
            {
                ["X-Orion-Public-Proxy"] = "1",
                ["x-dashboard-key"] = "test-only-dashboard-admin-key-0123456789",
            });
        var res = await guard.TryPreprocessRequest(req, new FakeResponse());
        Assert.False(res.result.HasFlag(HttpPreprocessorResult.STOP_AFTER));
    }

    // CASE 7: direct internal game-server flow (loopback, no marker, no key)
    // on a non-open mutation route -> preserved (allowed, as before).
    [Fact]
    public async Task DirectInternalMutation_IsAllowed()
    {
        var guard = new StationApiGuard();
        var req = Req("POST", MutationPath, Loopback);
        var res = await guard.TryPreprocessRequest(req, new FakeResponse());
        Assert.False(res.result.HasFlag(HttpPreprocessorResult.STOP_AFTER));
    }

    // Marker value must match exactly; lookalikes don't count.
    [Theory]
    [InlineData("0")]
    [InlineData("true")]
    [InlineData(" 1 ")]
    [InlineData("")]
    public void MarkerValueMustMatchExactly(string value)
    {
        // " 1 " trims to "1" -> external; everything else on loopback stays internal.
        var req = Req("POST", MutationPath, Loopback,
            new() { ["X-Orion-Public-Proxy"] = value });
        Assert.Equal(value.Trim() == "1", StationApiGuard.IsExternal(req));
    }
}
