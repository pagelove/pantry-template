# Pantry

Kitchen inventory and a shopping list.

[Hosted sample](https://some-derby-0862.onpagelove.com/pantry-demo/) · [Design notes](DESIGN.md)

Track quantities, low-stock thresholds, restock targets, locations, and optional best-before dates. The shopping list is derived from low stock. Dates are inventory reminders. Data lives in `#pantry-items`; every write uses a strong ETag and preserves entered values on a conflict.

## Run locally

Use Python 3.10 or later:

```sh
python -m venv .venv
# Activate the environment for your shell, then:
python -m pip install -r requirements-preview.txt
python preview.py
```

Open [the local app](http://127.0.0.1:8787/pantry-demo/). The server binds to loopback only. Use `--port 8788` if the default port is occupied. Changes are saved in `.preview-state/`, which Git ignores. Use `--state-dir .preview-state/fresh` for a separate sample session.

The preview implements the selector reads/writes these screens need, including stale ETag rejection. It does not implement Pagelove authorization, schemas, uniqueness, or other server-side policy. A static file server can display the UI but cannot save records.

## Install from the Pagelove console

Pantry is in the console's template catalogue. Open an empty host in the console, choose Pantry and select Add template. The console copies the contents of `site/` to the host root.

`pagelove.html` describes the template to the console. It is never installed.

## Deploy to Pagelove by hand

`site/` is the complete deployment directory. Upload **its contents** to the root of a new Pagelove host, preserving `pantry-demo/` and `assets/`. The root page redirects to `/pantry-demo/`.

1. Get the host's exact WebDAV URL from the Pagelove console.
2. Authenticate to the console and WebDAV with `Authorization: Bearer <your console API key>`. Keep the key outside the repository.
3. List the destination with a read-only `PROPFIND` using `Depth: 1`; `207 Multi-Status` is success.
4. Create missing collections with `MKCOL`, upload assets first, then the app files with WebDAV `PUT`. Upload the root landing page last.
5. Read back the uploaded files and check the application through the separate public hostname.

Use a fresh host or back up existing documents first. The HTML contains both the app and seed records: replacing it can overwrite live data. When updating an existing installation, preserve its records. If you change the app route, update **all** rule resource paths and record-key prefixes together. Keep file paths and schema constraints consistent.

## Development checks

Use Node.js 22.12 or later and Bun 1.4.2 or later:

```sh
bun install --frozen-lockfile
bun run test
```

Tests use an isolated DOM and mocked HTTP responses. They cover browser behavior and data handling, not live Pagelove permission enforcement. Before a production deployment, verify the actual provider's authorization, schema rejection, uniqueness, and concurrency behavior.

See [publication review](REVIEW.md) for the checks completed on this package.

## September 29 polish

44px stock actions, 16px mobile search text, a two-column filter grid and single-column item forms on narrow phones.

The bundled app preserves its established design and data contract. The hosted sample link identifies the existing demo; publication of this repository does not redeploy that host.

## Assets and sample data

Fonts and artwork are bundled locally; see [asset provenance and licenses](ASSETS.md). Records are fictional examples. This is a public sample app: do not enter private household, contact, client, or payment information.
