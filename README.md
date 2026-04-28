# Dev Digest

A personalized daily tech digest that aggregates [TLDR](https://tldr.tech/) newsletters, enriches articles with AI-generated summaries, and publishes them as a static site.

Built with [Roq](https://iamroq.dev/) (Quarkus-powered static site generator).

## How it works

1. **Fetch** articles from TLDR RSS feeds (AI, Tech, DevOps, Data, Design, Crypto) using a JBang/Playwright pipeline
2. **Summarize** each article with a structured What / Why it matters / Takeaway format
3. **Tag and prioritize** articles by topic relevance (configurable in `data/feeds.yml`)
4. **Publish** as a static site with expandable deep-dives and original article links

## Running locally

```shell
./mvnw quarkus:dev
```

The site is served at http://localhost:8080 with live reload.

## Project structure

```
content/digest-posts/   Digest entries (one per day, Qute/YAML frontmatter)
data/feeds.yml          RSS feed sources and tag priority configuration
templates/layouts/      Qute page templates
web/                    CSS and client-side JS (priority sorting)
config/                 Quarkus/Roq configuration
```

## Configuration

Edit `data/feeds.yml` to customize:

- **feeds**: which TLDR newsletters to aggregate
- **tag-priorities**: numeric priority per tag (1 = highest, 4 = lowest) to control article ordering
