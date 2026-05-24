# Project Instructions For Codex

When editing files in this repository:

1. Treat text files as UTF-8 without BOM.
2. Preserve LF line endings unless the file is `.bat`, `.cmd`, or `.ps1`.
3. Avoid PowerShell here-strings for source-code edits.
4. Avoid shell command chaining with `&&` or `||`; use separate commands or PowerShell-native sequencing.
5. Prefer small, targeted edits over large file rewrites.
6. For non-ASCII-heavy files or exact replacements, prefer a small Node.js script that:
   - reads files as UTF-8
   - replaces exact target blocks
   - fails if the target text is not found
   - writes files back as UTF-8
7. Use `node scripts/replace-text.mjs <file> <from> <to>` for exact replacements instead of shell heredocs.
8. Inspect the exact target function or block before editing.
9. Run the smallest relevant test first, then the broader regression when needed.
10. Do not rewrite entire files unless explicitly requested.
