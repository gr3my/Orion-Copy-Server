using AUnrealFeatures.Hosting.Http.Interfaces;
using System.Net;
using System.Text;

namespace OrionCopyServer.Tests;

// Throwaway response stub: the guard only reads the request, never the response.
sealed class FakeResponse : IHttpResponse
{
    public HttpStatusCode StatusCode { get; set; } = HttpStatusCode.OK;
    public string ContentType { get; set; } = "";
    public byte[] Content { get; set; } = Array.Empty<byte>();
    public Dictionary<string, string> Headers { get; } = new();

    public void ApplyToHttpListenerResponse(IHttpActionResult httpActionResult) { }
    public void SetHeader(string key, string value) { }
    public void RemoveHeader(string key) { }
    public void SetCookie(Cookie cookie) { }
    public void Redirect(string url) { }
    public void SetContentString(string content, Encoding? encoding = null) { }
    public Task WriteContentAsync(Stream stream) => Task.CompletedTask;
    public void SetJsonContent(object obj) { }
    public void SetXmlContent(object obj) { }
    public void EnableCors(string origin = "*", string methods = "GET,POST,PUT,DELETE,OPTIONS", string headers = "*") { }
    public void SetContentDisposition(string fileName, bool inline = false) { }
    public void SetCacheControl(int maxAgeSeconds) { }
}
