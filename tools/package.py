from pathlib import Path
import hashlib
import json
import os
import re
import zipfile

root = Path(__file__).resolve().parent.parent
manifest = json.loads((root / "module.json").read_text(encoding="utf-8"))
version = manifest["version"]
assert re.fullmatch(r"\d+\.\d+\.\d+", version), "Expected a stable x.y.z version"
tag = f"v{version}"
ref = os.environ.get("GITHUB_REF", "")
if ref.startswith("refs/tags/"):
    assert ref == f"refs/tags/{tag}", "Tag must match module.json version"
repository = os.environ.get("GITHUB_REPOSITORY", "TenteiGengetsu/pf2-mythic-Proficiency")
assert repository == "TenteiGengetsu/pf2-mythic-Proficiency", "Unexpected release repository"
url = f"https://github.com/{repository}"
manifest.update({"url": url, "manifest": f"{url}/releases/latest/download/module.json", "download": f"{url}/releases/download/{tag}/pf2e-mythic-proficiency.zip"})
data = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
output = root / "dist"
output.mkdir(exist_ok=True)
(output / "module.json").write_bytes(data)
files = {"module.json": data}
for directory in ["scripts", "styles", "lang"]:
    for file in sorted((root / directory).rglob("*")):
        if file.is_file():
            files[file.relative_to(root).as_posix()] = file.read_bytes()
for name in ["LICENSE", "README.md", "VALIDATION.md"]:
    files[name] = (root / name).read_bytes()
assert files["README.md"] == b"", "README must remain empty"
archive = output / "pf2e-mythic-proficiency.zip"
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as package:
    for name, content in sorted(files.items()):
        info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        package.writestr(info, content)
with zipfile.ZipFile(archive) as package:
    assert package.testzip() is None
    assert set(package.namelist()) == set(files)
    assert package.read("module.json") == data
    assert package.read("README.md") == b""
checksums = "".join(f"{hashlib.sha256(file.read_bytes()).hexdigest()}  {file.name}\n" for file in [archive, output / "module.json"])
(output / "SHA256SUMS.txt").write_text(checksums, encoding="utf-8")
notes = f"""PF2e Mythic Proficiency {tag}

- 保留原熟练度；掷骰窗口提供原熟练度 / 神话互斥选择，默认原熟练度。
- 神话仅本次检定生效，确认掷骰消耗 1 神话点；取消不扣点。
- 标准神话熟练加值为等级 +10；无等级熟练为 +10。
- 检查并保留豁免、职业 DC、施法等框体尺寸和位置，移除模组悬浮提示。
- Foundry VTT 14（清单 verified 14.369），PF2e 8.6.1。
- 自动化数值及界面夹具测试通过；游戏内验收仍需使用者执行。
- 下次检定自动回到原熟练度；原生改写命运重投保持系统处理。

Foundry 安装清单：{url}/releases/latest/download/module.json

手动安装：将 pf2e-mythic-proficiency.zip 解压到 Data/modules/pf2e-mythic-proficiency/。
"""
(output / "RELEASE_NOTES.md").write_text(notes, encoding="utf-8")
(output / "release-meta.json").write_text(json.dumps({"version": version, "tag": tag, "title": f"PF2e Mythic Proficiency {tag}", "repository": repository}, indent=2) + "\n", encoding="utf-8")
print(f"Built {archive.name} {tag}; {len(files)} files; CRC, root manifest and empty README verified.")
