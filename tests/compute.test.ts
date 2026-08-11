import { describe, expect, it } from "vitest";
import type { Extension } from "@codemirror/state";
import { EditorState } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { StreamLanguage } from "@codemirror/language";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { getStickyContextForRange } from "../src/compute";
import { makeStickyScrollConfig, type StickyScrollOptions } from "../src/facet";
import type { StickyLine } from "../src/types";

// Fixture with nested function / arrow / loop / if / class / object literal.
const DOC = `import fs from "fs";

export function outer(a, b) {
  const helper = () => {
    for (let i = 0; i < 10; i++) {
      if (i % 2 === 0) {
        return i;
      }
    }
    return null;
  };
  return helper(a + b);
}

export class Box {
  open() {
    const x = {
      a: 1,
      b: 2,
    };
    return x.a;
  }
}
`;

function makeState(doc: string, lang: Extension = javascript()) {
  return EditorState.create({ doc, extensions: [lang] });
}

/** Compute the sticky line numbers when line `topLine` is at the viewport top. */
function stickyLineNumbers(
  doc: string,
  topLine: number,
  options?: StickyScrollOptions,
  lang: Extension = javascript()
): number[] {
  const state = makeState(doc, lang);
  const fromPos = state.doc.line(topLine).from;
  const lines: StickyLine[] = getStickyContextForRange(state, fromPos, makeStickyScrollConfig(options));
  return lines.map((l) => l.lineNumber);
}

describe("getStickyContextForRange — nested JS fixture", () => {
  it("pins the enclosing scopes outermost → innermost", () => {
    // Viewport top on line 7 (deep inside the `if`).
    expect(stickyLineNumbers(DOC, 7)).toEqual([3, 4, 5, 6]);
  });

  it("drops inner scopes that have already closed above the viewport", () => {
    // Line 12 is still inside `outer` but past the helper's closing brace.
    expect(stickyLineNumbers(DOC, 12)).toEqual([3]);
  });

  it("deduplicates nodes sharing the same opening line", () => {
    // Line 3: FunctionDeclaration + its Block both start on line 3.
    // Line 5: ForStatement + Block both start on line 5.
    expect(stickyLineNumbers(DOC, 7)).toHaveLength(4);
    expect(new Set(stickyLineNumbers(DOC, 7)).size).toBe(4);
  });

  it("excludes data literals by default (denylist), but not class/method", () => {
    // Inside the object literal (line 18): ObjectExpression is excluded,
    // class Box (15) and method open() (16) remain.
    expect(stickyLineNumbers(DOC, 18)).toEqual([15, 16]);
  });

  it("respects a custom excludeNode override (denylist can be disabled)", () => {
    const never = () => false;
    // With the default denylist disabled, the ObjectExpression (line 17) shows up.
    expect(stickyLineNumbers(DOC, 18, { excludeNode: never })).toEqual([15, 16, 17]);
  });

  it("caps the result at maxStickyLines, keeping the outermost", () => {
    expect(stickyLineNumbers(DOC, 7, { maxStickyLines: 2 })).toEqual([3, 4]);
    expect(stickyLineNumbers(DOC, 7, { maxStickyLines: 0 })).toEqual([]);
  });

  it("returns [] at the very top of the document", () => {
    expect(stickyLineNumbers(DOC, 1)).toEqual([]);
    expect(stickyLineNumbers(DOC, 2)).toEqual([]);
  });
});

describe("getStickyContextForRange — scope end drives slide-away (try/catch)", () => {
  const TRY_DOC = `export async function checkGitInstalled(): Promise<boolean> {
  try {
    const avail = await invoke<GitAvailability>('check_git_availability', { manualPath: null });
    return avail.status === 'Available';
  } catch {
    return false;
  }
}
`;

  it("uses the full semantic scope end, not the try-body block end", () => {
    const state = makeState(TRY_DOC, javascript({ typescript: true }));
    const fromPos = state.doc.line(3).from;
    const lines = getStickyContextForRange(state, fromPos, makeStickyScrollConfig(undefined));

    expect(lines.map((l) => l.lineNumber)).toEqual([1, 2]);
    // The try scope is only over at the `}` after `catch` (line 7) — so the
    // slide-away must not start while the viewport is still inside the try body.
    expect(lines[1].closingLine).toBe(7);
    // The function scope ends at its own closing brace (line 8).
    expect(lines[0].closingLine).toBe(8);
  });
});

describe("getStickyContextForRange — guards (§8.1)", () => {
  it("returns [] when no language extension is registered", () => {
    const state = EditorState.create({ doc: DOC });
    const fromPos = state.doc.line(7).from;
    const lines = getStickyContextForRange(state, fromPos, makeStickyScrollConfig(undefined));
    expect(lines).toEqual([]);
  });

  it("returns [] when the excludeNode predicate excludes everything", () => {
    const excludeAll = () => true;
    expect(stickyLineNumbers(DOC, 7, { excludeNode: excludeAll })).toEqual([]);
  });

  it("returns [] for an empty document", () => {
    expect(stickyLineNumbers("", 1)).toEqual([]);
  });
});

describe("getStickyContextForRange — plain text (no fold service)", () => {
  it("returns [] when the language provides no folding info", () => {
    // A bare language with no foldNodeProp: nothing is foldable → no sticky lines.
    const plain = StreamLanguage.define({
      token: (stream) => {
        stream.skipToEnd();
        return null;
      },
    });
    const doc = `line one
line two
line three`;
    expect(stickyLineNumbers(doc, 3, undefined, plain)).toEqual([]);
  });
});

describe("getStickyContextForRange — large files with a partial syntax tree", () => {
  // Builds a JS file large enough that the *committed* syntax tree only covers
  // the first few thousand characters (CM6 parses lazily). This mirrors what
  // the plugin sees right after a scroll jump into an unparsed region.
  function buildLargeDoc(n: number): string {
    let code = "export function outer() {\n";
    for (let i = 0; i < n; i++) {
      if (i === 0) code += "  function inner() {\n";
      code += `    const x_${i} = ${i};\n`;
    }
    code += "  }\n";
    code += "}\n";
    return code;
  }

  it("returns [] when computing against the stale, short committed tree", () => {
    const state = EditorState.create({ doc: buildLargeDoc(5000), extensions: [javascript()] });
    const deepPos = state.doc.line(4000).from;
    const partialTree = syntaxTree(state);
    expect(partialTree.length).toBeLessThan(deepPos);

    const lines = getStickyContextForRange(state, deepPos, makeStickyScrollConfig(undefined), partialTree);
    expect(lines).toEqual([]);
  });

  it("finds the real scopes when given a tree extended to the target position", () => {
    let state = EditorState.create({ doc: buildLargeDoc(5000), extensions: [javascript()] });
    const deepLine = 4000;
    const deepPos = state.doc.line(deepLine).from;

    // Force the parse up to the target and commit it into the state (this is
    // what the plugin's treeUpTo()/ensureSyntaxTree does on scroll).
    ensureSyntaxTree(state, deepPos, 60000);
    state = state.update({}).state;
    const extendedTree = syntaxTree(state);
    expect(extendedTree.length).toBeGreaterThanOrEqual(deepPos);

    const lines = getStickyContextForRange(state, deepPos, makeStickyScrollConfig(undefined), extendedTree);
    const numbers = lines.map((l) => l.lineNumber);
    // outermost `outer` + innermost `inner` are both open at line 4000.
    expect(numbers).toEqual([1, 2]);
    expect(lines[1].text.trim()).toMatch(/^function inner/);
  });
});