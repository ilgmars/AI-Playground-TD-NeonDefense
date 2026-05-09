#!/bin/sh
# Install the repo's git hooks into .git/hooks. Run once after cloning.
#
# Usage: tools/install-hooks.sh

set -e
cd "$(git rev-parse --show-toplevel)"

mkdir -p .git/hooks

cat > .git/hooks/pre-push <<'EOF'
#!/bin/sh
# Auto-bump the cache-bust query string on every push so deployed assets
# re-fetch on the next visitor reload. If the bump produced staged changes,
# warn the dev so they can amend before the push goes out.
sh tools/bump-cache.sh
if ! git diff --cached --quiet index.html 2>/dev/null; then
    echo "pre-push: index.html cache-bust was bumped — amend the last commit:"
    echo "         git commit --amend --no-edit && git push"
    exit 1
fi
EOF
chmod +x .git/hooks/pre-push

echo "Installed pre-push hook → .git/hooks/pre-push"
