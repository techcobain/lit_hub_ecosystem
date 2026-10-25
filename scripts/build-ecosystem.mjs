#!/usr/bin/env node
// Aggregate ecosystem/*.json into public/ecosystem.json so the frontend gets one fetch.
// Runs as `prebuild` so it's regenerated on every Next.js build.

import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readProjects } from "./validate-ecosystem.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SRC = path.join(ROOT, "ecosystem");
const OUT_DIR = path.join(ROOT, "public");
const OUT = path.join(OUT_DIR, "ecosystem.json");

mkdirSync(OUT_DIR, { recursive: true });

const { projects, errors } = readProjects(SRC);

if (errors.length) {
  console.error("ecosystem build errors:");
  for (const e of errors) console.error("  " + e);
  process.exit(1);
}

writeFileSync(OUT, JSON.stringify({ projects, generatedAt: new Date().toISOString() }, null, 2) + "\n");
console.log(`Built ${OUT} (${projects.length} projects)`);
