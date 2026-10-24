import { readFile, mkdir } from "node:fs/promises";
import { clone, mergeObject, runtimeSources } from "./pf2e-runtime.mjs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_URL ?? "playwright");

export async function harness() {
  const files = Object.fromEntries(await Promise.all(["scripts/main.mjs", "scripts/core.mjs", "scripts/rolls.mjs", "styles/mythic.css", "lang/cn.json", "lang/en.json"].map(async (name) => [name, await readFile(new URL(`../${name}`, import.meta.url), "utf8")])));
  await mkdir(new URL("../.test-results/", import.meta.url), { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://fvtt.test/**", async (route) => {
    const name = new URL(route.request().url()).pathname.slice(1);
    if (!name) return route.fulfill({ contentType: "text/html", body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>" });
    return route.fulfill({ status: files[name] ? 200 : 404, contentType: name.endsWith(".mjs") ? "text/javascript" : "text/plain", body: files[name] ?? "Not found" });
  });
  await page.goto("https://fvtt.test/");
  await page.evaluate(({ cn, en }) => {
    window.dicts = { cn: JSON.parse(cn), en: JSON.parse(en) }; window.language = "cn";
    const events = new Map();
    window.Hooks = {
      on(name, fn) { events.set(name, [...(events.get(name) ?? []), fn]); },
      once(name, fn) { const once = (...args) => { events.set(name, (events.get(name) ?? []).filter((f) => f !== once)); fn(...args); }; this.on(name, once); },
      dispatch(name, ...args) { for (const fn of events.get(name) ?? []) fn(...args); }
    };
    const rankNames = () => language === "cn" ? ["未受训", "受训", "专家", "大师", "传奇"] : ["Untrained", "Trained", "Expert", "Master", "Legendary"];
    window.game = {
      version: "14.369", system: { id: "pf2e", version: "8.6.1" }, user: { isGM: true, settings: { showCheckDialogs: true } },
      modules: new Map([["pf2e-mythic-proficiency", {}]]),
      i18n: {
        localize(key, data = {}) {
          const value = /^PF2E.ProficiencyLevel[0-4]$/.test(key) ? rankNames()[Number(key.at(-1))] : key.split(".").reduce((obj, part) => obj?.[part], dicts[language]) ?? key;
          return String(value).replace(/\{(\w+)\}/g, (_, part) => String(data[part] ?? part));
        }, has(key) { return this.localize(key) !== key; }
      }, pf2e: { settings: { variants: { pwol: { enabled: false, modifiers: [0, 2, 4, 6, 8] } } } }
    };
    window.CONFIG = { PF2E: { damageTypes: {}, abilities: { str: "STR", int: "INT" }, equivalentWeapons: {} } };
    window.messages = []; window.notifications = []; window.dialogs = new Map();
    window.ui = { notifications: { warn: (message) => notifications.push(message), error: (message) => notifications.push(message) } };
    window.actor = {
      id: "test", uuid: "Actor.test", type: "character", isOwner: true, level: 10, flags: {}, items: new Map(), itemTypes: { lore: [] }, updates: [], resourceUpdates: [],
      system: { resources: { mythicPoints: { value: 3, max: 3 } }, skills: { athletics: { rank: 1 } }, proficiencies: { attacks: {}, defenses: {}, classDCs: { fighter: { rank: 2 }, wizard: { rank: 3 } }, spellcasting: { rank: 1 } } },
      synthetics: { modifierAdjustments: { all: [], damage: [] }, modifiers: { all: [] } },
      getResource() { return { ...this.system.resources.mythicPoints, slug: "mythic-points" }; },
      async updateResource(slug, value) { this.resourceUpdates.push({ slug, value }); await this.update({ "system.resources.mythicPoints.value": value }); },
      async update(changes) {
        this.updates.push(changes);
        for (const [key, value] of Object.entries(changes)) { const parts = key.split("."); const last = parts.pop(); const obj = parts.reduce((target, part) => (target[part] ??= {}), this); obj[last] = value; }
        return this;
      }
    };
    for (const [id, slug] of [["entry1", ""], ["entry2", "fighter"], ["entry3", "wizard"]]) actor.items.set(id, { id, type: "spellcastingEntry", isOfType: (type) => type === "spellcastingEntry", system: { proficiency: { slug } } });
    window.fromUuidSync = (uuid) => uuid === actor.uuid ? actor : null;
    window.app = { id: "test", actor, isEditable: true, render() {} };
    let sequence = 0;
    class NativeDialogFixture {
      constructor(check, resolve, context) { Object.assign(this, { check, resolve, context, id: `roll${sequence++}`, isResolved: false }); dialogs.set(this.id, this); window.lastDialog = this; }
      render() {
        if (!this.element) { this.element = document.createElement("div"); this.element.className = "roll-modifiers-dialog"; this.element.dataset.dialog = this.id; document.body.append(this.element); }
        this.element.replaceChildren();
        const form = document.createElement("form"); form.className = "check-modifiers-content";
        const container = document.createElement("div"); container.className = "modifier-container";
        for (const [index, modifier] of this.check.modifiers.entries()) {
          const row = document.createElement("div"); row.className = `dialog-row${modifier.enabled ? "" : " off"}`;
          const label = document.createElement("span"); label.className = "mod"; label.textContent = modifier.label;
          const value = document.createElement("span"); value.className = "value"; value.textContent = String(modifier.modifier);
          const input = document.createElement("input"); input.type = "checkbox"; input.checked = modifier.enabled; input.dataset.modifierIndex = String(index);
          input.addEventListener("click", () => { this.check.modifiers[index].ignored = !input.checked; this.check.calculateTotal(); this.render(); });
          const exclude = document.createElement("div"); exclude.className = "exclude";
          const toggle = document.createElement("label"); toggle.className = "toggle";
          const widget = document.createElement("span"); widget.className = "widget";
          toggle.append(input, widget); exclude.append(toggle);
          row.append(label, value, exclude); container.append(row);
        }
        const submit = document.createElement("button"); submit.type = "submit"; submit.textContent = `Roll (${this.check.totalModifier})`;
        const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "cancel"; cancel.textContent = "Cancel"; cancel.onclick = () => this.close();
        form.append(container, submit, cancel); this.element.append(form);
        // Same resolution order as the audited CheckModifiersDialog source.
        form.addEventListener("submit", (event) => { event.preventDefault(); this.resolve(true); this.isResolved = true; this.close(); });
        Hooks.dispatch("renderCheckModifiersDialog", this, this.element);
        return this;
      }
      close() { if (!this.isResolved) this.resolve(false); this.element?.remove(); dialogs.delete(this.id); }
    }
    game.pf2e.Check = class {
      static async roll(check, context = {}, event, callback) {
        context.options ??= new Set();
        if (!context.isReroll) check.calculateTotal(context.options);
        const skip = context.skipDialog ?? !game.user.settings.showCheckDialogs;
        if (!skip && !await new Promise((resolve) => new NativeDialogFixture(check, resolve, context).render())) return null;
        if (window.failDice) throw new Error("Dice evaluation failed");
        if (window.cancelDice) return null;
        const result = { totalModifier: check.totalModifier, options: [...context.options], modifiers: check.modifiers.map((m) => ({ slug: m.slug, modifier: m.modifier, enabled: m.enabled, ignored: m.ignored, type: m.type })) };
        messages.push(result);
        if (callback) await callback(result, null, { id: "message" }, event);
        return result;
      }
    };
  }, { cn: files["lang/cn.json"], en: files["lang/en.json"] });
  const prefix = `
    const clone = ${clone.toString()};
    const mergeObject = ${mergeObject.toString()};
    const R = {unique: xs=>[...new Set(xs)],isTruthy:Boolean,isPlainObject:x=>!!x&&Object.getPrototypeOf(x)===Object.prototype,isObjectType:x=>x!==null&&typeof x==='object',omit:(o,keys)=>Object.fromEntries(Object.entries(o).filter(([key])=>!keys.includes(key)))};
    const fu = {deepClone:clone,mergeObject};
    const _loc = (key,data)=>game.i18n.localize(key,data);
    const setHasElement=(set,x)=>set.has(x),objectHasKey=(obj,key)=>Object.hasOwn(obj,key),tupleHasValue=(xs,x)=>xs.includes(x),sluggify=x=>String(x).toLowerCase().replaceAll(' ','-'),signedInteger=x=>(x>=0?'+':'')+x,ErrorPF2e=s=>new Error(s);
    const DamageCategorization={fromDamageType:()=>null};
    const extractModifierAdjustments=(record,selectors,slug)=>[...new Set(selectors.flatMap(s=>record[s]??[]))].filter(a=>a.slug===slug||a.slug===null);
    const extractModifiers=(synthetics,selectors)=>[...new Set(selectors)].flatMap(s=>synthetics.modifiers[s]??[]).flatMap(f=>f({})??[]);
    Math.clamp=(n,lo,hi)=>Math.min(hi,Math.max(lo,n));
    Object.defineProperty(Array.prototype,'findSplice',{configurable:true,value:function(predicate){const index=this.findIndex(predicate);return index<0?undefined:this.splice(index,1)[0];}});
  `;
  await page.addScriptTag({ content: prefix + runtimeSources.join("\n") + "\nObject.assign(game.pf2e,{Modifier,CheckModifier});" });
  await page.addStyleTag({ content: files["styles/mythic.css"] });
  await page.evaluate(async () => {
    await import("https://fvtt.test/scripts/main.mjs"); Hooks.dispatch("init"); Hooks.dispatch("ready");
    window.api = game.modules.get("pf2e-mythic-proficiency").api;
    window.startCheck = (extra = {}) => {
      const { Modifier, CheckModifier } = game.pf2e;
      const source = new CheckModifier("athletics", { modifiers: [new Modifier({ slug: "proficiency", type: "proficiency", label: game.i18n.localize("PF2E.ProficiencyLevel1"), modifier: 12 }), new Modifier({ slug: "str", type: "ability", label: "STR", modifier: 4 })] });
      window.lastSource = source;
      window.rollResult = "pending";
      const callback = window.throwCallback ? async () => { throw new Error("Downstream callback failed"); } : undefined;
      window.rollPromise = game.pf2e.Check.roll(source, { actor, type: "skill-check", domains: ["athletics", "all"], options: new Set(["self:type:character"]), ...extra }, null, callback);
      rollPromise.then((result) => { window.rollResult = result; }, (error) => { window.rollError = error.message; window.rollResult = null; });
    };
  });
  return { browser, page, errors };
}
