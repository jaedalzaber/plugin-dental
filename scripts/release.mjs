// Builds a release: the packed plugin in package/ (committed: a Git install of the release tag uses it) and
// release/dental-<version>.zip with its sha256 (for a zip upload). See README.md, Releasing.
// Signing: RELEASE_KEY=<private key PEM file> RELEASE_KEY_ID=<key id> pnpm release
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { id, version } = JSON.parse(readFileSync(join(root, "plugin.json"), "utf8"));
const zip = join(root, "release", `dental-${version}.zip`);
mkdirSync(dirname(zip), { recursive: true });

const args = ["--import", "tsx", join(root, "..", "booking-and-cms", "packages", "plugin-sdk", "src", "pack", "cli.ts"), root, "--out", join(root, "package"), "--zip", zip];
if (process.env.RELEASE_KEY) args.push("--key", process.env.RELEASE_KEY, "--key-id", process.env.RELEASE_KEY_ID ?? "");
execFileSync(process.execPath, args, { cwd: root, stdio: "inherit" });

const sha256 = createHash("sha256").update(readFileSync(zip)).digest("hex");
console.log(`\n${id} ${version}\n  zip:    ${zip}\n  sha256: ${sha256}`);
console.log(`\nNext: commit (package/ included), then git tag v${version} && git push origin main v${version},\nthen set version and download.ref ("v${version}") in the plugin list's index.json.`);
