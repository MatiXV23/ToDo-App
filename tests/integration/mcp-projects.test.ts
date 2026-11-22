import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { projectRepositories, repoInstallations, repoInstallationUsers } from "@/server/db/schema";
import { createMcpServer } from "@/server/mcp/server";
import type { Actor } from "@/server/permissions/access";
import { getProvider, setProviderForTests } from "@/server/repo-providers";
import type { ProviderRepository, RepoProvider } from "@/server/repo-providers/types";
import { createProject } from "@/server/services/projects";
import { as, createUser, projectWithRoles } from "./helpers";

afterEach(() => setProviderForTests(null));

async function connect(actor: Actor) {
  const server = createMcpServer(actor);
  const client = new Client({ name: "test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return async (name: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
    const text = res.content[0]?.text ?? "";
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {}
    return { error: !!res.isError, text, data: data as Record<string, unknown> };
  };
}

/** GitHub falso: una instalación de "acme" (vinculada al usuario) con dos repos. */
async function fakeGithub(userId: string) {
  const suffix = randomUUID().slice(0, 8);
  const installationExternalId = `inst-${suffix}`;
  const repos: ProviderRepository[] = ["web", "api"].map((name, i) => ({
    externalId: `${suffix}-${i}`,
    fullName: `acme-${suffix}/${name}`,
    htmlUrl: `https://github.com/acme-${suffix}/${name}`,
    defaultBranch: "main",
    private: true,
  }));
  const [inst] = await db
    .insert(repoInstallations)
    .values({ provider: "github", externalId: installationExternalId, accountLogin: `acme-${suffix}` })
    .returning();
  await db.insert(repoInstallationUsers).values({ installationId: inst.id, userId });
  const provider: RepoProvider = {
    ...getProvider("github")!,
    isConfigured: () => true,
    async listRepositories(id) {
      return id === installationExternalId ? repos : [];
    },
  };
  setProviderForTests(provider);
  return { owner: `acme-${suffix}`, repos };
}

describe("MCP: proyectos y repositorios", () => {
  it("crea un proyecto con clave derivada y le conecta el repo del remoto git", async () => {
    const me = await createUser("Dueña");
    const gh = await fakeGithub(me.id);
    const call = await connect(as(me));

    const name = `Tienda ${randomUUID().slice(0, 4)} Online`;
    const created = await call("create_project", { name, repository: `git@github.com:${gh.owner}/web.git` });
    expect(created.error).toBe(false);
    const key = created.data.key as string;
    expect(key).toMatch(/^T[A-Z0-9]{1,9}$/);
    expect(created.data).toMatchObject({ repository: { fullName: gh.repos[0].fullName, alreadyConnected: false } });
    expect(created.data.url).toContain(`/p/${key}`);

    // Idempotente y sin importar mayúsculas.
    const again = await call("connect_repository", { project: key, repository: `https://github.com/${gh.owner.toUpperCase()}/WEB` });
    expect(again.data).toMatchObject({ repository: gh.repos[0].fullName, alreadyConnected: true });

    const listed = await call("list_repositories", { project: key });
    expect(listed.data).toMatchObject({
      githubConfigured: true,
      connected: [{ fullName: gh.repos[0].fullName }],
      available: [{ fullName: gh.repos[1].fullName }],
    });

    const found = await call("find_projects_by_repository", { repository: `${gh.owner}/web` });
    expect(found.data).toMatchObject([{ key, role: "owner" }]);
    expect((await call("find_projects_by_repository", { repository: `${gh.owner}/api` })).data).toEqual([]);
  });

  it("si la clave pedida está tomada, usa la siguiente libre al derivarla", async () => {
    const me = await createUser();
    const call = await connect(as(me));
    const base = `Q${randomUUID().replace(/[^A-Z0-9]/gi, "").slice(0, 3).toUpperCase()}`;
    await createProject(as(me), { name: "x", key: base });
    const created = await call("create_project", { name: base.toLowerCase() });
    expect(created.data.key).toBe(`${base}2`);
  });

  it("explica cómo dar acceso cuando el repo no está en ninguna instalación", async () => {
    const me = await createUser();
    const gh = await fakeGithub(me.id);
    const call = await connect(as(me));
    const created = await call("create_project", { name: "Sin acceso", repository: "otra-cuenta/repo" });
    expect(created.error).toBe(false);
    expect(created.data.repositoryError).toMatch(/Instalá la GitHub App en "otra-cuenta".*\/api\/integrations\/github\/connect\?project=/);

    const key = created.data.key as string;
    const missing = await call("connect_repository", { project: key, repository: `${gh.owner}/no-existe` });
    expect(missing.error).toBe(true);
    expect(missing.text).toContain(`está instalada en "${gh.owner}"`);

    expect((await call("connect_repository", { project: key, repository: "https://gitlab.com/a/b" })).text).toMatch(/solo .* GitHub/);
  });

  it("solo el dueño conecta repos y los tokens externos no crean proyectos", async () => {
    const { project, editor, owner } = await projectWithRoles();
    await fakeGithub(owner.id);
    const asEditor = await connect(as(editor));
    expect((await asEditor("connect_repository", { project: project.key, repository: "a/b" })).error).toBe(true);
    expect((await asEditor("list_repositories", { project: project.key })).data).toMatchObject({ available: [] });

    const external = await connect({ type: "user", userId: owner.id, via: "ITP App", external: true });
    const res = await external("create_project", { name: "Spam" });
    expect(res.error).toBe(true);
    expect(res.text).toMatch(/integración externa/);
    const rows = await db.select().from(projectRepositories).where(eq(projectRepositories.projectId, project.id));
    expect(rows).toEqual([]);
  });
});
