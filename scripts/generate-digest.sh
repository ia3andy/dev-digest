#!/usr/bin/env bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FEEDS_FILE="$PROJECT_DIR/data/feeds.yml"
POSTS_DIR="$PROJECT_DIR/content/digest-posts"
TEMP_DIR=$(mktemp -d)
CACHE_DIR="$PROJECT_DIR/.digest-cache"
mkdir -p "$CACHE_DIR"
trap 'rm -rf "$TEMP_DIR"' EXIT

TARGET_DATE=""
DRY_RUN=false
NO_PUSH=false
CLEAN_ALL=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --date) TARGET_DATE="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    --no-push) NO_PUSH=true; shift ;;
    --clean-all) CLEAN_ALL=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [[ "$CLEAN_ALL" == true ]]; then
  echo "Re-cleaning all posts..."
  jbang "$SCRIPT_DIR/DigestHelper.java" clean-all "$POSTS_DIR" "$CACHE_DIR" "$FEEDS_FILE"
  exit 0
fi

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

# Scrape, enrich, and summarize a single feed. Writes YAML output to $4.
summarize_feed() {
  local name="$1" daily_url="$2" target_date="$3" output_file="$4"

  local feed_file="$TEMP_DIR/feed-${name}-${target_date}.xml"
  echo "  [$name] Scraping..." >&2
  jbang "$SCRIPT_DIR/DigestHelper.java" tldr-articles "$daily_url" > "$feed_file"

  echo "  [$name] Enriching..." >&2
  local enriched_file="$TEMP_DIR/enriched-${name}-${target_date}.json"
  jbang "$SCRIPT_DIR/DigestHelper.java" enrich "$feed_file" "$enriched_file" "$CACHE_DIR"

  echo "  [$name] Summarizing..." >&2
  jbang "$SCRIPT_DIR/DigestHelper.java" summarize "$enriched_file" "$name" > "$output_file"
  echo "  [$name] Done." >&2
}

generate_post() {
  local target_date="$1"
  local post_dir="$POSTS_DIR/${target_date}-dev-digest"

  if [[ -d "$post_dir" ]]; then
    echo "Post for $target_date already exists, skipping."
    return
  fi

  echo "Generating digest for $target_date..."

  # Launch each feed in parallel: scrape + enrich + summarize
  local pids=()
  local feed_outputs=()
  local feed_index=0

  while IFS='|' read -r name url; do
    local daily_url
    daily_url=$(find_daily_url "$url" "$target_date")

    if [[ -z "$daily_url" ]]; then
      echo "  No daily page for $name on $target_date"
      continue
    fi

    echo "  $name: $daily_url"
    local output_file="$TEMP_DIR/section-${feed_index}.yml"
    feed_outputs+=("$output_file")
    feed_index=$((feed_index + 1))

    summarize_feed "$name" "$daily_url" "$target_date" "$output_file" &
    pids+=($!)
  done < <(parse_feeds)

  if [[ ${#pids[@]} -eq 0 ]]; then
    echo "  No feeds found for $target_date, skipping."
    return
  fi

  echo "  Waiting for ${#pids[@]} feeds..."
  local failed=0
  for pid in "${pids[@]}"; do
    wait "$pid" || failed=$((failed + 1))
  done
  [[ $failed -gt 0 ]] && echo "  Warning: $failed feed(s) failed" >&2

  # Combine sections
  local all_sections=""
  for output_file in "${feed_outputs[@]}"; do
    [[ -s "$output_file" ]] && all_sections+="$(cat "$output_file")"$'\n'
  done

  if [[ -z "$all_sections" ]]; then
    echo "  Error: no output for $target_date" >&2
    return
  fi

  # Generate digest summary
  echo "  Generating digest summary..."
  local digest_desc
  digest_desc=$(echo "$all_sections" | timeout 120 claude -p "Write a 1-2 sentence summary of the most important news for developers from these sections. Output ONLY the text, no quotes, no prefix." 2>/dev/null) || digest_desc=""
  [[ -z "$digest_desc" ]] && digest_desc="Daily developer news digest"
  digest_desc="${digest_desc//\"/\'}"

  local claude_output="sections:"$'\n'"$all_sections"

  local post_image
  post_image=$(echo "$claude_output" | grep '^ *image:' | head -1 | sed 's/.*image: *//; s/^"//; s/"$//')

  local title_date
  title_date=$(LC_ALL=en_US.UTF-8 date -j -f "%Y-%m-%d" "$target_date" "+%B %d, %Y" 2>/dev/null \
    || date -d "$target_date" "+%B %d, %Y" 2>/dev/null \
    || echo "$target_date")

  mkdir -p "$post_dir"
  local image_line=""
  [[ -n "$post_image" ]] && image_line="image: \"${post_image}\""

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

  echo "  Writing article content files..."
  jbang "$SCRIPT_DIR/DigestHelper.java" write-content "$post_dir/index.md" "$CACHE_DIR" "$FEEDS_FILE"

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
