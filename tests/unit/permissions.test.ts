import { describe, expect, it } from "vitest";
import { type Action, allowedActions, can, PERMISSIONS, ROLES } from "@/server/permissions";

const actions = Object.keys(PERMISSIONS) as Action[];

/** Tabla esperada, escrita a mano: si alguien cambia la matriz por error, esto falla. */
const EXPECTED: Record<Action, { owner: boolean; editor: boolean; viewer: boolean }> = {
  "project.view": { owner: true, editor: true, viewer: true },
  "project.update": { owner: true, editor: false, viewer: false },
  "project.archive": { owner: true, editor: false, viewer: false },
  "project.delete": { owner: true, editor: false, viewer: false },
  "member.manage": { owner: true, editor: false, viewer: false },
  "task.create": { owner: true, editor: true, viewer: false },
  "task.update": { owner: true, editor: true, viewer: false },
  "task.delete": { owner: true, editor: true, viewer: false },
  "comment.create": { owner: true, editor: true, viewer: false },
  "comment.moderate": { owner: true, editor: false, viewer: false },
  "column.manage": { owner: true, editor: true, viewer: false },
  "epic.manage": { owner: true, editor: true, viewer: false },
  "tag.manage": { owner: true, editor: true, viewer: false },
  "sprint.manage": { owner: true, editor: true, viewer: false },
  "automation.view": { owner: true, editor: true, viewer: true },
  "automation.manage": { owner: true, editor: true, viewer: false },
  "repo.connect": { owner: true, editor: false, viewer: false },
  "repo.link": { owner: true, editor: true, viewer: false },
  "ai.use": { owner: true, editor: true, viewer: false },
  "ai.summarize": { owner: true, editor: true, viewer: true },
};

describe("matriz de permisos", () => {
  it("cubre exactamente las acciones esperadas", () => {
    expect(actions.sort()).toEqual((Object.keys(EXPECTED) as Action[]).sort());
  });

  for (const action of Object.keys(EXPECTED) as Action[]) {
    for (const role of ROLES) {
      const allowed = EXPECTED[action][role];
      it(`${role} ${allowed ? "puede" : "no puede"} ${action}`, () => {
        expect(can(role, action)).toBe(allowed);
      });
    }
  }

  it("sin rol no se puede nada", () => {
    for (const action of actions) {
      expect(can(null, action)).toBe(false);
      expect(can(undefined, action)).toBe(false);
    }
  });

  it("solo lectura nunca tiene permisos de escritura", () => {
    const viewerActions = allowedActions("viewer");
    expect(viewerActions.sort()).toEqual(["ai.summarize", "automation.view", "project.view"]);
  });

  it("el dueño puede todo", () => {
    expect(allowedActions("owner").length).toBe(actions.length);
  });
});
