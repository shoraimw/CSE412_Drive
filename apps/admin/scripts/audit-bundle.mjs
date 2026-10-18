import {existsSync, readdirSync, readFileSync, statSync} from "node:fs";
import {join} from "node:path";

const build = new URL("../dist/", import.meta.url);
if (!existsSync(build)) throw new Error("Run npm run build before bundle inspection.");
const forbidden = [
  /sk_(?:test|live)_[A-Za-z0-9]{12,}/,
  /whsec_[A-Za-z0-9]{12,}/,
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
  /AIza[0-9A-Za-z_-]{35}(?:[^\w-]|$)/,
  /"private_key"\s*:/,
];
let checked = 0;
function inspect(dir) {
  for(const name of readdirSync(dir)) {
    const file=join(dir,name);
    if(statSync(file).isDirectory()) {
      inspect(file);continue;
    }
    if(!/\.(?:js|css|html|json|map)$/i.test(name))continue;
    const content=readFileSync(file,"utf8");
    if(forbidden.some(expr=>expr.test(content))) {
      throw new Error("Possible sensitive credential embedded in browser bundle: "+name);
    }
    checked++;
  }
}
inspect(build.pathname);
if(checked===0)throw new Error("No deployable web assets found.");
console.log("Admin public bundle audit passed for",checked,"asset(s).");
