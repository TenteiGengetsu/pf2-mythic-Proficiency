export const ID = "pf2e-mythic-proficiency";
export const MYTHIC = 5;
export const LABEL = "PF2E_MYTHIC.Rank";

// Keys are encoded to avoid Foundry treating dots in custom slugs as update paths.
export function flagKey(key) {
  return Array.from(new TextEncoder().encode(key), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function isMythic(actor, key) {
  return actor.flags?.[ID]?.ranks?.[flagKey(key)] === true;
}

export function mythicBonus(actor) {
  return 10 + (globalThis.game?.pf2e?.settings?.variants?.pwol?.enabled ? 0 : Number(actor.level) || 0);
}

export function targets(actor) {
  const system = actor.system;
  const list = [{ key: "perception", path: "system.perception.rank", selector: "perception" }];
  for (const save of ["fortitude", "reflex", "will"]) {
    list.push({ key: `save:${save}`, path: `system.saves.${save}.rank`, selector: save });
  }
  for (const [slug, skill] of Object.entries(system.skills ?? {})) {
    if (!skill.lore && !skill.itemId) list.push({ key: `skill:${slug}`, path: `system.skills.${slug}.rank`, selector: slug });
  }
  // Lore keys follow the Item id, so renaming a Lore keeps the selection.
  for (const item of actor.itemTypes?.lore ?? []) {
    list.push({ key: `lore:${item.id}`, itemId: item.id, path: "system.proficient.value", selector: item.slug });
  }
  for (const group of ["attacks", "defenses"]) {
    for (const slug of Object.keys(system.proficiencies?.[group] ?? {})) {
      list.push({ key: `${group}:${slug}`, path: `system.proficiencies.${group}.${slug}.rank`, group, slug });
    }
  }
  for (const slug of Object.keys(system.proficiencies?.classDCs ?? {})) {
    list.push({ key: `class:${slug}`, path: `system.proficiencies.classDCs.${slug}.rank`, selector: slug });
  }
  list.push({ key: "spellcasting", path: "system.proficiencies.spellcasting.rank", selector: "spell-attack-dc" });
  return list;
}

export function attackMatches(actor, slug, options) {
  const set = options instanceof Set ? options : new Set(options);
  if (slug.startsWith("weapon-group-")) return set.has(`item:group:${slug.slice(13)}`);
  if (slug.startsWith("weapon-base-")) {
    const base = slug.slice(12);
    const equivalent = globalThis.CONFIG?.PF2E?.equivalentWeapons?.[base];
    return set.has(`item:base:${base}`) || (!!equivalent && set.has(`item:base:${equivalent}`));
  }
  if (set.has(`item:category:${slug}`)) return true;
  const proficiency = actor.system.proficiencies?.attacks?.[slug];
  return proficiency?.definition?.test?.(set) ?? false;
}

export function defenseMatches(actor, slug) {
  const armor = actor.wornArmor;
  if (!armor) return slug === "unarmored";
  if (armor.category === slug) return true;
  return actor.system.proficiencies?.defenses?.[slug]?.definition?.test?.(new Set(armor.getRollOptions("item"))) ?? false;
}

export async function setMythic(actor, key, enabled) {
  if (actor.type !== "character" || !actor.isOwner) throw new Error("PF2E_MYTHIC.Permission");
  if (!targets(actor).some((target) => target.key === key)) throw new Error("PF2E_MYTHIC.InvalidTarget");
  return actor.update({ [`flags.${ID}.ranks.${flagKey(key)}`]: enabled === true });
}
