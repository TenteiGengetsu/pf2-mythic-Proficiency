from pathlib import Path
import copy
import hashlib
import importlib.util
import json
import os
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

spec = importlib.util.spec_from_file_location("publisher", Path(__file__).resolve().parents[1] / "tools/publish.py")
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)

class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        dist = self.root / "dist"
        dist.mkdir()
        self.names = ["module.json", "pf2e-mythic-proficiency.zip", "SHA256SUMS.txt"]
        for name in self.names:
            (dist / name).write_bytes(name.encode())
        (dist / "RELEASE_NOTES.md").write_text("Test notes", encoding="utf-8")
        (dist / "release-meta.json").write_text(json.dumps({"tag": "v1.0.0", "repository": "owner/repo", "title": "Release"}), encoding="utf-8")
        self.env = patch.dict(os.environ, {"GITHUB_SHA": "new-sha", "GITHUB_REF": "refs/heads/main", "GITHUB_REPOSITORY": "owner/repo"})
        self.env.start()
        self.releases, self.calls, self.head = [], [], "new-sha"

    def tearDown(self):
        self.env.stop()
        self.temp.cleanup()

    def draft(self, id):
        return {"id": id, "tag_name": "v1.0.0", "target_commitish": "old-sha", "draft": True, "author": {"login": "github-actions[bot]"}, "assets": [], "upload_url": f"https://uploads.github.com/repos/owner/repo/releases/{id}/assets{{?name,label}}", "html_url": "https://github.com/owner/repo/releases/tag/v1.0.0"}

    def api(self, method, url, data=None, content_type="application/json"):
        self.calls.append((method, url))
        p = urlparse(url)
        if p.path.endswith("/git/ref/heads/main"):
            return {"object": {"sha": self.head}}
        if method == "GET" and p.path.endswith("/releases"):
            return copy.deepcopy(self.releases)
        if method == "POST" and p.path.endswith("/releases"):
            item = self.draft(50)
            item.update(data)
            self.releases.append(item)
            return copy.deepcopy(item)
        if method == "POST" and p.netloc == "uploads.github.com":
            selected = next(r for r in self.releases if r["id"] == int(p.path.split("/")[-2]))
            asset = {"id": len(self.calls) + 100, "name": parse_qs(p.query)["name"][0], "state": "uploaded", "size": len(data), "digest": f"sha256:{hashlib.sha256(data).hexdigest()}"}
            selected["assets"].append(asset)
            return copy.deepcopy(asset)
        if "/releases/assets/" in p.path and method == "DELETE":
            for item in self.releases:
                item["assets"] = [a for a in item["assets"] if a["id"] != int(p.path.split("/")[-1])]
            return None
        selected = next(r for r in self.releases if r["id"] == int(p.path.split("/")[-1]))
        if method == "PATCH":
            selected.update(data)
        if method == "DELETE":
            self.releases.remove(selected)
            return None
        return copy.deepcopy(selected)

    def test_fresh(self):
        publisher.publish(self.root, self.api)
        self.assertFalse(self.releases[0]["draft"])
        self.assertEqual({a["name"] for a in self.releases[0]["assets"]}, set(self.names))

    def test_duplicate_drafts(self):
        self.releases = [self.draft(10), self.draft(11)]
        publisher.publish(self.root, self.api)
        self.assertEqual([r["id"] for r in self.releases], [11])
        self.assertFalse(self.releases[0]["draft"])
        self.assertEqual(self.releases[0]["target_commitish"], "new-sha")

    def test_replace_draft_asset(self):
        item = self.draft(12)
        item["assets"] = [{"id": 99, "name": "module.json"}]
        self.releases = [item]
        publisher.publish(self.root, self.api)
        self.assertEqual(len(self.releases[0]["assets"]), 3)
        self.assertTrue(any(m == "DELETE" and u.endswith("/assets/99") for m, u in self.calls))

    def test_preserve_published(self):
        item = self.draft(12)
        item.update({"draft": False, "assets": [{"name": n} for n in self.names]})
        self.releases = [item]
        publisher.publish(self.root, self.api)
        self.assertTrue(all(m == "GET" for m, _ in self.calls))

    def test_preserve_maintainer_draft(self):
        item = self.draft(12)
        item["author"]["login"] = "maintainer"
        self.releases = [item]
        with self.assertRaises(AssertionError):
            publisher.publish(self.root, self.api)
        self.assertTrue(all(m == "GET" for m, _ in self.calls))

    def test_skip_stale(self):
        self.head = "newer-sha"
        publisher.publish(self.root, self.api)
        self.assertEqual(len(self.calls), 1)

if __name__ == "__main__":
    unittest.main()
