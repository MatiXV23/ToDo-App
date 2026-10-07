import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** `state` firmado para flujos OAuth: ata el callback al usuario que lo inició. */

function secret() {
  const value = process.env.BETTER_AUTH_SECRET;
  if (!value) throw new Error("BETTER_AUTH_SECRET no está definida");
  return value;
}

export function signState(data: Record<string, string>) {
  const payload = Buffer.from(JSON.stringify({ ...data, n: randomBytes(8).toString("hex"), t: Date.now() })).toString(
    "base64url",
  );
  const sig = createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyState(state: string, maxAgeMs = 15 * 60_000): Record<string, string> | null {
  const [payload, sig] = state.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", secret()).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, string> & { t: number };
  if (Date.now() - data.t > maxAgeMs) return null;
  return data;
}
