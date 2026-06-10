#!/usr/bin/env node
// Aggregate request-a-protocol/*.json into public/request-a-protocol.json so the frontend gets one fetch.

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SRC = path.join(ROOT, "request-a-protocol");
const OUT_DIR = path.join(ROOT, "public");
const OUT = path.join(OUT_DIR, "request-a-protocol.json");

mkdirSync(SRC, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

const files = readdirSync(SRC).filter((f) => f.endsWith(".json")).sort();
const requests = [];
const errors = [];

for (const f of files) {
  try {
    const raw = readFileSync(path.join(SRC, f), "utf8");
    requests.push({ slug: f.replace(/\.json$/, ""), ...JSON.parse(raw) });
  } catch (e) {
    errors.push(`${f}: ${e.message}`);
  }
}

if (errors.length) {
  console.error("Request a Protocol build errors:");
  for (const e of errors) console.error("  " + e);
  process.exit(1);
}

writeFileSync(OUT, JSON.stringify({ requests, generatedAt: new Date().toISOString() }, null, 2) + "\n");
console.log(`Built ${OUT} (${requests.length} requests)`);
