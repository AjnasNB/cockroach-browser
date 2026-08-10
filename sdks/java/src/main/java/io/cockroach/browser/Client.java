package io.cockroach.browser;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

public final class Client {
  private final URI baseUri;
  private final String token;
  private final Duration timeout;
  private final HttpClient http;

  public Client(String token) { this("http://127.0.0.1:43110", token, Duration.ofSeconds(60)); }

  public Client(String baseUrl, String token, Duration timeout) {
    if (token == null || token.isBlank()) throw new IllegalArgumentException("token is required");
    this.baseUri = URI.create(baseUrl.replaceAll("/+$", "") + "/");
    this.token = token;
    this.timeout = timeout;
    this.http = HttpClient.newBuilder().connectTimeout(timeout).build();
  }

  public String request(String method, String path, String jsonBody) throws IOException, InterruptedException {
    if (!path.startsWith("/")) throw new IllegalArgumentException("path must start with /");
    HttpRequest.BodyPublisher body = jsonBody == null
      ? HttpRequest.BodyPublishers.noBody()
      : HttpRequest.BodyPublishers.ofString(jsonBody, StandardCharsets.UTF_8);
    HttpRequest.Builder builder = HttpRequest.newBuilder(baseUri.resolve(path.substring(1)))
      .timeout(timeout).header("Accept", "application/json").header("Authorization", "Bearer " + token)
      .method(method, body);
    if (jsonBody != null) builder.header("Content-Type", "application/json");
    HttpResponse<String> response = http.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    if (response.statusCode() < 200 || response.statusCode() >= 300) {
      throw new IOException("Cockroach Browser returned HTTP " + response.statusCode() + ": " + response.body());
    }
    return response.body();
  }

  public String health() throws IOException, InterruptedException { return request("GET", "/v1/health", null); }
  public String capabilities() throws IOException, InterruptedException { return request("GET", "/v1/capabilities", null); }
  public String createSession(String json) throws IOException, InterruptedException { return request("POST", "/v1/sessions", json); }
  public String sessions() throws IOException, InterruptedException { return request("GET", "/v1/sessions", null); }
  public String session(String id) throws IOException, InterruptedException { return request("GET", "/v1/sessions/" + encode(id), null); }
  public String closeSession(String id) throws IOException, InterruptedException { return request("DELETE", "/v1/sessions/" + encode(id), null); }
  public String act(String id, String json) throws IOException, InterruptedException { return request("POST", "/v1/sessions/" + encode(id) + "/actions", json); }
  public String actBatch(String id, String json) throws IOException, InterruptedException { return request("POST", "/v1/sessions/" + encode(id) + "/actions/batch", json); }
  public String snapshot(String id, String json) throws IOException, InterruptedException { return request("POST", "/v1/sessions/" + encode(id) + "/snapshot", json); }

  private static String encode(String value) { return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20"); }
}

