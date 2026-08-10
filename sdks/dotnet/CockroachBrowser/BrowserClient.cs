using System.Net.Http.Headers;
using System.Text;

namespace CockroachBrowser;

public sealed class BrowserClient : IDisposable
{
    private readonly HttpClient _http;

    public BrowserClient(string token, string baseUrl = "http://127.0.0.1:43110", TimeSpan? timeout = null)
    {
        if (string.IsNullOrWhiteSpace(token)) throw new ArgumentException("token is required", nameof(token));
        _http = new HttpClient { BaseAddress = new Uri(baseUrl.TrimEnd('/') + "/"), Timeout = timeout ?? TimeSpan.FromSeconds(60) };
        _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        _http.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
    }

    public async Task<string> RequestAsync(HttpMethod method, string path, string? json = null, CancellationToken cancellationToken = default)
    {
        if (!path.StartsWith('/')) throw new ArgumentException("path must start with /", nameof(path));
        using var request = new HttpRequestMessage(method, path.TrimStart('/'));
        if (json is not null) request.Content = new StringContent(json, Encoding.UTF8, "application/json");
        using var response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode) throw new HttpRequestException($"Cockroach Browser returned HTTP {(int)response.StatusCode}: {body}");
        return body;
    }

    public Task<string> HealthAsync(CancellationToken token = default) => RequestAsync(HttpMethod.Get, "/v1/health", null, token);
    public Task<string> CapabilitiesAsync(CancellationToken token = default) => RequestAsync(HttpMethod.Get, "/v1/capabilities", null, token);
    public Task<string> CreateSessionAsync(string json, CancellationToken token = default) => RequestAsync(HttpMethod.Post, "/v1/sessions", json, token);
    public Task<string> SessionsAsync(CancellationToken token = default) => RequestAsync(HttpMethod.Get, "/v1/sessions", null, token);
    public Task<string> SessionAsync(string id, CancellationToken token = default) => RequestAsync(HttpMethod.Get, $"/v1/sessions/{Uri.EscapeDataString(id)}", null, token);
    public Task<string> CloseSessionAsync(string id, CancellationToken token = default) => RequestAsync(HttpMethod.Delete, $"/v1/sessions/{Uri.EscapeDataString(id)}", null, token);
    public Task<string> ActAsync(string id, string json, CancellationToken token = default) => RequestAsync(HttpMethod.Post, $"/v1/sessions/{Uri.EscapeDataString(id)}/actions", json, token);
    public Task<string> ActBatchAsync(string id, string json, CancellationToken token = default) => RequestAsync(HttpMethod.Post, $"/v1/sessions/{Uri.EscapeDataString(id)}/actions/batch", json, token);
    public Task<string> SnapshotAsync(string id, string json = "{}", CancellationToken token = default) => RequestAsync(HttpMethod.Post, $"/v1/sessions/{Uri.EscapeDataString(id)}/snapshot", json, token);
    public void Dispose() => _http.Dispose();
}

