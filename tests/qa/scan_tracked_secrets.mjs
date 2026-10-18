/**
 * Lightweight repository secret-pattern guard, not a complete credential
 * inventory. Ignore README examples only by requiring credential-like values.
 */
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";

const paths = execFileSync("git", ["ls-files", "-z"], {encoding: "utf8"})
  .split("\0").filter(Boolean);
const forbiddenNames = /(^|\/)(\.env(\.(?!example$)[^/]*)?|serviceAccountKey\.json|google-services\.json|GoogleService-Info\.plist|[^/]+-firebase-adminsdk-[^/]+\.json)$/i;
const forbiddenExts = /\.(pem|p12|pfx|key)$/i;
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /sk_live_[a-zA-Z0-9]{12,}/,
  /ghp_[a-zA-Z0-9]{30,}/,
  /AKIA[0-9A-Z]{16}/,
  /"private_key"\s*:\s*"[^"]{20,}"/,
];
const bad = [];
for (const path of paths) {
  if (forbiddenNames.test(path) || forbiddenExts.test(path)) {
    bad.push(path + ": sensitive filename committed");
    continue;
  }
  if (!/\.(js|mjs|cjs|ts|tsx|dart|py|json|yml|yaml|md|toml|html|xml|sh|ps1|txt)$/.test(path)) continue;
  let text;
  try { text = readFileSync(path, "utf8"); } catch { continue; }
  if (patterns.some(pattern => pattern.test(text))) bad.push(path + ": possible secret pattern");
}
if (bad.length) {
  bad.forEach(message => console.error("BLOCKED " + message));
  process.exit(1);
}
console.log("Tracked-file secret-pattern checks passed (" + paths.length + " files checked).");
