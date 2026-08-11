# @fazelstudio/codemirror-stickyscroll

> VS Code / Monaco-style **sticky scroll** (sticky lines) for [CodeMirror 6](https://codemirror.net/).

Sticky lines keep the *opening* lines of the enclosing scopes (function, class,
if/loop blocks, …) pinned at the top of the editor while you scroll — exactly
like VS Code's sticky scroll, but built **purely as an external CodeMirror 6
extension** (no fork of `@codemirror/*`).

## Features

- **Per-pixel updates** — a native `scroll` listener + `requestAnimationFrame`
  throttle keeps the bar glued to the scroll position; no "jumpy" updates.
- **Slide-away effect** — the innermost pinned line is pushed out gradually as
  its own closing line approaches the top of the viewport (Monaco behavior).
- **Click-to-jump with margin compensation** — clicking a sticky line scrolls
  the target line to the top *plus* the current bar height, so the line you
  jump to is never hidden behind the bar. Keyboard (`Enter`/`Space`) + `role="button"` for a11y.
- **Reuses the consumer's theme** — the bar re-highlights lines through the
  *active* highlight styles of the editor (`highlightingFor`), or clones the
  already-rendered DOM line when available. The package **never** registers its
  own `syntaxHighlighting(...)`.
- **Language-agnostic** — detection is based on `foldable()` from
  `@codemirror/language` (the fold services / fold node props that every
  `@codemirror/lang-*` already registers). It includes a smart, generic denylist
  that works across multiple languages (JS/TS, Python, Rust, Go, etc.) out of the box,
  and gracefully handles data languages like JSON.
- **Gutter alignment, horizontal sync, RTL, resize-proof** — line numbers are
  aligned with the real gutter (width tracked via `ResizeObserver`), the bar
  follows horizontal scroll, and it reacts to font/zoom/resize changes.
- **Zero runtime deps** — peer dependencies only.

## Installation

```bash
npm install @fazelstudio/codemirror-stickyscroll
# or
bun add @fazelstudio/codemirror-stickyscroll
```

The following are **peer dependencies** (already present in any project that
has a working CodeMirror 6 editor):

| Package | Minimum |
| --- | --- |
| `@codemirror/view` | ^6.0.0 |
| `@codemirror/state` | ^6.0.0 |
| `@codemirror/language` | ^6.0.0 |
| `@lezer/common` | ^1.0.0 |
| `@lezer/highlight` | ^1.0.0 |

They are deliberately **not bundled** (see [Why peer deps?](#why-peer-deps)).

## Usage (vanilla)

```ts
import { EditorView, basicSetup } from "codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { stickyScroll } from "@fazelstudio/codemirror-stickyscroll";

const view = new EditorView({
  doc: "export function hello() {\n  return 42;\n}",
  extensions: [
    basicSetup,
    javascript(),
    stickyScroll({ maxStickyLines: 4 }),
  ],
  parent: document.getElementById("editor")!,
});
```

## Usage (Svelte — target integration)

```svelte
<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { EditorView } from "@codemirror/view";
  import { javascript } from "@codemirror/lang-javascript";
  import { stickyScroll } from "@fazelstudio/codemirror-stickyscroll";

  let container: HTMLDivElement;
  let view: EditorView;

  onMount(() => {
    view = new EditorView({
      parent: container,
      extensions: [
        // ...your extensions (theme, keymaps, lint, ...)
        javascript(),
        stickyScroll({ maxStickyLines: 5 }),
      ],
    });
  });

  onDestroy(() => {
    view?.destroy();
  });
</script>

<div bind:this={container} />
```

Because it's a pure `ViewPlugin`, the bar is destroyed together with the editor
instance (tabs closing, runtime reconfiguration) — no leaks.

## API

### `stickyScroll(options?: StickyScrollOptions): Extension`

```ts
interface StickyScrollOptions {
  /** Maximum sticky lines shown at once (dynamically clamped to ~40% of editor height). Default: 4 */
  maxStickyLines?: number;
  /** Minimum lines a scope must span to become sticky. Default: 2 */
  minBlockLines?: number;
  /**
   * Denylist predicate: return true to never pin a foldable node of that type.
   * Defaults to `defaultExcludeNode` (imports + data literals + comments).
   * It uses exact node names for JS/TS and generic regex patterns for other
   * languages, while automatically bypassing the literal denylist for JSON.
   */
  excludeNode?: (nodeName: string, langName: string | undefined) => boolean;
  /** Extra HighlightStyle merged in when a line is re-highlighted from scratch. */
  highlightStyle?: HighlightStyle;
  /** Called after a sticky line is clicked (after the jump is dispatched). */
  onLineClick?: (lineNumber: number) => void;
  /** Extra CSS class(es) for the bar container. */
  class?: string;
}
```

### Re-exports

```ts
import {
  stickyScroll,
  stickyScrollFacet,        // the configuration Facet (compose/override per instance)
  defaultExcludeNode,       // default denylist implementation
  makeStickyScrollConfig,   // merge options with defaults
  stickyScrollBaseTheme,    // layout-only base theme (no token colors)
  type StickyScrollOptions,
  type StickyLine,
} from "@fazelstudio/codemirror-stickyscroll";
```

### Disable / enable at runtime

```ts
import { Compartment } from "@codemirror/state";
import { stickyScroll } from "@fazelstudio/codemirror-stickyscroll";

const sticky = new Compartment();
// in extensions:  sticky.of(stickyScroll({ maxStickyLines: 3 }))

view.dispatch({ effects: sticky.reconfigure([]) });                    // off
view.dispatch({ effects: sticky.reconfigure(stickyScroll()) });        // on
```

## Styling

The bar is layout-only by default and always follows the **editor's own theme**
(token colors, background). You can restyle it with CSS:

```css
.cm-stickyscroll-container {
  /* bar background (auto-set from the editor theme; override if you like) */
  --cm-stickyscroll-bg: #1e1e1e;
  --cm-stickyscroll-border: rgba(128, 128, 128, 0.3);
  --cm-stickyscroll-lineNumber: #9a9a9a;
  --cm-stickyscroll-hoverBg: rgba(128, 128, 128, 0.15);
  --cm-stickyscroll-accent: #4b9edd;
}
```

Per-row hooks:

| Class | Purpose |
| --- | --- |
| `.cm-stickyscroll-container` | the overlay bar |
| `.cm-stickyscroll-line` | one breadcrumb row |
| `.cm-stickyscroll-line:hover` | hover highlight |
| `.cm-stickyscroll-line.cm-stickyscroll-current` | block containing the cursor |
| `.cm-stickyscroll-gutter` | line-number cell |
| `.cm-stickyscroll-text` | code column (horizontally synced) |

## How it works

1. **Detect the top line** — `view.lineBlockAtHeight(scrollTop - documentTop)`.
2. **Walk the syntax tree** — from `syntaxTree(state).resolveInner(topPos, 0)`
   up through `node.parent`.
3. **A scope qualifies when** its opening line is *foldable*
   (`foldable(state, line.from, line.to)` from `@codemirror/language`), its fold
   anchor node is not denylisted, and it spans ≥ `minBlockLines`.
4. **Render** — a `ViewPlugin` owns an absolutely-positioned overlay
   (`position: absolute; top: 0` inside `view.dom`), updated per-frame from the
   native `scroll` event; line numbers align with the real gutter; token colors
   come from the consumer's active highlighters.
5. **Slide-away** — when the innermost pinned block's closing line reaches the
   top, the bar's height shrinks and the innermost row(s) translate up & fade
   instead of disappearing abruptly.

The DOM overlay (rather than the Panel API / `showPanel`) is what makes the bar
behave like Monaco: it never pushes the content down (no reflow) and it can be
updated per-pixel, which panels cannot (panels only re-render on `ViewUpdate`,
not on pure scroll).

## Language support

Works out of the box with any `@codemirror/lang-*` (or community grammar) that
registers folding — JS/TS, Rust, Python, Java, Go, C#, etc. Legacy
`StreamLanguage` modes (no Lezer tree, no `foldNodeProp`) are **not** supported;
for those, the extension silently does nothing (§ graceful degradation).

## Why peer deps?

`Facet`, `StateField`, `ViewPlugin` and other CodeMirror primitives are
identified by **JavaScript object identity**. If this package bundled its own
copy of `@codemirror/state`, its facets/plugins would silently never match the
ones in the host app. Keeping them as peer dependencies guarantees a single
module instance. npm/bun installs matching versions automatically if missing.

## Development

```bash
npm install
npm run dev      # Vite demo in example/
npm test         # vitest unit tests (compute algorithm + plugin lifecycle)
npm run typecheck
npm run build    # tsup → ESM + CJS + .d.ts into dist/
```

## License

MIT — © Zulfazli (Fazelllyyy) · [https://github.com/fazelllyyy](https://github.com/fazelllyyy)
