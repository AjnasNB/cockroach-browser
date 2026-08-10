require "json"
require "net/http"
require "uri"

module CockroachBrowser
  class Error < StandardError
    attr_reader :status, :body
    def initialize(status, body)
      @status = status
      @body = body
      super("Cockroach Browser returned HTTP #{status}: #{body}")
    end
  end

  class Client
    def initialize(token:, base_url: "http://127.0.0.1:43110", timeout: 60)
      raise ArgumentError, "token is required" if token.to_s.empty?
      @token = token
      @base_url = base_url.sub(%r{/+$}, "")
      @timeout = timeout
    end

    def request(method, path, body = nil)
      raise ArgumentError, "path must start with /" unless path.start_with?("/")
      uri = URI(@base_url + path)
      request_class = { "GET" => Net::HTTP::Get, "POST" => Net::HTTP::Post, "DELETE" => Net::HTTP::Delete }.fetch(method)
      request = request_class.new(uri)
      request["Accept"] = "application/json"
      request["Authorization"] = "Bearer #{@token}"
      unless body.nil?
        request["Content-Type"] = "application/json"
        request.body = JSON.generate(body)
      end
      response = Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == "https", open_timeout: @timeout, read_timeout: @timeout) { |http| http.request(request) }
      raise Error.new(response.code.to_i, response.body) unless response.is_a?(Net::HTTPSuccess)
      response.body.to_s.empty? ? nil : JSON.parse(response.body)
    end

    def health = request("GET", "/v1/health")
    def capabilities = request("GET", "/v1/capabilities").fetch("capabilities")
    def create_session(session) = request("POST", "/v1/sessions", session)
    def sessions = request("GET", "/v1/sessions").fetch("sessions")
    def session(id) = request("GET", "/v1/sessions/#{escape(id)}")
    def close_session(id) = request("DELETE", "/v1/sessions/#{escape(id)}")
    def act(id, action) = request("POST", "/v1/sessions/#{escape(id)}/actions", action)
    def act_batch(id, batch) = request("POST", "/v1/sessions/#{escape(id)}/actions/batch", batch)
    def snapshot(id, tab_id: nil) = request("POST", "/v1/sessions/#{escape(id)}/snapshot", { tabId: tab_id })

    private

    def escape(value) = URI.encode_www_form_component(value).gsub("+", "%20")
  end
end

