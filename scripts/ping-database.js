const path = require("path");
require("dotenv").config({
  path: path.resolve(__dirname, "../.env"),
  override: true,
});

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is empty. Check backend/.env");
  }

  const rows = await prisma.$queryRawUnsafe(
    "SELECT current_database() AS db, current_user AS db_user, inet_server_addr()::text AS host, inet_server_port() AS port, now() AS now",
  );
  console.log(JSON.stringify({ connected: true, result: rows }, null, 2));
}

main()
  .catch((err) => {
    console.error(
      JSON.stringify(
        {
          connected: false,
          code: err.code ?? null,
          message: err.message,
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
