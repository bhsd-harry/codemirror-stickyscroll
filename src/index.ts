import type { Extension } from "@codemirror/state";
import { stickyScrollFacet, type StickyScrollOptions } from "./facet";
import { scrollStickyPlugin } from "./plugin";
import { stickyScrollBaseTheme } from "./theme";

export type { StickyScrollOptions } from "./facet";
export { defaultExcludeNode } from "./facet";
export { stickyScrollEffect } from "./plugin";

/**
 * Add Monaco/VS Code-style sticky scroll to a CodeMirror 6 editor.
 *
 * ```ts
 * import { stickyScroll } from "@fazelstudio/codemirror-stickyscroll";
 *
 * const view = new EditorView({
 *   extensions: [basicSetup, javascript(), stickyScroll({ maxStickyLines: 4 })],
 *   parent: el,
 * });
 * ```
 *
 * Note: the returned array deliberately does NOT contain any
 * `syntaxHighlighting(...)` — token colors always come from the consumer's own
 * theme (§4.4).
 */
export function stickyScroll(options: StickyScrollOptions = {}): Extension {
  return [stickyScrollFacet.of(options), stickyScrollBaseTheme, scrollStickyPlugin];
}