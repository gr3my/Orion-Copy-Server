using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace AUnrealFeatures.EOSSDK;

// Voice (RTC) room tokens for an external RTC provider. All values come from the
// environment so no provider credentials are baked into the source. When the RTC
// provider is not configured, room issuance refuses (fail safe) instead of
// minting tokens against a placeholder.
internal static class RtcHelper
{
    static string Env(string name)
    {
        var v = Environment.GetEnvironmentVariable(name);
        return string.IsNullOrWhiteSpace(v) ? "" : v.Trim();
    }

    static bool IsPlaceholder(string v)
        => v.StartsWith("CHANGE_ME", StringComparison.OrdinalIgnoreCase)
        || v.StartsWith("YOUR_", StringComparison.OrdinalIgnoreCase);

    static string ApiKey    => Env("ORION_RTC_API_KEY");
    static string ApiSecret => Env("ORION_RTC_SECRET");
    internal static string ServerUrl => Env("ORION_RTC_URL");

    internal static bool Configured
    {
        get
        {
            return !string.IsNullOrEmpty(ApiKey) && !IsPlaceholder(ApiKey)
                && !string.IsNullOrEmpty(ApiSecret) && !IsPlaceholder(ApiSecret)
                && !string.IsNullOrEmpty(ServerUrl) && !IsPlaceholder(ServerUrl);
        }
    }

    internal static string RoomName(string lobbyId) => $"lobby-{lobbyId}";

    internal static string MakeToken(string roomName, string puid)
    {
        if (!Configured)
            throw new InvalidOperationException("RTC is not configured (set ORION_RTC_URL / ORION_RTC_API_KEY / ORION_RTC_SECRET).");
        var header  = B64Url("{\"alg\":\"HS256\",\"typ\":\"JWT\"}");
        var exp     = DateTimeOffset.UtcNow.AddHours(6).ToUnixTimeSeconds();
        var nbf     = DateTimeOffset.UtcNow.AddSeconds(-1).ToUnixTimeSeconds();
        var payload = B64Url(JsonSerializer.Serialize(new
        {
            iss   = ApiKey,
            sub   = puid,
            jti   = puid,
            exp,
            nbf,
            video = new { room = roomName, roomJoin = true, canPublish = true, canSubscribe = true }
        }));
        var sig = B64Url(HmacSha256Bytes($"{header}.{payload}", ApiSecret));
        return $"{header}.{payload}.{sig}";
    }

    static string B64Url(string s) => B64Url(Encoding.UTF8.GetBytes(s));
    static string B64Url(byte[] b) => Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    static byte[] HmacSha256Bytes(string data, string key)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(key));
        return hmac.ComputeHash(Encoding.UTF8.GetBytes(data));
    }
}
