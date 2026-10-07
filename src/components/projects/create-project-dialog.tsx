"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { suggestProjectKey } from "@/lib/domain";
import { useTRPC } from "@/lib/trpc";

export function CreateProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const trpc = useTRPC();
  const router = useRouter();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [sprintsEnabled, setSprintsEnabled] = useState(false);

  const create = useMutation(
    trpc.project.create.mutationOptions({
      onSuccess: (project) => {
        onOpenChange(false);
        setName("");
        setKey("");
        setKeyTouched(false);
        setDescription("");
        setSprintsEnabled(false);
        router.push(`/p/${project.key}`);
      },
    }),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nuevo proyecto</DialogTitle>
          <DialogDescription>La clave se usa en los identificadores de tareas y en los nombres de rama.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate({ name, key, description, sprintsEnabled });
          }}
        >
          <div className="grid grid-cols-[1fr_7rem] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="project-name">Nombre</Label>
              <Input
                id="project-name"
                autoFocus
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!keyTouched) setKey(suggestProjectKey(e.target.value));
                }}
                placeholder="Mi proyecto"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="project-key">Clave</Label>
              <Input
                id="project-key"
                value={key}
                maxLength={10}
                className="font-mono uppercase"
                onChange={(e) => {
                  setKeyTouched(true);
                  setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""));
                }}
                placeholder="MP"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="project-description">Descripción (opcional)</Label>
            <Textarea
              id="project-description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <label className="flex items-start justify-between gap-4 rounded-lg border p-3">
            <span>
              <span className="block text-sm font-medium">Usar sprints</span>
              <span className="block text-xs text-muted-foreground">
                Backlog y sprint activo. Se puede cambiar después.
              </span>
            </span>
            <Switch checked={sprintsEnabled} onCheckedChange={setSprintsEnabled} />
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!name.trim() || key.length < 2 || create.isPending}>
              Crear proyecto
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
