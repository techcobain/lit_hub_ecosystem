import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { indexErrors, projectErrors, readProjects } from "../scripts/validate-ecosystem.mjs";

const quote = { name: "Quote", categories: ["Apps", "Terminal", "Agents"] };
const schema = JSON.parse(readFileSync(new URL("../schemas/project.schema.json", import.meta.url), "utf8"));

test("one to three distinct known categories are accepted, preserving order", () => {
  assert.deepEqual(projectErrors(quote), []);
  assert.deepEqual(projectErrors({ ...quote, categories: ["Data"] }), []);
});

test("invalid categories and other consumer schema violations are rejected", () => {
  for (const value of [
    { ...quote, categories: [] }, { ...quote, categories: ["Apps", "Apps"] },
    { ...quote, categories: [...quote.categories, "Data"] },
    { ...quote, categories: schema.properties.categories.items.enum },
    { ...quote, categories: ["Unknown"] }, { ...quote, categories: "Apps" },
    { ...quote, name: "" }, { ...quote, description: "x".repeat(121) },
    { ...quote, url: "http://example.com" }, { ...quote, url: "https://" },
    { ...quote, status: "Maybe" }, { ...quote, instances: [] },
    { ...quote, createdAt: "yesterday" }, { ...quote, integrator_account_index: "bad" },
    { ...quote, robinhood_account_index: "bad" }, { ...quote, team: [{ name: "" }] },
    { ...quote, official: "false" }, null,
  ]) assert.ok(projectErrors(value).length > 0, JSON.stringify(value));
});

test("legacy optional fields, aliases and extension fields remain supported", () => {
  assert.deepEqual(projectErrors({ ...quote, robinhood_account_index: "42", futureField: true }), []);
  assert.deepEqual(projectErrors({ ...quote, url: "", integrator_account_index: [42, "43"] }), []);
});

test("source reader reports filenames for broken JSON and invalid records", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "catalog-validation-"));
  try {
    writeFileSync(path.join(directory, "quote.json"), JSON.stringify(quote));
    writeFileSync(path.join(directory, "broken.json"), '{"name":"Bad" "categories":[]}');
    writeFileSync(path.join(directory, "invalid.json"), JSON.stringify({ ...quote, categories: ["Unknown"] }));
    writeFileSync(path.join(directory, "spoofed.json"), JSON.stringify({ ...quote, slug: "quote" }));
    const result = readProjects(directory);
    assert.deepEqual(result.projects, [{ ...quote, slug: "quote" }]);
    assert.equal(result.errors.length, 3);
    for (const file of ["broken.json", "invalid.json", "spoofed.json"]) {
      assert.ok(result.errors.some((error) => error.startsWith(`${file}:`)));
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("generated indexes reject bad envelopes, duplicate slugs and invalid entries", () => {
  const entry = { ...quote, slug: "quote" };
  assert.deepEqual(indexErrors({ projects: [entry] }), []);
  for (const input of [null, {}, { projects: [null] }, { projects: [entry, entry] }, { projects: [quote] }]) {
    assert.ok(indexErrors(input).length > 0);
  }
});

test("validation command exits nonzero for an invalid PR without rewriting its index", () => {
  const root = mkdtempSync(path.join(tmpdir(), "catalog-pr-"));
  try {
    mkdirSync(path.join(root, "ecosystem"));
    mkdirSync(path.join(root, "public"));
    const indexPath = path.join(root, "public/ecosystem.json");
    const original = JSON.stringify({ projects: [{ ...quote, slug: "quote" }] });
    writeFileSync(indexPath, original);
    writeFileSync(path.join(root, "ecosystem/quote.json"), JSON.stringify({ ...quote, categories: ["Unknown"] }));
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL("../scripts/validate-ecosystem.mjs", import.meta.url)), root,
    ], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /quote.json.*categories/);
    assert.equal(readFileSync(indexPath, "utf8"), original);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
