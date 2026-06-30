// Posts one tweet per NEW job opening added to an existing project. Job
// openings live in the `jobs` array inside ecosystem/<slug>.json, so adding
// one is a MODIFICATION of an existing file (not a new file). This script
// diffs each modified file's `jobs` array against its previous version (read
// from git) and announces only the openings that weren't there before.
//
// Inputs (set by the announce workflow):
//   MODIFIED_FILES  space-separated list of changed ecosystem/*.json files
//   BEFORE_SHA      the commit to diff against (git show ${BEFORE_SHA}:<file>)
//
// Local dry run (no posting, just prints the tweets):
//   MODIFIED_FILES="ecosystem/minara-ai.json" BEFORE_SHA=HEAD~1 DRY_RUN=1 \
//     node scripts/announce-new-job.mjs

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const SITE_URL = process.env.SITE_URL || "https://lit-hub.org";
const BEFORE_SHA = process.env.BEFORE_SHA || "";
const DRY_RUN = process.env.DRY_RUN === "1";

const files = (process.env.MODIFIED_FILES || "")
  .split(/\s+/)
  .map((f) => f.trim())
  .filter(Boolean);

if (files.length === 0) {
  console.log("No modified project files to scan for jobs.");
  process.exit(0);
}

function slugFromPath(file) {
  return path.basename(file, ".json");
}

// Pull a clean @handle out of whatever the submitter left in `twitter`.
function extractTwitterHandle(value) {
  const v = (value || "").trim();
  if (!v) return null;
  let handle = v;
  if (handle.includes("/")) {
    const noQuery = handle.split(/[?#]/)[0].replace(/\/+$/, "");
    handle = noQuery.split("/").pop() || "";
  }
  handle = handle.replace(/^@/, "");
  return /^[A-Za-z0-9_]{1,15}$/.test(handle) ? handle : null;
}

// Stable identity for a job so we can tell new ones from pre-existing ones.
// Prefer an explicit id; fall back to the human fields that define the role.
function jobKey(job) {
  const id = (job?.id || "").trim();
  if (id) return `id:${id}`;
  return `t:${(job?.title || "").trim().toLowerCase()}|u:${(job?.applyUrl || "").trim().toLowerCase()}`;
}

function readJobs(json) {
  try {
    const project = JSON.parse(json);
    const jobs = Array.isArray(project?.jobs) ? project.jobs : [];
    return { project, jobs };
  } catch {
    return { project: null, jobs: [] };
  }
}

// Previous version of the file at BEFORE_SHA. Missing file (brand-new project)
// or no base sha -> treat as "no prior jobs" but the caller decides whether to
// announce; we skip brand-new files to avoid double-posting with the
// new-project announcer.
function readPreviousFile(file) {
  if (!BEFORE_SHA) return null;
  try {
    return execFileSync("git", ["show", `${BEFORE_SHA}:${file}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null; // file didn't exist before
  }
}

function buildJobTweet(project, slug, job) {
  const projectUrl = `${SITE_URL}/ecosystem/${slug}`;
  const handle = extractTwitterHandle(project.twitter);
  const named = handle ? `${project.name} (@${handle})` : project.name;

  const headline = `💼 ${named} is hiring: ${job.title}`;
  const meta = [job.type, job.location].map((s) => (s || "").trim()).filter(Boolean).join(" · ");
  const footer = `Apply on Lit Hub 👇\nBuilt on @Lighter_xyz`;

  const compose = (desc) =>
    [headline, meta, "", desc, "", projectUrl, "", footer]
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

  const blurb = (job.description || "").trim();
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
    let currentRaw;
    try {
      currentRaw = readFileSync(file, "utf8");
    } catch {
      console.warn(`Skip (cannot read): ${file}`);
      continue;
    }

    const prevRaw = readPreviousFile(file);
    if (prevRaw === null) {
      // Brand-new project file — its jobs (if any) ship with the project
      // announcement, so don't double-post them here.
      console.log(`Skip jobs for new file: ${file}`);
      continue;
    }

    const { project, jobs: currentJobs } = readJobs(currentRaw);
    if (!project) {
      console.warn(`Skip (invalid JSON): ${file}`);
      continue;
    }
    const { jobs: prevJobs } = readJobs(prevRaw);

    const prevKeys = new Set(prevJobs.map(jobKey));
    const newJobs = currentJobs.filter((j) => j?.title && !prevKeys.has(jobKey(j)));

    const slug = slugFromPath(file);
    for (const job of newJobs) {
      tweets.push({ slug, title: job.title, text: buildJobTweet(project, slug, job) });
    }
  }

  if (tweets.length === 0) {
    console.log("No new job openings to announce.");
    return;
  }

  if (DRY_RUN) {
    for (const t of tweets) {
      console.log(`\n--- ${t.slug} / ${t.title} (${t.text.length} chars) ---\n${t.text}`);
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
      console.log(`Posted ${t.slug} / ${t.title}: ${res.data?.id}`);
    } catch (err) {
      console.error(`Failed to post ${t.slug} / ${t.title}:`, err?.message || err);
      process.exitCode = 1;
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
