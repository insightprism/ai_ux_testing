#!/bin/bash

# Keep the FLOW_KEEP_NEWEST_SCREENSHOT_COUNT newest .png files and
# FLOW_KEEP_NEWEST_VIDEO_COUNT newest .webm files under flow_runs/.
# Preserves any folder containing flow_report.json (reviewed runs).

set -e

KEEP_SCREENSHOTS=${FLOW_KEEP_NEWEST_SCREENSHOT_COUNT:-100}
KEEP_VIDEOS=${FLOW_KEEP_NEWEST_VIDEO_COUNT:-20}

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNS_DIR="$SCRIPT_DIR/flow_review/flow_runs"

if [ ! -d "$RUNS_DIR" ]; then
    echo "No flow_runs/ — nothing to clean."
    exit 0
fi

cd "$RUNS_DIR"

totalScreenshots=$(find . -type f -name "*.png" | wc -l)
totalVideos=$(find . -type f -name "*.webm" | wc -l)
echo "Screenshots: $totalScreenshots (keep newest $KEEP_SCREENSHOTS)"
echo "Videos:      $totalVideos (keep newest $KEEP_VIDEOS)"

trim_by_extension() {
    local extension="$1"
    local keepCount="$2"
    local total
    total=$(find . -type f -name "*.${extension}" | wc -l)
    if [ "$total" -le "$keepCount" ]; then return 0; fi
    local toDelete=$((total - keepCount))
    echo "Deleting $toDelete oldest .${extension} file(s)..."
    find . -type f -name "*.${extension}" -printf '%T@ %p\n' \
        | sort -n \
        | head -n "$toDelete" \
        | cut -d' ' -f2- \
        | xargs -r rm -f
}

trim_by_extension png "$KEEP_SCREENSHOTS"
trim_by_extension webm "$KEEP_VIDEOS"

preservedReviewed=0
removedEmptyRunFolders=0
for dir in */; do
    [ -d "$dir" ] || continue
    pngCount=$(find "$dir" -maxdepth 1 -type f -name "*.png" | wc -l)
    webmCount=$(find "$dir" -maxdepth 1 -type f -name "*.webm" | wc -l)
    if [ "$pngCount" -eq 0 ] && [ "$webmCount" -eq 0 ]; then
        if [ -f "$dir/flow_report.json" ]; then
            preservedReviewed=$((preservedReviewed + 1))
            continue
        fi
        rm -rf "$dir"
        removedEmptyRunFolders=$((removedEmptyRunFolders + 1))
    fi
done

remainingPng=$(find . -type f -name "*.png" | wc -l)
remainingWebm=$(find . -type f -name "*.webm" | wc -l)
echo "Done. PNGs remaining: $remainingPng. WebMs remaining: $remainingWebm. Empty folders removed: $removedEmptyRunFolders. Reviewed preserved: $preservedReviewed."
