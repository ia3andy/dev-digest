///usr/bin/env jbang "$0" "$@" ; exit $?
//DEPS com.microsoft.playwright:playwright:1.49.0
//DEPS com.google.code.gson:gson:2.11.0

import com.microsoft.playwright.*;
import com.microsoft.playwright.options.*;
import com.google.gson.*;
import java.io.*;
import java.nio.file.*;
import java.security.*;
import java.util.*;
import java.util.regex.*;

public class DigestHelper {

    public static void main(String[] args) throws Exception {
        if (args.length < 2) {
            System.err.println("Usage: DigestHelper <command> <args...>");
            System.err.println("Commands:");
            System.err.println("  tldr-articles <url>              Scrape TLDR daily page into RSS items");
            System.err.println("  enrich <input> <output> <cache>  Enrich articles with og:image and content");
            System.exit(1);
        }
        switch (args[0]) {
            case "tldr-articles" -> tldrArticles(args[1]);
            case "enrich" -> enrich(args[1], args[2], args[3]);
            default -> {
                System.err.println("Unknown command: " + args[0]);
                System.exit(1);
            }
        }
    }

    static void tldrArticles(String url) {
        try (Playwright pw = Playwright.create()) {
            Browser browser = pw.chromium().launch(new BrowserType.LaunchOptions()
                    .setChannel("chrome")
                    .setHeadless(false));
            Page page = browser.newPage();
            page.navigate(url, new Page.NavigateOptions()
                    .setWaitUntil(WaitUntilState.LOAD)
                    .setTimeout(30000));
            page.waitForSelector("article", new Page.WaitForSelectorOptions().setTimeout(15000));

            String h1Text = page.locator("h1").first().textContent();
            String feedName = h1Text.replaceAll("TLDR\\s+", "").replaceAll("\\s+\\d{4}-.*", "").trim();

            var sections = page.querySelectorAll("section");
            for (var section : sections) {
                var headerEl = section.querySelector("header h3");
                if (headerEl == null) continue;
                String sectionName = headerEl.textContent().trim();
                if (sectionName.isEmpty()) continue;

                var articles = section.querySelectorAll("article");
                boolean sectionHeaderPrinted = false;

                for (var article : articles) {
                    var titleLink = article.querySelector("a.font-bold");
                    if (titleLink == null) continue;

                    String title = titleLink.textContent().trim();
                    String link = titleLink.getAttribute("href");
                    if (link == null || link.isEmpty()) continue;
                    if (title.toLowerCase().contains("(sponsor)")) continue;
                    if (link.contains("jobs.ashbyhq.com") || link.contains("jobs.lever.co")) continue;

                    if (title.length() < 3) {
                        title = titleFromUrl(link);
                        if (title.isEmpty()) continue;
                    }

                    var descEl = article.querySelector(".newsletter-html");
                    String description = descEl != null ? descEl.textContent().trim() : "";

                    if (!sectionHeaderPrinted) {
                        System.out.println("--- SECTION: " + sectionName + " ---");
                        sectionHeaderPrinted = true;
                    }

                    System.out.println("<item>");
                    System.out.println("<title>" + escapeXml(title) + "</title>");
                    System.out.println("<guid isPermaLink=\"true\">" + escapeXml(link) + "</guid>");
                    System.out.println("<category>" + escapeXml(sectionName) + "</category>");
                    System.out.println("<description><![CDATA[" + description + "]]></description>");
                    System.out.println("</item>");
                }
            }
            browser.close();
        }
    }

