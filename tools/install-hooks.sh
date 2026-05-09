#!/bin/sh
# Install the repo's git hooks into .git/hooks. Run once after cloning.
#
# Installs a pre-commit hook that auto-bumps the ?v=... cache-bust token
# in index.html whenever a relevant source file is being committed. The
# token is a UTC timestamp, so it's unique per commit even when amending,
# and committed alongside the source change in a single revision.
#
# Usage: tools/install-hooks.sh

set -e
cd "$(git rev-parse --show-toplevel)"

mkdir -p .git/hooks

cat > .git/hooks/pre-commit <<'EOF'
#!/bin/sh
# Auto-bump cache-bust ?v= when JS/CSS sources or index.html itself are
# part of this commit. Skip otherwise (docs/test-only commits don't need
# a new asset version).
if git diff --cached --name-only | grep -qE '^(src/|style\.css$|index\.html$)'; then
    sh tools/bump-cache.sh
    git add index.html
fi
EOF
chmod +x .git/hooks/pre-commit

# Remove any leftover pre-push hook from earlier iterations of this setup.
[ -f .git/hooks/pre-push ] && rm -f .git/hooks/pre-push

echo "Installed pre-commit hook → .git/hooks/pre-commit"
