import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_URL ?? "playwright");
const base = new URL("../", import.meta.url);
const files = Object.fromEntries(await Promise.all(["scripts/main.mjs", "scripts/core.mjs", "styles/mythic.css", "lang/cn.json", "lang/en.json"].map(async (name) => [name, await readFile(new URL(name, base), "utf8")])));
await mkdir(new URL("../.test-results/", import.meta.url), { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://fvtt.test/**", async (route) => {
    const file = new URL(route.request().url()).pathname.slice(1);
    if (!file) return route.fulfill({ contentType: "text/html", body: "<!doctype html><html><head><meta charset='utf-8'></head><body><div id='sheet' class='default sheet actor character'></div></body></html>" });
    if (files[file]) return route.fulfill({ contentType: file.endsWith("mjs") ? "text/javascript" : "text/plain", body: files[file] });
    return route.fulfill({ status: 404, body: "Not found" });
  });
  await page.goto("https://fvtt.test/");
  await page.addStyleTag({ content: `body{font:16px system-ui;background:#171c27;color:#ded9d1;padding:35px}.sheet{background:#efe7da;color:#2e241e;padding:24px;width:650px}h1{font-size:24px}h2{font-size:17px;margin-top:25px}li,.roll-data{display:flex;gap:20px;margin:10px 0;align-items:center}li .name{min-width:180px}.pf-rank{display:block;width:4.25rem;height:1.125rem;box-sizing:border-box;font-size:12px;text-align:center;padding:1px;border:1px solid #211;color:white;background:#777}.pf-rank[data-rank="1"],option[value="1"]{background:#171d65}.pf-rank[data-rank="2"],option[value="2"]{background:#3b005b}.pf-rank[data-rank="3"],option[value="3"]{background:#805700}.pf-rank[data-rank="4"],option[value="4"]{background:#7c0900}small{color:#6d6256}.readonly{pointer-events:none}${files["styles/mythic.css"]}` });
  await page.evaluate(({ cn, en }) => {
    window.dicts = { cn: JSON.parse(cn), en: JSON.parse(en) }; window.language = "cn";
    const handlers = new Map();
    window.Hooks = {
      once: (hook, fn) => { const wrapper = (...args) => { fn(...args); handlers.set(hook, (handlers.get(hook) ?? []).filter((f) => f !== wrapper)); }; handlers.set(hook, [...(handlers.get(hook) ?? []), wrapper]); },
      on: (hook, fn) => handlers.set(hook, [...(handlers.get(hook) ?? []), fn]),
      dispatch: (hook, ...args) => { for (const fn of handlers.get(hook) ?? []) fn(...args); }
    };
    const loc = (key, data = {}) => {
      const native = language === "cn" ? ["未受训", "受训", "专家", "大师", "传奇"] : ["Untrained", "Trained", "Expert", "Master", "Legendary"];
      let value = /^PF2E.ProficiencyLevel[0-4]$/.test(key) ? native[Number(key.at(-1))] : key.split(".").reduce((v, k) => v?.[k], dicts[language]) ?? key;
      return value.replace(/\{(\w+)\}/g, (_, name) => String(data[name] ?? `{${name}}`));
    };
    window.game = { version: "14.369", system: { id: "pf2e", version: "8.6.1" },
      modules: new Map([["pf2e-mythic-proficiency", {}]]), user: { isGM: true },
      i18n: { localize: loc, has: (key) => loc(key) !== key },
      pf2e: { settings: { variants: { pwol: { enabled: false } } } } };
    window.notifications = []; window.ui = { notifications: { error: (s) => notifications.push(s) } };
    class CharacterFixture { prepareEmbeddedDocuments() { this.originalCalls = (this.originalCalls ?? 0) + 1; this.sawEarlySpellAdjustment = this.synthetics.modifierAdjustments["spell-attack-dc"]?.length ?? 0; return "original-result"; } }
    window.CONFIG = { PF2E: { Actor: { documentClasses: { character: CharacterFixture } } } };
    window.actor = Object.assign(new CharacterFixture(), {
      type: "character", level: 10, isOwner: true, flags: {},
      itemTypes: { lore: [] }, items: new Map(), synthetics: { modifierAdjustments: { all: [], damage: [] } },
      system: { skills: { athletics: { rank: 1 }, stealth: { rank: 4 } },
        proficiencies: { attacks: { martial: { rank: 2 } }, defenses: { heavy: { rank: 1 } }, classDCs: { fighter: { rank: 2 } }, spellcasting: { rank: 1 } } },
      updates: [],
      async update(changes) {
        this.updates.push(changes);
        for (const [key, value] of Object.entries(changes)) {
          const keys = key.split("."); const last = keys.pop(); const obj = keys.reduce((o, k) => (o[k] ??= {}), this); obj[last] = value;
        }
        return this;
      }
    });
    const lore = { id: "lore1", type: "lore", slug: "sailing-lore", system: { proficient: { value: 1 } }, updates: [], async update(changes) { this.updates.push(changes); this.system.proficient.value = changes["system.proficient.value"]; return this; } };
    actor.itemTypes.lore.push(lore); actor.items.set(lore.id, lore);
    actor.items.set("spells1", { type: "spellcastingEntry", isOfType: (x) => x === "spellcastingEntry", system: { proficiency: { slug: "" } } });
    actor.items.set("spells2", { type: "spellcastingEntry", isOfType: (x) => x === "spellcastingEntry", system: { proficiency: { slug: "fighter" } } });
    const options = (rank) => [0, 1, 2, 3, 4].map((n) => `<option value='${n}' ${rank === n ? "selected" : ""}>${loc(`PF2E.ProficiencyLevel${n}`)}</option>`).join("");
    window.app = { actor, isEditable: true, render: () => renderFixture() };
    window.nativeChanges = [];
    window.renderFixture = () => {
      const root = document.querySelector("#sheet");
      root.innerHTML = `<h1>${language === "cn" ? "神话熟练度 · 角色卡界面验证" : "Mythic proficiency · Sheet UI check"}</h1><small>Foundry 14.369 · PF2e 8.6.1 · DOM fixture</small>
      <h2>技能 / Skills</h2><ul><li><span class='name'>运动 Athletics</span><select class='pf-rank' name='system.skills.athletics.rank' data-property='system.skills.athletics.rank' data-rank='${actor.system.skills.athletics.rank}'>${options(actor.system.skills.athletics.rank)}</select></li>
      <li><span class='name'>隐匿 Stealth</span><select class='pf-rank' data-property='system.skills.stealth.rank' data-rank='4'>${options(4)}</select></li>
      <li class='item' data-item-id='lore1'><span class='name'>航海学识 Sailing Lore</span><select class='pf-rank adjust-item-stat-select' data-item-property='system.proficient.value' data-rank='${lore.system.proficient.value}'>${options(lore.system.proficient.value)}</select></li></ul>
      <h2>攻击与防御 / Attacks & Defenses</h2><ul class='combat-list'><li data-slug='martial'><span class='modifier'>+14</span><span class='name'>军用武器 Martial weapons</span><select class='pf-rank readonly' data-property='system.proficiencies.attacks.martial.rank' data-rank='2'>${options(2)}</select></li></ul>
      <ul class='combat-list'><li data-slug='heavy'><span class='modifier'>+12</span><span class='name'>重甲 Heavy armor</span><span class='pf-rank' data-rank='1'>${loc("PF2E.ProficiencyLevel1")}</span></li></ul>
      <h2>察觉与豁免 / Perception & Saves</h2><section class='perception'><div class='roll-data'><span class='name'>察觉 Perception</span><span class='pf-rank' data-rank='2'>${loc("PF2E.ProficiencyLevel2")}</span></div></section><ul><li data-save='will'><span class='name'>意志 Will</span><span class='pf-rank' data-rank='1'>${loc("PF2E.ProficiencyLevel1")}</span></li></ul>
      <h2>职业与法术 / Class & Spells</h2><ul><li><a class='dc' data-tooltip-content='#fixture-fighter-modifiers'>24</a><span class='name'>战士职业 DC</span><span class='pf-rank' data-rank='2'>${loc("PF2E.ProficiencyLevel2")}</span></li>
      <li data-slug='spellcasting'><span class='modifier'>+12</span><span class='name'>基础施法 Spellcasting</span><span class='pf-rank' data-rank='1'>${loc("PF2E.ProficiencyLevel1")}</span></li>
      <li class='item spellcasting-entry' data-item-id='spells1'><span class='name'>法术条目 Entry</span><div class='spellcasting-prof'><span class='pf-rank' data-rank='1'>${loc("PF2E.ProficiencyLevel1")}</span></div></li>
      <li class='item spellcasting-entry' data-item-id='spells2'><span class='name'>职业绑定法术 Class-linked</span><div class='spellcasting-prof'><span class='pf-rank' data-rank='2'>${loc("PF2E.ProficiencyLevel2")}</span></div></li></ul>`;
      for (const select of root.querySelectorAll("select")) select.addEventListener("change", () => nativeChanges.push(select.value));
      Hooks.dispatch("renderActorSheet", app, root);
      return root;
    };
  }, { cn: files["lang/cn.json"], en: files["lang/en.json"] });
  await page.evaluate(async () => { await import("https://fvtt.test/scripts/main.mjs"); Hooks.dispatch("init"); Hooks.dispatch("ready"); renderFixture(); });
  const control = (key) => page.locator(`select[data-mythic-key="${key}"]`).first();
  let count = 0;
  const pass = (s) => { count++; console.log(`PASS ${s}`); };
  assert.equal(await control("skill:athletics").locator("option[value='5']").textContent(), "神话");
  assert.equal(await page.locator("select[data-mythic-key]").count(), 11);
  pass("native dropdowns, automatic badges, lore and spell/class bindings get controls");
  for (const [key, rank] of [["perception", "专家"], ["save:will", "受训"], ["attacks:martial", "专家"], ["defenses:heavy", "受训"], ["class:fighter", "专家"], ["spellcasting", "受训"]]) {
    assert.equal(await control(key).locator("option[value='system']").textContent(), rank);
    assert.equal(await control(key).evaluate((el) => getComputedStyle(el).width), "68px");
  }
  pass("automatic badges keep native rank text and compact sheet width without a system suffix");
  assert.equal(await page.locator(".pf2e").count(), 0);
  assert.equal(await control("skill:athletics").locator("option[value='5']").evaluate((el) => getComputedStyle(el).backgroundColor), "rgb(212, 175, 55)");
  assert.equal(await control("skill:athletics").evaluate((el) => getComputedStyle(el).backgroundColor), "rgb(23, 29, 101)");
  assert.equal(await control("skill:stealth").evaluate((el) => getComputedStyle(el).backgroundColor), "rgb(124, 9, 0)");
  const unrelated = await page.evaluate(() => {
    const select = document.createElement("select");
    select.className = "pf-rank"; select.dataset.rank = "5";
    select.add(new Option("Unrelated rank", "5")); document.body.append(select);
    const color = getComputedStyle(select).backgroundColor;
    const optionColor = getComputedStyle(select.options[0]).backgroundColor;
    select.remove(); return { color, optionColor };
  });
  assert.notEqual(unrelated.color, "rgb(212, 175, 55)");
  assert.notEqual(unrelated.optionColor, "rgb(212, 175, 55)");
  pass("gold dropdown option works without .pf2e ancestor; native ranks and unrelated controls keep their colors");
  await control("skill:athletics").selectOption("5");
  await page.waitForFunction(() => !!document.querySelector('select[data-mythic-key="skill:athletics"].mythic-active'));
  assert.equal(await control("skill:athletics").evaluate((el) => getComputedStyle(el).backgroundColor), "rgb(212, 175, 55)");
  assert.equal(await control("skill:athletics").getAttribute("name"), null);
  assert.deepEqual(await page.evaluate(() => nativeChanges), []);
  assert.equal(await page.evaluate(() => actor.system.skills.athletics.rank), 1);
  pass("rank 5 is captured before system handlers, gold, and excluded from form data");
  await control("skill:athletics").selectOption("4");
  await page.waitForFunction(() => document.querySelector('select[data-mythic-key="skill:athletics"]').value === "4");
  assert.equal(await page.evaluate(() => actor.system.skills.athletics.rank), 4);
  assert.equal(await control("skill:athletics").evaluate((el) => el.classList.contains("mythic-active")), false);
  pass("returning to ordinary rank clears flag and saves valid system rank");
  await control("attacks:martial").selectOption("5");
  await page.waitForFunction(() => document.querySelector('select[data-mythic-key="attacks:martial"]').value === "5");
  assert.equal(await control("attacks:martial").locator("option").count(), 2);
  assert.equal(await control("attacks:martial").evaluate((el) => el.closest("li").querySelector(".modifier").textContent), "+20");
  await control("attacks:martial").selectOption("system");
  await page.waitForFunction(() => document.querySelector('select[data-mythic-key="attacks:martial"]').value === "system");
  assert.equal(await page.evaluate(() => actor.system.proficiencies.attacks.martial.rank), 2);
  pass("automatic attack rank toggles Mythic/System without rewriting class progression");
  await control("lore:lore1").selectOption("5");
  await page.waitForFunction(() => document.querySelector('select[data-mythic-key="lore:lore1"]').value === "5");
  await control("lore:lore1").selectOption("2");
  await page.waitForFunction(() => actor.items.get("lore1").system.proficient.value === 2);
  pass("lore updates its owned Item and Actor flag correctly");
  await control("spellcasting").selectOption("5");
  await page.waitForFunction(() => document.querySelector('select[data-mythic-key="spellcasting"]').value === "5");
  const wrapper = await page.evaluate(() => { const result = actor.prepareEmbeddedDocuments(); return { result, calls: actor.originalCalls, early: actor.sawEarlySpellAdjustment }; });
  assert.deepEqual(wrapper, { result: "original-result", calls: 1, early: 1 });
  pass("integration chains original method and injects before base spellcasting is built");
  await control("defenses:heavy").selectOption("5");
  await page.waitForFunction(() => document.querySelector('select[data-mythic-key="defenses:heavy"]').value === "5");
  await control("perception").selectOption("5");
  await page.waitForFunction(() => document.querySelector('select[data-mythic-key="perception"]').value === "5");
  await page.evaluate(() => { Hooks.dispatch("renderActorSheet", app, document.querySelector("#sheet")); });
  assert.equal(await control("perception").locator("option[value='5']").count(), 1);
  pass("repeat renders preserve flags and do not duplicate options");
  await page.screenshot({ path: fileURLToPath(new URL("../.test-results/ui-cn.png", import.meta.url)), fullPage: true });
  await page.evaluate(() => { language = "en"; renderFixture(); });
  assert.equal(await control("save:will").locator("option[value='system']").textContent(), "Trained");
  assert.equal(await control("perception").locator("option[value='5']").textContent(), "Mythic");
  assert.ok(!(await control("perception").getAttribute("title")).includes("PF2E_MYTHIC"));
  pass("English Mythic and translated tooltips resolve correctly");
  await page.evaluate(() => { actor.isOwner = false; app.isEditable = false; renderFixture(); });
  assert.equal(await control("skill:athletics").isDisabled(), true);
  assert.equal(await page.locator(".perception .pf-rank").textContent(), "Mythic");
  assert.equal(await page.locator(".perception .pf-rank").evaluate((el) => getComputedStyle(el).backgroundColor), "rgb(212, 175, 55)");
  pass("non-owners see gold Mythic and cannot modify selections");
  assert.deepEqual(errors, []);
  assert.deepEqual(await page.evaluate(() => notifications), []);
  assert.equal(await page.evaluate(() => actor.updates.some((update) => Object.entries(update).some(([key, value]) => key.startsWith("system.") && value === 5))), false);
  pass("no page exceptions, notifications or writes of rank 5 into PF2e data");
  console.log(`${count} browser interaction tests passed in Chromium using the actual module scripts and PF2e-style DOM fixtures.`);
} finally { await browser.close(); }
