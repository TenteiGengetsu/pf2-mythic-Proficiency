import { ID, MYTHIC, LABEL, flagKey, isMythic, mythicBonus, targets, installAdjustments, setMythic } from "./core.mjs";

const localize = (key, data) => game.i18n.localize(`PF2E_MYTHIC.${key}`, data);
const boundRoots = new WeakSet();
let installed = false;

function installIntegration() {
  if (installed || game.system.id !== "pf2e") return;
  const proto = CONFIG.PF2E?.Actor?.documentClasses?.character?.prototype;
  if (!proto || typeof proto.prepareEmbeddedDocuments !== "function") {
    throw new Error("PF2E_MYTHIC.Unsupported");
  }
  // A narrow chained wrapper, preserving receiver, arguments and return value.
  // This method is internal to PF2e, pinned to 8.6.1 in the manifest.
  const original = proto.prepareEmbeddedDocuments;
  proto.prepareEmbeddedDocuments = function (...args) {
    installAdjustments(this);
    return original.apply(this, args);
  };
  installed = true;
}

function asElement(html) {
  return html instanceof HTMLElement ? html : html?.[0] instanceof HTMLElement ? html[0] : null;
}

function targetForSelect(actor, select, list) {
  if (select.dataset.mythicKey) return list.find((t) => t.key === select.dataset.mythicKey);
  const itemId = select.closest("[data-item-id]")?.dataset.itemId;
  const property = select.dataset.itemProperty;
  if (property && itemId) return list.find((t) => t.itemId === itemId && t.path === property);
  const propertyPath = select.dataset.property ?? select.name;
  return list.find((t) => !t.itemId && t.path === propertyPath);
}

function targetForBadge(actor, badge, list) {
  if (badge.closest(".perception")) return list.find((t) => t.key === "perception");
  const save = badge.closest("[data-save]")?.dataset.save;
  if (save) return list.find((t) => t.key === `save:${save}`);
  if (badge.closest(".spellcasting-prof")) {
    // Ephemeral ritual/activation entries do not necessarily use spell proficiency.
    const entryId = badge.closest("[data-item-id]")?.dataset.itemId;
    const entry = actor.items.get(entryId);
    if (!entry?.isOfType("spellcastingEntry")) return null;
    const base = entry.system.proficiency.slug;
    // Entries linked to class DCs or skills follow that statistic's proficiency.
    return base ? list.find((t) => t.selector === base && !t.group) : list.find((t) => t.key === "spellcasting");
  }
  const row = badge.closest("li");
  const slug = row?.dataset.slug;
  if (slug === "spellcasting") return list.find((t) => t.key === "spellcasting");
  if (slug && row?.closest(".combat-list")) return list.find((t) => t.key === `defenses:${slug}`);
  const tooltip = row?.querySelector(".dc[data-tooltip-content]")?.dataset.tooltipContent;
  if (tooltip) return list.find((t) => t.key.startsWith("class:") && tooltip.endsWith(`-${t.selector}-modifiers`));
  return null;
}

function paint(select, actor, target) {
  const active = isMythic(actor, target.key);
  const rank = Number(select.value);
  select.dataset.rank = String(active ? MYTHIC : rank);
  select.classList.toggle("mythic-active", active);
  select.title = active ? localize("Hint", { bonus: mythicBonus(actor) }) : localize("SelectHint");
  select.setAttribute("aria-label", localize("SelectHint"));
}

