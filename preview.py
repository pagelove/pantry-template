#!/usr/bin/env python3
"""Loopback-only preview of the three template apps, with local sample writes.

This adapter is not Pagelove. It implements the DOM operations used by these
apps so their interface can be exercised without deploying or touching users.
It does not prove remote authorization, schemas, transitions, or OIDC behavior.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from bs4 import BeautifulSoup

for extension, mime in ((".woff", "font/woff"), (".woff2", "font/woff2"), (".webp", "image/webp")):
    mimetypes.add_type(mime, extension)

ROOT = Path(__file__).resolve().parent / "site"
PROJECT = ROOT
APPS = {"pantry-demo": ("pantry-demo", ('pantry-items',))}
SHARED_ASSETS = {'pantry-ingredients.webp', 'SourceSerif4-Variable.woff', 'Manrope-Variable.woff2'}
LOCK = threading.RLock()


def soup(text):
    return BeautifulSoup(text, "html.parser")


def digest(text):
    return '"' + hashlib.sha256(text.encode()).hexdigest() + '"'


class Handler(BaseHTTPRequestHandler):
    server_version = "PageloveLocalPreview/1"

    def log_message(self, fmt, *args):
        # Requests contain sample data only; never log request bodies/headers.
        print(fmt % args, flush=True)

    def send(self, status, content=b"", kind="text/html; charset=utf-8", etag=None):
        if isinstance(content, str):
            content = content.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Pagelove-Preview", "local")
        self.send_header("X-Content-Type-Options", "nosniff")
        if etag:
            self.send_header("ETag", etag)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(content)

    def route(self):
        path = urlsplit(self.path).path
        parts = path.strip("/").split("/")
        if parts[0] not in APPS:
            return None
        app, roots = APPS[parts[0]]
        leaf = "/".join(parts[1:]) or "index.html"
        if leaf not in ("index.html", "app.js", "styles.css", "no-script.css", "model.js", "invoice-math.js", "favicon.svg", "SourceSerif4-Variable.woff"):
            return None
        return parts[0], ROOT / app / leaf, roots

    def document(self, route):
        slug, file, roots = route
        doc = soup(file.read_text(encoding="utf-8"))
        statefile = self.server.state_dir / (slug + ".json")
        if statefile.exists():
            state = json.loads(statefile.read_text(encoding="utf-8"))
            for root in roots:
                if root in state and doc.find(id=root):
                    fresh = soup(state[root]).find(id=root)
                    doc.find(id=root).replace_with(fresh)
        # CRM's real host renders these Sessel stamps. Only these known demo
        # counts are emulated locally; arbitrary server expressions never run.
        if slug == "crm-demo":
            counts = {
                "peoplecount": len(doc.select("#people > li")),
                "logcount": len(doc.select("#log > li")),
                "overduecount": sum(float(x.get("content", 0)) < time.time()
                                    for x in doc.select('#people [itemprop="dueEpoch"]')),
            }
            for stamp in doc.find_all("p:stamp"):
                for name, value in counts.items():
                    if name in stamp.attrs:
                        stamp.string = str(value)
        return doc

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        path = urlsplit(self.path).path
        if path in ("", "/"):
            return self.send(200, (ROOT / "index.html").read_bytes())
        if path.startswith("/crm/"):
            return self.send(401, "<h1>Private CRM</h1><p>This local preview does not simulate an authenticated owner session.</p><a href='/'>Back to demos</a>")
        if path in ("/assets/SourceSerif4-Variable.woff", "/favicon.svg"):
            file = PROJECT / path.lstrip("/")
            return self.send(200, file.read_bytes(), mimetypes.guess_type(file)[0] or "application/octet-stream")
        if path.startswith("/assets/") and path.removeprefix("/assets/") in SHARED_ASSETS:
            file = ROOT / "assets" / path.removeprefix("/assets/")
            if file.is_file():
                return self.send(200, file.read_bytes(), mimetypes.guess_type(file)[0] or "application/octet-stream")
        route = self.route()
        if not route or not route[1].exists():
            return self.send(404, "<h1>Not found</h1><a href='/'>Back to demos</a>")
        if route[1].name != "index.html":
            return self.send(200, route[1].read_bytes(), mimetypes.guess_type(route[1])[0] or "application/octet-stream")
        with LOCK:
            doc = self.document(route)
            rendered = str(doc)
            etag = digest(rendered)
            range_header = self.headers.get("Range", "")
            if range_header.startswith("selector="):
                try:
                    selected = doc.select_one(range_header.removeprefix("selector="))
                except Exception:
                    return self.send(400, "<p>Invalid selector.</p>")
                return self.send(206 if selected else 404, str(selected) if selected else "", etag=etag)
            return self.send(200, rendered, etag=etag)

    def do_POST(self):
        self.mutate()

    def do_PUT(self):
        self.mutate()

    def do_DELETE(self):
        self.mutate()

    def mutate(self):
        origin = self.headers.get("Origin")
        expected = f"http://127.0.0.1:{self.server.server_port}"
        if origin and origin != expected:
            return self.send(403, "<p>Only this local preview may change its sample data.</p>")
        route = self.route()
        if not route or route[1].name != "index.html" or not route[1].exists():
            return self.send(405, "<p>No local write route.</p>")
        try:
            size = int(self.headers.get("Content-Length", 0))
            if not 0 <= size <= 262144:
                raise ValueError()
            fragment = self.rfile.read(size).decode("utf-8")
        except (ValueError, UnicodeError):
            return self.send(400, "<p>Invalid fragment.</p>")
        selector = self.headers.get("Range", "").removeprefix("selector=")
        with LOCK:
            doc = self.document(route)
            etag = digest(str(doc))
            match = self.headers.get("If-Match")
            if match and match != etag:
                return self.send(412, "<p>The data changed. Refresh before trying again.</p>", etag=etag)
            try:
                target = doc.select_one(selector)
            except Exception:
                return self.send(400, "<p>Invalid selector.</p>")
            if target is None:
                return self.send(404, "<p>The selected record no longer exists.</p>")
            root = target if target.get("id") in route[2] else target.find_parent(id=lambda x: x in route[2])
            if root is None:
                return self.send(403, "<p>Only the sample collections are writable.</p>")
            if target is root and self.command != "POST":
                return self.send(403, "<p>Replace individual sample records only.</p>")
            fresh = soup(fragment)
            tags = [x for x in fresh.contents if getattr(x, "name", None)]
            if self.command != "DELETE" and len(tags) != 1:
                return self.send(422, "<p>Supply exactly one record.</p>")
            if fresh.find(["script", "iframe", "object", "embed", "style"]) or any(
                name.lower().startswith("on") for el in fresh.find_all(True) for name in el.attrs
            ):
                return self.send(422, "<p>Active markup is not permitted in sample records.</p>")
            if self.command == "POST":
                target.append(tags[0])
            elif self.command == "PUT":
                target.replace_with(tags[0])
            else:
                target.decompose()
            state = {key: str(doc.find(id=key)) for key in route[2] if doc.find(id=key)}
            statefile = self.server.state_dir / (route[0] + ".json")
            pending = statefile.with_suffix(".tmp")
            pending.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
            pending.replace(statefile)
            # Re-render to include any updated local-only CRM counters.
            new_etag = digest(str(self.document(route)))
            self.send(206, "<p>Saved to this local preview.</p>", etag=new_etag)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--state-dir", type=Path, default=Path(__file__).resolve().parent / ".preview-state")
    args = parser.parse_args()
    args.state_dir.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.state_dir = args.state_dir.resolve()
    print(f"Local sample-data preview: http://127.0.0.1:{args.port}/", flush=True)
    print("Not a Pagelove server; no remote data, authentication, email or payments.", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
