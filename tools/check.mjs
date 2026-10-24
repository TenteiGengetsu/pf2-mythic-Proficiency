import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(await readFile(new URL("../module.json", import.meta.url), "utf8"));
assert.equal(manifest.id, "pf2e-mythic-proficiency");
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.deepEqual(manifest.compatibility, { minimum: "14", verified: "14.369", maximum: "14" });
assert.equal((await readFile(new URL("../README.md", import.meta.url))).byteLength, 0, "README.md must remain empty");
const cn = JSON.parse(await readFile(new URL("../lang/cn.json", import.meta.url), "utf8"));
const en = JSON.parse(await readFile(new URL("../lang/en.json", import.meta.url), "utf8"));
assert.deepEqual(Object.keys(cn.PF2E_MYTHIC).sort(), Object.keys(en.PF2E_MYTHIC).sort());
assert.equal(cn.PF2E_MYTHIC.Rank, "\u795e\u8bdd", "Chinese rank must survive UTF-8 transport");
for (const file of ["module.json", "lang/cn.json", "lang/en.json", "scripts/main.mjs", "scripts/core.mjs", "tests/ui.mjs", "tests/mechanics.mjs", "tools/package.py", "VALIDATION.md"]) {
  assert.ok(!(await readFile(path.join(root, file), "utf8")).includes("\uFFFD"), `Corrupt UTF-8 text in ${file}`);
}
for (const key of Object.keys(cn.PF2E_MYTHIC)) {
  const variables = (value) => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  assert.deepEqual(variables(cn.PF2E_MYTHIC[key]), variables(en.PF2E_MYTHIC[key]), key);
}
for (const resource of [...manifest.esmodules, ...manifest.styles, ...manifest.languages.map((entry) => entry.path), manifest.license]) {
  const resolved = path.resolve(root, resource);
  assert.ok(resolved.startsWith(root), `Resource must be inside module: ${resource}`);
  await readFile(resolved);
}
for (const directory of ["scripts", "tools", "tests"]) {
  for (const entry of await readdir(path.join(root, directory))) {
    if (!entry.endsWith(".mjs")) continue;
    const result = spawnSync(process.execPath, ["--check", path.join(root, directory, entry)], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
}
console.log("Manifest, empty README, resource paths, localization variables and JavaScript syntax passed.");
