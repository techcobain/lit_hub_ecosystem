// Reads the newly-added ecosystem/*.json files (passed via NEW_FILES, space-separated)
// and posts one tweet per project. Runs from the announce-new-project.yml workflow.
//
// Local dry run (no posting, just prints the tweets):
//   NEW_FILES="ecosystem/lighter-mcp-by-senya.json" DRY_RUN=1 node scripts/announce-new-project.mjs

import { readFileSync } from "node:fs";
import path from "node:path";

const SITE_URL = process.env.SITE_URL || "https://lit-hub.org";
const DRY_RUN = process.env.DRY_RUN === "1";

const files = (process.env.NEW_FILES || "")
  .split(/\s+/)
  .map((f) => f.trim())
  .filter(Boolean);

if (files.length === 0) {
  console.log("No new project files to announce.");
  process.exit(0);
}

function slugFromPath(file) {
  return path.basename(file, ".json");
}

// Pull a clean @handle out of whatever the submitter left in `twitter`:
// "https://x.com/minara", "https://twitter.com/foo", "@wallet_tg", "bar" -> "minara" / ...
function extractTwitterHandle(value) {
  const v = (value || "").trim();
  if (!v) return null;
  let handle = v;
  if (handle.includes("/")) {
    const noQuery = handle.split(/[?#]/)[0].replace(/\/+$/, "");
    handle = noQuery.split("/").pop() || "";
  }
  handle = handle.replace(/^@/, "");
  // X handles: letters, digits, underscore, 1..15 chars
  return /^[A-Za-z0-9_]{1,15}$/.test(handle) ? handle : null;
}

function buildTweet(project, slug) {
  // Link to the project's page on Lit Hub (advanced page), not its external site,
  // so the post drives traffic back to the hub.
  const projectUrl = `${SITE_URL}/ecosystem/${slug}`;
  const cats = Array.isArray(project.categories) ? project.categories : [];
  const catTags = cats
    .map((c) => `#${String(c).replace(/[^a-zA-Z0-9]/g, "")}`)
    .join(" ");

  const handle = extractTwitterHandle(project.twitter);
  const named = handle ? `${project.name} (@${handle})` : project.name;
  const headline = project.official
    ? `🆕 New official project on Lit Hub: ${named}`
    : `🆕 New on Lit Hub: ${named}`;

  const blurb = project.tagline || project.description || "";
  const footer = `Built on @Lighter_xyz${catTags ? ` ${catTags}` : ""}`;

  const compose = (text) =>
    [headline, "", text, "", projectUrl, "", footer]
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

  // X hard limit is 280 chars; trim the blurb if the whole thing overflows.
  let tweet = compose(blurb);
  if (tweet.length > 280 && blurb) {
    const overflow = tweet.length - 280 + 1; // +1 for the ellipsis
    const trimmed = blurb.slice(0, Math.max(0, blurb.length - overflow)).trimEnd();
    tweet = compose(trimmed ? `${trimmed}…` : "");
  }
  return tweet;
}

async function main() {
  const tweets = [];
  for (const file of files) {
    let raw;
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      console.warn(`Skip (cannot read): ${file}`);
      continue;
    }
    const project = JSON.parse(raw);
    const slug = slugFromPath(file);
    tweets.push({ slug, text: buildTweet(project, slug) });
  }

  if (DRY_RUN) {
    for (const t of tweets) {
      console.log(`\n--- ${t.slug} (${t.text.length} chars) ---\n${t.text}`);
    }
    return;
  }

  const { TwitterApi } = await import("twitter-api-v2");
  const client = new TwitterApi({
    appKey: process.env.X_API_KEY,
    appSecret: process.env.X_API_SECRET,
    accessToken: process.env.X_ACCESS_TOKEN,
    accessSecret: process.env.X_ACCESS_SECRET,
  });

  for (const t of tweets) {
    try {
      const res = await client.v2.tweet(t.text);
      console.log(`Posted ${t.slug}: ${res.data?.id}`);
    } catch (err) {
      console.error(`Failed to post ${t.slug}:`, err?.message || err);
      process.exitCode = 1;
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
