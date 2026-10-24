import { ID, isMythic, mythicBonus, targets, attackMatches } from "./core.mjs";

export const MYTHIC_OPTION = `${ID}:this-check`;
export const MYTHIC_SLUG = `${ID}-roll`;
const sessions = new WeakMap();
const actorQueues = new Map();
const boundDialogs = new WeakSet();
const boundRoots = new WeakSet();
const loc = (key, data) => game.i18n.localize(`PF2E_MYTHIC.${key}`, data);

function actorFor(context) {
  return context.actor ?? (context.target?.self ? context.target.actor : context.origin?.actor);
}

export function eligibleKeys(actor, check, context = {}) {
  if (actor?.type !== "character" || !actor.isOwner || actor.pack || context.isReroll || context.type === "flat-check") return [];
  const proficiency = check.modifiers.find((m) => m.slug === "proficiency" && m.type === "proficiency");
  if (!proficiency || proficiency.ignored || !proficiency.enabled || proficiency.modifier >= mythicBonus(actor)) return [];
  const domains = new Set(context.domains ?? []);
  const options = new Set(context.options ?? []);
  for (const option of context.item?.getRollOptions?.("item") ?? []) options.add(option);
  return targets(actor).filter((target) => {
    if (!isMythic(actor, target.key)) return false;
    if (target.group === "defenses") return false; // AC is not a check.
    if (target.group === "attacks") return domains.has("strike-attack-roll") && attackMatches(actor, target.slug, options);
    return domains.has(target.selector);
  }).map((target) => target.key);
}

async function withActorQueue(actor, operation) {
  const key = actor.uuid ?? actor;
  const previous = actorQueues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  actorQueues.set(key, next);
  try { return await next; }
  finally { if (actorQueues.get(key) === next) actorQueues.delete(key); }
}

export class MythicCheckSession {
  constructor(actor, source, context) {
    this.actor = actor;
    this.pointActor = (actor.uuid && globalThis.fromUuidSync?.(actor.uuid)) || actor;
    this.context = context;
    this.options = context.options instanceof Set ? context.options : new Set(context.options ?? []);
    this.options.delete(MYTHIC_OPTION);
    context.options = this.options;
    this.check = new game.pf2e.CheckModifier(source.slug, source, [], this.options);
    this.original = this.check.modifiers.find((m) => m.slug === "proficiency" && m.type === "proficiency");
    this.originalIgnored = this.original.ignored;
    this.alternative = new game.pf2e.Modifier({
      slug: MYTHIC_SLUG, label: loc("Rank"), type: "proficiency", modifier: mythicBonus(actor),
      predicate: [MYTHIC_OPTION], ignored: true, hideIfDisabled: false
    });
    this.check.push(this.alternative);
    this.mode = "normal";
    this.spent = false;
    this.finished = false;
    this.check.calculateTotal(this.options);
  }

  resource() { return this.pointActor.getResource?.("mythic-points") ?? null; }
  canSpend() {
    const resource = this.resource();
    return !!this.pointActor.isOwner && Number(resource?.max) > 0 && Number(resource?.value) >= 1;
  }

  choose(mode) {
    this.mode = mode === "mythic" && this.canSpend() ? "mythic" : "normal";
    if (this.mode === "mythic") this.options.add(MYTHIC_OPTION);
    else this.options.delete(MYTHIC_OPTION);
    this.original.ignored = this.mode === "mythic" || this.originalIgnored;
    this.check.calculateTotal(this.options);
    return this.mode;
  }

  accept(approved) {
    // The native form may receive rapid repeated submissions. Resolve once.
    return (this.acceptance ??= this._accept(approved));
  }

  async _accept(approved) {
    if (!approved) return false;
    if (this.mode !== "mythic") { this.commit(); return true; }
    try {
      await withActorQueue(this.pointActor, async () => {
        if (!this.canSpend()) throw new Error("PF2E_MYTHIC.NoPoints");
        const value = Number(this.resource().value);
        await this.pointActor.updateResource("mythic-points", value - 1);
        this.spent = true;
      });
      this.commit();
      return true;
    } catch (error) {
      console.error(`${ID} | Mythic point payment failed`, error);
      ui.notifications.warn(game.i18n.has(error.message) ? game.i18n.localize(error.message) : loc("PointError"));
      return false;
    }
  }

