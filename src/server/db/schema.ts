import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Posición ordenable (fractional indexing). Se compara byte a byte, por eso usa
 * collation "C": con la collation por defecto (en_US) "a" y "B" se ordenan mal.
 */
const rank = customType<{ data: string }>({
  dataType: () => 'text collate "C"',
});

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts("created_at").defaultNow().notNull();
const updatedAt = () =>
  ts("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date());

// ─── Enums ──────────────────────────────────────────────────────────────

export const projectRole = pgEnum("project_role", ["owner", "editor", "viewer"]);
export const columnCategory = pgEnum("column_category", ["todo", "in_progress", "done"]);
export const priority = pgEnum("priority", ["low", "medium", "high", "urgent"]);
export const sprintStatus = pgEnum("sprint_status", ["planned", "active", "completed"]);
export const epicStatus = pgEnum("epic_status", ["open", "done"]);
export const actorType = pgEnum("actor_type", ["user", "automation", "integration", "system"]);
export const invitationStatus = pgEnum("invitation_status", [
  "pending",
  "accepted",
  "declined",
  "revoked",
]);
export const vcsLinkKind = pgEnum("vcs_link_kind", ["branch", "commit", "pull_request"]);
export const automationRunStatus = pgEnum("automation_run_status", ["success", "skipped", "failed"]);

// ─── Better Auth ────────────────────────────────────────────────────────

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: ts("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: ts("access_token_expires_at"),
    refreshTokenExpiresAt: ts("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: ts("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

// ─── Proyectos y acceso ─────────────────────────────────────────────────

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  ownerId: text("owner_id")
    .notNull()
    .references(() => user.id),
  sprintsEnabled: boolean("sprints_enabled").notNull().default(false),
  taskSeq: integer("task_seq").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  archivedAt: ts("archived_at"),
});

export const projectMembers = pgTable(
  "project_members",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: projectRole("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.userId] }),
    index("project_members_user_idx").on(t.userId),
    uniqueIndex("project_single_owner_idx").on(t.projectId).where(sql`${t.role} = 'owner'`),
  ],
);

export const projectInvitations = pgTable(
  "project_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: projectRole("role").notNull(),
    status: invitationStatus("status").notNull().default("pending"),
    invitedById: text("invited_by_id")
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
    respondedAt: ts("responded_at"),
  },
  (t) => [
    index("project_invitations_email_idx").on(t.email),
    uniqueIndex("project_invitations_pending_idx")
      .on(t.projectId, t.email)
      .where(sql`${t.status} = 'pending'`),
  ],
);

// ─── Trabajo ────────────────────────────────────────────────────────────

export const boardColumns = pgTable(
  "board_columns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    rank: rank("rank").notNull(),
    category: columnCategory("category").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("board_columns_project_idx").on(t.projectId)],
);

export const epics = pgTable(
  "epics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    descriptionMd: text("description_md").notNull().default(""),
    color: text("color").notNull(),
    status: epicStatus("status").notNull().default("open"),
    rank: rank("rank").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts("deleted_at"),
  },
  (t) => [index("epics_project_idx").on(t.projectId)],
);

export const sprints = pgTable(
  "sprints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    goal: text("goal").notNull().default(""),
    status: sprintStatus("status").notNull().default("planned"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    startedAt: ts("started_at"),
    completedAt: ts("completed_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("sprints_project_idx").on(t.projectId),
    uniqueIndex("sprints_single_active_idx").on(t.projectId).where(sql`${t.status} = 'active'`),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => tasks.id, { onDelete: "cascade" }),
    epicId: uuid("epic_id").references(() => epics.id, { onDelete: "set null" }),
    columnId: uuid("column_id")
      .notNull()
      .references(() => boardColumns.id),
    sprintId: uuid("sprint_id").references(() => sprints.id, { onDelete: "set null" }),
    rank: rank("rank").notNull(),
    backlogRank: rank("backlog_rank").notNull(),
    title: text("title").notNull(),
    descriptionMd: text("description_md").notNull().default(""),
    priority: priority("priority").notNull().default("medium"),
    assigneeId: text("assignee_id").references(() => user.id, { onDelete: "set null" }),
    reporterId: text("reporter_id").references(() => user.id, { onDelete: "set null" }),
    dueDate: date("due_date"),
    estimateHours: doublePrecision("estimate_hours"),
    completedAt: ts("completed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts("deleted_at"),
  },
  (t) => [
    unique("tasks_project_number_uq").on(t.projectId, t.number),
    index("tasks_project_column_idx").on(t.projectId, t.columnId),
    index("tasks_parent_idx").on(t.parentId),
    index("tasks_sprint_idx").on(t.sprintId),
    index("tasks_due_idx").on(t.dueDate).where(sql`${t.dueDate} is not null and ${t.deletedAt} is null`),
  ],
);

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique("tags_project_name_uq").on(t.projectId, t.name)],
);

export const taskTags = pgTable(
  "task_tags",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.tagId] }), index("task_tags_tag_idx").on(t.tagId)],
);

