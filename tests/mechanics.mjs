import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { clone, Modifier, CheckModifier, Statistic, createProficiencyModifier, Predicate } from "./pf2e-runtime.mjs";
import { ID, flagKey, isMythic, setMythic, mythicBonus } from "../scripts/core.mjs";
import { MythicCheckSession, prepareSession, eligibleKeys, MYTHIC_OPTION, MYTHIC_SLUG } from "../scripts/rolls.mjs";

const cn = JSON.parse(await readFile(new URL("../lang/cn.json", import.meta.url), "utf8"));
game.i18n = {
  localize(key, data = {}) { return String(key.split(".").reduce((obj, part) => obj?.[part], cn) ?? key).replace(/\{(\w+)\}/g, (_, part) => String(data[part] ?? part)); },
  has(key) { return !!key.split(".").reduce((obj, part) => obj?.[part], cn); }
};
Object.assign(game.pf2e, { Modifier, CheckModifier });
globalThis.ui = { notifications: { warn() {} } };
let sequence = 0;
function fixture() {
  const actor = {
    type: "character", level: 10, uuid: `Actor.test${sequence++}`, isOwner: true,
    isOfType: (...types) => types.includes("character") || types.includes("creature"),
    getRollOptions: () => ["self:type:character"], abilities: { str: { mod: 4 }, int: { mod: 3 } },
    flags: { [ID]: { ranks: {} } }, items: new Map(), itemTypes: { lore: [] }, resourceUpdates: [],
    system: { resources: { mythicPoints: { value: 3, max: 3 } }, skills: { athletics: { rank: 1 }, stealth: { rank: 4 } }, proficiencies: {
      attacks: { simple: { rank: 1 }, martial: { rank: 2 }, "weapon-group-sword": { rank: 2 }, "weapon-base-composite-longbow": { rank: 2 }, custom: { rank: 1, definition: new Predicate("item:trait:agile") } },
      defenses: { heavy: { rank: 1 } }, classDCs: { fighter: { rank: 2 } }, spellcasting: { rank: 1 }
    } },
    synthetics: { modifierAdjustments: { all: [], damage: [] }, modifiers: { all: [] } },
    getResource() { return { ...this.system.resources.mythicPoints, slug: "mythic-points" }; },
    async updateResource(slug, value) { assert.equal(slug, "mythic-points"); this.resourceUpdates.push(value); this.system.resources.mythicPoints.value = Math.min(this.system.resources.mythicPoints.max, Math.max(0, value)); },
    async update(changes) { this.lastUpdate = changes; return this; }
  };
  return actor;
}
function enable(actor, key) { actor.flags[ID].ranks[flagKey(key)] = true; }
function input(actor, rank = 1, domains = ["athletics", "all"], type = "skill-check", extras = []) {
  const context = { actor, domains, type, options: new Set(["self:type:character"]) };
  const prof = createProficiencyModifier({ actor, rank, domains });
  return { context, check: new CheckModifier("test", { modifiers: [prof, ...extras] }, [], context.options) };
}
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("availability flags never change native proficiency values or passive DCs", () => {
  const actor = fixture(); enable(actor, "skill:athletics");
  for (const rank of [0, 1, 2, 3, 4]) {
    const { check } = input(actor, rank);
    assert.equal(check.totalModifier, rank ? 10 + rank * 2 : 0);
  }
  const stat = new Statistic(actor, { slug: "athletics", label: "Athletics", rank: 1, attribute: "str", domains: ["athletics", "all"], check: { type: "skill-check" } });
  assert.equal(stat.check.mod, 16); assert.equal(stat.dc.value, 26);
  assert.deepEqual(actor.synthetics.modifierAdjustments, { all: [], damage: [] });
});
test("one native and one Mythic proficiency remain visible; native is the default", () => {
  const actor = fixture(); enable(actor, "skill:athletics"); const { check, context } = input(actor);
  const session = prepareSession(check, context);
  assert.equal(session.mode, "normal"); assert.equal(session.check.totalModifier, 12);
  assert.equal(session.check.modifiers.filter((m) => m.type === "proficiency").length, 2);
  assert.equal(session.alternative.modifier, 20); assert.equal(session.alternative.ignored, true);
  assert.equal(session.original.enabled, true); assert.equal(check.modifiers.length, 1);
});
test("selection replaces proficiency and retains native item/status stacking", () => {
  const actor = fixture(); enable(actor, "skill:athletics");
  const extras = [new Modifier({ slug: "str", type: "ability", label: "STR", modifier: 4 }), new Modifier({ slug: "item1", type: "item", label: "Item 1", modifier: 1 }), new Modifier({ slug: "item2", type: "item", label: "Item 2", modifier: 2 }), new Modifier({ slug: "fear", type: "status", label: "Fear", modifier: -1 })];
  const { check, context } = input(actor, 1, undefined, undefined, extras); const session = prepareSession(check, context);
  assert.equal(session.check.totalModifier, 17); session.choose("mythic"); assert.equal(session.check.totalModifier, 25);
  assert.equal(session.original.enabled, false); assert.equal(session.alternative.enabled, true);
  session.choose("normal"); assert.equal(session.check.totalModifier, 17); assert.equal(check.totalModifier, 17);
});
test("repeated selection and calculation never stack the two proficiency bonuses", () => {
  const actor = fixture(); enable(actor, "skill:athletics"); const { check, context } = input(actor, 4); const session = prepareSession(check, context);
  for (let i = 0; i < 5; i++) { session.choose("mythic"); session.check.calculateTotal(context.options); assert.equal(session.check.totalModifier, 20); session.choose("normal"); assert.equal(session.check.totalModifier, 18); }
});
test("choosing Mythic does not charge until the roll is confirmed", async () => {
  const actor = fixture(); enable(actor, "skill:athletics"); const { check, context } = input(actor); const session = prepareSession(check, context);
  session.choose("mythic"); assert.deepEqual(actor.resourceUpdates, []); assert.equal(await session.accept(true), true);
  assert.deepEqual(actor.resourceUpdates, [2]); await session.finish(true); assert.equal(actor.getResource().value, 2);
});
test("cancelled dialogs do not charge a Mythic Point", async () => {
  const actor = fixture(); const { check, context } = input(actor); const session = new MythicCheckSession(actor, check, context);
  session.choose("mythic"); assert.equal(await session.accept(false), false); await session.finish(false); assert.deepEqual(actor.resourceUpdates, []);
});
test("confirmed normal checks do not charge a Mythic Point", async () => {
  const actor = fixture(); const { check, context } = input(actor); const session = new MythicCheckSession(actor, check, context);
  assert.equal(await session.accept(true), true); await session.finish(true); assert.deepEqual(actor.resourceUpdates, []);
});
test("zero or disabled Mythic Point resources cannot select Mythic", () => {
  for (const resource of [{ value: 0, max: 3 }, { value: 3, max: 0 }]) {
    const actor = fixture(); actor.system.resources.mythicPoints = resource; const { check, context } = input(actor);
    const session = new MythicCheckSession(actor, check, context); assert.equal(session.choose("mythic"), "normal"); assert.equal(session.check.totalModifier, 12);
  }
});
test("resource changes between selection and confirmation cancel without rolling", async () => {
  const actor = fixture(); const { check, context } = input(actor); const session = new MythicCheckSession(actor, check, context);
  session.choose("mythic"); actor.system.resources.mythicPoints.value = 0;
  const originalError = console.error; console.error = () => {};
  try { assert.equal(await session.accept(true), false); } finally { console.error = originalError; }
  assert.deepEqual(actor.resourceUpdates, []);
});
test("rapid duplicate submissions spend exactly one point", async () => {
  const actor = fixture(); const { check, context } = input(actor); const session = new MythicCheckSession(actor, check, context); session.choose("mythic");
  assert.deepEqual(await Promise.all([session.accept(true), session.accept(true), session.accept(true)]), [true, true, true]); assert.deepEqual(actor.resourceUpdates, [2]);
});
test("two dialogs sharing the last point cannot both spend it on one client", async () => {
  const actor = fixture(); actor.system.resources.mythicPoints.value = 1;
  const sessions = [0, 1].map(() => { const { check, context } = input(actor); const session = new MythicCheckSession(actor, check, context); session.choose("mythic"); return session; });
  const originalError = console.error; console.error = () => {};
  try { assert.deepEqual(await Promise.all(sessions.map((session) => session.accept(true))), [true, false]); } finally { console.error = originalError; }
  assert.equal(actor.getResource().value, 0); assert.deepEqual(actor.resourceUpdates, [0]);
});
test("cancelled or failed dice evaluation refunds once", async () => {
  const actor = fixture(); const { check, context } = input(actor); const session = new MythicCheckSession(actor, check, context);
  session.choose("mythic"); await session.accept(true); await session.finish(false); await session.finish(false);
  assert.deepEqual(actor.resourceUpdates, [2, 3]); assert.equal(context.options.has(MYTHIC_OPTION), false);
});
test("each new check defaults to original proficiency after a Mythic roll", async () => {
  const actor = fixture(); enable(actor, "skill:athletics"); const originalRank = actor.system.skills.athletics.rank;
  let source = input(actor); let session = prepareSession(source.check, source.context); session.choose("mythic"); await session.accept(true); await session.finish(true);
  source = input(actor); session = prepareSession(source.check, source.context); assert.equal(session.mode, "normal"); assert.equal(session.check.totalModifier, 12);
  assert.equal(actor.system.skills.athletics.rank, originalRank); assert.equal(isMythic(actor, "skill:athletics"), true);
});
test("confirmed rolls expose one proficiency so native Rewrite Fate cannot add it twice", async () => {
  for (const mode of ["normal", "mythic"]) {
    const actor = fixture(); const { check, context } = input(actor, 1); const session = new MythicCheckSession(actor, check, context);
    session.choose(mode); await session.accept(true);
    const proficiencies = session.check.modifiers.filter((m) => m.type === "proficiency");
    assert.equal(proficiencies.length, 1); assert.equal(proficiencies[0].slug, "proficiency");
    assert.equal(session.check.totalModifier - proficiencies[0].modifier + mythicBonus(actor), 20);
  }
});
test("native rerolls, flat checks, NPCs, and non-owners bypass the integration", () => {
  const actor = fixture(); enable(actor, "skill:athletics"); const { check, context } = input(actor);
  assert.equal(prepareSession(check, { ...context, isReroll: true }), null);
  assert.equal(prepareSession(check, { ...context, type: "flat-check" }), null);
  actor.type = "npc"; assert.equal(prepareSession(check, context), null); actor.type = "character"; actor.isOwner = false; assert.equal(prepareSession(check, context), null);
});
test("already-Mythic system modifiers do not create a second point charge", () => {
  const actor = fixture(); enable(actor, "skill:athletics"); const { context } = input(actor);
  const check = new CheckModifier("native-mythic", { modifiers: [new Modifier({ slug: "proficiency", label: "Native Mythic", type: "proficiency", modifier: 20 })] });
  assert.equal(prepareSession(check, context), null);
});
test("weapon categories, groups, equivalent bases and Predicate definitions stay isolated", () => {
  const actor = fixture(); for (const key of ["attacks:martial", "attacks:weapon-group-sword", "attacks:weapon-base-composite-longbow", "attacks:custom"]) enable(actor, key);
  for (const option of ["item:category:martial", "item:group:sword", "item:base:longbow", "item:trait:agile"]) { const { check, context } = input(actor, 2, ["strike-attack-roll"], "attack-roll"); context.options.add(option); assert.ok(prepareSession(check, context)); }
  const { check, context } = input(actor, 2, ["strike-attack-roll"], "attack-roll"); context.options.add("item:category:simple"); assert.equal(prepareSession(check, context), null);
});
test("Perception, saves, Lore, class-derived and spellcasting checks use their own eligibility", () => {
  const actor = fixture(); actor.items.set("lore1", { id: "lore1", type: "lore", slug: "naval-lore" }); actor.itemTypes.lore.push(actor.items.get("lore1"));
  for (const [key, domain] of [["perception", "perception"], ["save:will", "will"], ["lore:lore1", "naval-lore"], ["class:fighter", "fighter"], ["spellcasting", "spell-attack-dc"]]) { enable(actor, key); const { check, context } = input(actor, 1, [domain]); assert.ok(eligibleKeys(actor, check, context).includes(key)); }
  const { check, context } = input(actor, 1, ["reflex"]); assert.equal(prepareSession(check, context), null);
});
test("Proficiency Without Level uses +10 while retaining the normal bonus", () => {
  game.pf2e.settings.variants.pwol.enabled = true;
  try { const actor = fixture(); const { check, context } = input(actor, 4); const session = new MythicCheckSession(actor, check, context); assert.equal(session.check.totalModifier, 8); session.choose("mythic"); assert.equal(session.check.totalModifier, 10); session.choose("normal"); assert.equal(session.check.totalModifier, 8); }
  finally { game.pf2e.settings.variants.pwol.enabled = false; }
});
test("Mythic replaces an untrained PWOL penalty instead of adding it to +10", () => {
  const pwol = game.pf2e.settings.variants.pwol; const before = { ...pwol };
  pwol.enabled = true; pwol.modifiers = [-2, 2, 4, 6, 8];
  try { const actor = fixture(); const { check, context } = input(actor, 0); const session = new MythicCheckSession(actor, check, context); assert.equal(session.check.totalModifier, -2); session.choose("mythic"); assert.equal(session.check.totalModifier, 10); session.choose("normal"); assert.equal(session.check.totalModifier, -2); }
  finally { Object.assign(pwol, before); }
});
test("resource writes target the live Actor rather than its contextual clone", async () => {
  const live = fixture(); const actor = fixture(); actor.uuid = live.uuid; const { check, context } = input(actor);
  globalThis.fromUuidSync = () => live;
  try { const session = new MythicCheckSession(actor, check, context); session.choose("mythic"); await session.accept(true); assert.deepEqual(live.resourceUpdates, [2]); assert.deepEqual(actor.resourceUpdates, []); }
  finally { delete globalThis.fromUuidSync; }
});
test("the API stores availability only and preserves safe Unicode flag keys", async () => {
  const actor = fixture(); await setMythic(actor, "skill:athletics", true);
  assert.deepEqual(actor.lastUpdate, { [`flags.${ID}.ranks.${flagKey("skill:athletics")}`]: true });
  assert.ok(/^[0-9a-f]+$/.test(flagKey("skill:自定义.学识"))); actor.isOwner = false; await assert.rejects(setMythic(actor, "skill:athletics", true), /Permission/);
});
test("manifest and localization provide cn and matching translation keys", async () => {
  const en = JSON.parse(await readFile(new URL("../lang/en.json", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(cn.PF2E_MYTHIC).sort(), Object.keys(en.PF2E_MYTHIC).sort());
  const manifest = JSON.parse(await readFile(new URL("../module.json", import.meta.url), "utf8")); assert.ok(manifest.languages.some((l) => l.lang === "cn"));
});

for (const [name, fn] of tests) { await fn(); console.log(`PASS ${name}`); }
console.log(`${tests.length} per-check proficiency and resource tests passed against official PF2e modifier classes.`);
