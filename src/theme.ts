import { EditorView } from "@codemirror/view";

/**
 * Cosmetic-only theme for the sticky bar.
 *
 * ALL sizing (height, lineHeight, padding, overflow, position, display,
 * transform) is set via inline style by plugin.ts — matching Monaco's exact
 * approach of updating styles imperatively on every scroll event.
 *
 * This file only provides:
 *  1. Background color fallback (JS overrides immediately with actual editor bg)
 *  2. Current-scope highlight
 *  3. Gutter cosmetics (color, opacity)
 *  4. Dark-mode override for background fallback
 *
 * ⛔ Do NOT add: height, lineHeight, overflow, display, padding, margin,
 *    position, transform to .cm-stickyscroll-line or .cm-stickyscroll-inner.
 *    Plugin.ts owns those — any CSS here will conflict.
 * ⛔ Do NOT add syntaxHighlighting — token colors come from the consumer's theme.
 */
export const stickyScrollBaseTheme = EditorView.baseTheme({
  // Container background fallback — JS overrides with exact editor color.
  ".cm-stickyscroll-container": {
    position: "absolute",
    top: "0",
    left: "0",
    right: "0",
    zIndex: "10",
    overflow: "hidden",
    boxSizing: "border-box",
    pointerEvents: "none",
    backgroundColor: "var(--cm-stickyscroll-bg, #ffffff)",
    color: "inherit",
    font: "inherit",
    fontFamily: "monospace",
    tabSize: "4",
  },

  "&dark .cm-stickyscroll-container": {
    backgroundColor: "var(--cm-stickyscroll-bg, #1e1e1e)",
  },

  // The inner wrapper and every row inherit the container's (opaque) background.
  // This is what makes the VSCode slide-away work: when the innermost row slides
  // up underneath the row above it, the row above is opaque and actually *hides*
  // it — otherwise the sliding row's text would bleed through the outer rows.
  ".cm-stickyscroll-inner": {
    pointerEvents: "auto",
    backgroundColor: "inherit",
  },

  ".cm-stickyscroll-line": {
    display: "block",
    position: "relative",
    overflow: "hidden",
    whiteSpace: "pre",
    boxSizing: "border-box",
    cursor: "pointer",
    backgroundColor: "inherit",

    // Current scope indicator (left accent bar — same as VSCode).
    "&.cm-stickyscroll-current": {
      backgroundColor: "inherit",
      backgroundImage: "linear-gradient(rgba(128,128,128,.07), rgba(128,128,128,.07))",
      boxShadow: "inset 3px 0 0 #4b9edd",
    },

    "&:hover": {
      backgroundImage: "linear-gradient(rgba(128,128,128,.09), rgba(128,128,128,.09))",
    },
  },

  // Gutter cosmetics — position/size are inline from plugin.ts.
  ".cm-stickyscroll-gutter": {
    position: "absolute",
    top: "0",
    left: "0",
    zIndex: "1",
    display: "flex",
    alignItems: "stretch",
    boxSizing: "border-box",
    WebkitUserSelect: "none",
    userSelect: "none",
    backgroundColor: "inherit",
    backgroundImage: "inherit",
    borderRight: "1px solid rgba(128,128,128,.18)",
    color: "inherit",
    opacity: ".55",
    font: "inherit",
    fontSize: "inherit",

    // We provide base flex styles so the number aligns correctly, but allow custom padding to apply via CSS.
    "& .cm-gutterElement": {
      width: "100%",
      boxSizing: "border-box",
      display: "flex",
      alignItems: "center",
      justifyContent: "flex-end",
    },
  },

  ".cm-stickyscroll-linenum": {
    display: "block",
    textAlign: "end",
    width: "100%",
    whiteSpace: "nowrap",
    font: "inherit",
    paddingRight: "4px",
  },

  ".cm-stickyscroll-code": {
    display: "block",
    whiteSpace: "pre",
    padding: "0 2px 0 6px",
  },
});