#!/usr/bin/env bash
set -euo pipefail

# Reset working tree to a clean state
echo "Resetting working tree..."

# Confirm with the user before performing destructive operations
read -p "Are you sure you want to reset the working tree? This will discard all local changes. (y/N): " confirm
case "$confirm" in
  [yY]|[yY][eE][sS])
    echo "Proceeding with reset..."
    ;;
  *)
    echo "Aborted by user. No changes made."
    exit 0
    ;;
esac

# Perform the reset and clean
git reset --hard
git clean -fd

git log -1 --format="HEAD is now at %h %s"
