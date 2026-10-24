import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { stripTypeScriptTypes } from "node:module";

const sourceRoot = process.env.PF2E_SOURCE_ROOT ?? fileURLToPath(new URL("../.cache/pf2e/", import.meta.url));
const clone = (value) => Array.isArray(value) ? Array.from(value, clone) : value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)])) : value;
function mergeObject(a, b) {
  for (const [key, value] of Object.entries(b)) {
    a[key] = value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
      ? mergeObject(a[key] && typeof a[key] === "object" ? a[key] : {}, value) : value;
  }
  return a;
}
const R = {
  unique: (xs) => [...new Set(xs)], isTruthy: Boolean,
  isPlainObject: (x) => !!x && Object.getPrototypeOf(x) === Object.prototype,
  isObjectType: (x) => x !== null && typeof x === "object",
  omit: (o, keys) => Object.fromEntries(Object.entries(o).filter(([key]) => !keys.includes(key)))
};
globalThis.game = { pf2e: { settings: { variants: { pwol: { enabled: false, modifiers: [0, 2, 4, 6, 8] } } } } };
globalThis.CONFIG = { PF2E: { equivalentWeapons: { "composite-longbow": "longbow" }, damageTypes: {}, abilities: { str: "STR", int: "INT" } } };
const context = vm.createContext({
  R, game, CONFIG, console, Set, Object, Array, Map,
  SYSTEM_NAME: "Pathfinder Second Edition",
  fu: { deepClone: clone, mergeObject }, _loc: (x) => x,
  setHasElement: (set, x) => set.has(x),
  objectHasKey: (obj, key) => Object.hasOwn(obj, key),
  tupleHasValue: (xs, x) => xs.includes(x),
  sluggify: (x) => String(x).toLowerCase().replaceAll(" ", "-"),
  signedInteger: (x) => `${x >= 0 ? "+" : ""}${x}`,
  ErrorPF2e: (s) => new Error(s),
  DamageCategorization: { fromDamageType: () => null },
  extractModifierAdjustments: (record, selectors, slug) => [...new Set(selectors.flatMap((s) => record[s] ?? []))].filter((a) => a.slug === slug || a.slug === null),
  extractModifiers: (synthetics, selectors) => [...new Set(selectors)].flatMap((s) => synthetics.modifiers[s] ?? []).flatMap((f) => f({}) ?? [])
});
vm.runInContext("Math.clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n)); Object.defineProperty(Array.prototype, 'findSplice', {configurable:true,value:function(predicate){const index=this.findIndex(predicate);return index<0?undefined:this.splice(index,1)[0];}});", context);
const runtimeSources = [];
for (const file of ["src/module/system/predication.ts", "src/module/actor/modifiers.ts", "src/module/system/statistic/base.ts", "src/module/system/statistic/statistic.ts"]) {
  const raw = await readFile(`${sourceRoot}/${file}`, "utf8");
  const stripped = stripTypeScriptTypes(raw, { mode: "strip" })
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm, "")
    .replace(/export\s*\{[\s\S]*?\};/g, "");
  runtimeSources.push(stripped);
  vm.runInContext(stripped, context, { filename: file });
}
vm.runInContext("globalThis.official = { Modifier, StatisticModifier, CheckModifier, Statistic, createProficiencyModifier, Predicate };", context);
const { Modifier, StatisticModifier, CheckModifier, Statistic, createProficiencyModifier, Predicate } = context.official;
export { clone, mergeObject, R, runtimeSources, Modifier, StatisticModifier, CheckModifier, Statistic, createProficiencyModifier, Predicate };
