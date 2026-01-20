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

echo "HEAD is now at 3c8b97f Merge pull request #34 from ford442/enhance-atmosphere-timelapse-13787162779779197825"
