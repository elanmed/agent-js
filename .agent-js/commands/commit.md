Run `git log --oneline -20` to see previous commit messages and understand the style.

Run `git diff --staged --name-only` to check if there are any staged files.

If no files are staged, run `git add -A` to stage all changes.

Run `git diff --staged` to see the changes.

Look at the changes and decide:
- If changes are related and belong together, create a single commit
- If changes affect different areas (e.g., tests vs source, docs vs code, unrelated features), create separate commits

When splitting into multiple commits:
- Stage files for the first logical group with `git add <files>`
- Commit with an appropriate message
- Repeat for each group

Write commit messages that:
- Use conventional commit format: `<type>: <description>`
- Common types: `add:`, `fix:`, `refactor:`, `docs:`, `tests:`, `misc:`
- Use lowercase only
- Use commas to separate multiple changes in one commit
- Fit on a single line
- Are descriptive but concise

Then run `git commit -m "<message>"` for each commit.
