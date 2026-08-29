import crypto from "crypto";
import { db, receiptTokens, payments, documents, contacts, org } from "@/db";
import { and, eq } from "drizzle-orm";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"; // no 0/O/1/l/I

function generateToken(length = 12): string {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** One stable token per payment — created on first request, reused after. */
export async function getOrCreateReceiptToken(orgId: number, paymentId: number): Promise<string> {
  const [existing] = await db.select().from(receiptTokens)
    .where(and(eq(receiptTokens.paymentId, paymentId), eq(receiptTokens.orgId, orgId), eq(receiptTokens.revoked, false)));
  if (existing) return existing.token;

  // Retry on the (astronomically rare) token collision; the paymentId unique
  // index also makes concurrent calls converge on one row.
  for (let attempt = 0; attempt < 3; attempt++) {
    const token = generateToken();
    const [row] = await db.insert(receiptTokens)
      .values({ orgId, paymentId, token, createdAt: new Date().toISOString() })
      .onConflictDoNothing()
      .returning({ token: receiptTokens.token });
    if (row) return row.token;
    const [raced] = await db.select().from(receiptTokens)
      .where(and(eq(receiptTokens.paymentId, paymentId), eq(receiptTokens.revoked, false)));
    if (raced) return raced.token;
  }
  throw new Error("Failed to create receipt token");
}

/** Absolute app origin: env var, else the current request's host. */
export async function appOrigin(): Promise<string> {
  const env = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (env) {
    const withProtocol = /^https?:\/\//.test(env) ? env : `https://${env}`;
    return withProtocol.replace(/\/$/, "");
  }
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    const host = h.get("x-forwarded-host") || h.get("host");
    if (host) {
      const proto = h.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
      return `${proto}://${host}`;
    }
  } catch {
    // outside a request scope (scripts) — fall through
  }
  return "";
}

export async function receiptUrl(token: string): Promise<string> {
  return `${await appOrigin()}/r/${token}`;
}

/** Public lookup: full receipt payload for a valid token, else null. */
export async function getReceiptByToken(token: string) {
  if (!/^[A-Za-z0-9]{8,32}$/.test(token)) return null;

  const [row] = await db
    .select({ tok: receiptTokens, payment: payments })
    .from(receiptTokens)
    .innerJoin(payments, eq(payments.id, receiptTokens.paymentId))
    .where(and(eq(receiptTokens.token, token), eq(receiptTokens.revoked, false)));
  if (!row) return null;

  const [o] = await db.select().from(org).where(eq(org.id, row.tok.orgId));
  if (!o) return null;

  const [doc] = row.payment.documentId
    ? await db.select().from(documents).where(eq(documents.id, row.payment.documentId))
    : [undefined];
  const [contact] = row.payment.contactId
    ? await db.select().from(contacts).where(eq(contacts.id, row.payment.contactId))
    : [undefined];

  return { org: o, payment: row.payment, doc, contact };
}
