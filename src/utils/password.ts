import bcrypt from "bcryptjs";

const ROUNDS = 12;
const DUMMY_HASH = bcrypt.hashSync("invalid-credentials-placeholder", 10);

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain: string, passwordHash: string | null): Promise<boolean> {
  const compared = await bcrypt.compare(plain, passwordHash ?? DUMMY_HASH);
  return Boolean(passwordHash) && compared;
}
