const fs = require("node:fs");
const path = require("node:path");

const src = path.resolve(__dirname, "../src/generated");
const dest = path.resolve(__dirname, "../dist/generated");

if (!fs.existsSync(path.join(src, "prisma", "index.js"))) {
  console.error("Prisma client is missing at src/generated/prisma. Run prisma generate first.");
  process.exit(1);
}

fs.cpSync(src, dest, { recursive: true });
