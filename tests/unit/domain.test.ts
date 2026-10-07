import { describe, expect, it } from "vitest";
import { branchNameFor, parseTaskKey, slugify, suggestProjectKey, taskKey } from "@/lib/domain";
import { compareRank, rankBetween, ranksBetween } from "@/lib/rank";

describe("identificadores de tarea", () => {
  it("arma y parsea claves", () => {
    expect(taskKey("TDA", 42)).toBe("TDA-42");
    expect(parseTaskKey("tda-42")).toEqual({ projectKey: "TDA", number: 42 });
    expect(parseTaskKey("TDA42")).toBeNull();
    expect(parseTaskKey("-1")).toBeNull();
  });

  it("genera nombres de rama legibles y acotados", () => {
    expect(branchNameFor("TDA", 42, "Revisar el deploy y avisarle a Juan")).toBe(
      "tda-42-revisar-el-deploy-y-avisarle-a-juan",
    );
    expect(branchNameFor("TDA", 7, "¡Arreglar índice de búsqueda!")).toBe("tda-7-arreglar-indice-de-busqueda");
    expect(branchNameFor("TDA", 1, "???")).toBe("tda-1");
    const long = branchNameFor("TDA", 1, "palabra ".repeat(30));
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.endsWith("-")).toBe(false);
  });

  it("slugify quita acentos y símbolos", () => {
    expect(slugify("  Ñandú   Común!! ")).toBe("nandu-comun");
  });

  it("sugiere claves de proyecto válidas", () => {
    expect(suggestProjectKey("Mi App Web")).toBe("MAW");
    expect(suggestProjectKey("Tareas")).toBe("TARE");
    expect(suggestProjectKey("x")).toMatch(/^[A-Z][A-Z0-9]{1,9}$/);
  });
});

describe("ranking fraccional", () => {
  it("inserta entre vecinos manteniendo el orden byte a byte", () => {
    const [a, b] = ranksBetween(null, null, 2);
    const mid = rankBetween(a, b);
    expect(compareRank(a, mid)).toBe(-1);
    expect(compareRank(mid, b)).toBe(-1);
    expect(compareRank(rankBetween(null, a), a)).toBe(-1);
    expect(compareRank(b, rankBetween(b, null))).toBe(-1);
  });

  it("soporta muchas inserciones en el mismo hueco", () => {
    let low = rankBetween(null, null);
    const high = rankBetween(low, null);
    for (let i = 0; i < 200; i++) {
      const next = rankBetween(low, high);
      expect(compareRank(low, next)).toBe(-1);
      expect(compareRank(next, high)).toBe(-1);
      low = next;
    }
  });
});
