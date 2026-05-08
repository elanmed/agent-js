describe("print", () => {
  describe("formatMarkdown", () => {
    it("formats markdown tables with aligned columns", async () => {
      const unaligned = "|a|b|\n|-|-|\n|x|y|";
      const result = await formatMarkdown(unaligned);
      assert.ok(result.includes("| a   | b   |"));
    });

    it("returns original content when formatting fails", async () => {
      const invalid = null as unknown as string;
      const result = await formatMarkdown(invalid);
      assert.equal(result, invalid);
    });
  });

  describe("fencePrint", () => {
    let captured: string[] = [];

    beforeEach(() => {
      captured = [];
    });

    function makeFencePrintDeps(
      overrides: Partial<FencePrintDeps> = {},
    ): FencePrintDeps {
      return {
        colorPrint: (text: string | Uint8Array) => {
          captured.push(text.toString());
        },
        ...overrides,
      };
    }

    it("truncates labels longer than 50 characters", () => {
      const longText = "a".repeat(60);
      fencePrint(longText, {}, makeFencePrintDeps());
      assert.deepStrictEqual(captured, [`── ${"a".repeat(46)}... ─`]);
    });

    it("does not truncate labels under 50 characters", () => {
      const shortText = "short label";
      fencePrint(shortText, {}, makeFencePrintDeps());
      assert.deepStrictEqual(captured, [
        `── short label (0 in, 0 out) ─────────────────────────`,
      ]);
    });
  });
});
