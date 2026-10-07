<!-- markdownlint-disable first-line-h1 line-length -->
## 0.3.0

*2026-10-07*

**Added**

- Exported `stickyScrollEffect` to allow users to trigger sticky scroll updates manually

## 0.2.0

*2026-10-02*

**Removed**

- `stickyScrollFacet`, `makeStickyScrollConfig`, `stickyScrollBaseTheme` and types `StickyLine` and `StickyScrollConfig` are no longer exported

## 0.1.1

*2026-09-08*

**Changed**

- For stream languages, the extension will only scan at most 100 lines to find sticky lines, to avoid performance issues in large documents

## 0.1.0

*2026-08-28*

**Added**

- Sticky scroll support for stream languages (e.g., Wikitext) using [`foldService`](https://codemirror.net/docs/ref/#language.foldService)

**Fixed**

- Sticky lines for JSON/JSONC will now only show lines containing object property keys
- Avoid inline styles to allow users to customize the sticky scroll styles using CSS
- Use `MutationObserver` to detect dynamic changes in the gutters
- Remove the sliding effect on sticky lines when scrolling to fix a bug where the sticky lines would slide up at wrong times
- The sticky lines will now use the same font as the editor

**Changed**

- The default value of `minBlockLines` is now `6`
- The sticky lines will not remove leading right braces (`}`)
- Minor style changes to the sticky lines

**Removed**

- Configuration options `highlightStyle` and `onLineClick` are no longer supported
- CSS variables
