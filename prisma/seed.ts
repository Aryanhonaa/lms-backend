/// <reference types="node" />
import { loadBackendEnv } from "../src/config/load-env";
import { PrismaClient, Role } from "../src/generated/prisma";
import bcrypt from "bcryptjs";

loadBackendEnv();

const prisma = new PrismaClient();

const DEV_PASSWORD = "DevPass123!";

const users: Array<{ name: string; email: string; role: Role }> = [
  { name: "Ava Admin", email: "admin@lms.local", role: Role.SUPER_ADMIN },
  { name: "Iris Ops", email: "ops@lms.local", role: Role.ADMIN },
  { name: "Theo Trainer", email: "trainer@lms.local", role: Role.TRAINER },
  { name: "Nina Trainee", email: "trainee1@lms.local", role: Role.TRAINEE },
  { name: "Omar Trainee", email: "trainee2@lms.local", role: Role.TRAINEE },
  { name: "Priya Trainee", email: "trainee3@lms.local", role: Role.TRAINEE },
  { name: "Leo Trainee", email: "trainee4@lms.local", role: Role.TRAINEE },
];

async function main(): Promise<void> {
  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 12);

  for (const user of users) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: {
        name: user.name,
        role: user.role,
        passwordHash,
        isActive: true,
      },
      create: {
        name: user.name,
        email: user.email,
        role: user.role,
        passwordHash,
      },
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });

  