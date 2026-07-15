import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { testFs, setupTestContext } from "./test-helpers.ts";
import { getGlobalContextDir } from "./paths.ts";
import {
  getContextStr,
  getContextEntries,
  getSkillsStr,
  getSkills,
  getSkillJSON,
  parseFrontMatter,
} from "./context.ts";
import { actions } from "./state.ts";

describe("context", () => {
  beforeEach(() => {
    setupTestContext();
  });

  describe("getContextStr", () => {
    it("returns empty string when no AGENTS.md files found", () => {
      const result = getContextStr(getContextEntries());
      assert.equal(result, "");
    });

    it("returns formatted content for single file", () => {
      testFs._globResults.set("/test-cwd/**/AGENTS.md", [
        "/test-cwd/AGENTS.md",
      ]);
      testFs._files.set("/test-cwd/AGENTS.md", "# Agent Instructions");
      const result = getContextStr(getContextEntries());
      assert.equal(
        result,
        `
AGENTS.md context files:
Path: /test-cwd/AGENTS.md
Content: # Agent Instructions
`,
      );
    });

    it("returns formatted content for multiple files", () => {
      testFs._dirs.add(getGlobalContextDir());
      testFs._files.set("/test-cwd/AGENTS.md", "Root content");
      testFs._files.set(
        "/fake-home/.config/.agent-js/context/AGENTS.md",
        "Global content",
      );
      const result = getContextStr(getContextEntries());
      assert.equal(
        result,
        `
AGENTS.md context files:
Path: /test-cwd/AGENTS.md
Content: Root content

Path: /fake-home/.config/.agent-js/context/AGENTS.md
Content: Global content
`,
      );
    });

    it("skips files that fail to read", () => {
      testFs._dirs.add(getGlobalContextDir());
      testFs._files.set(
        "/fake-home/.config/.agent-js/context/AGENTS.md",
        "Global content",
      );
      const result = getContextStr(getContextEntries());
      assert.equal(
        result,
        `
AGENTS.md context files:
Path: /fake-home/.config/.agent-js/context/AGENTS.md
Content: Global content
`,
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
      const result = getContextStr(getContextEntries());
      assert.equal(
        result,
        `
AGENTS.md context files:
Path: /fake-home/.config/.agent-js/context/AGENTS.md
Content: global content
`,
      );
    });

    it("combines cwd and global agents dir files", () => {
      testFs._dirs.add(getGlobalContextDir());
      testFs._files.set(
        "/fake-home/.config/.agent-js/context/AGENTS.md",
        "global content",
      );
      testFs._files.set("/test-cwd/AGENTS.md", "local content");
      const result = getContextStr(getContextEntries());
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

  describe("getSkillsStr", () => {
    it("returns empty string when no skills are found", () => {
      const result = getSkillsStr([]);
      assert.equal(result, "");
    });

    it("lists skills found in skill directories", async () => {
      testFs._globResults.set(
        "/fake-home/.config/.agent-js/skills/**/SKILL.md",
        ["/fake-home/.config/.agent-js/skills/my-skill/SKILL.md"],
      );
      testFs._files.set(
        "/fake-home/.config/.agent-js/skills/my-skill/SKILL.md",
        `---
name: my-skill
description: A test skill
---
# Body`,
      );
      const result = getSkillsStr(await getSkills());
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

    it("deduplicates by parsed name, keeping first occurrence", async () => {
      testFs._globResults.set("/test-cwd/.agent-js/skills/**/SKILL.md", [
        "/test-cwd/.agent-js/skills/local-skill/SKILL.md",
      ]);
      testFs._globResults.set(
        "/fake-home/.config/.agent-js/skills/**/SKILL.md",
        ["/fake-home/.config/.agent-js/skills/global-skill/SKILL.md"],
      );
      testFs._files.set(
        "/test-cwd/.agent-js/skills/local-skill/SKILL.md",
        `---
name: deploy
description: Local deploy
---
# Local`,
      );
      testFs._files.set(
        "/fake-home/.config/.agent-js/skills/global-skill/SKILL.md",
        `---
name: deploy
description: Global deploy
---
# Global`,
      );
      const result = getSkillsStr(await getSkills());
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

    it("does not return duplicate skills", async () => {
      testFs._globResults.set("/test-cwd/.agent-js/skills/**/SKILL.md", [
        "/test-cwd/.agent-js/skills/a/SKILL.md",
      ]);
      testFs._globResults.set(
        "/fake-home/.config/.agent-js/skills/**/SKILL.md",
        ["/fake-home/.config/.agent-js/skills/b/SKILL.md"],
      );
      testFs._files.set(
        "/test-cwd/.agent-js/skills/a/SKILL.md",
        `---
name: deploy
description: First
---
# A`,
      );
      testFs._files.set(
        "/fake-home/.config/.agent-js/skills/b/SKILL.md",
        `---
name: deploy
description: Second
---
# B`,
      );
      const result = await getSkills();
      assert.equal(result.length, 1);
      assert.deepStrictEqual(result[0], {
        name: "deploy",
        description: "First",
        content: "# A",
        dir: "/test-cwd/.agent-js/skills/a",
      });
    });

    it("includes skills with different names", async () => {
      testFs._globResults.set("/test-cwd/.agent-js/skills/**/SKILL.md", [
        "/test-cwd/.agent-js/skills/a/SKILL.md",
        "/test-cwd/.agent-js/skills/b/SKILL.md",
      ]);
      testFs._files.set(
        "/test-cwd/.agent-js/skills/a/SKILL.md",
        `---
name: skill-a
description: First
---
`,
      );
      testFs._files.set(
        "/test-cwd/.agent-js/skills/b/SKILL.md",
        `---
name: skill-b
description: Second
---
`,
      );
      const result = getSkillsStr(await getSkills());
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

    it("skips non-existent skill directories", async () => {
      testFs._globResults.set(
        "/fake-home/.config/.agent-js/skills/**/SKILL.md",
        ["/fake-home/.config/.agent-js/skills/my-skill/SKILL.md"],
      );
      testFs._files.set(
        "/fake-home/.config/.agent-js/skills/my-skill/SKILL.md",
        `---
name: my-skill
description: A test skill
---
# Body`,
      );
      const result = getSkillsStr(await getSkills());
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

    it("skips malformed skill files", async () => {
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
        `---
name: good
description: Valid
---
`,
      );
      const result = getSkillsStr(await getSkills());
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

    it("includes skills from custom skill dirs", async () => {
      actions.setCustomSkillDirs(["/custom/skills"]);
      testFs._globResults.set("/custom/skills/**/SKILL.md", [
        "/custom/skills/custom-skill/SKILL.md",
      ]);
      testFs._files.set(
        "/custom/skills/custom-skill/SKILL.md",
        `---
name: custom-skill
description: From custom dir
---
`,
      );
      const result = getSkillsStr(await getSkills());
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

    it("prioritizes custom skill dirs over local and global", async () => {
      actions.setCustomSkillDirs(["/custom/skills"]);
      testFs._globResults.set("/custom/skills/**/SKILL.md", [
        "/custom/skills/deploy/SKILL.md",
      ]);
      testFs._globResults.set("/test-cwd/.agent-js/skills/**/SKILL.md", [
        "/test-cwd/.agent-js/skills/deploy/SKILL.md",
      ]);
      testFs._files.set(
        "/custom/skills/deploy/SKILL.md",
        `---
name: deploy
description: Custom deploy
---
`,
      );
      testFs._files.set(
        "/test-cwd/.agent-js/skills/deploy/SKILL.md",
        `---
name: deploy
description: Local deploy
---
`,
      );
      const result = getSkillsStr(await getSkills());
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

    it("includes nested AGENTS.md files as context skills", async () => {
      testFs._globResults.set("/test-cwd/*/**/AGENTS.md", [
        "/test-cwd/src/AGENTS.md",
      ]);
      testFs._files.set("/test-cwd/src/AGENTS.md", "nested content");
      const result = getSkillsStr(await getSkills());
      assert.equal(
        result,
        `
Skills:

Use the \`loadSkill\` tool to load a skill when the user's request
would benefit from specialized instructions.

 Available skills:
- __agent-js-context-for-/test-cwd/src: Context relevant for /test-cwd/src
`,
      );
    });

    it("nested AGENTS.md skills do not collide with regular skills", async () => {
      testFs._globResults.set(
        "/fake-home/.config/.agent-js/skills/**/SKILL.md",
        ["/fake-home/.config/.agent-js/skills/my-skill/SKILL.md"],
      );
      testFs._files.set(
        "/fake-home/.config/.agent-js/skills/my-skill/SKILL.md",
        `---
name: my-skill
description: A test skill
---
# Body`,
      );
      testFs._globResults.set("/test-cwd/*/**/AGENTS.md", [
        "/test-cwd/src/AGENTS.md",
      ]);
      testFs._files.set("/test-cwd/src/AGENTS.md", "nested content");
      const result = getSkillsStr(await getSkills());
      assert.equal(
        result,
        `
Skills:

Use the \`loadSkill\` tool to load a skill when the user's request
would benefit from specialized instructions.

 Available skills:
- my-skill: A test skill
- __agent-js-context-for-/test-cwd/src: Context relevant for /test-cwd/src
`,
      );
    });

    it("skips entries where globbySync throws", async () => {
      const originalGlobSync = testFs.globbySync;
      testFs.globbySync = (pattern: string) => {
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
        `---
name: ok
description: Works
---
`,
      );
      const result = getSkillsStr(await getSkills());
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
    it("returns null when file does not exist", async () => {
      const result = await getSkillJSON("/some/dir/SKILL.md");
      assert.equal(result, null);
    });

    it("parses valid SKILL.md front matter", async () => {
      testFs._files.set(
        "/skill-dir/SKILL.md",
        `---
name: deploy
description: Deploy the app
---
# Deploy`,
      );
      const result = await getSkillJSON("/skill-dir/SKILL.md");
      assert.deepStrictEqual(result, {
        name: "deploy",
        description: "Deploy the app",
        content: "# Deploy",
        dir: "/skill-dir",
      });
    });

    it("returns null when front matter is missing name", async () => {
      testFs._files.set(
        "/skill-dir/SKILL.md",
        `---
description: No name here
---
`,
      );
      const result = await getSkillJSON("/skill-dir/SKILL.md");
      assert.equal(result, null);
    });

    it("returns null when front matter is missing description", async () => {
      testFs._files.set(
        "/skill-dir/SKILL.md",
        `---
name: deploy
---
`,
      );
      const result = await getSkillJSON("/skill-dir/SKILL.md");
      assert.equal(result, null);
    });

    it("returns null when path is a directory", async () => {
      testFs._dirs.add("/skill-dir");
      const result = await getSkillJSON("/skill-dir");
      assert.equal(result, null);
    });

    it("returns null when readFileSync fails", async () => {
      const result = await getSkillJSON("/skill-dir/SKILL.md");
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
      const result = parseFrontMatter(`---
name: test
`);
      assert.equal(result, null);
    });

    it("returns null when yaml string is empty", () => {
      const result = parseFrontMatter(`---
---
body`);
      assert.equal(result, null);
    });

    it("parses valid front matter with attributes and body", () => {
      const result = parseFrontMatter(
        `---
name: my-skill
description: A skill
---
# Body content`,
      );
      assert.deepStrictEqual(result, {
        data: { name: "my-skill", description: "A skill" },
        body: "# Body content",
      });
    });

    it("parses front matter with no body", () => {
      const result = parseFrontMatter(`---
name: test
---
`);
      assert.deepStrictEqual(result, {
        data: { name: "test" },
        body: "",
      });
    });

    it("preserves body containing dashes", () => {
      const result = parseFrontMatter(
        `---
key: val
---
Body with --- inside
and more text`,
      );
      assert.deepStrictEqual(result, {
        data: { key: "val" },
        body: `Body with --- inside
and more text`,
      });
    });

    it("returns null when closing delimiter lacks trailing newline", () => {
      const result = parseFrontMatter(`---
key: val
---`);
      assert.equal(result, null);
    });

    it("returns null on invalid yaml", () => {
      const result = parseFrontMatter(`---
* invalid
* ---
*  body`);
      assert.equal(result, null);
    });

    it("returns null on unclosed flow sequence in yaml", () => {
      const result = parseFrontMatter(`---
key: [unclosed
---
body`);
      assert.equal(result, null);
    });
  });
});