export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    authorId: text("author_id").references(() => user.id, { onDelete: "set null" }),
    /** user | automation */
    source: actorType("source").notNull().default("user"),
    automationRuleId: uuid("automation_rule_id"),
    bodyMd: text("body_md").notNull(),
    createdAt: createdAt(),
    editedAt: ts("edited_at"),
  },
  (t) => [index("comments_task_idx").on(t.taskId, t.createdAt)],
);

export const taskActivity = pgTable(
  "task_activity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    actorType: actorType("actor_type").notNull(),
    /** id de usuario, de regla o del proveedor según actorType */
    actorId: text("actor_id"),
    kind: text("kind").notNull(),
    field: text("field"),
    oldValue: jsonb("old_value"),
    newValue: jsonb("new_value"),
    createdAt: createdAt(),
  },
  (t) => [index("task_activity_task_idx").on(t.taskId, t.createdAt)],
);

// ─── Notificaciones ─────────────────────────────────────────────────────

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    invitationId: uuid("invitation_id").references(() => projectInvitations.id, {
      onDelete: "cascade",
    }),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    readAt: ts("read_at"),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.createdAt)],
);

// ─── Eventos de dominio (outbox) ────────────────────────────────────────

export const domainEvents = pgTable(
  "domain_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    taskId: uuid("task_id"),
    actorType: actorType("actor_type").notNull(),
    actorId: text("actor_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    /** Profundidad en una cadena de automatizaciones (0 = acción humana o externa). */
    depth: integer("depth").notNull().default(0),
    /** Reglas que ya actuaron en esta cadena, para cortar bucles. */
    ruleChain: jsonb("rule_chain").$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
    processedAt: ts("processed_at"),
    error: text("error"),
  },
  (t) => [index("domain_events_pending_idx").on(t.id).where(sql`${t.processedAt} is null`)],
);

// ─── Repositorios ───────────────────────────────────────────────────────

export const repoInstallations = pgTable(
  "repo_installations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    accountLogin: text("account_login").notNull(),
    accountType: text("account_type"),
    createdAt: createdAt(),
  },
  (t) => [unique("repo_installations_provider_uq").on(t.provider, t.externalId)],
);

/** Usuarios que demostraron tener acceso a una instalación (vía OAuth del proveedor). */
export const repoInstallationUsers = pgTable(
  "repo_installation_users",
  {
    installationId: uuid("installation_id")
      .notNull()
      .references(() => repoInstallations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.installationId, t.userId] })],
);

export const projectRepositories = pgTable(
  "project_repositories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    installationId: uuid("installation_id")
      .notNull()
      .references(() => repoInstallations.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    externalRepoId: text("external_repo_id").notNull(),
    fullName: text("full_name").notNull(),
    defaultBranch: text("default_branch").notNull(),
    htmlUrl: text("html_url").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("project_repositories_uq").on(t.projectId, t.provider, t.externalRepoId),
    index("project_repositories_external_idx").on(t.provider, t.externalRepoId),
  ],
);

export const taskVcsLinks = pgTable(
  "task_vcs_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    projectRepositoryId: uuid("project_repository_id")
      .notNull()
      .references(() => projectRepositories.id, { onDelete: "cascade" }),
    kind: vcsLinkKind("kind").notNull(),
    /** Nombre de rama, SHA del commit o número de PR. */
    externalId: text("external_id").notNull(),
    title: text("title").notNull().default(""),
    url: text("url").notNull(),
    /** Rama: active | deleted. PR: draft | open | in_review | merged | closed. */
    state: text("state").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("task_vcs_links_uq").on(t.taskId, t.projectRepositoryId, t.kind, t.externalId),
    index("task_vcs_links_task_idx").on(t.taskId),
  ],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    deliveryId: text("delivery_id").notNull(),
    event: text("event").notNull(),
    action: text("action"),
    payload: jsonb("payload").notNull(),
    receivedAt: ts("received_at").defaultNow().notNull(),
    processedAt: ts("processed_at"),
    error: text("error"),
  },
  (t) => [unique("webhook_deliveries_uq").on(t.provider, t.deliveryId)],
);

// ─── Automatizaciones ───────────────────────────────────────────────────

export const automationRules = pgTable(
  "automation_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    trigger: jsonb("trigger").notNull(),
    conditions: jsonb("conditions").notNull().default([]),
    actions: jsonb("actions").notNull().default([]),
    createdById: text("created_by_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("automation_rules_project_idx").on(t.projectId)],
);

export const automationRuns = pgTable(
  "automation_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => automationRules.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    eventId: bigint("event_id", { mode: "number" }),
    triggerType: text("trigger_type").notNull(),
    status: automationRunStatus("status").notNull(),
    reason: text("reason"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    depth: integer("depth").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index("automation_runs_rule_idx").on(t.ruleId, t.createdAt),
    index("automation_runs_project_idx").on(t.projectId, t.createdAt),
  ],
);

/** Evita disparar dos veces el mismo aviso de fecha límite. */
export const dueReminders = pgTable(
  "due_reminders",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    dueDate: date("due_date").notNull(),
    /** "notify" para el aviso al responsable, o el id de la regla. */
    kind: text("kind").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.dueDate, t.kind] })],
);

// ─── IA ─────────────────────────────────────────────────────────────────

export const aiUsage = pgTable(
  "ai_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    feature: text("feature").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    status: text("status").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("ai_usage_user_idx").on(t.userId, t.createdAt)],
);
