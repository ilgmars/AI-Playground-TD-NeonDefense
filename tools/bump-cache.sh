#!/bin/sh
# Bump the ?v=<sha> cache-bust query string on every <script>/<link> tag in
# index.html to the current git short SHA.
#
# Run this BEFORE `git push` so the just-deployed HTML carries fresh
# query-string versions on its asset references — that way every visitor
# whose browser revalidates the HTML (~10 min after a deploy on GitHub
# Pages) immediately re-fetches the JS/CSS instead of pulling the stale
# 1-hour-cached copies.
#
# Usage: tools/bump-cache.sh
# Hooked from .git/hooks/pre-push by tools/install-hooks.sh.

set -e
cd "$(git rev-parse --show-toplevel)"

NEW=$(git rev-parse --short HEAD)
# Match an existing ?v=<7+hex> and replace; works for the link and every script tag.
sed -i "s/?v=[0-9a-f]\{7,\}/?v=$NEW/g" index.html

if git diff --quiet index.html; then
    echo "bump-cache: index.html already at v=$NEW"
else
    echo "bump-cache: index.html updated to v=$NEW"
    git add index.html
fi
