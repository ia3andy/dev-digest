#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FEEDS_FILE="$PROJECT_DIR/data/feeds.yml"
PROMPT_FILE="$SCRIPT_DIR/prompt-template.md"
POSTS_DIR="$PROJECT_DIR/content/digest-posts"
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

# Parse arguments
TARGET_DATE=""
DRY_RUN=false
NO_PUSH=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --date) TARGET_DATE="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    --no-push) NO_PUSH=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Find last processed date from existing posts
find_last_date() {
  ls -d "$POSTS_DIR"/*-dev-digest 2>/dev/null \
    | sort \
    | tail -1 \
    | grep -o '[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}' \
    || echo ""
}

# Get yesterday's date (cross-platform)
yesterday() {
  if [[ "$(uname)" == "Darwin" ]]; then
    date -v-1d +%Y-%m-%d
  else
    date -d "yesterday" +%Y-%m-%d
  fi
}

# Add N days to a date (cross-platform)
date_add() {
  local base_date="$1"
  local days="$2"
  if [[ "$(uname)" == "Darwin" ]]; then
    date -j -v+"${days}d" -f "%Y-%m-%d" "$base_date" +%Y-%m-%d
  else
    date -d "$base_date + $days days" +%Y-%m-%d
  fi
}

# Compare dates: returns 0 if $1 <= $2
date_le() {
  [[ "$1" < "$2" ]] || [[ "$1" == "$2" ]]
}

# Extract feed names and URLs from feeds.yml
parse_feeds() {
  grep -A1 "^  - name:" "$FEEDS_FILE" \
    | paste - - \
    | sed 's/.*name: *//; s/ *url: */|/' \
    | tr -d '"'
}

# Fetch RSS and filter articles by date
fetch_feed() {
  local name="$1"
  local url="$2"
  local target_date="$3"
  local output_file="$4"

  local rss_content
  rss_content=$(curl -s --max-time 30 "$url" 2>/dev/null || echo "")

  if [[ -z "$rss_content" ]]; then
    echo "  Warning: failed to fetch $name ($url)" >&2
    return
  fi

  echo "--- FEED: $name ---" >> "$output_file"
  echo "$rss_content" >> "$output_file"
  echo "" >> "$output_file"
}

# Generate a post for a single date
generate_post() {
  local target_date="$1"
  local post_dir="$POSTS_DIR/${target_date}-dev-digest"

  if [[ -d "$post_dir" ]]; then
    echo "Post for $target_date already exists, skipping."
    return
  fi

  echo "Generating digest for $target_date..."

  # Fetch all feeds
  local combined_file="$TEMP_DIR/feeds-${target_date}.xml"
  > "$combined_file"

  while IFS='|' read -r name url; do
    echo "  Fetching $name..."
    fetch_feed "$name" "$url" "$target_date" "$combined_file"
  done < <(parse_feeds)

  if [[ ! -s "$combined_file" ]]; then
    echo "  No feed content fetched for $target_date, skipping."
    return
  fi

  # Call Claude CLI
  echo "  Summarizing with Claude..."
  local prompt
  prompt=$(cat "$PROMPT_FILE")

  local claude_output
  claude_output=$(cat "$combined_file" | claude -p "$prompt

Process the RSS feeds above for date: $target_date
Output ONLY the YAML sections array, nothing else." 2>/dev/null) || {
    echo "  Error: Claude CLI failed for $target_date" >&2
    return
  }

  if [[ -z "$claude_output" ]]; then
    echo "  Error: empty Claude output for $target_date" >&2
    return
  fi

  # Clean up Claude output (remove markdown fences if present)
  claude_output=$(echo "$claude_output" | sed '/^```/d')

  # Format the date in French for the title
  local title_date
  title_date=$(LC_ALL=fr_FR.UTF-8 date -j -f "%Y-%m-%d" "$target_date" "+%d %B %Y" 2>/dev/null \
    || date -d "$target_date" "+%d %B %Y" 2>/dev/null \
    || echo "$target_date")

  # Write post
  mkdir -p "$post_dir"
  cat > "$post_dir/index.md" <<FRONTMATTER
---
title: "Dev Digest - ${title_date}"
layout: digest-post
date: ${target_date}
tags: digest
author: ia3andy
${claude_output}
---
FRONTMATTER

  echo "  Written to $post_dir/index.md"
}

# Main flow
if [[ -n "$TARGET_DATE" ]]; then
  generate_post "$TARGET_DATE"
else
  LAST_DATE=$(find_last_date)
  END_DATE=$(yesterday)

  if [[ -z "$LAST_DATE" ]]; then
    echo "No existing posts found. Generating for yesterday ($END_DATE)."
    generate_post "$END_DATE"
  else
    START_DATE=$(date_add "$LAST_DATE" 1)
    if date_le "$START_DATE" "$END_DATE"; then
      echo "Backfilling from $START_DATE to $END_DATE..."
      current="$START_DATE"
      while date_le "$current" "$END_DATE"; do
        generate_post "$current"
        current=$(date_add "$current" 1)
      done
    else
      echo "Already up to date (last post: $LAST_DATE)."
    fi
  fi
fi

# Git operations
if [[ "$DRY_RUN" == true ]]; then
  echo "Dry run: skipping git operations."
  exit 0
fi

cd "$PROJECT_DIR"
if git diff --quiet content/digest-posts/ 2>/dev/null && git diff --cached --quiet content/digest-posts/ 2>/dev/null; then
  # Check for new untracked files
  if [[ -z "$(git ls-files --others --exclude-standard content/digest-posts/)" ]]; then
    echo "No changes to commit."
    exit 0
  fi
fi

git add content/digest-posts/
git commit -m "feat: add dev digest posts"

if [[ "$NO_PUSH" == true ]]; then
  echo "Committed. Skipping push (--no-push)."
else
  git push
  echo "Pushed to remote."
fi
