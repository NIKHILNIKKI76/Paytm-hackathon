import { mkdir, readFile, writeFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";

const source = await readFile(new URL("app.ts", import.meta.url), "utf8");
await mkdir(new URL("dist/", import.meta.url), { recursive: true });
await writeFile(new URL("dist/app.js", import.meta.url), stripTypeScriptTypes(source));
console.log("Built lending frontend from TypeScript.");
