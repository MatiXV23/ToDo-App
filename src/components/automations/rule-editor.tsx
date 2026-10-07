"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { Board } from "@/components/board/filters";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  ACTION_LABELS,
  type Action,
  CONDITION_LABELS,
  type Condition,
  ruleInputSchema,
  type RuleInput,
  TEMPLATE_VARIABLES,
  type Trigger,
  TRIGGER_LABELS,
  TRIGGER_TYPES,
} from "@/lib/automation-schema";
import { PRIORITIES, PRIORITY_META, type Priority } from "@/lib/domain";
import { useTRPC } from "@/lib/trpc";

const ANY = "__any__";
const NONE = "__none__";

function Pick({
  value,
  onChange,
  options,
  placeholder,
  className = "w-48",
}: {
  value: string | null | undefined;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  className?: string;
}) {
  return (
    <Select value={value ?? undefined} onValueChange={onChange}>
      <SelectTrigger size="sm" className={className}>
        <SelectValue placeholder={placeholder ?? "Elegir…"} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function defaultTrigger(type: Trigger["type"]): Trigger {
  if (type === "task.moved") return { type, fromColumnId: null, toColumnId: null };
  if (type === "task.due_soon") return { type, hoursBefore: 24 };
  return { type } as Trigger;
}

function defaultCondition(type: Condition["type"], board: Board): Condition {
  switch (type) {
    case "priority":
      return { type, op: "in", values: ["high", "urgent"] };
    case "tag":
      return { type, op: "has", tagId: board.tags[0]?.id ?? "" };
    case "epic":
      return { type, op: "is", epicId: board.epics[0]?.id ?? null };
    case "assignee":
      return { type, op: "is", userId: null };
    case "column":
      return { type, op: "is", columnId: board.columns[0]?.id ?? "" };
    case "is_subtask":
      return { type, value: false };
  }
}

function defaultAction(type: Action["type"], board: Board): Action {
  switch (type) {
    case "move_to_column":
      return { type, columnId: board.columns.at(-1)?.id ?? "" };
    case "assign":
      return { type, userId: board.members[0]?.id ?? null };
    case "add_tag":
    case "remove_tag":
      return { type, tagId: board.tags[0]?.id ?? "" };
    case "add_comment":
      return { type, body: "" };
  }
}

export type EditingRule = { id?: string; draft: RuleInput };

export function RuleEditor({
  board,
  editing,
  onClose,
}: {
  board: Board;
  editing: EditingRule | null;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<RuleInput | null>(null);
  const [lastEditing, setLastEditing] = useState<EditingRule | null>(null);
  if (editing !== lastEditing) {
    setLastEditing(editing);
    setDraft(editing?.draft ?? null);
  }
  const [error, setError] = useState<string | null>(null);
  const done = () => {
    void queryClient.invalidateQueries(trpc.automation.pathFilter());
    onClose();
  };
  const create = useMutation(trpc.automation.create.mutationOptions({ onSuccess: done }));
  const update = useMutation(trpc.automation.update.mutationOptions({ onSuccess: done }));

  const columns = board.columns.map((c) => ({ value: c.id, label: c.name }));
  const tags = board.tags.map((t) => ({ value: t.id, label: t.name }));
  const members = board.members.map((m) => ({ value: m.id, label: m.name }));
  const epicsOptions = board.epics.map((e) => ({ value: e.id, label: e.title }));

  if (!draft) return null;
  const set = (patch: Partial<RuleInput>) => setDraft({ ...draft, ...patch });
  const setCondition = (i: number, c: Condition) => set({ conditions: draft.conditions.map((x, j) => (j === i ? c : x)) });
  const setAction = (i: number, a: Action) => set({ actions: draft.actions.map((x, j) => (j === i ? a : x)) });

  const save = () => {
    const parsed = ruleInputSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Revisá la regla");
      return;
    }
    setError(null);
    if (editing?.id) update.mutate({ ruleId: editing.id, ...parsed.data });
    else create.mutate({ projectId: board.project.id, ...parsed.data });
  };

  const t = draft.trigger;

  return (
    <Dialog open={!!editing} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing?.id ? "Editar regla" : "Nueva regla"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="rule-name">Nombre</Label>
            <Input id="rule-name" value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="PR abierto → En revisión" />
          </div>

          <section className="space-y-2 rounded-lg border p-3">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Cuando</h3>
            <div className="flex flex-wrap items-center gap-2">
              <Pick
                className="w-64"
                value={t.type}
                onChange={(v) => set({ trigger: defaultTrigger(v as Trigger["type"]) })}
                options={TRIGGER_TYPES.map((type) => ({ value: type, label: TRIGGER_LABELS[type] }))}
              />
              {t.type === "task.moved" ? (
                <>
                  <span className="text-sm text-muted-foreground">desde</span>
                  <Pick
                    className="w-40"
                    value={t.fromColumnId ?? ANY}
                    onChange={(v) => set({ trigger: { ...t, fromColumnId: v === ANY ? null : v } })}
                    options={[{ value: ANY, label: "cualquiera" }, ...columns]}
                  />
                  <span className="text-sm text-muted-foreground">hacia</span>
                  <Pick
                    className="w-40"
                    value={t.toColumnId ?? ANY}
                    onChange={(v) => set({ trigger: { ...t, toColumnId: v === ANY ? null : v } })}
                    options={[{ value: ANY, label: "cualquiera" }, ...columns]}
                  />
                </>
              ) : null}
              {t.type === "task.due_soon" ? (
                <>
                  <span className="text-sm text-muted-foreground">con</span>
                  <Input
                    type="number"
                    min={1}
                    max={720}
                    className="h-7 w-20"
                    value={t.hoursBefore}
                    onChange={(e) => set({ trigger: { ...t, hoursBefore: Number(e.target.value) || 1 } })}
                  />
                  <span className="text-sm text-muted-foreground">horas de anticipación</span>
                </>
              ) : null}
            </div>
            {t.type === "pr.opened" || t.type === "pr.merged" || t.type === "branch.created" ? (
              <p className="text-xs text-muted-foreground">Aplica a tareas vinculadas por su clave en la rama, el título o la descripción del PR.</p>
            ) : null}
          </section>

          <section className="space-y-2 rounded-lg border p-3">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Si (todas se cumplen)</h3>
            {draft.conditions.length === 0 ? <p className="text-sm text-muted-foreground">Sin condiciones: aplica siempre.</p> : null}
            {draft.conditions.map((c, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Pick
                  className="w-40"
                  value={c.type}
                  onChange={(v) => setCondition(i, defaultCondition(v as Condition["type"], board))}
                  options={Object.entries(CONDITION_LABELS).map(([value, label]) => ({ value, label }))}
                />
                {c.type === "priority" ? (
                  <>
                    <Pick
                      className="w-28"
                      value={c.op}
                      onChange={(v) => setCondition(i, { ...c, op: v as "in" | "not_in" })}
                      options={[
                        { value: "in", label: "es" },
                        { value: "not_in", label: "no es" },
                      ]}
                    />
                    <div className="flex flex-wrap gap-1">
                      {PRIORITIES.map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() =>
                            setCondition(i, {
                              ...c,
                              values: c.values.includes(p) ? c.values.filter((x) => x !== p) : [...c.values, p as Priority],
                            })
                          }
                          className={`rounded-md border px-2 py-0.5 text-xs ${c.values.includes(p) ? "border-foreground bg-foreground text-background" : ""}`}
                        >
                          {PRIORITY_META[p].label}
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
                {c.type === "tag" ? (
                  <>
                    <Pick
                      className="w-32"
                      value={c.op}
                      onChange={(v) => setCondition(i, { ...c, op: v as "has" | "not_has" })}
                      options={[
                        { value: "has", label: "tiene" },
                        { value: "not_has", label: "no tiene" },
                      ]}
                    />
                    <Pick value={c.tagId} onChange={(v) => setCondition(i, { ...c, tagId: v })} options={tags} placeholder="Tag" />
                  </>
                ) : null}
                {c.type === "epic" ? (
                  <>
                    <Pick
                      className="w-28"
                      value={c.op}
                      onChange={(v) => setCondition(i, { ...c, op: v as "is" | "is_not" })}
                      options={[
                        { value: "is", label: "es" },
                        { value: "is_not", label: "no es" },
                      ]}
                    />
                    <Pick
                      value={c.epicId ?? NONE}
                      onChange={(v) => setCondition(i, { ...c, epicId: v === NONE ? null : v })}
                      options={[{ value: NONE, label: "Sin epic" }, ...epicsOptions]}
                    />
                  </>
                ) : null}
                {c.type === "assignee" ? (
                  <>
                    <Pick
                      className="w-28"
                      value={c.op}
                      onChange={(v) => setCondition(i, { ...c, op: v as "is" | "is_not" })}
                      options={[
                        { value: "is", label: "es" },
                        { value: "is_not", label: "no es" },
                      ]}
                    />
                    <Pick
                      value={c.userId ?? NONE}
                      onChange={(v) => setCondition(i, { ...c, userId: v === NONE ? null : v })}
                      options={[{ value: NONE, label: "Sin responsable" }, ...members]}
                    />
                  </>
                ) : null}
                {c.type === "column" ? (
                  <>
                    <Pick
                      className="w-28"
                      value={c.op}
                      onChange={(v) => setCondition(i, { ...c, op: v as "is" | "is_not" })}
                      options={[
                        { value: "is", label: "es" },
                        { value: "is_not", label: "no es" },
                      ]}
                    />
                    <Pick value={c.columnId} onChange={(v) => setCondition(i, { ...c, columnId: v })} options={columns} />
                  </>
                ) : null}
                {c.type === "is_subtask" ? (
                  <Pick
                    value={c.value ? "yes" : "no"}
                    onChange={(v) => setCondition(i, { ...c, value: v === "yes" })}
                    options={[
                      { value: "no", label: "Tarea principal" },
                      { value: "yes", label: "Subtarea" },
                    ]}
                  />
                ) : null}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Quitar condición"
                  className="ml-auto"
                  onClick={() => set({ conditions: draft.conditions.filter((_, j) => j !== i) })}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
            <Button
              variant="ghost"
              size="sm"
              disabled={draft.conditions.length >= 10}
              onClick={() => set({ conditions: [...draft.conditions, defaultCondition("priority", board)] })}
            >
              <Plus /> Agregar condición
            </Button>
          </section>

          <section className="space-y-2 rounded-lg border p-3">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Entonces</h3>
            {draft.actions.map((a, i) => (
              <div key={i} className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Pick
                    className="w-48"
                    value={a.type}
                    onChange={(v) => setAction(i, defaultAction(v as Action["type"], board))}
                    options={Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label }))}
                  />
                  {a.type === "move_to_column" ? (
                    <Pick value={a.columnId} onChange={(v) => setAction(i, { ...a, columnId: v })} options={columns} />
                  ) : null}
                  {a.type === "assign" ? (
                    <Pick
                      value={a.userId ?? NONE}
                      onChange={(v) => setAction(i, { ...a, userId: v === NONE ? null : v })}
                      options={[{ value: NONE, label: "Quitar responsable" }, ...members]}
                    />
                  ) : null}
                  {a.type === "add_tag" || a.type === "remove_tag" ? (
                    <Pick value={a.tagId} onChange={(v) => setAction(i, { ...a, tagId: v })} options={tags} placeholder="Tag" />
                  ) : null}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Quitar acción"
                    className="ml-auto"
                    disabled={draft.actions.length === 1}
                    onClick={() => set({ actions: draft.actions.filter((_, j) => j !== i) })}
                  >
                    <Trash2 />
                  </Button>
                </div>
                {a.type === "add_comment" ? (
                  <div>
                    <Textarea
                      rows={2}
                      value={a.body}
                      onChange={(e) => setAction(i, { ...a, body: e.target.value })}
                      placeholder="PR abierto: {{pr.url}}"
                    />
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Variables: {TEMPLATE_VARIABLES.map((v) => `{{${v.key}}}`).join(" · ")}
                    </p>
                  </div>
                ) : null}
              </div>
            ))}
            <Button
              variant="ghost"
              size="sm"
              disabled={draft.actions.length >= 10}
              onClick={() => set({ actions: [...draft.actions, defaultAction("add_comment", board)] })}
            >
              <Plus /> Agregar acción
            </Button>
          </section>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={create.isPending || update.isPending}>
            Guardar regla
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
