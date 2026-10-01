#!/usr/bin/env node
// Announce newly merged ecosystem projects on Telegram and X.
//
// Runs from .github/workflows/notify-telegram.yml on every push to main that
// touches ecosystem/**. It diffs the push range for *added* project files and
// posts one message per project to each configured channel:
//   Telegram: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
//   X:        X_API_KEY + X_API_SECRET + X_ACCESS_TOKEN + X_ACCESS_SECRET
//             (OAuth 1.0a user context for the @lighter_hub account)
// A channel whose secrets are missing is skipped with a log line.
//
// Safe preview: `DRY_RUN=true SLUG=botlyz node scripts/notify-telegram.mjs`.
// Both channels attach the same rendered card. If the card can't be rendered,
// Telegram still sends its text; X sends nothing.
//
// Posts link to the project's lit-hub page, which only exists once the site
// has picked up the rebuilt index, so nothing is sent until that page loads.

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCardRenderer, validateSlug } from "./render-announcement.mjs";
import { postCardToX } from "./x-card.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const X = {
  key: process.env.X_API_KEY,
  secret: process.env.X_API_SECRET,
  token: process.env.X_ACCESS_TOKEN,
  tokenSecret: process.env.X_ACCESS_SECRET,
};
const X_ENABLED = Boolean(X.key && X.secret && X.token && X.tokenSecret);
const TELEGRAM_ENABLED = Boolean(TOKEN && CHAT_ID);
const SITE_URL = (process.env.SITE_URL || "https://lit-hub.org").replace(/\/$/, "");
const AFTER = process.env.AFTER || "HEAD";
const BEFORE = process.env.BEFORE || "";
const ZERO = "0000000000000000000000000000000000000000";

