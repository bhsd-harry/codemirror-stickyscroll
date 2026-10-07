import type { Extension } from "@codemirror/state";
import { stickyScrollFacet, type StickyScrollOptions } from "./facet.js";
import { scrollStickyPlugin } from "./plugin.js";
import { stickyScrollBaseTheme } from "./theme.js";

export type { StickyScrollOptions } from "./facet";
export { defaultExcludeNode } from "./facet.js";
export { stickyScrollEffect } from "./plugin.js";

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