  commit() {
    if (this.committed) return;
    // PF2e's native reroll reads a single proficiency from message flags.
    // Keep both choices in the dialog, but serialize only the chosen one.
    const unused = this.mode === "mythic" ? this.original : this.alternative;
    this.check.delete(unused);
    if (this.mode === "mythic") this.alternative.slug = "proficiency";
    this.committed = true;
  }

  async finish(rolled) {
    if (this.finished) return;
    this.finished = true;
    this.options.delete(MYTHIC_OPTION);
    // If dice evaluation is cancelled or fails, restore the reserved point.
    if (this.spent && !rolled) {
      await withActorQueue(this.pointActor, async () => {
        const resource = this.resource();
        await this.pointActor.updateResource("mythic-points", Math.min(resource.max, Number(resource.value) + 1));
      });
      this.spent = false;
    }
  }
}

export function prepareSession(check, context) {
  const actor = actorFor(context);
  return eligibleKeys(actor, check, context).length ? new MythicCheckSession(actor, check, context) : null;
}

function renderChoices(app, html) {
  const session = sessions.get(app.check);
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!session || !root) return;
  const originals = [session.original, session.alternative];
  for (const [index, modifier] of app.check.modifiers.entries()) {
    if (!originals.includes(modifier)) continue;
    const input = root.querySelector(`input[data-modifier-index="${index}"]`);
    if (!input) continue;
    const mythic = modifier === session.alternative;
    input.type = "radio";
    input.name = `${ID}-${app.id}`;
    input.dataset.mythicChoice = mythic ? "mythic" : "normal";
    input.checked = session.mode === input.dataset.mythicChoice;
    input.disabled = mythic && !session.canSpend();
    const toggle = input.closest("label.toggle");
    if (toggle) {
      toggle.classList.remove("toggle");
      toggle.classList.add("mythic-radio-control");
      toggle.querySelector(".widget")?.remove();
    }
    const row = input.closest(".dialog-row");
    if (row) {
      row.classList.remove("hidden");
      row.classList.toggle("off", !input.checked);
      row.classList.toggle("mythic-roll-choice", mythic);
      const label = row.querySelector(".mod");
      if (label) label.textContent = mythic ? loc("MythicCheck") : loc("OriginalCheck", { rank: modifier.label });
      input.setAttribute("aria-label", label?.textContent ?? loc("Rank"));
    }
  }
  let status = root.querySelector(".mythic-point-status");
  if (!status) {
    status = document.createElement("p");
    status.className = "mythic-point-status";
    root.querySelector(".modifier-container")?.after(status);
  }
  status.textContent = loc("Points", { value: session.resource()?.value ?? 0 }) + (session.canSpend() ? "" : ` · ${loc("NoPoints")}`);

  // A new native dialog body is created after each modifier change.
  if (!boundRoots.has(root)) root.addEventListener("click", (event) => {
    const input = event.target.closest?.("input[data-mythic-choice]");
    if (!input) return;
    event.stopImmediatePropagation();
    session.choose(input.dataset.mythicChoice);
    app.render(false);
  }, true);
  boundRoots.add(root);
  if (!boundDialogs.has(app)) {
    boundDialogs.add(app);
    const resolve = app.resolve.bind(app);
    app.resolve = (approved) => { void session.accept(approved).then(resolve); };
  }
}

export function installRollIntegration() {
  const Check = game.pf2e.Check;
  if (!Check || typeof Check.roll !== "function" || !game.pf2e.CheckModifier || !game.pf2e.Modifier) throw new Error("PF2E_MYTHIC.Unsupported");
  const original = Check.roll;
  Check.roll = async function (check, context = {}, event = null, callback) {
    const session = prepareSession(check, context);
    if (!session) return original.call(this, check, context, event, callback);
    sessions.set(session.check, session);
    let rolled = false;
    try {
      const onRoll = async (...args) => {
        // The native callback runs after dice/message creation. A downstream
        // macro error must not refund a check that has already been rolled.
        rolled = !!args[0];
        if (callback) return callback(...args);
      };
      const result = await original.call(this, session.check, context, event, onRoll);
      rolled ||= !!result;
      return result;
    } finally {
      sessions.delete(session.check);
      await session.finish(rolled);
    }
  };
  Hooks.on("renderCheckModifiersDialog", renderChoices);
  return true;
}
