import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const apiRoot = path.join(root, "src", "app", "api");
const collectionPath = path.join(root, "scripts", "Marekto.postman_collection.json");
const supportedMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

async function findRouteFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const results = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return findRouteFiles(entryPath);
      return entry.isFile() && entry.name === "route.ts" ? [entryPath] : [];
    }),
  );
  return results.flat();
}

function routePathFromFile(filePath) {
  const segments = path
    .relative(apiRoot, path.dirname(filePath))
    .split(path.sep)
    .filter(Boolean)
    .map((segment) => {
      const match = /^\[(.+)]$/.exec(segment);
      return match ? ":param" : segment;
    });
  return `/api/${segments.join("/")}`.replace(/\/$/, "");
}

function extractMethods(source) {
  return new Set(
    [...source.matchAll(/export\s+(?:async\s+function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map(
      (match) => match[1],
    ),
  );
}

function normalizePostmanUrl(url) {
  const raw = typeof url === "string" ? url : url?.raw;
  if (typeof raw !== "string") throw new Error("A Postman request has no URL");
  return raw
    .replace(/^\{\{baseUrl}}/, "")
    .split("?", 1)[0]
    .replace(/\{\{[^}]+}}/g, ":param")
    .replace(/\/$/, "");
}

function collectRequests(items, parents = []) {
  const requests = [];
  for (const item of items ?? []) {
    const names = [...parents, item.name ?? "<unnamed>"];
    if (item.request) {
      const method = String(item.request.method ?? "").toUpperCase();
      if (!supportedMethods.has(method)) {
        throw new Error(`${names.join(" / ")} has unsupported method ${method}`);
      }
      requests.push({
        name: names.join(" / "),
        method,
        path: normalizePostmanUrl(item.request.url),
      });
    }
    requests.push(...collectRequests(item.item, names));
  }
  return requests;
}

const keyOf = ({ method, path: endpointPath }) => `${method} ${endpointPath}`;
const routeFiles = await findRouteFiles(apiRoot);
const routeEndpoints = [];

for (const file of routeFiles) {
  const source = await readFile(file, "utf8");
  const endpointPath = routePathFromFile(file);
  for (const method of extractMethods(source)) {
    routeEndpoints.push({ method, path: endpointPath });
  }
}

const collection = JSON.parse(await readFile(collectionPath, "utf8"));
const postmanRequests = collectRequests(collection.item);
const routeKeys = new Set(routeEndpoints.map(keyOf));
const postmanKeys = new Set(postmanRequests.map(keyOf));
const missing = [...routeKeys].filter((key) => !postmanKeys.has(key));
const stale = postmanRequests.filter((request) => !routeKeys.has(keyOf(request)));
const duplicates = [...postmanKeys].filter(
  (key) => postmanRequests.filter((request) => keyOf(request) === key).length > 1,
);

if (missing.length || stale.length || duplicates.length) {
  if (missing.length) {
    console.error("Missing Postman requests:");
    missing.forEach((value) => console.error(`  - ${value}`));
  }
  if (stale.length) {
    console.error("Stale Postman requests:");
    stale.forEach((value) => console.error(`  - ${keyOf(value)} (${value.name})`));
  }
  if (duplicates.length) {
    console.error("Duplicate Postman requests:");
    duplicates.forEach((value) => console.error(`  - ${value}`));
  }
  process.exitCode = 1;
} else {
  console.log(
    `Postman collection matches all ${routeKeys.size} backend route methods in ${routeFiles.length} route files.`,
  );
}
