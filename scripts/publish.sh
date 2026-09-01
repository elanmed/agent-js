#!/bin/bash

./scripts/compile.sh || exit 1

version="v$(node -p "require('./package.json').version")" || exit 1
echo "Publishing $version..."

if ! git rev-parse "$version" >/dev/null 2>&1; then
  git tag "$version" || exit 1
fi

git push origin "$version" || exit 1

# extract the first changelog section for the release notes
#   /^## /  - match a `## ` section heading
#   c++     - count headings seen
#   c > 1   - second heading means the first section is over
#   exit    - stop reading
#   next    - skip the heading line itself
#   c       - print lines while the counter is 1
notes="$(awk '/^## / { c++; if (c > 1) exit; next } c' CHANGELOG.md)" || exit 1

if gh release view "$version" >/dev/null 2>&1; then
  echo "Release $version already exists"
else
  gh release create "$version" dist/* --title "$version" --notes "$notes" || exit 1
fi

echo "Published $version"
