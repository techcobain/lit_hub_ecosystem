#!/usr/bin/env node
// Deterministic, offline rendering of the approved Lit Hub announcement design.
import { readFile, realpath, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = path.join(ROOT, "scripts/announcement-assets");
const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml", ".webp": "image/webp", ".avif": "image/avif",
  ".ico": "image/x-icon", ".gif": "image/gif" };

export function validateSlug(slug) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(`Invalid project slug: ${slug}`);
  return slug;
}

export async function readProject(slug, root = ROOT) {
  validateSlug(slug);
  return JSON.parse(await readFile(path.join(root, "ecosystem", `${slug}.json`), "utf8"));
}

async function logoData(project, root) {
  const logo = String(project.logo ?? "").trim();
  if (!logo) return null;
  if (!logo.startsWith("/logos/")) throw new Error("Logo must be a local /logos/ asset");
  const dir = await realpath(path.join(root, "public/logos"));
  const file = await realpath(path.join(root, "public", logo.slice(1)));
  if (!file.startsWith(dir + path.sep)) throw new Error("Logo is outside public/logos");
  const mime = MIME[path.extname(file).toLowerCase()];
  if (!mime) throw new Error("Unsupported logo format");
  const bytes = await readFile(file);
  if (bytes.length > 10 * 1024 * 1024) throw new Error("Logo exceeds 10 MiB");
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

async function template() {
  const data = async (file) => (await readFile(path.join(ASSETS, file))).toString("base64");
  const [regular, bold, mono, brand, outline] = await Promise.all([
    data("fonts/Arimo-Regular.ttf"), data("fonts/Arimo-Bold.ttf"), data("fonts/Cousine-Regular.ttf"), data("lit-hub-logo.png"),
    data("lit-hub-outline.svg"),
  ]);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @font-face { font-family: Card; src: url(data:font/ttf;base64,${regular}); font-weight: 400; }
    @font-face { font-family: Card; src: url(data:font/ttf;base64,${bold}); font-weight: 700; }
    @font-face { font-family: CardMono; src: url(data:font/ttf;base64,${mono}); font-weight: 400; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f8f9fc; color: #080808; font-family: Card, sans-serif; }
    #card { position: relative; width: 1600px; height: 900px; overflow: hidden; }
    .brand { position:absolute; left:96px; top:62px; display:flex; align-items:center; gap:26px; }
    .brand img { width:64px; height:82px; object-fit:contain; filter:brightness(0); }
    .brand span { font-size:56px; font-weight:700; letter-spacing:-2.3px; }
    .micro { font-family: CardMono, monospace; font-size:18px; letter-spacing:2.3px; color:#7c8594; }
    .eyebrow { position:absolute; top:98px; right:96px; }
    .rule { position:absolute; left:96px; right:96px; height:1px; background:#aeb5c0; }
    .top-rule { top:167px; } .bottom-rule { top:785px; }
    .copy { position:absolute; left:96px; top:250px; height:450px; width:900px;
      display:flex; flex-direction:column; justify-content:center; }
    #name { margin:0; flex-shrink:0; font-size:144px; font-weight:700; letter-spacing:-6px; line-height:1.04;
      overflow-wrap:normal; word-break:normal; }
    #name .word { display:inline-block; white-space:nowrap; }
    #tagline { margin-top:20px; font-size:84px; line-height:1.12; letter-spacing:-3px;
      white-space:nowrap; font-weight:400; }
    #logo { position:absolute; left:1080px; top:307px; width:316px; height:316px;
      display:flex; align-items:center; justify-content:center; overflow:hidden; border-radius:54px; }
    #logo img { width:100%; height:100%; object-fit:contain; }
    #initials { width:100%; height:100%; display:flex; align-items:center; justify-content:center;
      border:1px solid #d3d7df; border-radius:54px; background:#eceef3; font-size:110px; font-weight:700; }
    .watermark { position:absolute; left:1332px; top:196px; width:417px; height:540px; }
    .footer { position:absolute; left:96px; top:821px; font-size:16px; letter-spacing:1px; }
    .url { position:absolute; right:96px; top:816px; display:flex; align-items:center; gap:20px;
      font-family:CardMono, monospace; font-size:23px; letter-spacing:1px; }
  </style></head><body><main id="card">
    <div class="brand"><img src="data:image/png;base64,${brand}" alt=""><span>Lit Hub</span></div>
    <div class="micro eyebrow">ECOSYSTEM UPDATE</div><div class="rule top-rule"></div>
    <img class="watermark" src="data:image/svg+xml;base64,${outline}" alt="">
    <div class="copy"><h1 id="name"></h1><div id="tagline">is live on Lit Hub</div></div>
    <div id="logo"></div><div class="rule bottom-rule"></div>
    <div class="micro footer">WHERE COMMUNITY AND BUILDERS MEET.</div>
    <div class="url">lit-hub.org <svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 22L22 4M6 4H22V20"/></svg></div>
  </main></body></html>`;
}

export async function createCardRenderer() {
  const browser = await chromium.launch({ headless: true });
  try {
    const html = await template();
    return {
      async render(project, output, { root = ROOT } = {}) {
        const name = String(project.name ?? "").replace(/\s+/gu, " ").trim();
        if (!name || name.length > 240) throw new Error("Project name must contain 1–240 characters");
        const logo = await logoData(project, root);
        const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
        try {
          // No external assets, scripts or font requests during rendering.
          await page.route("**/*", (route) => route.abort());
          await page.setContent(html);
          await page.evaluate(async ({ name, logo }) => {
            const title = document.querySelector("#name");
            // Keep every word intact (including hyphenated names). Wrapping
            // happens only at the spaces between these spans.
            for (const [index, word] of name.split(" ").entries()) {
              if (index) title.append(" ");
              const span = document.createElement("span");
              span.className = "word";
              span.textContent = word;
              title.append(span);
            }
            const container = document.querySelector("#logo");
            if (logo) {
              const image = new Image();
              image.src = logo;
              await image.decode();
              container.append(image);
            } else {
              const initials = document.createElement("div");
              initials.id = "initials";
              initials.textContent = name.split(" ").slice(0, 2).map((s) => [...s][0]).join("").toUpperCase();
              container.append(initials);
            }
            await document.fonts.ready;
            const width = title.clientWidth;
            let size = 144;
            while (size > 36 && (title.getBoundingClientRect().height > size * 1.04 * 2 + 2 || title.scrollWidth > width)) {
              size -= 2;
              title.style.fontSize = size + "px";
              title.style.letterSpacing = -(size / 24) + "px";
            }
            if (title.getBoundingClientRect().height > size * 1.04 * 2 + 2 || title.scrollWidth > width) {
              throw new Error("Project name does not fit the card");
            }
          }, { name, logo });
          const layout = await page.evaluate(() => {
            const box = (selector) => {
              const { x, y, width, height } = document.querySelector(selector).getBoundingClientRect();
              return { x, y, width, height };
            };
            const lines = [];
            for (const word of document.querySelectorAll("#name .word")) {
              const { y } = word.getBoundingClientRect();
              const line = lines.at(-1);
              if (line && Math.abs(line.y - y) < 1) line.words.push(word.textContent);
              else lines.push({ y, words: [word.textContent] });
            }
            return { title: box("#name"), tagline: box("#tagline"), logo: box("#logo"),
              lines: lines.map(({ words }) => words.join(" ")),
              fontSize: getComputedStyle(document.querySelector("#name")).fontSize,
              name: document.querySelector("#name").textContent };
          });
          await mkdir(path.dirname(output), { recursive: true });
          const png = await page.screenshot({ path: output, type: "png", animations: "disabled" });
          return { png, layout, fallbackLogo: !logo };
        } finally {
          await page.close();
        }
      },
      close: () => browser.close(),
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const slugs = process.argv.slice(2);
  if (!slugs.length) throw new Error("Usage: npm run preview:announcement -- telegram-wallet [other-slug]");
  const renderer = await createCardRenderer();
  try {
    for (const slug of slugs) {
      const project = await readProject(slug);
      const output = path.join(ROOT, "output/announcements", `${slug}.png`);
      const { layout, fallbackLogo } = await renderer.render(project, output);
      console.log(JSON.stringify({ slug, output, layout, fallbackLogo }));
    }
  } finally {
    await renderer.close();
  }
}
