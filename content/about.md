---
title: About
description: Daily developer news digest, AI-curated from TLDR newsletters
layout: page
---

# About Devoured

A daily developer news digest built with [Roq](https://iamroq.dev). Each day, a script fetches TLDR newsletters (AI, Tech, DevOps, Data, Design, Crypto, Founders), summarizes them using Claude, and publishes the result as a blog post.

The summaries are structured with three distinct perspectives per article: the fact, why it matters, and a concrete takeaway.

## Authors

<div class="authors">
  {#for id in cdi:authors.fields}
    {#let author=cdi:authors.get(id)}
    {#roq/authorCard name=author.name avatar=author.avatar nickname=author.nickname profile=author.profile /}
  {/for}
</div>

