#!/usr/bin/env node
// Aggregate ecosystem/*.json into public/ecosystem.json so the frontend gets one fetch.
// Runs as `prebuild` so it's regenerated on every Next.js build.

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SRC = path.join(ROOT, "ecosystem");
const OUT_DIR = path.join(ROOT, "public");
const OUT = path.join(OUT_DIR, "ecosystem.json");

mkdirSync(OUT_DIR, { recursive: true });

const files = readdirSync(SRC).filter((f) => f.endsWith(".json")).sort();
const projects = [];
const errors = [];

for (const f of files) {
  try {
    const raw = readFileSync(path.join(SRC, f), "utf8");
    projects.push({ slug: f.replace(/\.json$/, ""), ...JSON.parse(raw) });
  } catch (e) {
    errors.push(`${f}: ${e.message}`);
  }
}

if (errors.length) {
  console.error("ecosystem build errors:");
  for (const e of errors) console.error("  " + e);
  process.exit(1);
}

writeFileSync(OUT, JSON.stringify({ projects, generatedAt: new Date().toISOString() }, null, 2) + "\n");
console.log(`Built ${OUT} (${projects.length} projects)`);
