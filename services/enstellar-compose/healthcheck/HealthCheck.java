import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Tiny HTTP health-check program compiled to a fat-free JAR and mounted
 * read-only into containers that have Java but no shell or curl/wget
 * (e.g. hapiproject/hapi distroless images).
 *
 * Usage: java -jar healthcheck.jar [url]
 *   Default URL: http://localhost:8080/actuator/health
 * Exit 0 = HTTP 2xx, Exit 1 = anything else or connection error.
 */
public class HealthCheck {
    public static void main(String[] args) {
        String url = args.length > 0 ? args[0] : "http://localhost:8080/actuator/health";
        try {
            HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(5000);
            conn.setRequestMethod("GET");
            int code = conn.getResponseCode();
            System.exit((code >= 200 && code < 300) ? 0 : 1);
        } catch (Exception e) {
            System.exit(1);
        }
    }
}
