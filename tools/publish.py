from pathlib import Path
import hashlib
import json
import os
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def github_api(method, url, data=None, content_type="application/json"):
    if data is not None and not isinstance(data, bytes):
        data = json.dumps(data).encode("utf-8")
    request = Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {os.environ['GH_TOKEN']}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": content_type,
        "User-Agent": "pf2e-mythic-proficiency-release",
    })
    with urlopen(request, timeout=60) as response:
        body = response.read()
        return json.loads(body) if body else None


def publish(root=None, api=github_api):
    root = root or Path(__file__).resolve().parent.parent
    dist = root / "dist"
    meta = json.loads((dist / "release-meta.json").read_text(encoding="utf-8"))
    repository, tag = meta["repository"], meta["tag"]
    commit = os.environ["GITHUB_SHA"]
    assert os.environ["GITHUB_REPOSITORY"] == repository
    base = f"https://api.github.com/repos/{repository}"
    if os.environ.get("GITHUB_REF") == "refs/heads/main":
        if api("GET", f"{base}/git/ref/heads/main")["object"]["sha"] != commit:
            print("A newer main revision exists; let its validated workflow publish.")
            return
    # Resolve drafts once, then use their unique REST id for every mutation.
    releases = []
    page = 1
    while True:
        batch = api("GET", f"{base}/releases?per_page=100&page={page}")
        releases.extend(item for item in batch if item["tag_name"] == tag)
        if len(batch) < 100:
            break
        page += 1
    assets = [dist / name for name in ["module.json", "pf2e-mythic-proficiency.zip", "SHA256SUMS.txt"]]
    existing = next((item for item in releases if not item["draft"]), None)
    if existing:
        assert {f.name for f in assets}.issubset({a["name"] for a in existing["assets"]}), "Published release lacks assets"
        print(f"{tag} already published; increment module.json version for new code.")
        return
    assert all(r["author"]["login"] == "github-actions[bot]" for r in releases), "Refusing to alter a maintainer-created draft"
    payload = {"tag_name": tag, "target_commitish": commit, "name": meta["title"], "body": (dist / "RELEASE_NOTES.md").read_text(encoding="utf-8"), "draft": True, "prerelease": False}
    if releases:
        selected = max(releases, key=lambda item: item["id"])
        selected = api("PATCH", f"{base}/releases/{selected['id']}", payload)
    else:
        selected = api("POST", f"{base}/releases", payload)
    release_id = selected["id"]
    upload_url = selected["upload_url"].split("{", 1)[0]
    for file in assets:
        old = next((a for a in selected["assets"] if a["name"] == file.name), None)
        if old:
            api("DELETE", f"{base}/releases/assets/{old['id']}")
        content = file.read_bytes()
        kind = "application/zip" if file.suffix == ".zip" else "application/json" if file.suffix == ".json" else "text/plain; charset=utf-8"
        uploaded = api("POST", f"{upload_url}?{urlencode({'name': file.name})}", content, kind)
        assert uploaded["name"] == file.name and uploaded["state"] == "uploaded" and uploaded["size"] == len(content)
        if uploaded.get("digest"):
            assert uploaded["digest"] == f"sha256:{hashlib.sha256(content).hexdigest()}"
    uploaded = api("GET", f"{base}/releases/{release_id}")
    assert {f.name for f in assets}.issubset({a["name"] for a in uploaded["assets"]})
    published = api("PATCH", f"{base}/releases/{release_id}", {"draft": False, "make_latest": "true"})
    assert not published["draft"] and published["tag_name"] == tag
    # Clean up only this automation's redundant unpublished drafts.
    for other in releases:
        if other["id"] != release_id:
            api("DELETE", f"{base}/releases/{other['id']}")
    print(f"Published {published['html_url']} with verified manifest, ZIP and SHA256 checksums.")


if __name__ == "__main__":
    publish()
