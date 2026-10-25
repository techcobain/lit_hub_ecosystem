import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const schema = JSON.parse(readFileSync(new URL("../schemas/project.schema.json", import.meta.url), "utf8"));
const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
// Match Zod's WHATWG URL parsing; the generic URI format accepts values such
// as "https://" that the website rejects.
ajv.addFormat("uri", (value) => {
  try { new URL(value); return true; } catch { return false; }
});
const validate = ajv.compile(schema);
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

export function projectErrors(project) {
  if (validate(project)) return [];
  return validate.errors.map((error) => `${error.instancePath || "/"} ${error.message}`);
}

export function readProjects(directory) {
  const projects = [];
  const errors = [];
  for (const file of readdirSync(directory).filter((f) => f.endsWith(".json")).sort()) {
    const slug = file.slice(0, -5);
    try {
      if (!SLUG.test(slug)) throw new Error("filename must be a lowercase slug with hyphens");
      const project = JSON.parse(readFileSync(path.join(directory, file), "utf8"));
      const issues = projectErrors(project);
      if (issues.length) throw new Error(issues.join("; "));
      if (project.slug !== undefined && project.slug !== slug) {
        throw new Error("slug must match the filename");
      }
      projects.push({ slug, ...project });
    } catch (error) {
      errors.push(`${file}: ${error.message}`);
    }
  }
  return { projects, errors };
}

export function indexErrors(index) {
  if (!index || typeof index !== "object" || !Array.isArray(index.projects)) {
    return ["expected an object with a projects array"];
  }
  const errors = [];
  if (index.generatedAt !== undefined && typeof index.generatedAt !== "string") {
    errors.push("generatedAt must be a string");
  }
  const seen = new Set();
  for (const [position, project] of index.projects.entries()) {
    const label = project?.slug ?? `projects[${position}]`;
    errors.push(...projectErrors(project).map((message) => `${label}: ${message}`));
    if (typeof project?.slug !== "string" || !SLUG.test(project.slug)) {
      errors.push(`${label}: invalid or missing slug`);
    } else if (seen.has(project.slug)) {
      errors.push(`${label}: duplicate slug`);
    } else {
      seen.add(project.slug);
    }
  }
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] ? path.resolve(process.argv[2]) : ROOT;
  const { projects, errors } = readProjects(path.join(root, "ecosystem"));
  try {
    const index = JSON.parse(readFileSync(path.join(root, "public/ecosystem.json"), "utf8"));
    errors.push(...indexErrors(index).map((message) => `public/ecosystem.json: ${message}`));
  } catch (error) {
    errors.push(`public/ecosystem.json: ${error.message}`);
  }
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else {
    console.log(`Validated ${projects.length} project files and the public index`);
  }
}
