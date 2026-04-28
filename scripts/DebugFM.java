///usr/bin/env jbang "$0" "$@" ; exit $?
//DEPS com.fasterxml.jackson.dataformat:jackson-dataformat-yaml:2.17.2
//DEPS io.vertx:vertx-core:4.5.10

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;
import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

public class DebugFM {
    public static void main(String[] args) throws Exception {
        if (args.length < 1) {
            System.err.println("Usage: DebugFM <post-file>");
            System.exit(1);
        }

        String content = Files.readString(Path.of(args[0]));

        // Extract YAML front matter between --- markers
        int start = content.indexOf("---");
        int end = content.indexOf("---", start + 3);
        if (start < 0 || end < 0) {
            System.err.println("No front matter found");
            System.exit(1);
        }
        String yaml = content.substring(start + 3, end).trim();

        // Parse with Jackson YAML (same as Roq)
        ObjectMapper mapper = new ObjectMapper(new YAMLFactory());
        @SuppressWarnings("unchecked")
        Map<String, Object> map = mapper.readValue(yaml, Map.class);
        JsonObject root = new JsonObject(map);

        System.out.println("Top-level keys: " + root.fieldNames());

        Object sectionsObj = root.getValue("sections");
        System.out.println("sections type: " + (sectionsObj != null ? sectionsObj.getClass().getName() : "null"));
        if (sectionsObj instanceof JsonArray) {
            JsonArray sections = (JsonArray) sectionsObj;
            for (int s = 0; s < sections.size(); s++) {
                JsonObject section = sections.getJsonObject(s);
                System.out.println("\n=== Section: " + section.getString("name") + " ===");
                Object articlesObj = section.getValue("articles");
                if (articlesObj instanceof JsonArray) {
                    JsonArray articles = (JsonArray) articlesObj;
                    System.out.println("  Article count: " + articles.size());
                    for (int a = 0; a < articles.size(); a++) {
                        JsonObject article = articles.getJsonObject(a);
                        System.out.println("  [" + article.getString("id") + "] keys: " + article.fieldNames());
                        if (!article.containsKey("one-liner")) {
                            System.out.println("    *** MISSING one-liner ***");
                        }
                        if (!article.containsKey("tags")) {
                            System.out.println("    *** MISSING tags ***");
                        }
                        if (article.containsKey("article-content")) {
                            String ac = article.getString("article-content");
                            System.out.println("    article-content length: " + (ac != null ? ac.length() : "null"));
                            if (ac != null && ac.length() > 3000) {
                                System.out.println("    LAST 300 chars: ..." + ac.substring(ac.length() - 300));
                            }
                        }
                    }
                }
            }
        }
    }
}
