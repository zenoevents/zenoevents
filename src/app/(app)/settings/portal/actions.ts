"use server";

import { db, org } from "@/db";
import { eq } from "drizzle-orm";
import { requirePerm } from "@/lib/guard";
import { getOrg, withOrg } from "@/lib/org";
import { revalidatePath } from "next/cache";

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "business";
}

export async function ensurePortalSlugAction() {
  return withOrg(async () => {
    await requirePerm("settings");
    const o = await getOrg();
    if (o.portalSlug) return { slug: o.portalSlug };

    const base = slugify(o.name);
    for (let i = 0; i < 5; i++) {
      const candidate = i === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
      try {
        await db.update(org).set({ portalSlug: candidate }).where(eq(org.id, o.id));
        revalidatePath("/settings/portal");
        return { slug: candidate };
      } catch {
        // unique collision — retry with suffix
      }
    }
    return { error: "Could not generate a portal link — try again" };
  });
}
