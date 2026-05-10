import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { makeFsDeps } from "./fs-deps.ts";
import { GLOBAL_AGENTS_PATH } from "./paths.ts";
import {
  getAgentsContext,
  getSkillsContext,
  getSkillJSON,
  parseFrontMatter,
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

    it("includes global AGENTS.md when it exists", () => {
      fs._files.set(GLOBAL_AGENTS_PATH, "global content");
      const deps = makeDeps();
      const result = getAgentsContext(deps);
      assert.equal(
        result,
        `\nAGENTS.md context files:\nPath: ${GLOBAL_AGENTS_PATH}\nContent: global content\n`,
      );
    });

    it("combines global and globbed AGENTS.md files", () => {
      fs._files.set(GLOBAL_AGENTS_PATH, "global content");
      fs._globResults.set("**/AGENTS.md", ["AGENTS.md"]);
      fs._files.set("AGENTS.md", "local content");
      const deps = makeDeps();
      const result = getAgentsContext(deps);
      assert.equal(
        result,
        `
AGENTS.md context files:
Path: ${GLOBAL_AGENTS_PATH}
Content: global content

Path: AGENTS.md
Content: local content
`,
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
      fs._files.set(
        "/local/skills/local-skill/SKILL.md",
        "---\nname: deploy\ndescription: Local deploy\n---\n# Local",
      );
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
      fs._files.set(
        "/local/skills/a/SKILL.md",
        "---\nname: skill-a\ndescription: First\n---\n",
      );
      fs._files.set(
        "/local/skills/b/SKILL.md",
        "---\nname: skill-b\ndescription: Second\n---\n",
      );
      const deps = makeDeps();
      const result = getSkillsContext(deps);
      assert.ok(result.includes("- skill-a: First"));
      assert.ok(result.includes("- skill-b: Second"));
    });

    it("skips non-existent skill directories", () => {
      fs._dirs.add("/global/skills");
      fs._dirs.add("/global/skills/my-skill");
      fs._files.set(
        "/global/skills/my-skill/SKILL.md",
        "---\nname: my-skill\ndescription: A test skill\n---\n# Body",
      );
      const deps = makeDeps({
        skillsDirPaths: ["/nonexistent", "/global/skills"],
      });
      const result = getSkillsContext(deps);
      assert.ok(result.includes("- my-skill: A test skill"));
    });

    it("skips file entries in skill directory", () => {
      fs._dirs.add("/global/skills");
      fs._files.set("/global/skills/not-a-dir", "some content");
      fs._dirs.add("/global/skills/actual-skill");
      fs._files.set(
        "/global/skills/actual-skill/SKILL.md",
        "---\nname: actual-skill\ndescription: Real\n---\n",
      );
      const deps = makeDeps();
      const result = getSkillsContext(deps);
      assert.ok(result.includes("- actual-skill: Real"));
      assert.ok(!result.includes("not-a-dir"));
    });

    it("skips entries where statSync fails", () => {
      fs._dirs.add("/global/skills");
      fs._dirs.add("/global/skills/broken");
      fs._dirs.add("/global/skills/working");
      fs._files.set(
        "/global/skills/working/SKILL.md",
        "---\nname: working\ndescription: Works\n---\n",
      );
      const originalStatSync = fs.statSync;
      fs.statSync = (path: string) => {
        if (path === "/global/skills/broken") throw new Error("stat failed");
        return originalStatSync(path);
      };
      const deps = makeDeps();
      const result = getSkillsContext(deps);
      assert.ok(result.includes("- working: Works"));
      assert.ok(!result.includes("broken"));
    });

    it("skips entries where getSkillJSON returns null", () => {
      fs._dirs.add("/global/skills");
      fs._dirs.add("/global/skills/no-skill-md");
      fs._dirs.add("/global/skills/has-skill");
      fs._files.set("/global/skills/no-skill-md/readme.txt", "just a file");
      fs._files.set(
        "/global/skills/has-skill/SKILL.md",
        "---\nname: has-skill\ndescription: Present\n---\n",
      );
      const deps = makeDeps();
      const result = getSkillsContext(deps);
      assert.ok(result.includes("- has-skill: Present"));
      assert.ok(!result.includes("no-skill-md"));
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
      fs._files.set("/skill-dir/other.txt", "");
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
      fs._files.set(
        "/skill-dir/SKILL.md",
        "---\ndescription: No name here\n---\n",
      );
      const deps = makeDeps();
      const result = getSkillJSON("/skill-dir", deps);
      assert.equal(result, null);
    });

    it("returns null when SKILL.md is missing description", () => {
      fs._files.set("/skill-dir/SKILL.md", "---\nname: deploy\n---\n");
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

    it("finds SKILL.md when it is not the first entry", () => {
      fs._files.set("/skill-dir/readme.txt", "readme");
      fs._files.set("/skill-dir/notes.md", "notes");
      fs._files.set(
        "/skill-dir/SKILL.md",
        "---\nname: deploy\ndescription: Deploy the app\n---\n",
      );
      const deps = makeDeps();
      const result = getSkillJSON("/skill-dir", deps);
      assert.deepStrictEqual(result, {
        name: "deploy",
        description: "Deploy the app",
      });
    });

    it("skips entries where statSync fails", () => {
      fs._files.set("/skill-dir/SKILL.md", "content");
      const originalStatSync = fs.statSync;
      fs.statSync = (path: string) => {
        if (path === "/skill-dir/SKILL.md") throw new Error("stat failed");
        return originalStatSync(path);
      };
      const deps = makeDeps();
      const result = getSkillJSON("/skill-dir", deps);
      assert.equal(result, null);
    });

    it("returns null when readFileSync fails", () => {
      const deps = makeDeps();
      const result = getSkillJSON("/skill-dir", deps);
      assert.equal(result, null);
    });

    it("calls colorPrint for malformed skill", () => {
      const calls: string[] = [];
      fs._files.set("/skill-dir/SKILL.md", "---\nname: bad\n---\n");
      const deps = makeDeps({
        colorPrint: (text) => {
          calls.push(text.toString());
        },
      });
      const result = getSkillJSON("/skill-dir", deps);
      assert.equal(result, null);
      assert.equal(calls.length, 1);
      assert.ok(calls[0]!.includes("Malformed skill at /skill-dir/SKILL.md"));
      assert.ok(calls[0]!.includes("name"));
      assert.ok(calls[0]!.includes("description"));
    });

    it("calls colorPrint when front matter fails to parse", () => {
      const calls: string[] = [];
      fs._files.set("/skill-dir/SKILL.md", "---\n* invalid yaml\n---\n");
      const deps = makeDeps({
        colorPrint: (text) => {
          calls.push(text.toString());
        },
      });
      const result = getSkillJSON("/skill-dir", deps);
      assert.equal(result, null);
      assert.equal(calls.length, 1);
      assert.ok(calls[0]!.includes("Malformed skill at /skill-dir/SKILL.md"));
      assert.ok(calls[0]!.includes("valid YAML"));
    });
  });

  describe("parseFrontMatter", () => {
    it("returns null when content does not start with ---\\n", () => {
      const result = parseFrontMatter("no front matter here");
      assert.equal(result, null);
    });

    it("returns null when content starts with --- but no newline", () => {
      const result = parseFrontMatter("---foo");
      assert.equal(result, null);
    });

    it("returns null when no closing delimiter", () => {
      const result = parseFrontMatter("---\nname: test\n");
      assert.equal(result, null);
    });

    it("returns null when yaml string is empty", () => {
      const result = parseFrontMatter("---\n---\nbody");
      assert.equal(result, null);
    });

    it("parses valid front matter with attributes and body", () => {
      const result = parseFrontMatter(
        "---\nname: my-skill\ndescription: A skill\n---\n# Body content",
      );
      assert.deepStrictEqual(result, {
        data: { name: "my-skill", description: "A skill" },
        body: "# Body content",
      });
    });

    it("parses front matter with no body", () => {
      const result = parseFrontMatter("---\nname: test\n---\n");
      assert.deepStrictEqual(result, {
        data: { name: "test" },
        body: "",
      });
    });

    it("preserves body containing dashes", () => {
      const result = parseFrontMatter(
        "---\nkey: val\n---\nBody with --- inside\nand more text",
      );
      assert.deepStrictEqual(result, {
        data: { key: "val" },
        body: "Body with --- inside\nand more text",
      });
    });

    it("returns null when closing delimiter lacks trailing newline", () => {
      const result = parseFrontMatter("---\nkey: val\n---");
      assert.equal(result, null);
    });

    it("returns null on invalid yaml", () => {
      const result = parseFrontMatter("---\n* invalid\n---\nbody");
      assert.equal(result, null);
    });

    it("returns null on unclosed flow sequence in yaml", () => {
      const result = parseFrontMatter("---\nkey: [unclosed\n---\nbody");
      assert.equal(result, null);
    });
  });
});
