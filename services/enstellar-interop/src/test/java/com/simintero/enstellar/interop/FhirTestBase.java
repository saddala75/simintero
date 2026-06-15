package com.simintero.enstellar.interop;

import com.github.tomakehurst.wiremock.WireMockServer;
import com.github.tomakehurst.wiremock.core.WireMockConfiguration;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.util.Date;
import java.util.List;

import static com.github.tomakehurst.wiremock.client.WireMock.*;


@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(TestSecurityConfig.class)
public abstract class FhirTestBase {

    // Container is started once for the entire JVM session and never stopped, so its
    // port never changes.  Spring Boot's test-context cache then correctly reuses a
    // single application context across all IT classes (they share the same config).
    // Using @Testcontainers + @Container per-class would stop/restart the container
    // between test classes, producing a new port each time while the cached Spring
    // context still points to the original port, causing HikariPool timeouts.
    static final PostgreSQLContainer<?> POSTGRES;

    static {
        POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
                .withDatabaseName("hapi_test")
                .withUsername("hapi")
                .withPassword("hapi_secret");
        POSTGRES.start();
    }

    // Shared mock "external HAPI" for the FHIR proxy. Started in a static initializer
    // (not @BeforeAll) so it is running before Spring evaluates the @DynamicPropertySource
    // supplier for interop.hapi.base-url during ConfigurationProperties binding.
    // Shared across the entire JVM (started once, never stopped, reset in @BeforeEach),
    // mirroring the POSTGRES pattern so the cached Spring context keeps one stable target.
    // SAFE ONLY because ITs run sequentially — do NOT enable JUnit parallel execution or
    // maxParallelForks>1 without giving each test its own WireMock instance.
    protected static final WireMockServer HAPI_MOCK;

    static {
        HAPI_MOCK = new WireMockServer(WireMockConfiguration.options().dynamicPort());
        HAPI_MOCK.start();
    }

    @DynamicPropertySource
    static void configureProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.security.oauth2.resourceserver.jwt.jwk-set-uri",
                () -> "http://test-issuer-not-used");
        // Match the issuer and audience used by mintJwt so that SecurityConfig's
        // production jwtDecoder bean (if ever un-overridden) would accept test tokens.
        registry.add("spring.security.oauth2.resourceserver.jwt.issuer-uri",
                () -> "http://test-issuer");
        registry.add("enstellar.security.expected-audience", () -> "enstellar-api");
    }

    @DynamicPropertySource
    static void configureProxy(DynamicPropertyRegistry registry) {
        registry.add("interop.hapi.base-url",
            () -> "http://localhost:" + HAPI_MOCK.port() + "/fhir");
        // Custom FHIR storage was removed (Task 7) — the proxy is now the only FHIR CRUD path.
        registry.add("interop.hapi.proxy-enabled", () -> "true");
    }

    @BeforeEach
    void resetHapiMock() {
        HAPI_MOCK.resetAll();
        HAPI_MOCK.stubFor(get(urlEqualTo("/fhir/metadata"))
            .willReturn(okJson("""
                {
                  "resourceType": "CapabilityStatement",
                  "status": "active",
                  "publisher": "HAPI FHIR",
                  "rest": [{
                    "mode": "server",
                    "resource": [
                      {"type": "Patient",
                       "profile": "http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient|5.0.1",
                       "interaction": [{"code":"read"},{"code":"search-type"},{"code":"create"}]},
                      {"type": "Practitioner",
                       "profile": "http://hl7.org/fhir/us/core/StructureDefinition/us-core-practitioner|5.0.1",
                       "interaction": [{"code":"read"},{"code":"search-type"},{"code":"create"}]},
                      {"type": "Coverage",
                       "profile": "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/profile-coverage-pas|2.0.1",
                       "interaction": [{"code":"read"},{"code":"search-type"},{"code":"create"}]},
                      {"type": "Organization",
                       "profile": "http://hl7.org/fhir/us/core/StructureDefinition/us-core-organization|5.0.1",
                       "interaction": [{"code":"read"},{"code":"search-type"},{"code":"create"}]},
                      {"type": "DocumentReference",
                       "profile": "http://hl7.org/fhir/us/core/StructureDefinition/us-core-documentreference|5.0.1",
                       "interaction": [{"code":"read"},{"code":"search-type"},{"code":"create"}]}
                    ]
                  }]
                }
                """)));
        HAPI_MOCK.stubFor(any(anyUrl())
            .atPriority(10)
            .willReturn(aResponse().withStatus(404)
                .withHeader("Content-Type", "application/fhir+json")
                .withBody("{\"resourceType\":\"OperationOutcome\"}")));
    }

    @LocalServerPort
    protected int port;

    @Autowired
    protected TestRestTemplate restTemplate;

    protected static String mintJwt(String tenantId, String scopes) {
        try {
            JWTClaimsSet.Builder builder = new JWTClaimsSet.Builder()
                    .issuer("http://test-issuer")
                    .subject("test-user")
                    .audience(List.of("enstellar-api"))
                    .claim("scope", scopes)
                    .expirationTime(new Date(System.currentTimeMillis() + 3_600_000L));

            if (tenantId != null) {
                builder.claim("tenant_id", tenantId);
            }

            SignedJWT jwt = new SignedJWT(
                    new JWSHeader.Builder(JWSAlgorithm.RS256).keyID("test-key-1").build(),
                    builder.build());
            jwt.sign(new RSASSASigner(TestSecurityConfig.TEST_RSA_KEY));
            return jwt.serialize();
        } catch (Exception e) {
            throw new RuntimeException("Failed to mint test JWT", e);
        }
    }

    protected static String mintDefaultJwt() {
        return mintJwt("test-tenant", "patient/*.read patient/*.write");
    }
}
