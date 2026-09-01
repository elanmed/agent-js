Update CHANGELOG.md with the changes since the last release.

1. Use git to find the most recent release tag (the `v*` tags are placed on `release:` commits).
2. List the commits since that tag — their subjects are the source material for the entry.
3. Determine the new version: use `package.json` if it is newer than the tag, otherwise propose the next patch or minor version. Ask the user to confirm the version, and use today's date.
4. Build a section matching the existing format (`## v<version> - <date>` followed by `- ` bullets).
5. Derive bullets from the commit subjects:
   - Strip the conventional-commit type prefix (`add:`, `fix:`, `refactor:`, etc.)
   - Capitalize the first word, write each bullet as a concise human-readable sentence
   - Group related commits into a single bullet
   - Skip internal churn (logo tweaks, test-only commits) unless user-facing

6. Insert the new section at the top of CHANGELOG.md, directly after the `# Changelog` header line, leaving the rest of the file untouched.
7. Show the user the proposed entry for approval before writing it to the file.
