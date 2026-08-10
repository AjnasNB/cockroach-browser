package cockroachbrowser

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Client struct {
	BaseURL string
	Token   string
	HTTP    *http.Client
}

func New(token string) (*Client, error) {
	if strings.TrimSpace(token) == "" { return nil, fmt.Errorf("token is required") }
	return &Client{BaseURL: "http://127.0.0.1:43110", Token: token, HTTP: &http.Client{Timeout: 60 * time.Second}}, nil
}

func (c *Client) Request(ctx context.Context, method, path string, body any, output any) error {
	if !strings.HasPrefix(path, "/") { return fmt.Errorf("path must start with /") }
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body); if err != nil { return err }
		reader = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(c.BaseURL, "/")+path, reader)
	if err != nil { return err }
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Authorization", "Bearer "+c.Token)
	if body != nil { request.Header.Set("Content-Type", "application/json") }
	response, err := c.HTTP.Do(request); if err != nil { return err }
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 64<<20)); if err != nil { return err }
	if response.StatusCode < 200 || response.StatusCode >= 300 { return fmt.Errorf("cockroach browser returned HTTP %d: %s", response.StatusCode, data) }
	if output != nil && len(data) > 0 { return json.Unmarshal(data, output) }
	return nil
}

func (c *Client) Health(ctx context.Context, output any) error { return c.Request(ctx, http.MethodGet, "/v1/health", nil, output) }
func (c *Client) Capabilities(ctx context.Context, output any) error { return c.Request(ctx, http.MethodGet, "/v1/capabilities", nil, output) }
func (c *Client) CreateSession(ctx context.Context, input, output any) error { return c.Request(ctx, http.MethodPost, "/v1/sessions", input, output) }
func (c *Client) Sessions(ctx context.Context, output any) error { return c.Request(ctx, http.MethodGet, "/v1/sessions", nil, output) }
func (c *Client) Session(ctx context.Context, id string, output any) error { return c.Request(ctx, http.MethodGet, "/v1/sessions/"+url.PathEscape(id), nil, output) }
func (c *Client) CloseSession(ctx context.Context, id string) error { return c.Request(ctx, http.MethodDelete, "/v1/sessions/"+url.PathEscape(id), nil, nil) }
func (c *Client) Act(ctx context.Context, id string, input, output any) error { return c.Request(ctx, http.MethodPost, "/v1/sessions/"+url.PathEscape(id)+"/actions", input, output) }
func (c *Client) ActBatch(ctx context.Context, id string, input, output any) error { return c.Request(ctx, http.MethodPost, "/v1/sessions/"+url.PathEscape(id)+"/actions/batch", input, output) }
func (c *Client) Snapshot(ctx context.Context, id string, input, output any) error { return c.Request(ctx, http.MethodPost, "/v1/sessions/"+url.PathEscape(id)+"/snapshot", input, output) }
