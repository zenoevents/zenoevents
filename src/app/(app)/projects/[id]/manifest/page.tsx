import { notFound, redirect } from "next/navigation";
import { getProject } from "@/lib/projects";
import { getManifestForProject } from "@/lib/manifests";
import { getAccess } from "@/lib/access";
import { PageHeader } from "@/components/ui";
import { ManifestClient } from "./ManifestClient";

export const dynamic = "force-dynamic";

export default async function ManifestPage({ params }: { params: Promise<{ id: string }> }) {
  const access = await getAccess();
  if (!access) redirect("/login");
  if (!access.perms.has("manifests") && !access.perms.has("projects")) redirect("/");
  const { id } = await params;
  const projectId = Number(id);
  const project = await getProject(projectId);
  if (!project) notFound();

  const manifest = await getManifestForProject(projectId);
  const isAdmin = access.isOwner || access.role === "admin";

  return (
    <>
      <PageHeader title={`Manifest — ${project.name}`} subtitle={[project.eventType, project.venue, project.eventDate].filter(Boolean).join(" · ")} />
      <ManifestClient
        projectId={projectId}
        manifest={manifest}
        viewerRole={access.role}
        isAdmin={isAdmin}
      />
    </>
  );
}
