import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { join } from "node:path";
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
      const cwd = "/test-cwd";
      testFs._globResults.set(`${cwd}/**/AGENTS.md`, [`${cwd}/AGENTS.md`]);
      testFs._files.set(`${cwd}/AGENTS.md`, "# Agent Instructions");
      const result = getAgentsContext();
      assert.equal(
        result,
        `\nAGENTS.md context files:\nPath: ${cwd}/AGENTS.md\nContent: # Agent Instructions\n`,
      );
    });

    it("returns formatted content for multiple files", () => {
      const cwd = "/test-cwd";
      testFs._globResults.set(`${cwd}/**/AGENTS.md`, [
        `${cwd}/AGENTS.md`,
        `${cwd}/src/AGENTS.md`,
      ]);
      testFs._files.set(`${cwd}/AGENTS.md`, "Root content");
      testFs._files.set(`${cwd}/src/AGENTS.md`, "Src content");
      const result = getAgentsContext();
      assert.equal(
        result,
        `\nAGENTS.md context files:\nPath: ${cwd}/AGENTS.md\nContent: Root content\n\nPath: ${cwd}/src/AGENTS.md\nContent: Src content\n`,
      );
    });

    it("skips files that fail to read", () => {
      const cwd = "/test-cwd";
      testFs._globResults.set(`${cwd}/**/AGENTS.md`, [
        `${cwd}/AGENTS.md`,
        `${cwd}/src/AGENTS.md`,
      ]);
      testFs._files.set(`${cwd}/src/AGENTS.md`, "Src content");
      const result = getAgentsContext();
      assert.equal(
        result,
        `\nAGENTS.md context files:\nPath: ${cwd}/src/AGENTS.md\nContent: Src content\n`,
      );
    });

    it("includes global agents dir files", () => {
      testFs._dirs.add(getGlobalContextDir());
      const glob = join(getGlobalContextDir(), "**/AGENTS.md");
      const agentFile = join(getGlobalContextDir(), "AGENTS.md");
      testFs._globResults.set(glob, [agentFile]);
      testFs._files.set(agentFile, "global content");
      const result = getAgentsContext();
      assert.equal(
        result,
        `\nAGENTS.md context files:\nPath: ${agentFile}\nContent: global content\n`,
      );
    });

    it("combines global and globbed AGENTS.md files", () => {
      const cwd = "/test-cwd";
      testFs._dirs.add(getGlobalContextDir());
      const agentFile = join(getGlobalContextDir(), "AGENTS.md");
      testFs._files.set(agentFile, "global content");
      testFs._globResults.set(join(getGlobalContextDir(), "**/AGENTS.md"), [
        agentFile,
      ]);
      testFs._globResults.set(`${cwd}/**/AGENTS.md`, [`${cwd}/AGENTS.md`]);
      testFs._files.set(`${cwd}/AGENTS.md`, "local content");
      const result = getAgentsContext();
      assert.equal(
        result,
        `
AGENTS.md context files:
Path: ${cwd}/AGENTS.md
Content: local content

Path: ${agentFile}
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
      const dir = "/fake-home/.config/.agent-js/skills";
      testFs._dirs.add(dir);
      testFs._dirs.add(`${dir}/my-skill`);
      testFs._files.set(
        `${dir}/my-skill/SKILL.md`,
        "---\nname: my-skill\ndescription: A test skill\n---\n# Body",
      );
      const result = getSkillsContext();
      assert.ok(result.includes("- my-skill: A test skill"));
    });

    it("deduplicates by parsed name, keeping first occurrence", () => {
      const localDir = "/test-cwd/.agent-js/skills";
      const globalDir = "/fake-home/.config/.agent-js/skills";
      testFs._dirs.add(localDir);
      testFs._dirs.add(`${localDir}/local-skill`);
      testFs._dirs.add(globalDir);
      testFs._dirs.add(`${globalDir}/global-skill`);
      testFs._files.set(
        `${localDir}/local-skill/SKILL.md`,
        "---\nname: deploy\ndescription: Local deploy\n---\n# Local",
      );
      testFs._files.set(
        `${globalDir}/global-skill/SKILL.md`,
        "---\nname: deploy\ndescription: Global deploy\n---\n# Global",
      );
      const result = getSkillsContext();
      assert.ok(result.includes("- deploy: Local deploy"));
      assert.ok(!result.includes("Global deploy"));
    });

    it("includes skills with different names", () => {
      const dir = "/test-cwd/.agent-js/skills";
      testFs._dirs.add(dir);
      testFs._dirs.add(`${dir}/a`);
      testFs._dirs.add(`${dir}/b`);
      testFs._files.set(
        `${dir}/a/SKILL.md`,
        "---\nname: skill-a\ndescription: First\n---\n",
      );
      testFs._files.set(
        `${dir}/b/SKILL.md`,
        "---\nname: skill-b\ndescription: Second\n---\n",
      );
      const result = getSkillsContext();
      assert.ok(result.includes("- skill-a: First"));
      assert.ok(result.includes("- skill-b: Second"));
    });

    it("skips non-existent skill directories", () => {
      const dir = "/fake-home/.config/.agent-js/skills";
      testFs._dirs.add(dir);
      testFs._dirs.add(`${dir}/my-skill`);
      testFs._files.set(
        `${dir}/my-skill/SKILL.md`,
        "---\nname: my-skill\ndescription: A test skill\n---\n# Body",
      );
      const result = getSkillsContext();
      assert.ok(result.includes("- my-skill: A test skill"));
    });

    it("skips file entries in skill directory", () => {
      const dir = "/fake-home/.config/.agent-js/skills";
      testFs._dirs.add(dir);
      testFs._files.set(`${dir}/not-a-dir`, "some content");
      testFs._dirs.add(`${dir}/actual-skill`);
      testFs._files.set(
        `${dir}/actual-skill/SKILL.md`,
        "---\nname: actual-skill\ndescription: Real\n---\n",
      );
      const result = getSkillsContext();
      assert.ok(result.includes("- actual-skill: Real"));
      assert.ok(!result.includes("not-a-dir"));
    });

    it("skips entries where statSync fails", () => {
      const dir = "/fake-home/.config/.agent-js/skills";
      testFs._dirs.add(dir);
      testFs._dirs.add(`${dir}/broken`);
      testFs._dirs.add(`${dir}/working`);
      testFs._files.set(
        `${dir}/working/SKILL.md`,
        "---\nname: working\ndescription: Works\n---\n",
      );
      const originalStatSync = testFs.statSync;
      testFs.statSync = (path: string) => {
        if (path === `${dir}/broken`) throw new Error("stat failed");
        return originalStatSync(path);
      };
      const result = getSkillsContext();
      assert.ok(result.includes("- working: Works"));
      assert.ok(!result.includes("broken"));
    });

    it("skips entries where getSkillJSON returns null", () => {
      const dir = "/fake-home/.config/.agent-js/skills";
      testFs._dirs.add(dir);
      testFs._dirs.add(`${dir}/no-skill-md`);
      testFs._dirs.add(`${dir}/has-skill`);
      testFs._files.set(`${dir}/no-skill-md/readme.txt`, "just a file");
      testFs._files.set(
        `${dir}/has-skill/SKILL.md`,
        "---\nname: has-skill\ndescription: Present\n---\n",
      );
      const result = getSkillsContext();
      assert.ok(result.includes("- has-skill: Present"));
      assert.ok(!result.includes("no-skill-md"));
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
