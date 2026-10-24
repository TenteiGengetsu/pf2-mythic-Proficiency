from pathlib import Path
import json
import os
import subprocess

root = Path(__file__).resolve().parent.parent
dist = root / "dist"
meta = json.loads((dist / "release-meta.json").read_text(encoding="utf-8"))
tag = meta["tag"]
repository = meta["repository"]
commit = os.environ["GITHUB_SHA"]
assert os.environ["GITHUB_REPOSITORY"] == repository

def gh(*args):
    return subprocess.run(["gh", *args], check=True, text=True, encoding="utf-8", capture_output=True).stdout

def release():
    result = subprocess.run(["gh", "api", f"repos/{repository}/releases/tags/{tag}"], text=True, encoding="utf-8", capture_output=True)
    if result.returncode == 0:
        return json.loads(result.stdout)
    if "HTTP 404" in result.stderr:
        return None
    raise RuntimeError(result.stderr)

assets = [dist / name for name in ["module.json", "pf2e-mythic-proficiency.zip", "SHA256SUMS.txt"]]
existing = release()
if existing and not existing["draft"]:
    assert {file.name for file in assets}.issubset({asset["name"] for asset in existing["assets"]}), "Published release lacks expected assets; investigate without overwriting it"
    print(f"{tag} is already published; existing assets are preserved. Increment module.json version to publish new code.")
    raise SystemExit(0)
if existing:
    assert existing["target_commitish"] == commit, "Draft targets another commit; refusing to overwrite it"
else:
    gh("release", "create", tag, "--target", commit, "--draft", "--title", meta["title"], "--notes-file", str(dist / "RELEASE_NOTES.md"))
gh("release", "upload", tag, *(str(file) for file in assets), "--clobber")
uploaded = release()
assert uploaded and {file.name for file in assets}.issubset({asset["name"] for asset in uploaded["assets"]})
gh("release", "edit", tag, "--draft=false", "--latest")
published = release()
assert published and not published["draft"]
print(f"Published {published['html_url']} with module.json, module ZIP and SHA256 checksums.")