export function addedSlugs() {
  if (process.env.SLUG) return [...new Set(process.env.SLUG.split(",").map((s) => s.trim()).filter(Boolean).map(validateSlug))];
  if (!BEFORE || BEFORE === ZERO) {
    console.log("No previous commit in this push (new branch or force push); nothing to announce.");
    return [];
  }
  const out = execFileSync("git", ["diff", "--name-only", "--diff-filter=A", BEFORE, AFTER, "--", "ecosystem/*.json"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((f) => path.basename(f, ".json"));
}

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function socialUrl(kind, value) {
  const v = String(value ?? "").trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  const handle = v.replace(/^@/, "");
  if (kind === "x") return `https://x.com/${handle}`;
  if (kind === "telegram") return `https://t.me/${handle}`;
  return null;
}

export function buildMessage(slug, p) {
  const pageUrl = `${SITE_URL}/ecosystem/${encodeURIComponent(slug)}`;
  const links = [
    p.url && `<a href="${esc(p.url)}">Website</a>`,
    socialUrl("x", p.twitter) && `<a href="${esc(socialUrl("x", p.twitter))}">𝕏</a>`,
    socialUrl("telegram", p.telegram) && `<a href="${esc(socialUrl("telegram", p.telegram))}">Telegram</a>`,
    /^https?:\/\//i.test(p.discord ?? "") && `<a href="${esc(p.discord)}">Discord</a>`,
    `<a href="${pageUrl}">lit-hub page</a>`,
  ].filter(Boolean);
  const categories = p.categories ?? [];
  const status =
    p.status && p.status !== "Live"
      ? ` <i>(${esc(p.status === "Not Live" ? "coming soon" : p.status.toLowerCase())})</i>`
      : "";
  return [
    `🆕 <b>${esc(p.name)}</b> just joined <a href="${SITE_URL}">lit-hub.org</a>${status}`,
    "",
    p.description ? `<b>Description</b>: <i>${esc(p.description)}</i>` : null,
    categories.length
      ? `<b>${categories.length === 1 ? "Category" : "Categories"}</b>: ${categories.map(esc).join(", ")}`
      : null,
    "",
    links.join(" · "),
  ]
    .filter((l) => l !== null)
    .join("\n");
}

// --- Waiting for the lit-hub page ---

const PAGE_CHECK_ATTEMPTS = 40; // 40 checks 15s apart: up to 10 minutes
const PAGE_CHECK_INTERVAL_MS = 15_000;

// True once the project's page answers 200, false if it never does in time.
export async function waitForProjectPage(slug, {
  attempts = PAGE_CHECK_ATTEMPTS, intervalMs = PAGE_CHECK_INTERVAL_MS, fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const pageUrl = `${SITE_URL}/ecosystem/${encodeURIComponent(slug)}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetchImpl(pageUrl, { signal: AbortSignal.timeout(10_000) });
      await res.body?.cancel();
      if (res.ok) return true;
      console.log(`${slug}: page not live yet (HTTP ${res.status}), check ${attempt}/${attempts}`);
    } catch (err) {
      console.log(`${slug}: page check failed (${err.message}), check ${attempt}/${attempts}`);
    }
    if (attempt >= attempts) return false;
    await sleep(intervalMs);
  }
}

// --- X ---

const X_LIMIT = 280;
const X_URL_WEIGHT = 23; // every URL counts as 23 characters on X

function xHandle(value) {
  const v = String(value ?? "").trim();
  if (!v) return null;
  const m = v.match(/^(?:https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/)?@?([A-Za-z0-9_]{1,15})\/?$/);
  return m ? `@${m[1]}` : null;
}

function xLength(text) {
  return text.replace(/https?:\/\/\S+/g, "x".repeat(X_URL_WEIGHT)).length;
}

// Plain text (X has no formatting): who joined, and their one-liner. The
// project's own handle is mentioned when known so they see it.
export function buildPost(slug, p) {
  const handle = xHandle(p.twitter);
  const pageUrl = `${SITE_URL}/ecosystem/${encodeURIComponent(slug)}`;
  const head = `🆕 ${p.name}${handle ? ` (${handle})` : ""} just joined @lighter_hub`;
  const compose = (description) =>
    [head, description ? `\n${description}` : null, `\n${pageUrl}`].filter(Boolean).join("\n");
  let description = String(p.description ?? "").trim();
  let text = compose(description);
  while (xLength(text) > X_LIMIT && description.length > 20) {
    description = description.slice(0, description.length - 10).trimEnd() + "…";
    text = compose(description);
  }
  return text;
}

// --- Telegram ---

async function tg(method, body, fetchImpl = fetch, query = null) {
  const multipart = body instanceof FormData;
  const res = await fetchImpl(`https://api.telegram.org/bot${TOKEN}/${method}${query ? `?${query}` : ""}`, {
    method: "POST",
    // fetch sets the multipart content-type (with its boundary) itself.
    headers: multipart ? {} : { "content-type": "application/json" },
    body: multipart ? body : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(`${method}: ${data.description || res.status}`);
  return data;
}

async function announce(slug, text, png, fetchImpl) {
  try {
    if (png) {
      // The card isn't hosted anywhere, so upload the PNG itself. The caption
      // goes in the query string: multipart encoding turns its \n into \r\n.
      const form = new FormData();
      form.append("photo", new Blob([png], { type: "image/png" }), `${slug}.png`);
      const query = new URLSearchParams({ chat_id: CHAT_ID, caption: text, parse_mode: "HTML" });
      await tg("sendPhoto", form, fetchImpl, query);
    } else {
      await tg("sendMessage", { chat_id: CHAT_ID, text, parse_mode: "HTML", disable_web_page_preview: false }, fetchImpl);
    }
    console.log(`announced ${slug}${png ? " with card" : ""}`);
  } catch (err) {
    // A rejected photo shouldn't lose the announcement.
    if (png) {
      console.warn(`photo failed for ${slug} (${err.message}); sending text only`);
      await tg("sendMessage", { chat_id: CHAT_ID, text, parse_mode: "HTML" }, fetchImpl);
      console.log(`announced ${slug} (text)`);
    } else {
      throw err;
    }
  }
}

export async function runAnnouncements({
  slugs = addedSlugs(), dryRun = process.env.DRY_RUN === "true",
  telegramEnabled = TELEGRAM_ENABLED, xEnabled = X_ENABLED, credentials = X,
  rendererFactory = createCardRenderer, fetchImpl = fetch, waitForPage = waitForProjectPage,
  outputDir = path.join(ROOT, "output/announcements"),
} = {}) {
  slugs = [...new Set(slugs.map(validateSlug))];
  if (slugs.length === 0) {
    console.log("No new projects in this push.");
    return 0;
  }
  if (!telegramEnabled) console.log("Telegram not configured; skipping.");
  if (!xEnabled) console.log("X not configured; skipping publication.");
  if (!telegramEnabled && !xEnabled && !dryRun) {
    console.log(`Would announce: ${slugs.join(", ")}`);
    return 0;
  }
  let failed = 0;
  let renderer;
  await mkdir(outputDir, { recursive: true });
  try {
    for (const slug of slugs) {
      const file = path.join(ROOT, "ecosystem", `${slug}.json`);
      if (!existsSync(file)) {
        failed++;
        console.error(`skip ${slug}: no such project file`);
        continue;
      }
      const project = JSON.parse(readFileSync(file, "utf8"));
      const telegramText = buildMessage(slug, project);
      const xText = buildPost(slug, project);
      await writeFile(path.join(outputDir, `${slug}.telegram.txt`), telegramText + "\n");
      await writeFile(path.join(outputDir, `${slug}.txt`), xText + "\n");
      // One card per project, attached on both channels.
      let png = null;
      try {
        renderer ??= await rendererFactory();
        const card = await renderer.render(project, path.join(outputDir, `${slug}.png`));
        if (card.fallbackLogo) console.warn(`${slug}: no logo configured; card uses initials`);
        png = card.png;
      } catch (err) {
        console.error(`card failed for ${slug}: ${err.message}`);
        if (dryRun) failed++;
      }
      if (dryRun) {
        console.log(`preview ${slug} in ${outputDir} (nothing sent)`);
        continue;
      }
      if (!(await waitForPage(slug))) {
        failed++;
        console.error(
          `skip ${slug}: ${SITE_URL}/ecosystem/${slug} never loaded, so nothing was posted. ` +
            `Once it does, run the "Announce new projects" workflow manually with slug=${slug} and dry_run off.`,
        );
        continue;
      }
      if (telegramEnabled) {
        try {
          await announce(slug, telegramText, png, fetchImpl);
        } catch (err) {
          failed++;
          console.error(`Telegram failed for ${slug}: ${err.message}`);
        }
      }
      if (xEnabled) {
        try {
          if (!png) throw new Error("no card, so no post sent");
          const { postId } = await postCardToX({ text: xText, png, credentials, fetchImpl });
          console.log(`posted ${slug} on X with card (id ${postId})`);
        } catch (err) {
          failed++;
          console.error(`X failed for ${slug}: ${err.message}`);
        }
      }
    }
  } finally {
    await renderer?.close();
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runAnnouncements().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