    static void enrich(String inputFile, String outputFile, String cacheDir) throws Exception {
        String input = Files.readString(Path.of(inputFile));
        var writer = new PrintWriter(new FileWriter(outputFile));
        writer.print(input);
        writer.println();
        writer.println("=== FULL ARTICLE CONTENT ===");
        writer.println("Below is the fetched article content. Use this for richer summaries and deep-dives.");
        writer.println();

        var urls = extractUrls(input);
        if (urls.isEmpty()) {
            System.err.println("  No article URLs found to enrich.");
            writer.close();
            return;
        }

        Files.createDirectories(Path.of(cacheDir));
        var gson = new GsonBuilder().setPrettyPrinting().create();

        List<String> uncachedUrls = new ArrayList<>();
        Map<String, JsonObject> cached = new LinkedHashMap<>();

        for (String url : urls) {
            String cacheKey = cacheKey(url);
            Path cachePath = Path.of(cacheDir, cacheKey + ".json");
            if (Files.exists(cachePath)) {
                System.err.println("    [cached] " + url);
                cached.put(url, gson.fromJson(Files.readString(cachePath), JsonObject.class));
            } else {
                uncachedUrls.add(url);
            }
        }

        Map<String, JsonObject> fetched = new LinkedHashMap<>();
        if (!uncachedUrls.isEmpty()) {
            System.err.println("  Fetching " + uncachedUrls.size() + " uncached article(s) via Playwright...");
            try (Playwright pw = Playwright.create()) {
                Browser browser = pw.chromium().launch(new BrowserType.LaunchOptions()
                        .setChannel("chrome")
                        .setHeadless(false));
                Page page = browser.newPage();

                for (String url : uncachedUrls) {
                    System.err.println("    [fetch] " + url);
                    JsonObject data = fetchArticleData(page, url);
                    fetched.put(url, data);

                    String cacheKey = cacheKey(url);
                    Path cachePath = Path.of(cacheDir, cacheKey + ".json");
                    Files.writeString(cachePath, gson.toJson(data));
                }
                browser.close();
            }
        }

        int count = 0;
        for (String url : urls) {
            count++;
            JsonObject data = cached.containsKey(url) ? cached.get(url) : fetched.get(url);
            if (data == null) continue;
            if (data.has("skipped") && data.get("skipped").getAsBoolean()) continue;

            String ogImage = data.has("ogImage") ? data.get("ogImage").getAsString() : "";
            String content = data.has("content") ? data.get("content").getAsString() : "";

            writer.println("--- ARTICLE: " + url + " ---");
            if (!ogImage.isEmpty()) {
                writer.println("og:image: " + ogImage);
            }
            if (!content.isEmpty()) {
                var lines = content.split("\n");
                int limit = Math.min(lines.length, 200);
                for (int i = 0; i < limit; i++) {
                    writer.println(lines[i]);
                }
            }
            writer.println();
        }
        writer.close();
        System.err.println("  Enriched " + count + " article(s).");
    }

    static JsonObject fetchArticleData(Page page, String url) {
        JsonObject data = new JsonObject();
        try {
            Response response = page.navigate(url, new Page.NavigateOptions()
                    .setWaitUntil(WaitUntilState.DOMCONTENTLOADED)
                    .setTimeout(30000));

            if (response != null && (response.status() == 404 || response.status() == 410)) {
                System.err.println("      Skipping (HTTP " + response.status() + ")");
                data.addProperty("ogImage", "");
                data.addProperty("content", "");
                data.addProperty("skipped", true);
                return data;
            }

            page.waitForTimeout(4000);

            String ogImage = (String) page.evaluate(
                    "() => { const m = document.querySelector('meta[property=\"og:image\"]'); return m ? m.content : ''; }");
            if (ogImage == null || ogImage.isEmpty()) {
                ogImage = (String) page.evaluate(
                        "() => { const m = document.querySelector('meta[name=\"twitter:image\"]'); return m ? m.content : ''; }");
            }
            data.addProperty("ogImage", ogImage != null ? ogImage : "");

            String content = (String) page.evaluate("""
                    () => {
                        const article = document.querySelector('article') || document.querySelector('[role="main"]') || document.querySelector('main');
                        if (article) return article.innerText;
                        const body = document.body;
                        const nav = body.querySelector('nav');
                        const footer = body.querySelector('footer');
                        if (nav) nav.remove();
                        if (footer) footer.remove();
                        return body.innerText.substring(0, 50000);
                    }
                    """);
            data.addProperty("content", content != null ? content : "");
        } catch (Exception e) {
            System.err.println("      Error fetching " + url + ": " + e.getMessage());
            data.addProperty("ogImage", "");
            data.addProperty("content", "");
        }
        return data;
    }

    static List<String> extractUrls(String rssContent) {
        List<String> urls = new ArrayList<>();
        var matcher = Pattern.compile("<guid[^>]*>([^<]+)</guid>").matcher(rssContent);
        while (matcher.find()) {
            String url = matcher.group(1)
                    .replace("&amp;amp;", "&")
                    .replace("&amp;", "&")
                    .replace("&lt;", "<")
                    .replace("&gt;", ">");
            urls.add(url);
        }
        return urls;
    }

    static String cacheKey(String url) {
        String clean = url.replaceAll("[?&]utm_[^&]*", "")
                .replaceAll("[?&]ref=[^&]*", "")
                .replaceAll("\\?$", "");
        try {
            MessageDigest md = MessageDigest.getInstance("MD5");
            byte[] digest = md.digest(clean.getBytes());
            StringBuilder sb = new StringBuilder();
            for (byte b : digest) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            return "no-hash";
        }
    }

    static String titleFromUrl(String url) {
        try {
            String path = new java.net.URI(url).getPath();
            String slug = path.replaceAll("/$", "").replaceAll(".*/", "");
            slug = slug.replaceAll("\\.[a-z]+$", "");
            return slug.replace("-", " ").replace("_", " ").trim();
        } catch (Exception e) {
            return "";
        }
    }

    static String escapeXml(String s) {
        return s.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;");
    }
}
