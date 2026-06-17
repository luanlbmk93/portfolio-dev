const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const src = path.join(root, "portfolio pessoal", "dist");
const dest = path.join(root, "portfolio", "dist");

if (!fs.existsSync(src)) {
  console.error("Erro: rode o build antes — pasta não encontrada:", src);
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
fs.cpSync(src, dest, { recursive: true });
console.log("OK: portfolio pessoal/dist → portfolio/dist");
