import { describe, expect, it } from "vitest";
import { parseGitRemote } from "@/lib/git-remote";

describe("parseGitRemote", () => {
  it.each([
    ["matix/todoapp", "github.com", "matix/todoapp"],
    ["github.com/matix/todoapp", "github.com", "matix/todoapp"],
    ["https://github.com/matix/todoapp", "github.com", "matix/todoapp"],
    ["https://github.com/matix/todoapp.git", "github.com", "matix/todoapp"],
    ["https://github.com/matix/todoapp/", "github.com", "matix/todoapp"],
    ["https://user@www.github.com/Matix/To-Do.App.git", "github.com", "Matix/To-Do.App"],
    ["git@github.com:matix/todoapp.git", "github.com", "matix/todoapp"],
    ["ssh://git@github.com/matix/todoapp.git", "github.com", "matix/todoapp"],
    ["ssh://git@github.com:22/matix/todoapp", "github.com", "matix/todoapp"],
    ["  git@gitlab.com:grupo/proyecto.git\n", "gitlab.com", "grupo/proyecto"],
  ])("%s", (input, host, fullName) => {
    expect(parseGitRemote(input)).toEqual({ host, fullName });
  });

  it.each(["", "todoapp", "https://github.com/matix", "a/b/c/d", "../x", "matix/to do"])("rechaza %j", (input) => {
    expect(parseGitRemote(input)).toBeNull();
  });
});
