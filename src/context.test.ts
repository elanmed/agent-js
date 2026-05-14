import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { testFs, setupFakeDeps } from "./test-helpers.ts";
import { getGlobalContextDir } from "./paths.ts";
import {
  getAgentsContext,
  getSkillsContext,
  getSkillJSON,
  parseFrontMatter,
} from "./context.ts";
import { dispatch, actions } from "./state.ts";

describe("context", () => {
  beforeEach(() => {
    dispatch(actions.resetState());
  });

  describe("getAgentsContext", () => {
    beforeEach(() => {
      setupFakeDeps();
    });

    it("returns empty string when no AGENTS.md files found", () => {
      const result = getAgentsContext();
      assert.equal(result, "");
    });

    it("returns formatted content for single file", () => {
      testFs._globResults.set("/test-cwd/**/AGENTS.md", [
        "/test-cwd/AGENTS.md",
      ]);
      testFs._files.set("/test-cwd/AGENTS.md", "# Agent Instructions");
      const result = getAgentsContext();
      assert.equal(
        result,
        `\nAGENTS.md context files:\nPath: /test-cwd/AGENTS.md\nContent: # Agent Instructions\n`,
      );
    });

    it("returns formatted content for multiple files", () => {
      testFs._globResults.set("/test-cwd/**/AGENTS.md", [
        "/test-cwd/AGENTS.md",
        "/test-cwd/src/AGENTS.md",
      ]);
      testFs._files.set("/test-cwd/AGENTS.md", "Root content");
      testFs._files.set("/test-cwd/src/AGENTS.md", "Src content");
      const result = getAgentsContext();
      assert.equal(
        result,
        `\nAGENTS.md context files:\nPath: /test-cwd/AGENTS.md\nContent: Root content\n\nPath: /test-cwd/src/AGENTS.md\nContent: Src content\n`,
      );
    });

    it("skips files that fail to read", () => {
      testFs._globResults.set("/test-cwd/**/AGENTS.md", [
        "/test-cwd/AGENTS.md",
        "/test-cwd/src/AGENTS.md",
      ]);
      testFs._files.set("/test-cwd/src/AGENTS.md", "Src content");
      const result = getAgentsContext();
      assert.equal(
        result,
        `\nAGENTS.md context files:\nPath: /test-cwd/src/AGENTS.md\nContent: Src content\n`,
      );
    });

    it("includes global agents dir files", () => {
      testFs._dirs.add(getGlobalContextDir());
      testFs._globResults.set(
        "/fake-home/.config/.agent-js/context/**/AGENTS.md",
        ["/fake-home/.config/.agent-js/context/AGENTS.md"],
      );
      testFs._files.set(
        "/fake-home/.config/.agent-js/context/AGENTS.md",
        "global content",
      );
      const result = getAgentsContext();
      assert.equal(
        result,
        `\nAGENTS.md context files:\nPath: /fake-home/.config/.agent-js/context/AGENTS.md\nContent: global content\n`,
      );
    });

    it("combines global and globbed AGENTS.md files", () => {
      testFs._dirs.add(getGlobalContextDir());
      testFs._files.set(
        "/fake-home/.config/.agent-js/context/AGENTS.md",
        "global content",
      );
      testFs._globResults.set(
        "/fake-home/.config/.agent-js/context/**/AGENTS.md",
        ["/fake-home/.config/.agent-js/context/AGENTS.md"],
      );
      testFs._globResults.set("/test-cwd/**/AGENTS.md", [
        "/test-cwd/AGENTS.md",
      ]);
      testFs._files.set("/test-cwd/AGENTS.md", "local content");
      const result = getAgentsContext();
      assert.equal(
        result,
        `
AGENTS.md context files:
Path: /test-cwd/AGENTS.md
Content: local content

Path: /fake-home/.config/.agent-js/context/AGENTS.md
Content: global content
`,
      );
    });
  });

  describe("getSkillsContext", () => {
    beforeEach(() => {
      setupFakeDeps();
    });

    it("returns skills prompt with no skills when dirs are empty", () => {
      const result = getSkillsContext();
      assert.ok(result.includes("Available skills:\n"));
      assert.ok(!result.includes("- "));
    });

    it("lists skills found in skill directories", () => {
      testFs._dirs.add("/fake-home/.config/.agent-js/skills");
      testFs._dirs.add("/fake-home/.config/.agent-js/skills/my-skill");
      testFs._files.set(
        "/fake-home/.config/.agent-js/skills/my-skill/SKILL.md",
        "---\nname: my-skill\ndescription: A test skill\n---\n# Body",
      );
      const result = getSkillsContext();
      assert.ok(result.includes("- my-skill: A test skill"));
    });

    it("deduplicates by parsed name, keeping first occurrence", () => {
      testFs._dirs.add("/test-cwd/.agent-js/skills");
      testFs._dirs.add("/test-cwd/.agent-js/skills/local-skill");
      testFs._dirs.add("/fake-home/.config/.agent-js/skills");
      testFs._dirs.add("/fake-home/.config/.agent-js/skills/global-skill");
      testFs._files.set(
        "/test-cwd/.agent-js/skills/local-skill/SKILL.md",
        "---\nname: deploy\ndescription: Local deploy\n---\n# Local",
      );
      testFs._files.set(
        "/fake-home/.config/.agent-js/skills/global-skill/SKILL.md",
        "---\nname: deploy\ndescription: Global deploy\n---\n# Global",
      );
      const result = getSkillsContext();
      assert.ok(result.includes("- deploy: Local deploy"));
      assert.ok(!result.includes("Global deploy"));
    });

    it("includes skills with different names", () => {
      testFs._dirs.add("/test-cwd/.agent-js/skills");
      testFs._dirs.add("/test-cwd/.agent-js/skills/a");
      testFs._dirs.add("/test-cwd/.agent-js/skills/b");
      testFs._files.set(
        "/test-cwd/.agent-js/skills/a/SKILL.md",
        "---\nname: skill-a\ndescription: First\n---\n",
      );
      testFs._files.set(
        "/test-cwd/.agent-js/skills/b/SKILL.md",
        "---\nname: skill-b\ndescription: Second\n---\n",
      );
      const result = getSkillsContext();
      assert.ok(result.includes("- skill-a: First"));
      assert.ok(result.includes("- skill-b: Second"));
    });

    it("skips non-existent skill directories", () => {
      testFs._dirs.add("/fake-home/.config/.agent-js/skills");
      testFs._dirs.add("/fake-home/.config/.agent-js/skills/my-skill");
      testFs._files.set(
        "/fake-home/.config/.agent-js/skills/my-skill/SKILL.md",
        "---\nname: my-skill\ndescription: A test skill\n---\n# Body",
      );
      const result = getSkillsContext();
      assert.ok(result.includes("- my-skill: A test skill"));
    });

    it("skips file entries in skill directory", () => {
      testFs._dirs.add("/fake-home/.config/.agent-js/skills");
      testFs._files.set(
        "/fake-home/.config/.agent-js/skills/not-a-dir",
        "some content",
      );
      testFs._dirs.add("/fake-home/.config/.agent-js/skills/actual-skill");
      testFs._files.set(
        "/fake-home/.config/.agent-js/skills/actual-skill/SKILL.md",
        "---\nname: actual-skill\ndescription: Real\n---\n",
      );
      const result = getSkillsContext();
      assert.ok(result.includes("- actual-skill: Real"));
      assert.ok(!result.includes("not-a-dir"));
    });

    it("skips entries where statSync fails", () => {
      testFs._dirs.add("/fake-home/.config/.agent-js/skills");
      testFs._dirs.add("/fake-home/.config/.agent-js/skills/broken");
      testFs._dirs.add("/fake-home/.config/.agent-js/skills/working");
      testFs._files.set(
        "/fake-home/.config/.agent-js/skills/working/SKILL.md",
        "---\nname: working\ndescription: Works\n---\n",
      );
      const originalStatSync = testFs.statSync;
      testFs.statSync = (path: string) => {
        if (path === "/fake-home/.config/.agent-js/skills/broken")
          throw new Error("stat failed");
        return originalStatSync(path);
      };
      const result = getSkillsContext();
      assert.ok(result.includes("- working: Works"));
      assert.ok(!result.includes("broken"));
    });

    it("skips entries where getSkillJSON returns null", () => {
      testFs._dirs.add("/fake-home/.config/.agent-js/skills");
      testFs._dirs.add("/fake-home/.config/.agent-js/skills/no-skill-md");
      testFs._dirs.add("/fake-home/.config/.agent-js/skills/has-skill");
      testFs._files.set(
        "/fake-home/.config/.agent-js/skills/no-skill-md/readme.txt",
        "just a file",
      );
      testFs._files.set(
        "/fake-home/.config/.agent-js/skills/has-skill/SKILL.md",
        "---\nname: has-skill\ndescription: Present\n---\n",
      );
      const result = getSkillsContext();
      assert.ok(result.includes("- has-skill: Present"));
      assert.ok(!result.includes("no-skill-md"));
    });

    it("includes skills from custom skill dirs", () => {
      dispatch(actions.setCustomSkillDirs(["/custom/skills"]));
      testFs._dirs.add("/custom/skills");
      testFs._dirs.add("/custom/skills/custom-skill");
      testFs._files.set(
        "/custom/skills/custom-skill/SKILL.md",
        "---\nname: custom-skill\ndescription: From custom dir\n---\n",
      );
      const result = getSkillsContext();
      assert.ok(result.includes("- custom-skill: From custom dir"));
    });

    it("prioritizes custom skill dirs over local and global", () => {
      dispatch(actions.setCustomSkillDirs(["/custom/skills"]));
      testFs._dirs.add("/custom/skills");
      testFs._dirs.add("/custom/skills/deploy");
      testFs._dirs.add("/test-cwd/.agent-js/skills");
      testFs._dirs.add("/test-cwd/.agent-js/skills/deploy");
      testFs._files.set(
        "/custom/skills/deploy/SKILL.md",
        "---\nname: deploy\ndescription: Custom deploy\n---\n",
      );
      testFs._files.set(
        "/test-cwd/.agent-js/skills/deploy/SKILL.md",
        "---\nname: deploy\ndescription: Local deploy\n---\n",
      );
      const result = getSkillsContext();
      assert.ok(result.includes("- deploy: Custom deploy"));
      assert.ok(!result.includes("Local deploy"));
    });
  });

  describe("getSkillJSON", () => {
    beforeEach(() => {
      setupFakeDeps();
    });

    it("returns null when dir is empty", () => {
      const result = getSkillJSON("/some/dir");
      assert.equal(result, null);
    });

    it("parses valid SKILL.md front matter", () => {
      testFs._files.set("/skill-dir/other.txt", "");
      testFs._files.set(
        "/skill-dir/SKILL.md",
        "---\nname: deploy\ndescription: Deploy the app\n---\n# Deploy",
      );
      const result = getSkillJSON("/skill-dir");
      assert.deepStrictEqual(result, {
        name: "deploy",
        description: "Deploy the app",
      });
    });

    it("returns null when SKILL.md is missing name", () => {
      testFs._files.set(
        "/skill-dir/SKILL.md",
        "---\ndescription: No name here\n---\n",
      );
      const result = getSkillJSON("/skill-dir");
      assert.equal(result, null);
    });

    it("returns null when SKILL.md is missing description", () => {
      testFs._files.set("/skill-dir/SKILL.md", "---\nname: deploy\n---\n");
      const result = getSkillJSON("/skill-dir");
      assert.equal(result, null);
    });

    it("returns null when SKILL.md is not a file", () => {
      testFs._dirs.add("/skill-dir");
      testFs._files.delete("/skill-dir/SKILL.md");
      const result = getSkillJSON("/skill-dir");
      assert.equal(result, null);
    });

    it("finds SKILL.md when it is not the first entry", () => {
      testFs._files.set("/skill-dir/readme.txt", "readme");
      testFs._files.set("/skill-dir/notes.md", "notes");
      testFs._files.set(
        "/skill-dir/SKILL.md",
        "---\nname: deploy\ndescription: Deploy the app\n---\n",
      );
      const result = getSkillJSON("/skill-dir");
      assert.deepStrictEqual(result, {
        name: "deploy",
        description: "Deploy the app",
      });
    });

    it("skips entries where statSync fails", () => {
      testFs._files.set("/skill-dir/SKILL.md", "content");
      const originalStatSync = testFs.statSync;
      testFs.statSync = (path: string) => {
        if (path === "/skill-dir/SKILL.md") throw new Error("stat failed");
        return originalStatSync(path);
      };
      const result = getSkillJSON("/skill-dir");
      assert.equal(result, null);
    });

    it("returns null when readFileSync fails", () => {
      const result = getSkillJSON("/skill-dir");
      assert.equal(result, null);
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
