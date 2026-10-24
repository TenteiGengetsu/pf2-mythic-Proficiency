import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { harness } from "./browser-harness.mjs";
const { browser, page, errors } = await harness();
try {
  // Layout-affecting rules transcribed from PF2e 8.6.1's sidebar,
  // proficiency list and spellcasting SCSS, under their real selectors.
  await page.addStyleTag({ content: `
    *{box-sizing:border-box}body{margin:0;padding:10px;background:#202631;font-family:serif}
    .actor.sheet.character{background:#eee6d7;color:#261e18}
    .actor.sheet.character section.window-content .crb-style{display:grid;grid-template-columns:14.375rem minmax(0,1fr);align-items:start}
    .actor.sheet.character section.window-content .crb-style .pf-rank{display:block;width:4.25rem;height:1.125rem;padding:.0625rem;border:1px solid #302824;border-radius:2px;font-family:Arial,sans-serif;font-size:.625rem;font-weight:500;line-height:1;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:#777;color:white}
    .actor.sheet.character section.window-content .crb-style .pf-rank[data-rank='1']{background:#171d65}
    .actor.sheet.character section.window-content .crb-style .pf-rank[data-rank='2']{background:#3b005b}
    .actor.sheet.character section.window-content .crb-style .pf-rank[data-rank='3']{background:#805700}
    .actor.sheet.character section.window-content .crb-style .pf-rank[data-rank='4']{background:#7c0900}
    .actor.sheet.character section.window-content .crb-style aside{background:#65150f;color:#e5c995;padding:.5rem}
    .actor.sheet.character section.window-content .crb-style aside select{width:100%;max-width:100%;font-size:.9375rem;padding:.125rem .375rem}
    .actor.sheet.character section.window-content .crb-style aside .sidebar .roll-data{display:flex;align-items:center;gap:.25rem;justify-content:left}
    .actor.sheet.character section.window-content .crb-style aside .sidebar .roll-icon{display:inline-flex;align-items:center;font-size:1.1875rem}
    .actor.sheet.character section.window-content .crb-style aside .sidebar .modifier{font-size:1.125rem;line-height:1;white-space:nowrap}
    .actor.sheet.character section.window-content .crb-style aside .sidebar .perception select{flex:0 0 8.25rem;margin-left:auto}
    .actor.sheet.character section.window-content .crb-style aside .sidebar .perception .pf-rank{margin-left:auto}
    .actor.sheet.character section.window-content .crb-style aside .sidebar .perception .modifier{margin-right:1rem}
    .actor.sheet.character section.window-content .crb-style aside .sidebar ul.saves{display:flex;flex-wrap:nowrap;padding:0;margin:0}
    .actor.sheet.character section.window-content .crb-style aside .sidebar ul.saves li{border-left:1px solid #eddda533;flex-direction:column;gap:0;flex:1;min-width:0}
    .actor.sheet.character section.window-content .crb-style aside .sidebar ul.saves li:first-child{border-left:none}
    .actor.sheet.character section.window-content .crb-style aside .sidebar ul.saves .sidebar_label{font-size:.75rem;font-weight:400;line-height:1;margin:0 0 .125rem}
    .actor.sheet.character section.window-content .crb-style aside .sidebar ul.saves .save-roll{display:flex;gap:.25rem;margin-top:.25rem}
    .actor.sheet.character section.window-content .crb-style .sheet-body{min-width:0;padding:.5rem}
    .actor.sheet.character section.window-content .crb-style .tab{display:none}
    .actor.sheet.character section.window-content .crb-style .tab.active{display:block}
    .actor.sheet.character section.window-content .crb-style .proficiencies ul.proficiencies-list{display:grid;align-items:center;gap:.5rem;grid-template-columns:repeat(2,minmax(0,1fr));list-style:none;margin:0 0 .75rem;padding:0}
    .actor.sheet.character section.window-content .crb-style .proficiencies ul.proficiencies-list li{display:flex;align-items:center;min-height:2.25rem;padding:0 .5rem 0 .25rem;border:1px solid #a99c8b}
    .actor.sheet.character section.window-content .crb-style .proficiencies ul.proficiencies-list li .name{flex:1;line-height:.9;margin-right:.25rem}
    .actor.sheet.character section.window-content .crb-style .proficiencies ul.proficiencies-list li .dc,
    .actor.sheet.character section.window-content .crb-style .proficiencies ul.proficiencies-list li .modifier{width:1.75rem;margin-right:.25rem;text-align:end}
    .actor.sheet.character section.window-content .crb-style .proficiencies ul.proficiencies-list li .pf-rank{flex-shrink:0}
    .actor.sheet.character section.window-content .crb-style .proficiencies ul.proficiencies-list li.all-by-myself{grid-column:span 2}
    .actor.sheet.character section.window-content .crb-style .spellcastingEntry-list{padding:0;margin:0;list-style:none}
    .actor.sheet.character section.window-content .crb-style .spellcasting-entry{border:1px solid #a99c8b;margin-bottom:.5rem}
    .actor.sheet.character section.window-content .crb-style .spell-ability-data{display:flex;align-items:center;flex:1;gap:1rem;margin:.5em .25rem}
    .actor.sheet.character section.window-content .crb-style .spell-ability-data section{display:flex;align-items:center}
    .actor.sheet.character section.window-content .crb-style .spell-ability-data .spell-ability{gap:.5em;margin-left:auto}
    .actor.sheet.character section.window-content .crb-style .spell-ability-data .pf-rank{margin-bottom:.125rem}
    .actor.sheet.character section.window-content .crb-style .button-group{display:flex;align-items:center}
    h2{font-size:.875rem;margin:.75rem 0 .25rem}h3{font-size:.8125rem;margin:.5rem}
  ` });
  await page.evaluate(() => {
    window.buildLayout = (config) => {
      document.querySelector("#layout")?.remove();
      document.documentElement.style.fontSize = `${config.font}px`; window.language = config.language;
      const root = document.createElement("div"); root.id = "layout"; root.className = "default actor sheet character"; root.style.width = `${config.width}px`;
      const rank = (n) => `<span class='pf-rank' data-rank='${n}'>${game.i18n.localize(`PF2E.ProficiencyLevel${n}`)}</span>`;
      const text = (cn, en) => config.language === "cn" ? cn : en;
      const save = (slug, label) => `<li class='roll-data' data-save='${slug}' data-layout-row='save-${slug}'><h2 class='sidebar_label' data-anchor='name'>${label}</h2>${rank(1)}<div class='save-roll' data-anchor='roll'><a class='roll-icon'>D</a><a class='modifier'>+14</a></div></li>`;
      const classRow = (slug, name, n, primary) => `<li class='${config.multiclass ? primary ? '' : 'secondary' : 'all-by-myself'}' data-layout-row='class-${slug}'><a class='dc' data-tooltip-content='#layout-${slug}-modifiers' data-anchor='number'>24</a><span class='name' data-anchor='name'>${name}</span>${rank(n)}</li>`;
      const entry = (id, name, n) => `<li class='item spellcasting-entry' data-item-id='${id}' data-layout-row='${id}'><h3>${name}</h3><div class='spell-ability-data'><section data-anchor='number'>+14 / DC 24</section><section class='spell-ability'><span class='spell-tradition' data-anchor='name'>${name}</span><div class='spellcasting-prof button-group'>${rank(n)}</div></section></div></li>`;
      root.innerHTML = `<section class='window-content'><div class='crb-style'><aside><div class='sidebar'>
        <h2>${text('察觉','Perception')}</h2><section class='perception'><div class='roll-data' data-layout-row='perception'><a class='roll-icon'>D</a><a class='roll-icon'>S</a><a class='modifier' data-anchor='number'>+14</a>${rank(2)}</div></section>
        <h2>${text('豁免','Saves')}</h2><ul class='saves'>${save('fortitude',text('强韧','Fortitude'))}${save('reflex',text('反射','Reflex'))}${save('will',text('意志','Will'))}</ul>
        </div></aside><div class='sheet-body'><div class='sheet-content'>
        <section class='tab proficiencies' data-tab='proficiencies'><h2>${text('职业 DC','Class DCs')}</h2><ul class='proficiencies-list'>${classRow('fighter',text('战士职业 DC','Fighter Class DC'),2,true)}${config.multiclass ? classRow('wizard',text('法师职业 DC','Wizard Class DC'),3,false) : ''}</ul>
        <h2>${text('施法熟练度','Spellcasting Proficiency')}</h2><ul class='proficiencies-list'><li class='all-by-myself' data-slug='spellcasting' data-layout-row='spellcasting'><span class='modifier' data-anchor='number'>+14</span><span class='name' data-anchor='name'>${text('基础施法熟练度','Base Spellcasting Proficiency')}</span>${rank(1)}</li></ul></section>
        <section class='tab spellcasting spellbook-pane' data-tab='spellcasting'><ol class='spellcastingEntry-list'>${entry('entry1',text('奥术施法','Arcane Spellcasting'),1)}${entry('entry2',text('职业关联施法','Class-linked Spellcasting'),2)}${config.multiclass ? entry('entry3',text('副职业施法','Secondary Class Spellcasting'),3) : ''}</ol></section>
        </div></div></div></section>`;
      document.body.append(root); return root;
    };
    window.setTab = (tab) => { for (const element of document.querySelectorAll("#layout .tab")) element.classList.toggle("active", element.dataset.tab === tab); };
    window.measureLayout = (tab) => {
      setTab(tab); const root = document.querySelector("#layout"); const bounds = root.getBoundingClientRect();
      const rect = (element) => { const b = element.getBoundingClientRect(); return { x: b.x - bounds.x, y: b.y - bounds.y, width: b.width, height: b.height }; };
      return Object.fromEntries([...root.querySelectorAll("[data-layout-row]")].filter((row) => row.getBoundingClientRect().height > 0).map((row) => {
        const badge = row.querySelector(".pf-rank"); const css = getComputedStyle(badge);
        return [row.dataset.layoutRow, { badge: rect(badge), row: rect(row), fontSize: css.fontSize, padding: css.padding, anchors: Object.fromEntries([...row.querySelectorAll("[data-anchor]")].map((el) => [el.dataset.anchor, rect(el)])) }];
      }));
    };
  });
  const reports = [];
  function compare(actual, expected, path = "") {
    for (const key of Object.keys(expected)) {
      const label = `${path}.${key}`;
      if (typeof expected[key] === "number") assert.ok(Math.abs(actual[key] - expected[key]) <= 0.5, `${label}: ${actual[key]} != ${expected[key]}`);
      else if (expected[key] && typeof expected[key] === "object") compare(actual[key], expected[key], label);
      else assert.equal(actual[key], expected[key], label);
    }
  }
  let cases = 0;
  for (const language of ["cn", "en"]) for (const font of [16, 20]) for (const width of [750, 1000]) for (const multiclass of [false, true]) {
    const config = { language, font, width, multiclass };
    for (const mythic of [false, true]) {
      const expected = await page.evaluate((config) => { buildLayout(config); return { proficiencies: measureLayout("proficiencies"), spellcasting: measureLayout("spellcasting") }; }, config);
      await page.evaluate(async ({ config, mythic }) => {
        actor.isOwner = true; app.isEditable = true;
        for (const key of ["perception", "save:fortitude", "save:reflex", "save:will", "class:fighter", "class:wizard", "spellcasting"]) await api.set(actor, key, mythic);
        const root = buildLayout(config);
        // Exercise badge conversion while the other tab is still hidden.
        setTab(mythic ? "proficiencies" : "spellcasting");
        Hooks.dispatch("renderActorSheet", app, root);
      }, { config, mythic });
      for (const tab of ["proficiencies", "spellcasting"]) {
        const actual = await page.evaluate((tab) => measureLayout(tab), tab);
        compare(actual, expected[tab], `${JSON.stringify({ ...config, mythic, tab })}`);
        assert.equal(await page.locator("#layout .mythic-control[title], #layout .mythic-control[data-tooltip]").count(), 0);
      }
      await page.evaluate(() => Hooks.dispatch("renderActorSheet", app, document.querySelector("#layout")));
      compare(await page.evaluate(() => measureLayout("proficiencies")), expected.proficiencies, "repeat.proficiencies");
      compare(await page.evaluate(() => measureLayout("spellcasting")), expected.spellcasting, "repeat.spellcasting");
      reports.push({ ...config, mythic, passed: true, fields: Object.keys({ ...expected.proficiencies, ...expected.spellcasting }) }); cases++;
      if (language === "cn" && font === 16 && width === 750 && multiclass && mythic) {
        for (const tab of ["proficiencies", "spellcasting"]) {
          await page.evaluate((tab) => setTab(tab), tab);
          await page.locator("#layout").screenshot({ path: fileURLToPath(new URL(`../.test-results/layout-${tab}.png`, import.meta.url)) });
        }
      }
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(new URL("../.test-results/layout-report.json", import.meta.url), JSON.stringify({ cases, toleranceCssPixels: 0.5, reports }, null, 2));
  console.log(`PASS ${cases} original-versus-module layout scenarios: 3 saves, primary/secondary class DCs, base/linked spellcasting, CN/EN, 2 sizes, 2 font scales, normal/Mythic and initially hidden tabs.`);
} finally { await browser.close(); }
