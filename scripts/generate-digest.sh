#!/usr/bin/env bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FEEDS_FILE="$PROJECT_DIR/data/feeds.yml"
PROMPT_FILE="$SCRIPT_DIR/prompt-template.md"
POSTS_DIR="$PROJECT_DIR/content/digest-posts"
TEMP_DIR=$(mktemp -d)
CACHE_DIR="$PROJECT_DIR/.digest-cache"
mkdir -p "$CACHE_DIR"
trap 'rm -rf "$TEMP_DIR"' EXIT

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

find_last_date() {
  ls -d "$POSTS_DIR"/*-dev-digest 2>/dev/null \
    | sort \
    | tail -1 \
    | grep -o '[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}' \
    || echo ""
}

yesterday() {
  if [[ "$(uname)" == "Darwin" ]]; then
    date -v-1d +%Y-%m-%d
  else
    date -d "yesterday" +%Y-%m-%d
  fi
}

date_add() {
  local base_date="$1" days="$2"
  if [[ "$(uname)" == "Darwin" ]]; then
    date -j -v+"${days}d" -f "%Y-%m-%d" "$base_date" +%Y-%m-%d
  else
    date -d "$base_date + $days days" +%Y-%m-%d
  fi
}

date_le() {
  [[ "$1" < "$2" ]] || [[ "$1" == "$2" ]]
}

parse_feeds() {
  grep -A1 "^  - name:" "$FEEDS_FILE" \
    | paste - - \
    | sed 's/.*name: *//; s/ *url: */|/' \
    | tr -d '"' \
    | sed 's/[[:space:]]*|/|/; s/|[[:space:]]*/|/'
}

find_daily_url() {
  local rss_url="$1" target_date="$2"

  local rss_content
  rss_content=$(curl -s --max-time 30 "$rss_url" 2>/dev/null || echo "")
  if [[ -z "$rss_content" ]]; then
    echo ""
    return
  fi

  echo "$rss_content" \
    | grep -o '<guid[^>]*>[^<]*</guid>' \
    | sed 's/<guid[^>]*>//;s/<\/guid>//' \
    | grep "$target_date" \
    | head -1
}

generate_post() {
  local target_date="$1"
  local post_dir="$POSTS_DIR/${target_date}-dev-digest"

  if [[ -d "$post_dir" ]]; then
    echo "Post for $target_date already exists, skipping."
    return
  fi

  echo "Generating digest for $target_date..."

  local combined_file="$TEMP_DIR/feeds-${target_date}.xml"
  > "$combined_file"

  local found_content=false

  while IFS='|' read -r name url; do
    echo "  Fetching $name feed..."

    local daily_url
    daily_url=$(find_daily_url "$url" "$target_date")

    if [[ -z "$daily_url" ]]; then
      echo "    No daily page found for $name on $target_date" >&2
      continue
    fi

    echo "    Daily page: $daily_url"
    echo "--- FEED: $name ---" >> "$combined_file"
    jbang "$SCRIPT_DIR/DigestHelper.java" tldr-articles "$daily_url" >> "$combined_file"
    found_content=true
  done < <(parse_feeds)

  if [[ "$found_content" != true ]] || [[ ! -s "$combined_file" ]]; then
    echo "  No feed content fetched for $target_date, skipping."
    return
  fi

  echo "  Enriching with article content..."
  local enriched_file="$TEMP_DIR/enriched-${target_date}.xml"
  jbang "$SCRIPT_DIR/DigestHelper.java" enrich "$combined_file" "$enriched_file" "$CACHE_DIR"

  echo "  Summarizing with Claude..."
  local prompt
  prompt=$(cat "$PROMPT_FILE")

  local claude_output
  claude_output=$(claude -p "$prompt

Process the RSS feeds above for date: $target_date
Output ONLY the YAML sections array, nothing else." < "$enriched_file" 2>/dev/null) || {
    echo "  Error: Claude CLI failed for $target_date" >&2
    return
  }

  if [[ -z "$claude_output" ]]; then
    echo "  Error: empty Claude output for $target_date" >&2
    return
  fi

  claude_output=$(echo "$claude_output" | sed '/^```/d')

  local digest_desc
  digest_desc=$(echo "$claude_output" | grep '^digest-summary:' | sed 's/^digest-summary: *//; s/^"//; s/"$//')
  if [[ -z "$digest_desc" ]]; then
    digest_desc="Daily developer news digest"
  fi

  local post_image
  post_image=$(echo "$claude_output" | grep '^ *image:' | head -1 | sed 's/.*image: *//; s/^"//; s/"$//')

  claude_output=$(echo "$claude_output" | grep -v '^digest-summary:')

  local title_date
  title_date=$(LC_ALL=en_US.UTF-8 date -j -f "%Y-%m-%d" "$target_date" "+%B %d, %Y" 2>/dev/null \
    || date -d "$target_date" "+%B %d, %Y" 2>/dev/null \
    || echo "$target_date")

  mkdir -p "$post_dir"
  local image_line=""
  if [[ -n "$post_image" ]]; then
    image_line="image: \"${post_image}\""
  fi
  cat > "$post_dir/index.md" <<FRONTMATTER
---
title: "Dev Digest - ${title_date}"
description: "${digest_desc}"
layout: digest-post
date: ${target_date}
tags: digest
author: ia3andy
${image_line}
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

if [[ "$DRY_RUN" == true ]]; then
  echo "Dry run: skipping git operations."
  exit 0
fi

cd "$PROJECT_DIR"
if git diff --quiet content/digest-posts/ 2>/dev/null && git diff --cached --quiet content/digest-posts/ 2>/dev/null; then
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
