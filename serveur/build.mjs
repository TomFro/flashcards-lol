// Fabrique worker.bundle.js : le serveur en un seul fichier, à coller dans Cloudflare.
// À relancer après chaque changement de core.js ou worker.js : node serveur/build.mjs
import { readFileSync, writeFileSync } from "node:fs";
const dir = new URL(".", import.meta.url);
const core = readFileSync(new URL("core.js", dir), "utf8");
const worker = readFileSync(new URL("worker.js", dir), "utf8");
const names = [...core.matchAll(/^export (?:const|function|class) (\w+)/gm)].map((m) => m[1]);
const out = `// FICHIER FABRIQUÉ par build.mjs à partir de core.js et worker.js : ne pas le modifier à la main.
// C'est ce fichier qu'on colle dans Cloudflare (Workers > Edit code).
const G = (() => {
${core.replace(/^export /gm, "")}
return { ${names.join(", ")} };
})();

${worker.replace(/^import \* as G from "\.\/core\.js";\n/m, "")}`;
if (out.includes('from "./core.js"')) throw new Error("import de core.js pas retiré");
writeFileSync(new URL("worker.bundle.js", dir), out);
console.log(`worker.bundle.js : ${out.length} caractères, ${names.length} fonctions de core.js`);
