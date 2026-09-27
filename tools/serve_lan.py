"""Serve the browser app on Wi-Fi without exposing local credentials or Git files."""

import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
ROOT_FILES = {
    "index.html", "app.css", "app.js", "Locations.JS", "firebase.js",
    "Buildings.json", "events.json", "forum_alerts.json",
}
APP_FOLDERS = {"ActionBar", "ClassSearch", "LiveChat", "locationservices"}
ASSET_TYPES = {
    ".html", ".css", ".js", ".mjs", ".json", ".geojson", ".svg",
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico",
    ".woff", ".woff2", ".ttf", ".otf", ".mp3", ".wav", ".ogg",
}


class AppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_head(self):
        candidate = Path(self.translate_path(self.path)).resolve()
        if candidate == ROOT:
            candidate = ROOT / "index.html"
        try:
            relative = candidate.relative_to(ROOT)
        except ValueError:
            self.send_error(404)
            return None

        parts = relative.parts
        allowed = (
            len(parts) == 1 and parts[0] in ROOT_FILES
        ) or (
            len(parts) > 1
            and parts[0] in APP_FOLDERS
            and candidate.suffix.lower() in ASSET_TYPES
            and not any(part.startswith(".") or part == "tests" for part in parts)
        )
        # Pulse browser assets only; backend, tests and configuration stay private.
        allowed = allowed or (
            len(parts) == 3 and parts[0] == "Pulse"
            and parts[1] in {"client", "shared"}
            and candidate.suffix.lower() in {".js", ".css"}
            and not any(part.startswith(".") for part in parts)
        )
        if not allowed or not candidate.is_file():
            self.send_error(404)
            return None
        return super().send_head()

    def list_directory(self, path):
        self.send_error(404)
        return None

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--bind", default="0.0.0.0")
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.bind, args.port), AppHandler)
    print(f"Serving FIU Navigator on {args.bind}:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