function addControls(app, html) {
  const actor = app.actor ?? app.document;
  const root = asElement(html);
  if (!installed || actor?.type !== "character" || !root) return;
  const editable = actor.isOwner && app.isEditable !== false && !actor.pack;
  const list = targets(actor);
  for (const select of root.querySelectorAll("select.pf-rank")) {
    const target = targetForSelect(actor, select, list);
    if (!target) continue;
    const systemOnly = select.classList.contains("readonly") || select.disabled;
    if (systemOnly && editable) {
      // Automatic ranks remain automatic: expose only System and Mythic.
      const rank = Number(select.dataset.rank ?? select.value);
      select.replaceChildren(new Option(localize("SystemRank", { rank: game.i18n.localize(`PF2E.ProficiencyLevel${rank}`) }), "system"));
      select.dataset.mythicSystemRank = String(rank);
      select.classList.remove("readonly");
      select.disabled = false;
    }
    if (!select.querySelector('option[value="5"]')) select.add(new Option(localize("Rank"), String(MYTHIC)));
    select.dataset.mythicKey = target.key;
    select.classList.add("mythic-control");
    if (isMythic(actor, target.key)) select.value = String(MYTHIC);
    if (!editable) select.disabled = true;
    paint(select, actor, target);
    if (select.value === "system") select.dataset.rank = select.dataset.mythicSystemRank;
  }
  for (const badge of root.querySelectorAll("span.pf-rank")) {
    const target = targetForBadge(actor, badge, list);
    if (!target) continue;
    if (!editable) {
      if (isMythic(actor, target.key)) {
        badge.textContent = localize("Rank");
        badge.dataset.rank = String(MYTHIC);
        badge.classList.add("mythic-active");
      }
      continue;
    }
    const rank = Number(badge.dataset.rank ?? 0);
    const select = document.createElement("select");
    select.className = "pf-rank mythic-control";
    select.dataset.mythicKey = target.key;
    select.dataset.mythicSystemRank = String(rank);
    select.add(new Option(localize("SystemRank", { rank: game.i18n.localize(`PF2E.ProficiencyLevel${rank}`) }), "system"));
    select.add(new Option(localize("Rank"), String(MYTHIC)));
    select.value = isMythic(actor, target.key) ? String(MYTHIC) : "system";
    paint(select, actor, target);
    if (select.value === "system") select.dataset.rank = String(rank);
    badge.replaceWith(select);
  }
  // CharacterSheetPF2e.getData recomputes these display-only values with domains: [].
  // The underlying Strike/AC uses the real synthetic; keep the list in agreement.
  for (const select of root.querySelectorAll("select[data-mythic-key]")) {
    if (!isMythic(actor, select.dataset.mythicKey)) continue;
    if (/^(attacks|defenses):/.test(select.dataset.mythicKey)) {
      const value = select.closest("li")?.querySelector(".modifier");
      if (value) {
        value.textContent = `+${mythicBonus(actor)}`;
        value.dataset.tooltip = localize("Hint", { bonus: mythicBonus(actor) });
      }
    }
  }
  // Do this on every render, including applications which reuse their root.
  // Never submit the virtual rank through a native system data field.
  for (const select of root.querySelectorAll("select[data-mythic-key]")) {
    if (select.value === "5" && select.name) {
      select.dataset.mythicOriginalName = select.name;
      select.removeAttribute("name");
    }
  }
  if (boundRoots.has(root)) return;
  boundRoots.add(root);
  // Capture before PF2e handlers reject/clamp the virtual rank 5.
  root.addEventListener("change", (event) => {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement) || !select.dataset.mythicKey) return;
    const target = targets(actor).find((t) => t.key === select.dataset.mythicKey);
    if (!target) return;
    const active = isMythic(actor, target.key);
    if (select.value !== "5" && !active && !select.dataset.mythicSystemRank) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    if (!actor.isOwner || app.isEditable === false || actor.pack || select.dataset.mythicPending) return;
    select.dataset.mythicPending = "true";
    select.disabled = true;
    void updateSelection(actor, target, select).catch((error) => {
      console.error(`${ID} |`, error);
      ui.notifications.error(game.i18n.has(error.message) ? game.i18n.localize(error.message) : localize("UpdateError"));
    }).finally(() => app.render(false));
  }, true);
}

async function updateSelection(actor, target, select) {
  const value = select.value;
  if (value === "5") return setMythic(actor, target.key, true);
  const flagPath = `flags.${ID}.ranks.${flagKey(target.key)}`;
  if (value === "system") return actor.update({ [flagPath]: false });
  const rank = Number(value);
  if (!Number.isInteger(rank) || rank < 0 || rank > 4) throw new Error("PF2E_MYTHIC.InvalidTarget");
  if (target.itemId) {
    // Lore and its flag live on different Documents; clear first, then update.
    await actor.update({ [flagPath]: false });
    return actor.items.get(target.itemId).update({ [target.path]: rank });
  }
  return actor.update({ [flagPath]: false, [target.path]: rank });
}

Hooks.once("init", () => {
  if (game.system.id !== "pf2e") return;
  try {
    installIntegration();
    game.modules.get(ID).api = Object.freeze({
      rank: MYTHIC,
      slug: "mythic",
      isMythic,
      bonus: mythicBonus,
      targets,
      set: setMythic
    });
  } catch (error) {
    console.error(`${ID} | Could not install integration`, error);
  }
});

Hooks.on("renderActorSheet", addControls);
Hooks.on("renderActorSheetV2", addControls);
Hooks.once("ready", () => {
  if (game.system.id !== "pf2e") return;
  if (!installed) return ui.notifications.error(localize("Unsupported"));
  console.info(`${ID} | Foundry ${game.version}, PF2e ${game.system.version}; virtual rank mythic (5), bonus level + 10`);
});
