import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const repoUrl = new URL("../", import.meta.url);

async function assertMissing(relativePath) {
  await assert.rejects(access(new URL(relativePath, repoUrl)));
}

test("fork excludes the Remote Support interface and relay", async () => {
  await Promise.all([
    assertMissing("src/lib/remoteSupport.js"),
    assertMissing("src/lib/remoteSerial.js"),
    assertMissing("scripts/remote_support_mcp.mjs"),
    assertMissing("deploy/homeassistant-addon"),
    assertMissing("deploy/webflasher.caddy"),
  ]);

  const [app, packageJson, workflow] = await Promise.all([
    readFile(new URL("src/App.jsx", repoUrl), "utf8"),
    readFile(new URL("package.json", repoUrl), "utf8"),
    readFile(new URL(".github/workflows/pages.yml", repoUrl), "utf8"),
  ]);

  for (const source of [app, packageJson, workflow]) {
    assert.doesNotMatch(source, /remote[- ]support/i);
  }
});

test("fork deploys only through GitHub Pages", async () => {
  await Promise.all([
    assertMissing(".github/workflows/deploy.yml"),
    assertMissing(".github/actionlint.yaml"),
    assertMissing("scripts/reconcile-webflasher-caddy.sh"),
    assertMissing("scripts/verify-webflasher-caddy.sh"),
  ]);

  const workflow = await readFile(
    new URL(".github/workflows/pages.yml", repoUrl),
    "utf8",
  );
  assert.match(workflow, /runs-on: ubuntu-latest/);
  assert.match(workflow, /actions\/configure-pages@v6/);
  assert.match(workflow, /actions\/upload-pages-artifact@v5/);
  assert.match(workflow, /actions\/deploy-pages@v5/);
  assert.doesNotMatch(workflow, /self-hosted|rpi4|ssh|homeassistant/i);
});

test("fork documentation and runtime do not reference the source project", async () => {
  const legacyBrand = ["Sybil", "Sight"].join("");
  const legacyHost = ["webflasher.", "sybil", "sight.com"].join("");
  const paths = [
    "README.md",
    "LICENSE.md",
    "index.html",
    "package.json",
    "vite.config.js",
    "src/App.jsx",
    "src/lib/automaticRecovery.js",
    "src/lib/pogoFlashBridge.js",
    "scripts/build-firmware-archive.mjs",
    "scripts/g2_pogo_flasher.md",
    "public/firmware-updates/index.json",
  ];
  await assertMissing("scripts/build_g2flash_cfw.py");
  const contents = await Promise.all(
    paths.map((relativePath) =>
      readFile(new URL(relativePath, repoUrl), "utf8"),
    ),
  );
  for (const [index, source] of contents.entries()) {
    assert.equal(source.toLowerCase().includes(legacyBrand.toLowerCase()), false, paths[index]);
    assert.equal(source.toLowerCase().includes(legacyHost), false, paths[index]);
  }
});

test("fork publishes only pinned firmware, official or reviewed custom", async () => {
  const catalog = JSON.parse(
    await readFile(
      new URL("public/firmware-updates/index.json", repoUrl),
      "utf8",
    ),
  );
  assert.ok(catalog.releases.length > 0);
  for (const release of catalog.releases) {
    const channel = release.channel ?? "official";
    assert.ok(
      channel === "official" || channel === "custom",
      `${release.id} uses an unknown channel`,
    );
    assert.match(release.sha256, /^[a-f0-9]{64}$/, `${release.id} is not pinned`);
    if (channel !== "custom") continue;
    // A custom release must be reproducible from a pinned official base, so
    // what it contains can be re-derived rather than trusted.
    assert.equal(release.trust, "reviewed-custom", release.id);
    assert.match(release.baseVersion ?? "", /^2(?:\.[0-9]+)+$/, release.id);
    assert.match(release.patchSha256 ?? "", /^[a-f0-9]{64}$/, release.id);
    assert.ok(release.patchUrl?.startsWith("/firmware-updates/g2/"), release.id);
    // The charging case bundle is untouched by a glasses-only patch set.
    assert.equal(release.recoveryTarget, "glasses", release.id);
    assert.equal(release.caseRecoveryEligible, false, release.id);
  }

  // The retired advertised-name CFW stays out of the compiled writer allowlist.
  const targets = await readFile(
    new URL("src/lib/templeFlashTargets.js", repoUrl),
    "utf8",
  );
  assert.doesNotMatch(targets, /105032302d02/i);
});

test("fork has one canonical firmware catalog source", async () => {
  await assertMissing("public/firmware-catalog.json");

  const [catalog, viteConfig] = await Promise.all([
    readFile(
      new URL("public/firmware-updates/index.json", repoUrl),
      "utf8",
    ),
    readFile(new URL("vite.config.js", repoUrl), "utf8"),
  ]);

  const parsed = JSON.parse(catalog);
  assert.ok(parsed.releases.length > 0);
  assert.ok(
    parsed.releases.every((release) =>
      release.url.startsWith("/firmware-updates/g2/"),
    ),
  );
  assert.ok(
    parsed.ringReleases.every((release) =>
      release.url.startsWith("/firmware-updates/r1/"),
    ),
  );
  assert.match(
    viteConfig,
    /public\/firmware-updates\/index\.json/,
  );
  assert.doesNotMatch(viteConfig, /public\/firmware-catalog\.json/);
});

test("fork excludes the R1 bootloader unlock implementation and payloads", async () => {
  await Promise.all([
    assertMissing("src/lib/r1Unlock.js"),
    assertMissing("public/firmware-updates/local-r1-owner-unlock"),
  ]);

  const app = await readFile(new URL("src/App.jsx", repoUrl), "utf8");
  assert.doesNotMatch(app, /r1Unlock|unlockRingBootloader|Unlock R1 bootloader/);
});
