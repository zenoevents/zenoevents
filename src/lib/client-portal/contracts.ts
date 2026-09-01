"use server";

import { db, contracts, projects } from "@/db";
import { and, eq } from "drizzle-orm";
import { getClientSession } from "@/lib/client-portal/auth";
import { nowISO } from "@/lib/money";
import { revalidatePath } from "next/cache";

async function clientIpFromHeaders(): Promise<string | null> {
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    const fwd = h.get("x-forwarded-for");
    return fwd ? fwd.split(",")[0].trim() : null;
  } catch {
    return null;
  }
}

/** Ownership-checked single contract fetch — must belong to a project owned
 *  by contactId. Returns null (never throws) so pages can 404 cleanly. */
export async function getClientContractForAccept(orgId: number, contactId: number, contractId: number) {
  const [row] = await db
    .select({ contract: contracts, projectContactId: projects.contactId })
    .from(contracts)
    .innerJoin(projects, eq(projects.id, contracts.projectId))
    .where(and(eq(contracts.orgId, orgId), eq(contracts.id, contractId)))
    .limit(1);
  if (!row || row.projectContactId !== contactId) return null;
  return row.contract;
}

async function guardAcceptableContract(orgSlug: string, contractId: number) {
  const session = await getClientSession(orgSlug);
  if (!session) throw new Error("Not signed in");
  const contract = await getClientContractForAccept(session.orgId, session.contactId, contractId);
  if (!contract) throw new Error("Contract not found");
  if (!["draft", "sent"].includes(contract.status)) throw new Error("This contract has already been responded to");
  return { session, contract };
}

/** Step 1 of the portal flow: agreeing to the terms, before the actual
 *  signature. Doesn't touch `status`/`signedAt` — those only get set once
 *  the client types their name to sign (portalSignContractAction below).
 *  Kept as its own action so a client who accepts but doesn't finish signing
 *  in the same visit doesn't leave the contract in a half-signed state. */
export async function portalAcceptContractAction(orgSlug: string, contractId: number): Promise<{ success: true } | { error: string }> {
  try {
    await guardAcceptableContract(orgSlug, contractId);
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not accept this contract" };
  }
}

/** Step 2: the actual virtual signature — the client types their full name
 *  to sign, same real-world weight as a typed e-signature elsewhere. This is
 *  what actually flips status to "signed", visible to staff immediately
 *  since it's the same `contracts` row ContractsPanel already reads. */
export async function portalSignContractAction(orgSlug: string, contractId: number, typedName: string): Promise<{ success: true } | { error: string }> {
  try {
    const { contract } = await guardAcceptableContract(orgSlug, contractId);
    const clean = typedName.trim();
    if (!clean) throw new Error("Type your full name to sign");
    const ip = await clientIpFromHeaders();

    await db.update(contracts).set({
      status: "signed",
      signedAt: nowISO(),
      signedByName: clean,
      signatureMethod: "portal_click",
      portalAcceptedIp: ip,
    }).where(eq(contracts.id, contract.id));

    revalidatePath(`/portal/${orgSlug}/projects/${contract.projectId}`);
    revalidatePath(`/projects/${contract.projectId}`);
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not record your signature" };
  }
}

export async function portalDeclineContractAction(orgSlug: string, contractId: number): Promise<{ success: true } | { error: string }> {
  try {
    const { contract } = await guardAcceptableContract(orgSlug, contractId);
    await db.update(contracts).set({ status: "declined" }).where(eq(contracts.id, contract.id));
    revalidatePath(`/portal/${orgSlug}/projects/${contract.projectId}`);
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not decline this contract" };
  }
}
