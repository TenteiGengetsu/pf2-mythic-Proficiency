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

/**
 * PF2e 8.6.1 internal integration: its native ModifierAdjustment contract.
 * Runs before prepareEmbeddedDocuments builds base spellcasting. Values stay
 * proficiency modifiers; PF2e still owns stacking, roll dialogs, AC and DCs.
 */
export function installAdjustments(actor) {
  if (actor.type !== "character" || !actor.synthetics?.modifierAdjustments) return;
  const record = actor.synthetics.modifierAdjustments;
  // Preparation can be repeated on synthetic/token actors. Never accumulate.
  for (const [selector, entries] of Object.entries(record)) {
    record[selector] = entries.filter((entry) => entry.mythicModule !== ID);
  }
  const add = (selector, test = () => true) => {
    (record[selector] ??= []).push({
      mythicModule: ID,
      slug: "proficiency",
      relabel: LABEL,
      test,
      getNewValue: () => mythicBonus(actor)
    });
  };
  // Skills and class data may be contributed by Items during embedded preparation.
  // Decode saved semantic keys instead of relying on already-prepared system data.
  for (const [encoded, enabled] of Object.entries(actor.flags?.[ID]?.ranks ?? {})) {
    if (enabled !== true || !/^(?:[0-9a-f]{2})+$/.test(encoded)) continue;
    const key = new TextDecoder().decode(Uint8Array.from(encoded.match(/../g), (hex) => parseInt(hex, 16)));
    if (key === "perception") add("perception");
    else if (key === "spellcasting") add("spell-attack-dc");
    else if (/^(?:save|skill|class):/.test(key)) add(key.slice(key.indexOf(":") + 1));
    else if (key.startsWith("lore:")) {
      const item = actor.items.get(key.slice(5));
      if (item?.type === "lore") add(item.slug);
    } else if (key.startsWith("attacks:")) {
      add("strike-attack-roll", (options) => attackMatches(actor, key.slice(8), options));
    } else if (key.startsWith("defenses:")) {
      add("ac", () => defenseMatches(actor, key.slice(9)));
    }
  }
}

export async function setMythic(actor, key, enabled) {
  if (actor.type !== "character" || !actor.isOwner) throw new Error("PF2E_MYTHIC.Permission");
  if (!targets(actor).some((target) => target.key === key)) throw new Error("PF2E_MYTHIC.InvalidTarget");
  return actor.update({ [`flags.${ID}.ranks.${flagKey(key)}`]: enabled === true });
}
