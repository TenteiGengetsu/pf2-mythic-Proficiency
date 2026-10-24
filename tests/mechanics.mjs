import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { stripTypeScriptTypes } from "node:module";
import { ID, flagKey, mythicBonus, installAdjustments, isMythic, setMythic, targets } from "../scripts/core.mjs";

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
vm.runInContext("Math.clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));", context);
for (const file of ["src/module/system/predication.ts", "src/module/actor/modifiers.ts", "src/module/system/statistic/base.ts", "src/module/system/statistic/statistic.ts"]) {
  const raw = await readFile(`${sourceRoot}/${file}`, "utf8");
  const stripped = stripTypeScriptTypes(raw, { mode: "strip" })
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm, "")
    .replace(/export\s*\{[\s\S]*?\};/g, "");
  vm.runInContext(stripped, context, { filename: file });
}
vm.runInContext("globalThis.official = { Modifier, StatisticModifier, CheckModifier, Statistic, createProficiencyModifier, Predicate };", context);
const { Modifier, StatisticModifier, CheckModifier, Statistic, createProficiencyModifier, Predicate } = context.official;
let count = 0;
function check(name, fn) { fn(); count++; console.log(`PASS ${name}`); }
const enabled = (actor, key, value = true) => { actor.flags[ID].ranks[flagKey(key)] = value; };
function actorFixture() {
  const items = new Map();
  return {
    type: "character", level: 10, isOwner: true,
    isOfType: (...types) => types.includes("character") || types.includes("creature"),
    getRollOptions: () => ["self:type:character"],
    abilities: { str: { mod: 4 }, int: { mod: 3 } },
    flags: { [ID]: { ranks: {} } }, items, itemTypes: { lore: [] },
    system: { skills: { athletics: { rank: 1 }, stealth: { rank: 4 } }, proficiencies: {
      attacks: { simple: { rank: 1 }, martial: { rank: 2 }, "weapon-group-sword": { rank: 2 }, custom: { rank: 1, definition: new Predicate("item:trait:agile") } },
      defenses: { unarmored: { rank: 1 }, heavy: { rank: 1 }, light: { rank: 1 } },
      classDCs: { fighter: { rank: 2 } }, spellcasting: { rank: 1 }
    } },
    synthetics: { modifierAdjustments: { all: [], damage: [] }, modifiers: { all: [] } },
    update: async function (changes) { this.lastUpdate = changes; return changes; }
  };
}
function proficiency(actor, rank, domains, options = []) {
  const modifier = createProficiencyModifier({ actor, rank, domains });
  const statistic = new StatisticModifier("test", [modifier], new Set(["self:type:character", ...options]));
  return { modifier: statistic.modifiers[0], total: statistic.totalModifier, statistic };
}
check("all native ranks retain official PF2e values without selection", () => {
  const actor = actorFixture(); installAdjustments(actor);
  assert.deepEqual([0, 1, 2, 3, 4].map((rank) => proficiency(actor, rank, ["athletics"]).total), [0, 12, 14, 16, 18]);
});
check("all five base ranks become level +10; unrelated skill remains unchanged", () => {
  const actor = actorFixture(); enabled(actor, "skill:athletics"); installAdjustments(actor);
  assert.deepEqual([0, 1, 2, 3, 4].map((rank) => proficiency(actor, rank, ["athletics", "all"]).total), [20, 20, 20, 20, 20]);
  assert.equal(proficiency(actor, 4, ["stealth", "all"]).total, 18);
  assert.equal(actor.system.skills.athletics.rank, 1);
});
check("mythic replaces proficiency and preserves native stacking, repeated calculations, and clone", () => {
  const actor = actorFixture(); enabled(actor, "skill:athletics"); installAdjustments(actor);
  const modifiers = [createProficiencyModifier({ actor, rank: 1, domains: ["athletics", "all"] }),
    new Modifier({ slug: "str", type: "ability", ability: "str", label: "STR", modifier: 4 }),
    new Modifier({ slug: "item1", type: "item", label: "Item 1", modifier: 1 }),
    new Modifier({ slug: "item2", type: "item", label: "Item 2", modifier: 2 }),
    new Modifier({ slug: "frightened", type: "status", label: "Frightened", modifier: -1 })];
  const rollOptions = new Set(["self:type:character"]);
  const statistic = new StatisticModifier("athletics", modifiers, rollOptions);
  assert.equal(statistic.totalModifier, 25);
  statistic.calculateTotal(rollOptions); statistic.calculateTotal(rollOptions); assert.equal(statistic.totalModifier, 25);
  assert.equal(new CheckModifier("cloned", statistic, [], rollOptions).totalModifier, 25);
  assert.equal(statistic.modifiers.find((m) => m.slug === "proficiency").type, "proficiency");
  assert.equal(statistic.modifiers.find((m) => m.slug === "proficiency").label, "PF2E_MYTHIC.Rank");
});
check("matching weapon category only; no spell attack or weapon damage leak", () => {
  const actor = actorFixture(); enabled(actor, "attacks:martial"); installAdjustments(actor);
  assert.equal(proficiency(actor, 2, ["strike-attack-roll", "all"], ["item:category:martial"]).total, 20);
  assert.equal(proficiency(actor, 1, ["strike-attack-roll", "all"], ["item:category:simple"]).total, 12);
  assert.equal(proficiency(actor, 2, ["spell-attack-roll", "all"], ["item:category:martial"]).total, 14);
  assert.equal(proficiency(actor, 2, ["strike-damage", "all"], ["item:category:martial"]).total, 14);
});
check("weapon group, equivalent base and official Predicate definitions match", () => {
  const actor = actorFixture(); enabled(actor, "attacks:weapon-group-sword"); enabled(actor, "attacks:weapon-base-composite-longbow"); enabled(actor, "attacks:custom"); installAdjustments(actor);
  for (const option of ["item:group:sword", "item:base:longbow", "item:base:composite-longbow", "item:trait:agile"]) {
    assert.equal(proficiency(actor, 2, ["strike-attack-roll"], [option]).total, 20);
  }
  assert.equal(proficiency(actor, 2, ["strike-attack-roll"], ["item:group:axe"]).total, 14);
});
check("armor switches and unarmored matching stay isolated", () => {
  const actor = actorFixture(); enabled(actor, "defenses:heavy"); installAdjustments(actor);
  actor.wornArmor = { category: "heavy" }; assert.equal(proficiency(actor, 1, ["ac"]).total, 20);
  actor.wornArmor = { category: "light" }; assert.equal(proficiency(actor, 1, ["ac"]).total, 12);
  actor.wornArmor = null; assert.equal(proficiency(actor, 1, ["ac"]).total, 12);
  enabled(actor, "defenses:unarmored"); installAdjustments(actor); assert.equal(proficiency(actor, 1, ["ac"]).total, 20);
});
check("perception, save, class DC and base spellcasting selectors", () => {
  const actor = actorFixture();
  for (const key of ["perception", "save:will", "class:fighter", "spellcasting"]) enabled(actor, key);
  installAdjustments(actor);
  for (const domain of ["perception", "will", "fighter", "spell-attack-dc"]) assert.equal(proficiency(actor, 1, [domain, "all"]).total, 20);
  assert.equal(proficiency(actor, 1, ["reflex", "all"]).total, 12);
});
check("base spellcasting captures adjustment before preparation and cloned checks keep it", () => {
  const actor = actorFixture(); enabled(actor, "spellcasting"); installAdjustments(actor);
  const original = createProficiencyModifier({ actor, rank: 1, domains: ["all", "spell-attack-dc"] });
  const base = new StatisticModifier("base-spellcasting", [original], new Set(["self:type:character"]));
  const extended = new CheckModifier("arcane", base, [], new Set(["self:type:character"]));
  assert.equal(extended.totalModifier, 20); assert.equal(10 + extended.totalModifier, 30);
});
check("official Statistic yields skill check +24 and skill DC 34 without changing rank", () => {
  const actor = actorFixture(); enabled(actor, "skill:athletics"); installAdjustments(actor);
  const stat = new Statistic(actor, { slug: "athletics", label: "Athletics", rank: 1, attribute: "str", domains: ["athletics", "all"], check: { type: "skill-check" } });
  assert.equal(stat.check.mod, 24); assert.equal(stat.dc.value, 34); assert.equal(stat.rank, 1);
});
check("official base spellcasting extend preserves mythic in actual spell attack and DC", () => {
  const actor = actorFixture(); enabled(actor, "spellcasting"); installAdjustments(actor);
  const base = new Statistic(actor, { slug: "base-spellcasting", label: "Spellcasting", rank: 1, domains: ["all", "spell-attack-dc"], check: { type: "attack-roll" } });
  const extended = base.extend({ slug: "arcane", attribute: "int", rank: 1, domains: ["all", "int-based", "spell-attack-dc"], check: { type: "attack-roll", domains: ["spell-attack-roll"] }, dc: { domains: ["spell-dc"] } });
  assert.equal(extended.check.mod, 23); assert.equal(extended.dc.value, 33);
});
check("official class-based spellcasting extends selected class, independent of base spell flag", () => {
  const actor = actorFixture(); enabled(actor, "class:fighter"); installAdjustments(actor);
  const base = new Statistic(actor, { slug: "fighter", label: "Class DC", rank: 2, attribute: "str", domains: ["all", "class", "fighter"] });
  assert.equal(base.dc.value, 34);
  const spell = base.extend({ slug: "class-spells", domains: ["spell-attack-dc"], check: { type: "attack-roll", domains: ["spell-attack-roll"] }, dc: { domains: ["spell-dc"] } });
  assert.equal(spell.check.mod, 24); assert.equal(spell.dc.value, 34);
});
check("lore renaming retains Item-id selection and deleted lore cannot leak", () => {
  const actor = actorFixture(); const item = { id: "lore1", type: "lore", slug: "sailing-lore" };
  actor.items.set(item.id, item); actor.itemTypes.lore.push(item); enabled(actor, "lore:lore1"); installAdjustments(actor);
  assert.equal(proficiency(actor, 1, ["sailing-lore"]).total, 20);
  item.slug = "naval-lore"; installAdjustments(actor);
  assert.equal(proficiency(actor, 1, ["naval-lore"]).total, 20);
  assert.equal(proficiency(actor, 1, ["sailing-lore"]).total, 12);
  actor.items.clear(); installAdjustments(actor); assert.equal(proficiency(actor, 1, ["naval-lore"]).total, 12);
});
check("preparation is idempotent and flag removal restores native value", () => {
  const actor = actorFixture(); enabled(actor, "skill:athletics"); installAdjustments(actor); installAdjustments(actor);
  assert.equal(actor.synthetics.modifierAdjustments.athletics.length, 1);
  enabled(actor, "skill:athletics", false); installAdjustments(actor);
  assert.equal(proficiency(actor, 1, ["athletics"]).total, 12);
});
check("Proficiency Without Level uses fixed +10 including customized base ranks", () => {
  game.pf2e.settings.variants.pwol = { enabled: true, modifiers: [-2, 3, 5, 7, 9] };
  const actor = actorFixture(); enabled(actor, "skill:athletics"); installAdjustments(actor);
  for (const rank of [0, 1, 2, 3, 4]) assert.equal(proficiency(actor, rank, ["athletics"]).total, 10);
  assert.equal(proficiency(actor, 4, ["stealth"]).total, 9);
  game.pf2e.settings.variants.pwol.enabled = false;
});
check("level-zero characters and safe Unicode flag keys", () => {
  const actor = actorFixture(); actor.level = 0; assert.equal(mythicBonus(actor), 10);
  const key = "skill:�Զ���.ѧʶ"; enabled(actor, key); installAdjustments(actor);
  assert.ok(/^[0-9a-f]+$/.test(flagKey(key)));
  assert.equal(proficiency(actor, 1, ["�Զ���.ѧʶ"]).total, 10);
});
check("non-character actors retain untouched synthetics", () => {
  const actor = actorFixture(); actor.type = "npc"; enabled(actor, "skill:athletics"); installAdjustments(actor);
  assert.equal(actor.synthetics.modifierAdjustments.athletics, undefined);
});
{
  const actor = actorFixture(); await setMythic(actor, "skill:athletics", true);
  assert.deepEqual(actor.lastUpdate, { [`flags.${ID}.ranks.${flagKey("skill:athletics")}`]: true });
  assert.ok(!Object.keys(actor.lastUpdate).some((key) => key.startsWith("system.")));
  actor.isOwner = false; await assert.rejects(setMythic(actor, "skill:athletics", true), /Permission/);
  actor.isOwner = true; await assert.rejects(setMythic(actor, "skill:missing", true), /InvalidTarget/);
  count++; console.log("PASS API enforces ownership, validates target, and never writes rank 5");
}
for (const language of ["cn", "en"]) {
  const dict = JSON.parse(await readFile(new URL(`../lang/${language}.json`, import.meta.url)));
  assert.equal(Object.keys(dict.PF2E_MYTHIC).length, 8);
}
const manifest = JSON.parse(await readFile(new URL("../module.json", import.meta.url)));
assert.deepEqual(manifest.compatibility, { minimum: "14", verified: "14.369", maximum: "14" });
assert.ok(manifest.languages.some((l) => l.lang === "cn" && l.path === "lang/cn.json"));
count++; console.log("PASS manifest and cn/en localization contract");
console.log(`${count} mechanics and packaging tests passed against official PF2e Modifier/StatisticModifier source.`);
