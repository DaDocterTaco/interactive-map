"""Check the preview's real browser dependency graph and private-file boundary."""

import re
import threading
import unittest
from html.parser import HTMLParser
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.parse import urljoin, urlsplit
from urllib.request import urlopen

from serve_lan import AppHandler


class QuietHandler(AppHandler):
    def log_message(self, *args):
        pass


class AssetParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.references = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag in {"script", "img", "link"}:
            reference = attributes.get("src") or attributes.get("href")
            if reference:
                self.references.append(reference)


class PreviewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}/"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def test_current_page_and_local_dependencies_load(self):
        pending, visited = [self.base], set()
        while pending:
            url = pending.pop()
            if url in visited:
                continue
            visited.add(url)
            with self.subTest(url=url), urlopen(url) as response:
                self.assertEqual(response.status, 200)
                body = response.read()
                if not any(kind in response.headers.get_content_type()
                           for kind in ("html", "javascript", "css")):
                    continue
                source = body.decode("utf-8")
            references = []
            if urlsplit(url).path in {"/", "/index.html"}:
                parser = AssetParser()
                parser.feed(source)
                references.extend(parser.references)
            # Include static imports, dynamic imports, exports, and URL assets.
            references.extend(re.findall(
                r'''(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\bnew\s+URL\s*\(\s*)["'](\.[^"']+)["']''',
                source,
            ))
            for reference in references:
                target = urljoin(url, reference)
                if urlsplit(target).netloc == urlsplit(self.base).netloc:
                    pending.append(target)
        # Requests above verify complete versioned URLs; coverage uses canonical paths.
        visited = {url.split("?", 1)[0] for url in visited}
        self.assertIn(urljoin(self.base, "navigation/classNavigation.js"), visited)
        self.assertIn(urljoin(self.base, "locationservices/locationTracker.js"), visited)
        self.assertIn(urljoin(self.base, "CampusUI/camera.mjs"), visited)
        self.assertIn(urljoin(self.base, "Campus3D/mapGestures.mjs"), visited)
        for path in ("CampusUI/fonts/InterVariable.woff2", "CampusUI/icons/compass.svg", "CampusUI/fiu-logo.png"):
            with urlopen(urljoin(self.base,path)) as response:
                self.assertEqual(response.status,200)

    def test_private_paths_stay_unavailable(self):
        for path in (".env", ".git/config", "service-account.json", "package.json",
                     "Pulse/backend/service.js", "Pulse/package.json",
                     "navigation/server.mjs", "navigation/tools/build-campus.mjs",
                     "Events/installation.json", "tools/serve_lan.py",
                     "ActionBar/tests/location-menu.html", "CampusUI/camera.test.mjs", "Campus3D/mapGestures.test.mjs", "qa/location.html", "LiveChat/"):
            with self.subTest(path=path), self.assertRaises(HTTPError) as error:
                urlopen(urljoin(self.base, path))
            self.assertEqual(error.exception.code, 404)
            error.exception.close()


if __name__ == "__main__":
    unittest.main()
