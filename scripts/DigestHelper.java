///usr/bin/env jbang "$0" "$@" ; exit $?
//DEPS org.jsoup:jsoup:1.18.3
//DEPS com.microsoft.playwright:playwright:1.49.0
//DEPS com.google.code.gson:gson:2.11.0

import com.microsoft.playwright.*;
import com.microsoft.playwright.options.*;
import com.google.gson.*;
import org.jsoup.Jsoup;
import org.jsoup.nodes.*;
import org.jsoup.select.*;
import java.io.*;
import java.nio.file.*;
import java.security.*;
import java.util.*;
import java.util.regex.*;

public class DigestHelper {

    static final int CONTENT_MIN_LENGTH = 500;

    // TLDR page selectors (shared between Jsoup and Playwright)
    static final String SEL_SECTION = "section";
    static final String SEL_SECTION_HEADER = "header h3";
    static final String SEL_ARTICLE = "article";
    static final String SEL_TITLE_LINK = "a.font-bold";
    static final String SEL_DESCRIPTION = ".newsletter-html";

    // Article content selectors (Jsoup syntax, no quotes needed around attr values)
    static final String SEL_OG_IMAGE = "meta[property=og:image]";
    static final String SEL_TWITTER_IMAGE = "meta[name=twitter:image]";
    static final String SEL_CONTENT_ARTICLE = "article";
    static final String SEL_CONTENT_MAIN = "[role=main]";
    static final String SEL_CONTENT_MAIN_TAG = "main";

    // Browser querySelector needs quoted attribute values
    static String browserSelector(String sel) {
        return sel.replaceAll("\\[([\\w-]+)=([^\"\\]]+)]", "[$1=\"$2\"]");
    }

    public static void main(String[] args) throws Exception {
        if (args.length < 2) {
            System.err.println("Usage: DigestHelper <command> <args...>");
            System.err.println("Commands:");
            System.err.println("  tldr-articles <url>              Scrape TLDR daily page into RSS items");
            System.err.println("  enrich <input> <output> <cache>  Enrich articles with og:image and content");
            System.err.println("  inject-content <post> <cache>    Inject cached article HTML into post file");
            System.exit(1);
        }
        switch (args[0]) {
            case "tldr-articles" -> tldrArticles(args[1]);
            case "enrich" -> enrich(args[1], args[2], args[3]);
            case "inject-content" -> injectContent(args[1], args[2]);
            default -> {
                System.err.println("Unknown command: " + args[0]);
                System.exit(1);
            }
        }
    }

