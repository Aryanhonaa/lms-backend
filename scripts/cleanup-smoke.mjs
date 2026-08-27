// Removes draft programs created by scripts/smoke-files.mjs.
import { PrismaClient } from "../src/generated/prisma/index.js";

const prisma = new PrismaClient();
const result = await prisma.program.deleteMany({ where: { title: { startsWith: "Storage smoke" } } });
console.log("removed draft programs:", result.count);
await prisma.$disconnect();
