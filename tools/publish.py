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
        # A draft may not have a real Git tag yet and the tag endpoint can
        # return 404. List authenticated releases to find resumable drafts.
        return next((item for item in json.loads(gh("api", f"repos/{repository}/releases?per_page=100")) if item["tag_name"] == tag), None)
    raise RuntimeError(result.stderr)

if os.environ.get("GITHUB_REF") == "refs/heads/main":
    head = json.loads(gh("api", f"repos/{repository}/git/ref/heads/main"))["object"]["sha"]
    if head != commit:
        print("A newer main revision exists; let its validated workflow publish.")
        raise SystemExit(0)

assets = [dist / name for name in ["module.json", "pf2e-mythic-proficiency.zip", "SHA256SUMS.txt"]]
existing = release()
if existing and not existing["draft"]:
    assert {file.name for file in assets}.issubset({asset["name"] for asset in existing["assets"]}), "Published release lacks expected assets; investigate without overwriting it"
    print(f"{tag} is already published; existing assets are preserved. Increment module.json version to publish new code.")
    raise SystemExit(0)
if existing:
    assert existing["author"]["login"] == "github-actions[bot]", "Refusing to change a maintainer-created draft"
    # Resume only this automation's unpublished draft, including a newer fix
    # to the same version before its first successful publication.
    gh("release", "edit", tag, "--target", commit, "--title", meta["title"], "--notes-file", str(dist / "RELEASE_NOTES.md"))
else:
    gh("release", "create", tag, "--target", commit, "--draft", "--title", meta["title"], "--notes-file", str(dist / "RELEASE_NOTES.md"))
gh("release", "upload", tag, *(str(file) for file in assets), "--clobber")
uploaded = release()
assert uploaded and {file.name for file in assets}.issubset({asset["name"] for asset in uploaded["assets"]})
gh("release", "edit", tag, "--draft=false", "--latest")
published = release()
assert published and not published["draft"]
print(f"Published {published['html_url']} with module.json, module ZIP and SHA256 checksums.")
