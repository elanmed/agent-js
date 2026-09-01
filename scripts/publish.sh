#!/bin/bash

./scripts/compile.sh || exit 1

version="v$(node -p "require('./package.json').version")" || exit 1
echo "Publishing $version..."

if ! git rev-parse "$version" >/dev/null 2>&1; then
  git tag "$version" || exit 1
fi

git push origin "$version" || exit 1

notes_file=$(mktemp) || exit 1
awk -v ver="$version" '
  $1 == "##" && $2 == ver { capture = 1; next }
  capture && /^## / { exit }
  capture { print }
' CHANGELOG.md > "$notes_file"

notes_arg="--generate-notes"
if [[ -s "$notes_file" ]]; then
  notes_arg="--notes-file $notes_file"
fi

if gh release view "$version" >/dev/null 2>&1; then
  echo "Release $version already exists"
else
  gh release create "$version" dist/* --title "$version" $notes_arg || exit 1
fi

rm -f "$notes_file"
echo "Published $version"
