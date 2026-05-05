#!/usr/bin/env bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FEEDS_FILE="$PROJECT_DIR/data/feeds.yml"
DATA_FILE="$PROJECT_DIR/data/digest-posts.json"
TEMP_DIR=$(mktemp -d)
CACHE_DIR="$PROJECT_DIR/.digest-cache"
mkdir -p "$CACHE_DIR"
ENV_FILE="$PROJECT_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
fi
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
  jbang "$SCRIPT_DIR/DigestHelper.java" clean-all "$DATA_FILE" "$CACHE_DIR" "$FEEDS_FILE"
  exit 0
fi

find_last_date() {
  if [[ -f "$DATA_FILE" ]]; then
    grep '"date"' "$DATA_FILE" | grep -o '[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}' | sort | tail -1 || echo ""
  else
    echo ""
  fi
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

# Phase 1: scrape + enrich a single feed (no summarization yet)
enrich_feed() {
  local name="$1" daily_url="$2" target_date="$3" enriched_file="$4"

  local feed_file="$TEMP_DIR/feed-${name}-${target_date}.xml"
  echo "  [$name] Scraping..." >&2
  jbang "$SCRIPT_DIR/DigestHelper.java" tldr-articles "$daily_url" > "$feed_file"

  echo "  [$name] Enriching..." >&2
  jbang "$SCRIPT_DIR/DigestHelper.java" enrich "$feed_file" "$enriched_file" "$CACHE_DIR"
  echo "  [$name] Enriched." >&2
}

# Phase 3: summarize a single feed
summarize_feed() {
  local enriched_file="$1" name="$2" output_file="$3"

  echo "  [$name] Summarizing..." >&2
  jbang "$SCRIPT_DIR/DigestHelper.java" summarize "$enriched_file" "$name" > "$output_file"
  echo "  [$name] Done." >&2
}

generate_post() {
  local target_date="$1"

  # Check if post already exists in data file
  if [[ -f "$DATA_FILE" ]] && grep -q "\"date\": \"$target_date\"" "$DATA_FILE"; then
    echo "Post for $target_date already exists, skipping."
    return
  fi

  echo "Generating digest for $target_date..."

  # Phase 1: scrape + enrich all feeds in parallel
  local pids=()
  local enriched_files=()
  local feed_names=()
  local feed_index=0

  while IFS='|' read -r name url; do
    local daily_url
    daily_url=$(find_daily_url "$url" "$target_date")

    if [[ -z "$daily_url" ]]; then
      echo "  No daily page for $name on $target_date"
      continue
    fi

    echo "  $name: $daily_url"
    local enriched_file="$TEMP_DIR/enriched-${feed_index}-${name}.json"
    enriched_files+=("$enriched_file")
    feed_names+=("$name")
    feed_index=$((feed_index + 1))

    enrich_feed "$name" "$daily_url" "$target_date" "$enriched_file" &
    pids+=($!)
  done < <(parse_feeds)

  if [[ ${#pids[@]} -eq 0 ]]; then
    echo "  No feeds found for $target_date, skipping."
    return
  fi

  echo "  Waiting for ${#pids[@]} feeds to enrich..."
  local failed=0
  for pid in "${pids[@]}"; do
    wait "$pid" || failed=$((failed + 1))
  done
  [[ $failed -gt 0 ]] && echo "  Warning: $failed feed(s) failed enrichment" >&2

  # Phase 2: deduplicate across all enriched files
  echo "  Deduplicating across feeds..."
  jbang "$SCRIPT_DIR/DigestHelper.java" dedup "${enriched_files[@]}"

  # Phase 3: summarize all feeds in parallel (outputs JSON)
  pids=()
  local feed_outputs=()
  for i in "${!enriched_files[@]}"; do
    local output_file="$TEMP_DIR/section-${i}.json"
    feed_outputs+=("$output_file")
    summarize_feed "${enriched_files[$i]}" "${feed_names[$i]}" "$output_file" &
    pids+=($!)
  done

  echo "  Waiting for ${#pids[@]} feeds to summarize..."
  failed=0
  for pid in "${pids[@]}"; do
    wait "$pid" || failed=$((failed + 1))
  done
  [[ $failed -gt 0 ]] && echo "  Warning: $failed feed(s) failed summarization" >&2

  # Filter to non-empty section files
  local valid_sections=()
  for output_file in "${feed_outputs[@]}"; do
    [[ -s "$output_file" ]] && valid_sections+=("$output_file")
  done

  if [[ ${#valid_sections[@]} -eq 0 ]]; then
    echo "  Error: no output for $target_date" >&2
    return
  fi

  # Generate digest summary from section JSON files
  echo "  Generating digest summary..."
  local digest_desc
  digest_desc=$(cat "${valid_sections[@]}" | timeout 120 claude -p "Write a 1-2 sentence summary of the most important news for developers from these sections. Output ONLY the text, no quotes, no prefix." 2>/dev/null) || digest_desc=""
  [[ -z "$digest_desc" ]] && digest_desc="Daily developer news digest"
  digest_desc="${digest_desc//\"/}"
  digest_desc="${digest_desc//\\/}"

  # Extract first image from section JSON
  local post_image
  post_image=$(grep -h '"image"' "${valid_sections[@]}" 2>/dev/null | head -1 | sed 's/.*"image": *"//; s/".*//' || echo "")

  local title_date
  title_date=$(LC_ALL=en_US.UTF-8 date -j -f "%Y-%m-%d" "$target_date" "+%B %d, %Y" 2>/dev/null \
    || date -d "$target_date" "+%B %d, %Y" 2>/dev/null \
    || echo "$target_date")

  # Add post to data file via DigestHelper
  local image_args=""
  [[ -n "$post_image" ]] && image_args="--image $post_image"

  jbang "$SCRIPT_DIR/DigestHelper.java" add-post \
    --data-file "$DATA_FILE" \
    --date "$target_date" \
    --title "Devoured - ${title_date}" \
    --description "${digest_desc}" \
    $image_args \
    "${valid_sections[@]}"

  echo "  Writing article content files..."
  jbang "$SCRIPT_DIR/DigestHelper.java" write-content "$DATA_FILE" "$target_date" "$CACHE_DIR" "$FEEDS_FILE"

  echo "  Syncing new tags..."
  jbang "$SCRIPT_DIR/DigestHelper.java" sync-tags "$DATA_FILE" "$FEEDS_FILE"

  echo "  Added post for $target_date"
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
if git diff --quiet data/digest-posts.json 2>/dev/null && git diff --cached --quiet data/digest-posts.json 2>/dev/null; then
  echo "No changes to commit."
  exit 0
fi

git add data/digest-posts.json
git commit -m "feat: add dev digest posts"

if [[ "$NO_PUSH" == true ]]; then
  echo "Committed. Skipping push (--no-push)."
else
  git push
  echo "Pushed to remote."
fi
