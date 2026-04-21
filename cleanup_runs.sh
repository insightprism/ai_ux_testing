#!/bin/bash

# Keep the 100 newest screenshots in runs/. Older shots (and run folders
# that end up empty) are deleted.
#
# Usage:
#   ./cleanup_runs.sh           # keep 100 (default)
#   KEEP=50 ./cleanup_runs.sh   # keep 50 instead

set -e

KEEP=${KEEP:-100}
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNS_DIR="$SCRIPT_DIR/ux_testing/runs"

if [ ! -d "$RUNS_DIR" ]; then
    echo "No runs/ directory found at $RUNS_DIR — nothing to clean."
    exit 0
fi

cd "$RUNS_DIR"

total=$(find . -type f -name "*.png" | wc -l)
echo "Current screenshots: $total"
echo "Keep newest:         $KEEP"

if [ "$total" -le "$KEEP" ]; then
    echo "Under limit — nothing to do."
    exit 0
fi

to_delete=$((total - KEEP))
echo "Deleting $to_delete oldest screenshot(s)..."

# List every PNG by mtime oldest-first, take the first $to_delete, delete them.
find . -type f -name "*.png" -printf '%T@ %p\n' \
    | sort -n \
    | head -n "$to_delete" \
    | cut -d' ' -f2- \
    | xargs -r rm -f

# Sweep run folders that are now empty of screenshots — EXCEPT reviewed runs
# (folders containing result.json). Reviewed runs are the audit trail behind
# a baseline; deleting them would break reproducibility.
removed_dirs=0
kept_reviewed=0
for dir in */; do
    [ -d "$dir" ] || continue
    png_count=$(find "$dir" -maxdepth 1 -type f -name "*.png" | wc -l)
    if [ "$png_count" -eq 0 ]; then
        if [ -f "$dir/result.json" ]; then
            kept_reviewed=$((kept_reviewed + 1))
            continue
        fi
        rm -rf "$dir"
        removed_dirs=$((removed_dirs + 1))
    fi
done

remaining=$(find . -type f -name "*.png" | wc -l)
echo "Done. Screenshots remaining: $remaining. Empty run folders removed: $removed_dirs. Reviewed runs preserved: $kept_reviewed."
