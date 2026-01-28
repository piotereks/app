Proxy worker

This small worker forwards requests to a target URL passed as the `url` query parameter and returns the target response.

Usage

- Request format: `GET /?url=https://example.com/path`
- Example using curl:

  curl -s "https://your-host/proxy/?url=https://example.com/api/data"

Behavior & headers

- If `url` is missing, the worker returns 400 with message `Missing url param`.
- The worker sets the following response headers:
  - `Content-Type: application/json` (the worker always sets JSON content type)
  - `Access-Control-Allow-Origin: *` (CORS enabled)
  - `Cache-Control: no-store`

Notes

- The implementation is Cloudflare Worker-style (exports an object with an `async fetch` handler) and is located at `index.js` in this folder.
- If you plan to deploy to Cloudflare, consider adding a `wrangler.toml` and configuring any secrets or routing you need.
- The worker sets a `User-Agent` header when fetching the target.

Security

- Make sure to validate or restrict the allowed target hosts if you deploy this publicly to avoid misuse.

Examples

- JavaScript fetch example:

  fetch("/proxy/?url=https://example.com/api/data")
    .then(r => r.json())
    .then(console.log)

That's it — adjust the worker to your needs (content-type handling, allowed hosts, caching) before public deployment.