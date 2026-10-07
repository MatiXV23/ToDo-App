// Arranca `next dev` en el puerto de APP_URL para que coincida con los callbacks de OAuth.
// Solo lee APP_URL: el resto del .env lo carga Next (y lo recarga al cambiar el archivo).
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

const fileEnv = existsSync(".env") ? parseEnv(readFileSync(".env", "utf8")) : {};
const url = new URL(process.env.APP_URL || fileEnv.APP_URL || "http://localhost:3000");
const port = url.port || (url.protocol === "https:" ? "443" : "80");

const child = spawn("next", ["dev", "--port", port], { stdio: "inherit", shell: true });
child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
