import { access, readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("spindle.json", root), "utf8"));
const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

check(/^\d+\.\d+\.\d+$/.test(manifest.version), "Manifest version is semver");
check(manifest.version === packageJson.version, "Manifest and package versions match");
check(/^[a-z0-9_]+$/.test(manifest.identifier), "Manifest identifier is valid");
for (const permission of ["generation", "interceptor", "chat_mutation", "ui_panels"]) {
  check(manifest.permissions?.includes(permission), `${permission} permission is requested`);
}
check(manifest.entry_backend === "dist/backend.js", "Backend entry is correct");
check(manifest.entry_frontend === "dist/frontend.js", "Frontend entry is correct");
check(manifest.interceptorTimeoutMs === 300_000, "Interceptor budget covers bounded tracker reconciliation");

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
check(frontend.includes("mountSelect"), "Frontend uses native Lumiverse selects when available");
check(frontend.includes("mountSwitch"), "Frontend uses a native Lumiverse switch when available");
check(frontend.includes("createFallbackDetails"), "Frontend keeps mounted controls in persistent details sections");
check(!frontend.includes("mountCollapsibleSection"), "Frontend does not mount controls inside unmounting host collapsibles");
check(frontend.includes("Continuity snapshot"), "Frontend presents a privacy-safe public continuity snapshot");
check(backend.includes("publicTrackerSnapshot"), "Backend publishes a privacy-safe tracker projection");
check(backend.includes("physicalAttraction"), "Backend bundle contains tracker schema v4 private response state");
check(backend.includes("bodyTypeAndProportions"), "Backend bundle contains stable woman appearance state");
check(backend.includes("fictional narrative clock, never wall-clock time"), "Backend distinguishes narrative time from wall-clock delay");
check(backend.includes("scene.lifecycle"), "Backend bundle contains explicit scene lifecycle state");
check(backend.includes("arc.lifecycle"), "Backend bundle contains explicit arc lifecycle state");
check(backend.includes("dressAndLayers"), "Backend bundle contains structured visible-man state");
check(backend.includes("proximityAndContact"), "Backend bundle contains structured spatial state");
check(frontend.includes("Body type & proportions"), "Frontend exposes stable woman appearance state");
check(backend.includes("upgradeTrackerState"), "Backend bundle upgrades older tracker state");
check(backend.includes("buildSurpriseMeSample"), "Backend bundle contains the prompt-only Surprise Me sampler");
check(frontend.includes("MutationObserver"), "Frontend self-heals delayed profile-card rendering");
check(frontend.includes("data-engine-manual"), "Frontend owns the manual-fallback visibility handshake");
check(frontend.includes("frontend detected, but the backend did not confirm"), "Frontend watchdog distinguishes backend failure");
check(frontend.includes("dsc-fallback-control"), "Frontend retains a themed compatibility fallback");
check(frontend.includes("createFloatWidget"), "Frontend creates the optional native floating status widget");
check(frontend.includes("CONTINUITY_ICON_SVG"), "Frontend reuses one Continuity icon for the tab and widget");
check(frontend.includes("Show Widget"), "Frontend exposes the floating-widget preference");
check(frontend.includes("continuity_set_widget_visibility"), "Frontend persists widget visibility immediately");
check(backend.includes("showStatusWidget"), "Backend persists the floating-widget preference");

if (failures.length) {
  console.error(`Package validation failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("Package validation passed.");
