import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { makeFsDeps } from "./fs-deps.ts";
import {
  getAgentsContext,
  getSkillsContext,
  getSkillJSON,
  type GetAgentsContextDeps,
  type GetSkillsContextDeps,
  type GetSkillJSONDeps,
} from "./context.ts";

describe("context", () => {
  describe("getAgentsContext", () => {
    let fs: ReturnType<typeof makeFsDeps>;
    beforeEach(() => {
      fs = makeFsDeps();
    });

    function makeDeps(overrides: Partial<GetAgentsContextDeps> = {}) {
      return {
        fs,
        debugLog: () => undefined,
        ...overrides,
      };
    }

    it("returns empty string when no AGENTS.md files found", () => {
      const deps = makeDeps();
      const result = getAgentsContext(deps);
      assert.equal(result, "");
    });

    it("returns formatted content for single file", () => {
      fs._globResults.set("**/AGENTS.md", ["AGENTS.md"]);
      fs._files.set("AGENTS.md", "# Agent Instructions");
      const deps = makeDeps();
      const result = getAgentsContext(deps);
      assert.equal(
        result,
        "\nAGENTS.md context files:\nPath: AGENTS.md\nContent: # Agent Instructions\n",
      );
    });

    it("returns formatted content for multiple files", () => {
      fs._globResults.set("**/AGENTS.md", ["AGENTS.md", "src/AGENTS.md"]);
      fs._files.set("AGENTS.md", "Root content");
      fs._files.set("src/AGENTS.md", "Src content");
      const deps = makeDeps();
      const result = getAgentsContext(deps);
      assert.equal(
        result,
        "\nAGENTS.md context files:\nPath: AGENTS.md\nContent: Root content\n\nPath: src/AGENTS.md\nContent: Src content\n",
      );
    });

    it("skips files that fail to read", () => {
      fs._globResults.set("**/AGENTS.md", ["AGENTS.md", "src/AGENTS.md"]);
      fs._files.set("src/AGENTS.md", "Src content");
      const deps = makeDeps();
      const result = getAgentsContext(deps);
      assert.equal(
        result,
        "\nAGENTS.md context files:\nPath: src/AGENTS.md\nContent: Src content\n",
      );
    });
  });

  describe("getSkillsContext", () => {
    let fs: ReturnType<typeof makeFsDeps>;
    beforeEach(() => {
      fs = makeFsDeps();
    });

    function makeDeps(overrides: Partial<GetSkillsContextDeps> = {}) {
      return {
        fs,
        skillsDirPaths: ["/global/skills", "/local/skills"],
        colorPrint: () => undefined,
        ...overrides,
      };
    }

    it("returns skills prompt with no skills when dirs are empty", () => {
      const deps = makeDeps();
      const result = getSkillsContext(deps);
      assert.ok(result.includes("Available skills:\n"));
      assert.ok(!result.includes("- "));
    });

    it("lists skills found in skill directories", () => {
      fs._dirs.add("/global/skills");
      fs._dirs.add("/global/skills/my-skill");
      fs._listings.set("/global/skills", ["my-skill"]);
      fs._listings.set("/global/skills/my-skill", ["SKILL.md"]);
      fs._files.set(
        "/global/skills/my-skill/SKILL.md",
        "---\nname: my-skill\ndescription: A test skill\n---\n# Body",
      );
      const deps = makeDeps();
      const result = getSkillsContext(deps);
      assert.ok(result.includes("- my-skill: A test skill"));
    });

    it("deduplicates by parsed name, keeping first occurrence", () => {
      fs._dirs.add("/local/skills");
      fs._dirs.add("/local/skills/local-skill");
      fs._dirs.add("/global/skills");
      fs._dirs.add("/global/skills/global-skill");
      fs._listings.set("/local/skills", ["local-skill"]);
      fs._listings.set("/local/skills/local-skill", ["SKILL.md"]);
      fs._files.set(
        "/local/skills/local-skill/SKILL.md",
        "---\nname: deploy\ndescription: Local deploy\n---\n# Local",
      );
      fs._listings.set("/global/skills", ["global-skill"]);
      fs._listings.set("/global/skills/global-skill", ["SKILL.md"]);
      fs._files.set(
        "/global/skills/global-skill/SKILL.md",
        "---\nname: deploy\ndescription: Global deploy\n---\n# Global",
      );
      const deps = makeDeps({
        skillsDirPaths: ["/local/skills", "/global/skills"],
      });
      const result = getSkillsContext(deps);
      assert.ok(result.includes("- deploy: Local deploy"));
      assert.ok(!result.includes("Global deploy"));
    });

    it("includes skills with different names", () => {
      fs._dirs.add("/local/skills");
      fs._dirs.add("/local/skills/a");
      fs._dirs.add("/local/skills/b");
      fs._listings.set("/local/skills", ["a", "b"]);
      fs._listings.set("/local/skills/a", ["SKILL.md"]);
      fs._files.set(
        "/local/skills/a/SKILL.md",
        "---\nname: skill-a\ndescription: First\n---\n",
      );
      fs._listings.set("/local/skills/b", ["SKILL.md"]);
      fs._files.set(
        "/local/skills/b/SKILL.md",
        "---\nname: skill-b\ndescription: Second\n---\n",
      );
      const deps = makeDeps();
      const result = getSkillsContext(deps);
      assert.ok(result.includes("- skill-a: First"));
      assert.ok(result.includes("- skill-b: Second"));
    });
  });

  describe("getSkillJSON", () => {
    let fs: ReturnType<typeof makeFsDeps>;
    beforeEach(() => {
      fs = makeFsDeps();
    });

    function makeDeps(overrides: Partial<GetSkillJSONDeps> = {}) {
      return { fs, colorPrint: () => undefined, ...overrides };
    }

    it("returns null when dir is empty", () => {
      const deps = makeDeps();
      const result = getSkillJSON("/some/dir", deps);
      assert.equal(result, null);
    });

    it("parses valid SKILL.md front matter", () => {
      fs._listings.set("/skill-dir", ["SKILL.md", "other.txt"]);
      fs._files.set(
        "/skill-dir/SKILL.md",
        "---\nname: deploy\ndescription: Deploy the app\n---\n# Deploy",
      );
      const deps = makeDeps();
      const result = getSkillJSON("/skill-dir", deps);
      assert.deepStrictEqual(result, {
        name: "deploy",
        description: "Deploy the app",
      });
    });

    it("returns null when SKILL.md is missing name", () => {
      fs._listings.set("/skill-dir", ["SKILL.md"]);
      fs._files.set(
        "/skill-dir/SKILL.md",
        "---\ndescription: No name here\n---\n",
      );
      const deps = makeDeps();
      const result = getSkillJSON("/skill-dir", deps);
      assert.equal(result, null);
    });

    it("returns null when SKILL.md is not a file", () => {
      fs._dirs.add("/skill-dir");
      fs._files.delete("/skill-dir/SKILL.md");
      const deps = makeDeps();
      const result = getSkillJSON("/skill-dir", deps);
      assert.equal(result, null);
    });
  });
});

