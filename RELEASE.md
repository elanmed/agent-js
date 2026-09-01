# Releasing

## Steps

1. **Bump the version** in `package.json`.
2. **Add a changelog entry** in `CHANGELOG.md`:

   ```md
   ## v0.1.0 - 2026-09-01

   - Initial release
   ```

3. **Commit** the bump and changelog together:

   ```sh
   git add package.json CHANGELOG.md
   git commit -m "release: v0.1.0"
   ```

4. **Release**:

   ```sh
   ./scripts/publish.sh
   ```

   This builds all platforms into `dist/`, tags the release commit with `v<version>` (pushing the tag), and creates a GitHub release with the changelog section for that version (`--notes-file`; falls back to `--generate-notes` if no section matches).

## Prerequisites

- `gh` installed and authenticated (`gh auth login`)
- git remote configured
- `dist/` is gitignored; binaries are built fresh by `publish.sh`