    static void tldrArticles(String url) throws IOException {
        Document doc = Jsoup.connect(url)
                .userAgent("Mozilla/5.0")
                .timeout(30000)
                .get();

        validateTldrStructure(doc, url);

        Elements sections = doc.select(SEL_SECTION);
        for (Element section : sections) {
            Element headerEl = section.selectFirst(SEL_SECTION_HEADER);
            if (headerEl == null) continue;
            String sectionName = headerEl.text().trim();
            if (sectionName.isEmpty()) continue;

            Elements articles = section.select(SEL_ARTICLE);
            boolean sectionHeaderPrinted = false;

            for (Element article : articles) {
                Element titleLink = article.selectFirst(SEL_TITLE_LINK);
                if (titleLink == null) continue;

                String title = titleLink.text().trim();
                String link = titleLink.attr("abs:href");
                if (link.isEmpty()) continue;
                if (title.toLowerCase().contains("(sponsor)")) continue;
                if (link.contains("jobs.ashbyhq.com") || link.contains("jobs.lever.co")) continue;

                if (title.length() < 3) {
                    title = titleFromUrl(link);
                    if (title.isEmpty()) continue;
                }

                Element descEl = article.selectFirst(SEL_DESCRIPTION);
                String description = descEl != null ? descEl.text().trim() : "";

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
    }

    static void validateTldrStructure(Document doc, String url) {
        Elements sections = doc.select(SEL_SECTION);
        boolean hasValidSection = false;
        for (Element section : sections) {
            if (section.selectFirst(SEL_SECTION_HEADER) != null
                    && !section.select(SEL_ARTICLE).isEmpty()) {
                Element article = section.selectFirst(SEL_ARTICLE);
                if (article.selectFirst(SEL_TITLE_LINK) != null) {
                    hasValidSection = true;
                    break;
                }
            }
        }
        if (!hasValidSection) {
            System.err.println("===========================================================");
            System.err.println("ERROR: TLDR DOM structure has changed!");
            System.err.println("URL: " + url);
            System.err.println("Expected: section > header h3, section > article > a.font-bold");
            System.err.println("Found sections: " + sections.size());
            for (Element s : sections) {
                System.err.println("  - header h3: " + (s.selectFirst(SEL_SECTION_HEADER) != null));
                System.err.println("    articles: " + s.select(SEL_ARTICLE).size());
                if (!s.select(SEL_ARTICLE).isEmpty()) {
                    Element a = s.selectFirst(SEL_ARTICLE);
                    System.err.println("    first article HTML (200 chars): "
                            + a.outerHtml().substring(0, Math.min(200, a.outerHtml().length())));
                }
            }
            System.err.println("Please update the selectors in DigestHelper.java");
            System.err.println("===========================================================");
            System.exit(2);
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
            String key = cacheKey(url);
            Path cachePath = Path.of(cacheDir, key + ".json");
            if (Files.exists(cachePath)) {
                System.err.println("    [cached] " + url);
                cached.put(url, gson.fromJson(Files.readString(cachePath), JsonObject.class));
            } else {
                uncachedUrls.add(url);
            }
        }

        Map<String, JsonObject> fetched = new LinkedHashMap<>();
        List<String> playwrightFallbackUrls = new ArrayList<>();

        for (String url : uncachedUrls) {
            if (needsBrowser(url)) {
                System.err.println("    [browser-only] " + url);
                playwrightFallbackUrls.add(url);
                continue;
            }
            System.err.println("    [jsoup] " + url);
            JsonObject data = fetchWithJsoup(url);
            if (data.has("skipped") && data.get("skipped").getAsBoolean()) {
                cacheAndStore(fetched, data, url, cacheDir, gson);
                continue;
            }
            String content = data.has("content") ? data.get("content").getAsString() : "";
            if (content.length() < CONTENT_MIN_LENGTH || isJunkContent(content)) {
                String reason = isJunkContent(content) ? "junk content (cookie wall/blocked)" : "too short (" + content.length() + " chars)";
                System.err.println("      -> " + reason + ", queuing for Playwright fallback");
                playwrightFallbackUrls.add(url);
            } else {
                cacheAndStore(fetched, data, url, cacheDir, gson);
            }
        }

        if (!playwrightFallbackUrls.isEmpty()) {
            System.err.println("  Fetching " + playwrightFallbackUrls.size() + " article(s) via Playwright fallback...");
            try (Playwright pw = Playwright.create()) {
                Browser browser = pw.chromium().launch(new BrowserType.LaunchOptions()
                        .setChannel("chrome")
                        .setHeadless(false));
                Page page = browser.newPage();

                for (String url : playwrightFallbackUrls) {
                    System.err.println("    [playwright] " + url);
                    JsonObject data = fetchWithPlaywright(page, url);
                    String pwContent = data.has("content") ? data.get("content").getAsString() : "";
                    if (isJunkContent(pwContent)) {
                        System.err.println("      -> still junk after Playwright, skipping");
                        data.addProperty("skipped", true);
                    }
                    cacheAndStore(fetched, data, url, cacheDir, gson);
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
            if (isJunkContent(content)) continue;

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

    static final List<String> BROWSER_ONLY_DOMAINS = List.of(
            "x.com", "twitter.com",
            "bloomberg.com", "wsj.com",
            "nytimes.com", "ft.com"
    );

    static final List<String> JUNK_PATTERNS = List.of(
            "enable cookies", "you have been blocked", "unable to access",
            "unusual activity", "captcha", "verify you are human",
            "request could not be satisfied", "403 error", "access denied",
            "just a moment", "checking your browser", "ray id",
            "please turn javascript on", "we care about your privacy"
    );

    static String sanitizeForYaml(String html) {
        html = html.replace("---", "&#45;&#45;&#45;");
        html = html.replace("...", "&#46;&#46;&#46;");
        html = html.replace("\t", "  ");
        html = html.replaceAll("\\r\\n?", "\n");
        return html;
    }

    static boolean isJunkContent(String content) {
        if (content == null || content.length() < 200) return true;
        String lower = content.toLowerCase();
        for (String pattern : JUNK_PATTERNS) {
            if (lower.startsWith(pattern) || lower.substring(0, Math.min(300, lower.length())).contains(pattern)) {
                return true;
            }
        }
        return false;
    }

    static boolean needsBrowser(String url) {
        String lower = url.toLowerCase();
        return BROWSER_ONLY_DOMAINS.stream().anyMatch(d -> lower.contains(d + "/"));
    }

    static JsonObject fetchWithJsoup(String url) {
        JsonObject data = new JsonObject();
        try {
            var response = Jsoup.connect(url)
                    .userAgent("Mozilla/5.0")
                    .timeout(30000)
                    .followRedirects(true)
                    .ignoreHttpErrors(true)
                    .execute();

            if (response.statusCode() == 404 || response.statusCode() == 410) {
                System.err.println("      Skipping (HTTP " + response.statusCode() + ")");
                data.addProperty("ogImage", "");
                data.addProperty("content", "");
                data.addProperty("skipped", true);
                return data;
            }

            Document doc = response.parse();

            Element ogMeta = doc.selectFirst(SEL_OG_IMAGE);
            String ogImage = ogMeta != null ? ogMeta.attr("content") : "";
            if (ogImage.isEmpty()) {
                Element twitterMeta = doc.selectFirst(SEL_TWITTER_IMAGE);
                ogImage = twitterMeta != null ? twitterMeta.attr("content") : "";
            }
            data.addProperty("ogImage", ogImage);

            Element contentEl = doc.selectFirst(SEL_CONTENT_ARTICLE);
            if (contentEl == null) contentEl = doc.selectFirst(SEL_CONTENT_MAIN);
            if (contentEl == null) contentEl = doc.selectFirst(SEL_CONTENT_MAIN_TAG);
            String content;
            String contentHtml;
            if (contentEl != null) {
                content = contentEl.text();
                contentHtml = sanitizeHtml(contentEl);
            } else {
                doc.select("nav, footer, header, script, style").remove();
                Element body = doc.body();
                content = body != null ? body.text() : "";
                contentHtml = body != null ? sanitizeHtml(body) : "";
                if (content.length() > 50000) content = content.substring(0, 50000);
            }
            data.addProperty("content", content);
            data.addProperty("contentHtml", contentHtml);
        } catch (Exception e) {
            System.err.println("      Jsoup error: " + e.getMessage());
            data.addProperty("ogImage", "");
            data.addProperty("content", "");
        }
        return data;
    }

    static JsonObject fetchWithPlaywright(Page page, String url) {
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
                    "() => { const m = document.querySelector('" + browserSelector(SEL_OG_IMAGE) + "'); return m ? m.content : ''; }");
            if (ogImage == null || ogImage.isEmpty()) {
                ogImage = (String) page.evaluate(
                        "() => { const m = document.querySelector('" + browserSelector(SEL_TWITTER_IMAGE) + "'); return m ? m.content : ''; }");
            }
            data.addProperty("ogImage", ogImage != null ? ogImage : "");

            String content = (String) page.evaluate(
                    "() => {"
                    + "const article = document.querySelector('" + browserSelector(SEL_CONTENT_ARTICLE) + "')"
                    + " || document.querySelector('" + browserSelector(SEL_CONTENT_MAIN) + "')"
                    + " || document.querySelector('" + browserSelector(SEL_CONTENT_MAIN_TAG) + "');"
                    + "if (article) return article.innerText;"
                    + "const body = document.body;"
                    + "const nav = body.querySelector('nav');"
                    + "const footer = body.querySelector('footer');"
                    + "if (nav) nav.remove();"
                    + "if (footer) footer.remove();"
                    + "return body.innerText.substring(0, 50000);"
                    + "}");
            data.addProperty("content", content != null ? content : "");
        } catch (Exception e) {
            System.err.println("      Error fetching " + url + ": " + e.getMessage());
            data.addProperty("ogImage", "");
            data.addProperty("content", "");
        }
        return data;
    }

    static void cacheAndStore(Map<String, JsonObject> fetched, JsonObject data, String url,
            String cacheDir, Gson gson) throws IOException {
        fetched.put(url, data);
        Path cachePath = Path.of(cacheDir, cacheKey(url) + ".json");
        Files.writeString(cachePath, gson.toJson(data));
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

    static final org.jsoup.safety.Safelist PROSE_SAFELIST = org.jsoup.safety.Safelist.none()
            .addTags("p", "h1", "h2", "h3", "h4", "h5", "h6",
                    "ul", "ol", "li", "blockquote", "pre", "code",
                    "strong", "b", "em", "i", "a", "br", "hr",
                    "table", "thead", "tbody", "tr", "th", "td",
                    "figure", "figcaption", "img", "dl", "dt", "dd")
            .addAttributes("a", "href")
            .addAttributes("img", "src", "alt")
            .addProtocols("a", "href", "https", "http")
            .addProtocols("img", "src", "https", "http");

    static String sanitizeHtml(Element el) {
        el.select("script, style, nav, footer, header, aside, .sidebar, .comments, .ad, .advertisement, form, iframe, svg").remove();
        String html = org.jsoup.Jsoup.clean(el.html(), PROSE_SAFELIST);
        html = html.replaceAll("(?s)<(p|div|li|blockquote|h[1-6])[^>]*>\\s*</\\1>", "");
        if (html.length() > 50000) html = html.substring(0, 50000);
        return html.trim();
    }

    static void injectContent(String postFile, String cacheDir) throws Exception {
        var lines = new ArrayList<>(Files.readAllLines(Path.of(postFile)));
        var gson = new GsonBuilder().setPrettyPrinting().create();
        var output = new ArrayList<String>();
        String currentLink = null;
        String indent = "        ";

        for (int i = 0; i < lines.size(); i++) {
            String line = lines.get(i);
            output.add(line);

            if (line.matches("\\s+link:.*")) {
                currentLink = line.replaceFirst("\\s+link:\\s*", "").replaceAll("^\"|\"$", "").trim();
            }

            if (line.matches("\\s+description:.*") && currentLink != null) {
                String key = cacheKey(currentLink);
                Path cachePath = Path.of(cacheDir, key + ".json");
                if (Files.exists(cachePath)) {
                    JsonObject data = gson.fromJson(Files.readString(cachePath), JsonObject.class);
                    String html = data.has("contentHtml") ? data.get("contentHtml").getAsString() : "";
                    if (html.isEmpty() && data.has("content")) {
                        String plain = data.get("content").getAsString();
                        if (!plain.isEmpty()) html = "<p>" + plain.replace("\n\n", "</p><p>").replace("\n", "<br/>") + "</p>";
                    }
                    if (!html.isEmpty() && !isJunkContent(html) && html.length() > 200) {
                        // Skip the description block scalar lines
                        if (line.trim().endsWith("|")) {
                            while (i + 1 < lines.size() && lines.get(i + 1).matches("\\s{10,}.*")) {
                                i++;
                                output.add(lines.get(i));
                            }
                        }
                        html = sanitizeForYaml(html);
                        output.add(indent + "article-content: |");
                        for (String htmlLine : html.split("\n")) {
                            output.add(indent + "  " + htmlLine);
                        }
                    }
                }
                currentLink = null;
            }
        }

        Files.writeString(Path.of(postFile), String.join("\n", output) + "\n");
        System.err.println("  Injected article content into " + postFile);
    }
}
