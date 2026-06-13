#!/bin/sh
# Bump the ?v=<token> cache-bust query string on every <script>/<link>
# tag in index.html so a fresh deploy invalidates the previous JS/CSS in
# every visitor's browser as soon as their browser revalidates the HTML
# (worst case ~10 min on GitHub Pages, after which everyone re-fetches).
#
# Token format: YYYYMMDDHHMMSS — guaranteed-unique per second, doesn't
# depend on the upcoming commit's SHA (which lets this run from a
# pre-commit hook without the amend loop git-SHA tokens cause).
#
# Usage: tools/bump-cache.sh
# Auto-invoked by .git/hooks/pre-commit (see tools/install-hooks.sh).

set -e
cd "$(git rev-parse --show-toplevel)"

NEW=$(date -u +%Y%m%d%H%M%S)
# Match any existing ?v=<token> (alphanumeric, 6+ chars) and replace.
sed -i "s/?v=[0-9a-zA-Z]\{6,\}/?v=$NEW/g" index.html

if git diff --quiet index.html; then
    echo "bump-cache: index.html already at v=$NEW"
else
    echo "bump-cache: index.html updated to v=$NEW"
fi

# Keep version.json's build token in lock-step with the cache-bust token.
# The APK reads this manifest (bundled vs the live copy on main) to decide
# whether a newer release is available; the mobile-web link uses none of it.
if [ -f version.json ]; then
    sed -i "s/\"build\"[[:space:]]*:[[:space:]]*\"[0-9a-zA-Z]\{6,\}\"/\"build\": \"$NEW\"/" version.json
    echo "bump-cache: version.json build set to $NEW"
fi
