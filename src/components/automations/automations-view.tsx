"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronRight, CircleSlash, MoreHorizontal, Plus, Sparkles, Workflow, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { Board } from "@/components/board/filters";
import { EmptyState } from "@/components/common/empty-state";
import { useCan, useProject } from "@/components/project/project-context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTaskParam } from "@/hooks/use-task-param";
import { type RuleInput, TRIGGER_LABELS, type TriggerType } from "@/lib/automation-schema";
import { slugify, taskKey } from "@/lib/domain";
import { formatDateTime, timeAgo } from "@/lib/format";
import { type RouterOutputs, useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { describeAction, describeCondition, describeTrigger } from "./describe";
import { type EditingRule, RuleEditor } from "./rule-editor";

type Rule = RouterOutputs["automation"]["list"][number];
type Run = RouterOutputs["automation"]["runs"][number];

/** Plantillas listas para usar, armadas con las columnas reales del proyecto. */
function templates(board: Board): { label: string; description: string; rules: RuleInput[] }[] {
  const byName = (name: string) => board.columns.find((c) => slugify(c.name) === slugify(name));
  const review = byName("En revisión") ?? board.columns.find((c) => c.category === "in_progress");
  const done = board.columns.find((c) => c.category === "done");
  const doing = byName("En curso") ?? board.columns.find((c) => c.category === "in_progress");
  const list: { label: string; description: string; rules: RuleInput[] }[] = [];
  if (review && done) {
    list.push({
      label: "Flujo de pull requests",
      description: `PR abierto → ${review.name}; PR mergeado → ${done.name}`,
      rules: [
        {
          name: `PR abierto → ${review.name}`,
          enabled: true,
          trigger: { type: "pr.opened" },
          conditions: [],
          actions: [
            { type: "move_to_column", columnId: review.id },
            { type: "add_comment", body: "Se abrió el PR #{{pr.number}}: {{pr.url}}" },
          ],
        },
        {
          name: `PR mergeado → ${done.name}`,
          enabled: true,
          trigger: { type: "pr.merged" },
          conditions: [],
          actions: [{ type: "move_to_column", columnId: done.id }],
        },
      ],
    });
  }
  if (doing) {
    list.push({
      label: "Rama creada → En curso",
      description: `Al crear una rama para la tarea, moverla a ${doing.name}`,
      rules: [
        {
          name: `Rama creada → ${doing.name}`,
          enabled: true,
          trigger: { type: "branch.created" },
          conditions: [],
          actions: [{ type: "move_to_column", columnId: doing.id }],
        },
      ],
    });
  }
  list.push({
    label: "Aviso de vencimiento",
    description: "Comentar en la tarea 24 h antes de la fecha límite",
    rules: [
      {
        name: "Vence en 24 h",
        enabled: true,
        trigger: { type: "task.due_soon", hoursBefore: 24 },
        conditions: [],
        actions: [{ type: "add_comment", body: "⏰ {{task.key}} vence el {{due_date}}." }],
      },
    ],
  });
  return list;
}

const STATUS = {
  success: { label: "Ejecutada", icon: Check, className: "bg-green-100 text-green-700" },
  skipped: { label: "Omitida", icon: CircleSlash, className: "bg-zinc-100 text-zinc-600" },
  failed: { label: "Falló", icon: X, className: "bg-red-100 text-red-700" },
} as const;

export function AutomationsView() {
  const project = useProject();
  const can = useCan();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const board = useQuery(trpc.board.get.queryOptions({ projectId: project.id }));
  const rules = useQuery(trpc.automation.list.queryOptions({ projectId: project.id }));
  const [editing, setEditing] = useState<EditingRule | null>(null);
  const canManage = can("automation.manage");

  const refresh = () => queryClient.invalidateQueries(trpc.automation.pathFilter());
  const toggle = useMutation(trpc.automation.setEnabled.mutationOptions({ onSuccess: refresh }));
  const remove = useMutation(trpc.automation.delete.mutationOptions({ onSuccess: refresh }));
  const create = useMutation(trpc.automation.create.mutationOptions({ onSuccess: refresh }));

  if (!board.data || rules.isLoading) {
    return (
      <div className="mx-auto max-w-4xl space-y-3 px-4 py-6">
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-20 rounded-xl" />
      </div>
    );
  }
  const data = board.data;
  const newRule = (): EditingRule => ({
    draft: {
      name: "",
      enabled: true,
      trigger: { type: "pr.opened" },
      conditions: [],
      actions: [{ type: "move_to_column", columnId: data.columns.at(-1)?.id ?? "" }],
    },
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-6">
      <Tabs defaultValue="rules">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <TabsList>
            <TabsTrigger value="rules">Reglas</TabsTrigger>
            <TabsTrigger value="runs">Registro</TabsTrigger>
          </TabsList>
          {canManage ? (
            <div className="ml-auto flex gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline">
                    <Sparkles /> Plantillas <ChevronDown className="opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80">
                  <DropdownMenuLabel>Agregar reglas listas</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {templates(data).map((tpl) => (
                    <DropdownMenuItem
                      key={tpl.label}
                      className="flex-col items-start gap-0.5"
                      onSelect={async () => {
                        for (const rule of tpl.rules) await create.mutateAsync({ projectId: project.id, ...rule });
                        toast.success(`Plantilla “${tpl.label}” agregada`);
                      }}
                    >
                      <span className="font-medium">{tpl.label}</span>
                      <span className="text-xs text-muted-foreground">{tpl.description}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button size="sm" onClick={() => setEditing(newRule())}>
                <Plus /> Nueva regla
              </Button>
            </div>
          ) : null}
        </div>

        <TabsContent value="rules">
          {!rules.data?.length ? (
            <EmptyState
              icon={Workflow}
              title="Sin automatizaciones"
              description="Reglas del tipo “cuando ocurre X, si se cumple Y, hacer Z”. Empezá con una plantilla."
            />
          ) : (
            <ul className="space-y-2">
              {rules.data.map((rule) => (
                <RuleCard
                  key={rule.id}
                  rule={rule}
                  board={data}
                  canManage={canManage}
                  onToggle={(enabled) => toggle.mutate({ ruleId: rule.id, enabled })}
                  onEdit={() =>
                    setEditing({
                      id: rule.id,
                      draft: {
                        name: rule.name,
                        enabled: rule.enabled,
                        trigger: rule.trigger as RuleInput["trigger"],
                        conditions: rule.conditions as RuleInput["conditions"],
                        actions: rule.actions as RuleInput["actions"],
                      },
                    })
                  }
                  onDelete={() => window.confirm(`¿Borrar la regla “${rule.name}”?`) && remove.mutate({ ruleId: rule.id })}
                />
              ))}
            </ul>
          )}
        </TabsContent>
        <TabsContent value="runs">
          <RunsLog rules={rules.data ?? []} />
        </TabsContent>
      </Tabs>
      <RuleEditor board={data} editing={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function RuleCard({
  rule,
  board,
  canManage,
  onToggle,
  onEdit,
  onDelete,
}: {
  rule: Rule;
  board: Board;
  canManage: boolean;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const trigger = rule.trigger as RuleInput["trigger"];
  const conditions = (rule.conditions ?? []) as RuleInput["conditions"];
  const actions = (rule.actions ?? []) as RuleInput["actions"];
  return (
    <li className={cn("rounded-xl border p-4", !rule.enabled && "bg-muted/30")}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className={cn("font-medium", !rule.enabled && "text-muted-foreground")}>{rule.name}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground/80">Cuando</span> {describeTrigger(trigger, board)}
            {conditions.length ? (
              <>
                , <span className="font-medium text-foreground/80">si</span>{" "}
                {conditions.map((c) => describeCondition(c, board)).join(" y ")}
              </>
            ) : null}
            , <span className="font-medium text-foreground/80">entonces</span> {actions.map((a) => describeAction(a, board)).join(", ")}.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {rule.lastRunAt ? `Última ejecución ${timeAgo(rule.lastRunAt)}` : "Todavía no se disparó"}
            {rule.runs ? ` · ${rule.runs} ejecutadas` : ""}
            {rule.failures ? <span className="text-destructive"> · {rule.failures} con error</span> : null}
            {!rule.valid ? <span className="text-destructive"> · configuración inválida</span> : null}
          </p>
        </div>
        <Switch checked={rule.enabled} disabled={!canManage} onCheckedChange={onToggle} aria-label="Activar regla" />
        {canManage ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Opciones de la regla">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onEdit}>Editar</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                Borrar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </li>
  );
}

function RunsLog({ rules }: { rules: Rule[] }) {
  const project = useProject();
  const trpc = useTRPC();
  const { openTask } = useTaskParam();
  const [ruleId, setRuleId] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const runs = useQuery(
    trpc.automation.runs.queryOptions({
      projectId: project.id,
      ruleId: ruleId === "all" ? undefined : ruleId,
      status: status === "all" ? undefined : (status as Run["status"]),
    }),
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        <Select value={ruleId} onValueChange={setRuleId}>
          <SelectTrigger size="sm" className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las reglas</SelectItem>
            {rules.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger size="sm" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            <SelectItem value="success">Ejecutadas</SelectItem>
            <SelectItem value="skipped">Omitidas</SelectItem>
            <SelectItem value="failed">Con error</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {runs.isLoading ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : !runs.data?.length ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          Todavía no hay ejecuciones. Cada vez que un evento coincide con una regla queda registrado acá, con el motivo.
        </p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {runs.data.map((run) => {
            const meta = STATUS[run.status];
            const details = run.details as {
              conditions?: { description: string; actual: string; passed: boolean }[];
              actions?: { type: string; ok: boolean; changed: boolean; message: string }[];
            };
            const open = expanded === run.id;
            return (
              <li key={run.id} className="text-sm">
                <button className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/40" onClick={() => setExpanded(open ? null : run.id)}>
                  {open ? <ChevronDown className="size-3.5 text-muted-foreground" /> : <ChevronRight className="size-3.5 text-muted-foreground" />}
                  <span className={cn("inline-flex w-24 shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium", meta.className)}>
                    <meta.icon className="size-3" /> {meta.label}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{run.ruleName}</span>
                    {run.task ? (
                      <span className="text-muted-foreground">
                        {" "}
                        · <span className="font-mono text-xs">{taskKey(run.projectKey, run.task.number)}</span> {run.task.title}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground" title={formatDateTime(run.createdAt)}>
                    {timeAgo(run.createdAt)}
                  </span>
                </button>
                {open ? (
                  <div className="space-y-3 bg-muted/20 px-11 pt-1 pb-4">
                    <p className="text-xs text-muted-foreground">
                      Evento: {TRIGGER_LABELS[run.triggerType as TriggerType] ?? run.triggerType}
                      {run.depth ? ` · encadenado (nivel ${run.depth})` : ""}
                    </p>
                    {run.reason ? <p className="text-sm">{run.reason}</p> : null}
                    {details.conditions?.length ? (
                      <div>
                        <p className="mb-1 text-xs font-medium text-muted-foreground">Condiciones</p>
                        <ul className="space-y-0.5">
                          {details.conditions.map((c, i) => (
                            <li key={i} className="flex items-center gap-2">
                              {c.passed ? <Check className="size-3.5 text-green-600" /> : <X className="size-3.5 text-red-600" />}
                              {c.description} <span className="text-xs text-muted-foreground">(valor: {c.actual})</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {details.actions?.length ? (
                      <div>
                        <p className="mb-1 text-xs font-medium text-muted-foreground">Acciones</p>
                        <ul className="space-y-0.5">
                          {details.actions.map((a, i) => (
                            <li key={i} className="flex items-center gap-2">
                              {a.ok ? <Check className="size-3.5 text-green-600" /> : <X className="size-3.5 text-red-600" />}
                              {a.message}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {run.task ? (
                      <Button size="xs" variant="outline" onClick={() => openTask(taskKey(run.projectKey, run.task!.number))}>
                        Abrir tarea
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
