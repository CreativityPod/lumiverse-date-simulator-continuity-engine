import { access, readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("spindle.json", root), "utf8"));
const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

check(/^\d+\.\d+\.\d+$/.test(manifest.version), "Manifest version is semver");
check(/^[a-z0-9_]+$/.test(manifest.identifier), "Manifest identifier is valid");
for (const permission of ["generation", "interceptor", "chat_mutation"]) {
  check(manifest.permissions?.includes(permission), `${permission} permission is requested`);
}
check(manifest.entry_backend === "dist/backend.js", "Backend entry is correct");
check(manifest.entry_frontend === "dist/frontend.js", "Frontend entry is correct");

for (const entry of [manifest.entry_backend, manifest.entry_frontend]) {
  try {
    await access(new URL(entry, root));
  } catch {
    failures.push(`${entry} exists`);
  }
}

const backend = await readFile(new URL(manifest.entry_backend, root), "utf8");
const frontend = await readFile(new URL(manifest.entry_frontend, root), "utf8");
check(!/^import\s/m.test(backend), "Backend bundle has no imports");
check(!/^export\s/m.test(backend), "Backend bundle has no exports");
check(backend.includes("registerInterceptor"), "Backend registers an interceptor");
check(backend.includes("runTracker"), "Backend contains tracker generation");
check(frontend.includes("export function setup"), "Frontend exports setup");
check(frontend.includes("ds-tracker-status"), "Frontend updates the profile status badge");
check(frontend.includes("-webkit-appearance: menulist"), "Frontend preserves visible dropdown affordances");
check(frontend.includes("var(--lumiverse-accent, #2563eb)"), "Frontend buttons have a host-independent color fallback");

if (failures.length) {
  console.error(`Package validation failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("Package validation passed.");
