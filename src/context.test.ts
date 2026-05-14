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
import { dispatch, actions, selectors } from "./state.ts";

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
      assert.equal(
        result,
        `
Skills:

Use the \`loadSkill\` tool to load a skill when the user's request
would benefit from specialized instructions.

 Available skills:

`,
      );
    });

    it("lists skills found in skill directories", () => {
      testFs._globResults.set(
        "/fake-home/.config/.agent-js/skills/**/SKILL.md",
        ["/fake-home/.config/.agent-js/skills/my-skill/SKILL.md"],
      );
      testFs._files.set(
        "/fake-home/.config/.agent-js/skills/my-skill/SKILL.md",
        "---\nname: my-skill\ndescription: A test skill\n---\n# Body",
      );
      const result = getSkillsContext();
      assert.equal(
        result,
        `
Skills:

Use the \`loadSkill\` tool to load a skill when the user's request
would benefit from specialized instructions.

 Available skills:
- my-skill: A test skill
`,
      );
    });

    it("deduplicates by parsed name, keeping first occurrence", () => {
      testFs._globResults.set("/test-cwd/.agent-js/skills/**/SKILL.md", [
        "/test-cwd/.agent-js/skills/local-skill/SKILL.md",
      ]);
      testFs._globResults.set(
        "/fake-home/.config/.agent-js/skills/**/SKILL.md",
        ["/fake-home/.config/.agent-js/skills/global-skill/SKILL.md"],
      );
      testFs._files.set(
        "/test-cwd/.agent-js/skills/local-skill/SKILL.md",
        "---\nname: deploy\ndescription: Local deploy\n---\n# Local",
      );
      testFs._files.set(
        "/fake-home/.config/.agent-js/skills/global-skill/SKILL.md",
        "---\nname: deploy\ndescription: Global deploy\n---\n# Global",
      );
      const result = getSkillsContext();
      assert.equal(
        result,
        `
Skills:

Use the \`loadSkill\` tool to load a skill when the user's request
would benefit from specialized instructions.

 Available skills:
- deploy: Local deploy
`,
      );
    });

    it("does not dispatch duplicate skills to state", () => {
      testFs._globResults.set("/test-cwd/.agent-js/skills/**/SKILL.md", [
        "/test-cwd/.agent-js/skills/a/SKILL.md",
      ]);
      testFs._globResults.set(
        "/fake-home/.config/.agent-js/skills/**/SKILL.md",
        ["/fake-home/.config/.agent-js/skills/b/SKILL.md"],
      );
      testFs._files.set(
        "/test-cwd/.agent-js/skills/a/SKILL.md",
        "---\nname: deploy\ndescription: First\n---\n# A",
      );
      testFs._files.set(
        "/fake-home/.config/.agent-js/skills/b/SKILL.md",
        "---\nname: deploy\ndescription: Second\n---\n# B",
      );
      getSkillsContext();
      assert.equal(selectors.getSkills().length, 1);
      assert.deepStrictEqual(selectors.getSkills()[0], {
        name: "deploy",
        description: "First",
        content: "# A",
        dir: "/test-cwd/.agent-js/skills/a",
      });
    });

    it("includes skills with different names", () => {
      testFs._globResults.set("/test-cwd/.agent-js/skills/**/SKILL.md", [
        "/test-cwd/.agent-js/skills/a/SKILL.md",
        "/test-cwd/.agent-js/skills/b/SKILL.md",
      ]);
      testFs._files.set(
        "/test-cwd/.agent-js/skills/a/SKILL.md",
        "---\nname: skill-a\ndescription: First\n---\n",
      );
      testFs._files.set(
        "/test-cwd/.agent-js/skills/b/SKILL.md",
        "---\nname: skill-b\ndescription: Second\n---\n",
      );
      const result = getSkillsContext();
      assert.equal(
        result,
        `
Skills:

Use the \`loadSkill\` tool to load a skill when the user's request
would benefit from specialized instructions.

 Available skills:
- skill-a: First
- skill-b: Second
`,
      );
    });

    it("skips non-existent skill directories", () => {
      testFs._globResults.set(
        "/fake-home/.config/.agent-js/skills/**/SKILL.md",
        ["/fake-home/.config/.agent-js/skills/my-skill/SKILL.md"],
      );
      testFs._files.set(
        "/fake-home/.config/.agent-js/skills/my-skill/SKILL.md",
        "---\nname: my-skill\ndescription: A test skill\n---\n# Body",
      );
      const result = getSkillsContext();
      assert.equal(
        result,
        `
Skills:

Use the \`loadSkill\` tool to load a skill when the user's request
would benefit from specialized instructions.

 Available skills:
- my-skill: A test skill
`,
      );
    });

    it("skips malformed skill files", () => {
      testFs._globResults.set(
        "/fake-home/.config/.agent-js/skills/**/SKILL.md",
        [
          "/fake-home/.config/.agent-js/skills/bad/SKILL.md",
          "/fake-home/.config/.agent-js/skills/good/SKILL.md",
        ],
      );
      testFs._files.set(
        "/fake-home/.config/.agent-js/skills/bad/SKILL.md",
        "not front matter",
      );
      testFs._files.set(
        "/fake-home/.config/.agent-js/skills/good/SKILL.md",
        "---\nname: good\ndescription: Valid\n---\n",
      );
      const result = getSkillsContext();
      assert.equal(
        result,
        `
Skills:

Use the \`loadSkill\` tool to load a skill when the user's request
would benefit from specialized instructions.

 Available skills:
- good: Valid
`,
      );
    });

    it("includes skills from custom skill dirs", () => {
      dispatch(actions.setCustomSkillDirs(["/custom/skills"]));
      testFs._globResults.set("/custom/skills/**/SKILL.md", [
        "/custom/skills/custom-skill/SKILL.md",
      ]);
      testFs._files.set(
        "/custom/skills/custom-skill/SKILL.md",
        "---\nname: custom-skill\ndescription: From custom dir\n---\n",
      );
      const result = getSkillsContext();
      assert.equal(
        result,
        `
Skills:

Use the \`loadSkill\` tool to load a skill when the user's request
would benefit from specialized instructions.

 Available skills:
- custom-skill: From custom dir
`,
      );
    });

    it("prioritizes custom skill dirs over local and global", () => {
      dispatch(actions.setCustomSkillDirs(["/custom/skills"]));
      testFs._globResults.set("/custom/skills/**/SKILL.md", [
        "/custom/skills/deploy/SKILL.md",
      ]);
      testFs._globResults.set("/test-cwd/.agent-js/skills/**/SKILL.md", [
        "/test-cwd/.agent-js/skills/deploy/SKILL.md",
      ]);
      testFs._files.set(
        "/custom/skills/deploy/SKILL.md",
        "---\nname: deploy\ndescription: Custom deploy\n---\n",
      );
      testFs._files.set(
        "/test-cwd/.agent-js/skills/deploy/SKILL.md",
        "---\nname: deploy\ndescription: Local deploy\n---\n",
      );
      const result = getSkillsContext();
      assert.equal(
        result,
        `
Skills:

Use the \`loadSkill\` tool to load a skill when the user's request
would benefit from specialized instructions.

 Available skills:
- deploy: Custom deploy
`,
      );
    });

    it("skips entries where globSync throws", () => {
      const originalGlobSync = testFs.globSync;
      testFs.globSync = (pattern: string) => {
        if (pattern === "/test-cwd/.agent-js/skills/**/SKILL.md")
          throw new Error("glob failed");
        return originalGlobSync(pattern);
      };
      testFs._globResults.set(
        "/fake-home/.config/.agent-js/skills/**/SKILL.md",
        ["/fake-home/.config/.agent-js/skills/ok/SKILL.md"],
      );
      testFs._files.set(
        "/fake-home/.config/.agent-js/skills/ok/SKILL.md",
        "---\nname: ok\ndescription: Works\n---\n",
      );
      const result = getSkillsContext();
      assert.equal(
        result,
        `
Skills:

Use the \`loadSkill\` tool to load a skill when the user's request
would benefit from specialized instructions.

 Available skills:
- ok: Works
`,
      );
    });
  });

  describe("getSkillJSON", () => {
    beforeEach(() => {
      setupFakeDeps();
    });

    it("returns null when file does not exist", () => {
      const result = getSkillJSON("/some/dir/SKILL.md");
      assert.equal(result, null);
    });

    it("parses valid SKILL.md front matter", () => {
      testFs._files.set(
        "/skill-dir/SKILL.md",
        "---\nname: deploy\ndescription: Deploy the app\n---\n# Deploy",
      );
      const result = getSkillJSON("/skill-dir/SKILL.md");
      assert.deepStrictEqual(result, {
        name: "deploy",
        description: "Deploy the app",
        content: "# Deploy",
        dir: "/skill-dir",
      });
    });

    it("returns null when front matter is missing name", () => {
      testFs._files.set(
        "/skill-dir/SKILL.md",
        "---\ndescription: No name here\n---\n",
      );
      const result = getSkillJSON("/skill-dir/SKILL.md");
      assert.equal(result, null);
    });

    it("returns null when front matter is missing description", () => {
      testFs._files.set("/skill-dir/SKILL.md", "---\nname: deploy\n---\n");
      const result = getSkillJSON("/skill-dir/SKILL.md");
      assert.equal(result, null);
    });

    it("returns null when path is a directory", () => {
      testFs._dirs.add("/skill-dir");
      const result = getSkillJSON("/skill-dir");
      assert.equal(result, null);
    });

    it("returns null when readFileSync fails", () => {
      const result = getSkillJSON("/skill-dir/SKILL.md");
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
