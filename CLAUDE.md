# Dev Digest

A daily developer news digest site built with [Roq](https://iamroq.dev), a static site generator powered by Quarkus and Qute templates.

## Dev Server

```bash
roq start
```

Starts live-reload dev server on http://localhost:8080. Content and template changes are auto-detected. Press `s` to force a soft restart if needed.

Other commands: `roq generate` (build to `target/roq/`), `roq serve` (preview built site), `roq update` (update deps to latest), `roq add plugin:name` (add a plugin).

## Project Structure

```
content/                    # Pages and collections
  index.html                # Home page
  digest-posts/             # Digest collection (one dir per day)
    2026-04-28-dev-digest/
      index.md              # YAML frontmatter + markdown body
  digest-articles/           # Article pages collection (generated)
    2026-04-28/
      ai-1.html             # Individual article page
config/
  application.properties    # Roq/Quarkus config
data/                       # YAML/JSON data files
  feeds.yml                 # Feed sources config
  authors.yml
  menu.yml
templates/
  layouts/                  # Page layouts (Qute)
    digest-home.html        # Home/index layout
    digest-post.html        # Individual digest post layout
  partials/
    digest-articles.html    # Article rendering partial
    digest-article.html     # Single article page layout
public/images/              # Static assets
web/                        # CSS/JS (bundled by Quarkus Web Bundler)
  _custom.css
scripts/
  DigestHelper.java         # JBang script for digest pipeline
  generate-digest.sh        # Shell orchestrator
```

## Digest Post Format

Each post in `content/digest-posts/` has YAML frontmatter with sections and articles:

```yaml
---
title: "Dev Digest - April 28, 2026"
layout: digest-post
sections:
  - name: AI
    articles:
      - id: unique-id
        title: "Article Title"
        link: https://example.com
        description: "Original description"
        tags: [ai, llm]
        one-liner: "AI-generated hook"
        summary:
          what: "What this is about"
          why: "Why it matters"
          takeaway: "What to do next"
---
Markdown body content
```

## Digest Pipeline (scripts/DigestHelper.java)

JBang script with Picocli subcommands. Run with `jbang scripts/DigestHelper.java <command>`.

Commands:
- `tldr-articles <url>` - scrape TLDR newsletter, output JSON to stdout
- `enrich <input.json> <output.json> <cacheDir>` - fetch article content, cache locally
- `summarize <enriched.json> <feedName>` - call Claude for AI summaries, output to stdout
- `write-content <index.md> <cacheDir> <feeds.yml>` - write post content from data
- `resummarize <postDir> <cacheDir>` - re-summarize a post (supports stop/resume via backup dirs)
- `resummarize-all <postsDir> <cacheDir>` - re-summarize all posts
- `clean-all <postsDir> <cacheDir> <feeds.yml>` - clean all posts
- `refresh-html <postsDir> <cacheDir>` - refresh cached HTML
- `sync-tags <postsDir> <feeds.yml>` - synchronize tags
- `generate-pages <postDir|postsDir> <articlesDir>` - generate article page files for sharing

Use `--help` on any command for parameter details.

### Resume behavior

`resummarize` backs up the post dir to `_<dirname>` before processing. If interrupted, re-run the same command to resume (skips articles that already have `one-liner`). Backup is cleaned up when all articles are done.

### Logs and costs

- `.digest-logs/` - per-post logs and `costs.log` with cumulative cost tracking
- Logs include timestamps, article counts, failure diagnostics, and per-session cost

## Roq Essentials

### Templates (Qute)

```html
{page.title}                              {! expression !}
{#if page.image}...{/if}                  {! conditional !}
{#for post in site.collections.posts}     {! loop !}
{#include partials/header /}              {! include partial !}
{#insert /}                               {! layout insertion point !}
{site.url('posts/my-post')}               {! URL resolution !}
{cdi:feeds}                               {! data file access !}
{page.date.format('yyyy, MMM dd')}        {! date formatting !}
```

### Layouts

Use `layout: name` in frontmatter for layout chain. Layouts use `{#insert /}` for child content (never `{page.content}`).

### Data files

YAML/JSON in `data/` become CDI beans: `{cdi:feeds}`, `{cdi:authors}`.

### Collections

Configured in `application.properties`: `site.collections.digest-posts=true`. Iterate with `{#for post in site.collections.digest-posts}`.

### Updating Roq skills

After updating Roq version, re-extract skill files from deployment JARs:
```bash
unzip -p ~/.m2/repository/io/quarkiverse/roq/ARTIFACT-deployment/VERSION/ARTIFACT-deployment-VERSION.jar META-INF/quarkus-skill.md > .claude/skills/SHORT_NAME.md
```

### Key references

- Roq LLM reference: https://iamroq.dev/llms.txt
- Roq docs: https://iamroq.dev/docs/
- Qute reference: https://quarkus.io/guides/qute-reference
