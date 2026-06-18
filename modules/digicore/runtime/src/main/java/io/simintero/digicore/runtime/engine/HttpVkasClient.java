package io.simintero.digicore.runtime.engine;

import com.fasterxml.jackson.databind.JsonNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;
import java.util.List;
import java.util.Optional;

@Component
@Primary
public class HttpVkasClient implements VkasClient {
    private static final Logger log = LoggerFactory.getLogger(HttpVkasClient.class);
    private final RestClient http;
    private final String baseUrl;

    public HttpVkasClient(RestClient.Builder builder, @Value("${vkas.url:http://vkas:3040}") String vkasUrl) {
        this.baseUrl = vkasUrl;
        this.http = builder.build();
    }

    @Override
    public List<String> resolveDefaultPins(String serviceCode) {
        return List.of(); // pins now sourced from the coverage_rule; no hardcoded default
    }

    @Override
    public Optional<JsonNode> resolveContent(String canonicalUrl, String version, RuleContext ctx) {
        // Build URI keeping the literal ':resolve'. UriComponentsBuilder encodes query VALUES but
        // we keep the path literal. The colon in the path is NOT a reserved sub-delim that the
        // builder percent-encodes, so it reaches VKAS un-encoded.
        UriComponentsBuilder b = UriComponentsBuilder.fromHttpUrl(baseUrl)
                .path("/v1/artifacts:resolve")
                .queryParam("canonical_url", canonicalUrl);
        if (version != null && !version.isBlank()) {
            b.queryParam("version", version);
        }
        if (ctx != null) {
            if (ctx.lob() != null) b.queryParam("lob", ctx.lob());
            if (ctx.region() != null) b.queryParam("region", ctx.region());
            if (ctx.program() != null) b.queryParam("program", ctx.program());
            if (ctx.product() != null) b.queryParam("product", ctx.product());
        }
        // encode() encodes query values; the ':' in the path stays literal.
        // Pass a java.net.URI so RestClient uses it as-is without re-encoding.
        URI uri = b.encode().build(true).toUri();
        try {
            JsonNode body = http.get().uri(uri).retrieve()
                .onStatus(s -> s.value() == 404, (req, resp) -> { throw new NotFound(); })
                .body(JsonNode.class);
            return Optional.ofNullable(body).map(n -> n.path("content"));
        } catch (NotFound nf) {
            return Optional.empty();
        } catch (Exception e) {
            log.warn("VKAS resolve failed for {} (treating as unresolved): {}", canonicalUrl, e.toString());
            return Optional.empty();
        }
    }

    private static final class NotFound extends RuntimeException {
    }
}
