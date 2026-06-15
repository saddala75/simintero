# T05 Tasks 7–9: HAPI Server Wiring, Integration Tests, and CI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete T05 by wiring the HAPI FHIR RestfulServer with resource providers and a config-driven CapabilityStatement, backed by a custom Spring Data JPA storage layer, then verify with Testcontainers integration tests and add CI wiring.

**Architecture:** Resource providers use a `FhirResourceEntity` (Spring Data JPA + PostgreSQL JSONB) instead of HAPI JPA DAO beans — this is the root-cause fix for repeated Task 7 failures. Tenant isolation uses the existing `TenantContext` ThreadLocal (set by `TenantInterceptor`) plus a SQL `tenant_id` column. The HAPI `RestfulServer` (not JPA server) is registered as a servlet at `/fhir/*` via `hapi-fhir-spring-boot-starter` auto-configuration.

**Root cause of repeated Task 7 failures:** The original plan's providers used `@Autowired IFhirResourceDao<Patient>`. Those beans are NOT auto-configured by `hapi-fhir-spring-boot-starter` + `hapi-fhir-jpaserver-base`. Result: `NoSuchBeanDefinitionException` for every `IFhirResourceDao<T>` on context startup.

**Current state (completed through Task 6):**
- `auth/TenantInterceptor.java` — validates `tenant_id` JWT claim, sets `TenantContext`
- `auth/TenantContext.java` — ThreadLocal tenant store
- `config/SecurityConfig.java` — JWT auth, `/fhir/metadata` public
- `config/FhirConfig.java` — `FhirContext` bean
- `config/InterceptorConfig.java` — plain `RestfulServer` with only `TenantInterceptor`
- `SecurityIntegrationTest.java` — 3 MockMvc tests passing
- Missing: resource providers, CapabilityStatement provider, Testcontainers tests

**Tech Stack:** Java 21, Spring Boot 3.3.0, HAPI FHIR 7.4.0 (plain RestfulServer), Spring Data JPA + PostgreSQL, Testcontainers 1.19.8, nimbus-jose-jwt 9.40

---

## File Map

**Created:**

| File | Responsibility |
|---|---|
| `src/main/java/.../persistence/FhirResourceEntity.java` | JPA entity: FHIR resource as JSON blob + tenant_id |
| `src/main/java/.../persistence/FhirResourceRepository.java` | Spring Data JPA repo + native JSONB search query |
| `src/main/java/.../config/FhirCapabilityProperties.java` | `@ConfigurationProperties(prefix="enstellar.fhir.capability")` |
| `src/main/java/.../conformance/EnstellarCapabilityStatementProvider.java` | Generates CapabilityStatement from `FhirCapabilityProperties` |
| `src/main/java/.../providers/PatientResourceProvider.java` | FHIR R4 Patient: @Read, @Search, @Create |
| `src/main/java/.../providers/PractitionerResourceProvider.java` | FHIR R4 Practitioner: @Read, @Search, @Create |
| `src/main/java/.../providers/CoverageResourceProvider.java` | FHIR R4 Coverage: @Read, @Search, @Create |
| `src/main/java/.../providers/OrganizationResourceProvider.java` | FHIR R4 Organization: @Read, @Search, @Create |
| `src/test/java/.../TestSecurityConfig.java` | Test RSA key pair + `@Primary JwtDecoder` |
| `src/test/java/.../FhirTestBase.java` | Testcontainers PostgreSQL + JWT minting |
| `src/test/java/.../SmartAuthIT.java` | 401/200 auth tests |
| `src/test/java/.../CapabilityStatementIT.java` | CapabilityStatement endpoint assertions |
| `src/test/java/.../TenantIsolationIT.java` | 403 without `tenant_id`, cross-tenant isolation |
| `src/test/java/.../PatientResourceIT.java` | Patient create/read/search |

**Modified / Deleted:**

| File | Change |
|---|---|
| `build.gradle.kts` | Add `nimbus-jose-jwt:9.40`, `spring-boot-starter-data-jpa`; remove `hapi-fhir-jpaserver-base`, `h2` |
| `src/main/resources/application.yml` | Add datasource + capability config |
| `src/main/java/.../config/InterceptorConfig.java` | **Delete** — replaced by `HapiServerConfig.java` |
| `src/main/java/.../config/HapiServerConfig.java` | **Create** — wires providers + CapabilityStatement onto RestfulServer |
| `src/test/resources/application-test.yml` | **Delete** — H2 incompatible with Testcontainers approach |
| `src/test/java/.../SecurityIntegrationTest.java` | **Delete** — superseded by SmartAuthIT |
| `Makefile` | Add `interop-test` target; add it to `test:` |
| `.github/workflows/ci.yml` | Rename/upgrade `test-interop-security` → `test-interop` with Gradle cache |
| `.claude/task-graph.md` | Mark T05 `[x]` |

Java package prefix: `com.simintero.enstellar.interop`

---

## Task 1: Fix Build Dependencies and Application Configuration

**Files:**
- Modify: `services/interop/build.gradle.kts`
- Modify: `services/interop/src/main/resources/application.yml`
- Delete: `services/interop/src/test/resources/application-test.yml`

- [ ] **Step 1.1: Rewrite `services/interop/build.gradle.kts`**

Replace the entire `dependencies` block with:

```kotlin
dependencies {
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter-security")
    implementation("org.springframework.boot:spring-boot-starter-oauth2-resource-server")
    implementation("org.springframework.boot:spring-boot-starter-data-jpa")

    // HAPI FHIR R4 — plain RestfulServer only (no HAPI JPA DAOs)
    implementation("ca.uhn.hapi.fhir:hapi-fhir-spring-boot-starter:7.4.0")
    implementation("ca.uhn.hapi.fhir:hapi-fhir-server:7.4.0")
    implementation("ca.uhn.hapi.fhir:hapi-fhir-structures-r4:7.4.0")
    // hapi-fhir-jpaserver-base removed: its IFhirResourceDao<T> beans
    // are not auto-configured by the spring-boot-starter and were causing
    // NoSuchBeanDefinitionException on every Task 7 attempt.

    runtimeOnly("org.postgresql:postgresql")

    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("org.springframework.security:spring-security-test")
    testImplementation("org.testcontainers:junit-jupiter:1.19.8")
    testImplementation("org.testcontainers:postgresql:1.19.8")
    testImplementation("com.nimbusds:nimbus-jose-jwt:9.40")
    // h2 removed: tests use Testcontainers PostgreSQL, not H2
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}
```

- [ ] **Step 1.2: Rewrite `src/main/resources/application.yml`**

Replace the entire file:

```yaml
server:
  port: 8080

spring:
  application:
    name: interop
  datasource:
    url: ${INTEROP_DB_URL:jdbc:postgresql://hapi-db:5432/hapi}
    username: ${INTEROP_DB_USER:hapi}
    password: ${INTEROP_DB_PASSWORD:hapi_secret}
    driver-class-name: org.postgresql.Driver
  jpa:
    open-in-view: false
    hibernate:
      ddl-auto: update
    properties:
      hibernate:
        dialect: org.hibernate.dialect.PostgreSQLDialect
        format_sql: false
  security:
    oauth2:
      resourceserver:
        jwt:
          jwk-set-uri: ${KEYCLOAK_JWK_SET_URI:http://localhost:8081/realms/enstellar/protocol/openid-connect/certs}

hapi:
  fhir:
    fhir-version: R4
    rest:
      server-address: http://localhost:8080/fhir

enstellar:
  fhir:
    capability:
      publisher: "Simintero Enstellar"
      resources:
        - type: Patient
          profile: "http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient"
          interactions: [read, search-type, create]
        - type: Practitioner
          profile: "http://hl7.org/fhir/us/core/StructureDefinition/us-core-practitioner"
          interactions: [read, search-type, create]
        - type: Coverage
          profile: ""
          interactions: [read, search-type, create]
        - type: Organization
          profile: "http://hl7.org/fhir/us/core/StructureDefinition/us-core-organization"
          interactions: [read, search-type, create]

logging:
  level:
    root: INFO
    com.simintero.enstellar: DEBUG
    ca.uhn.fhir: WARN
```

- [ ] **Step 1.3: Delete the H2 test config**

```bash
rm services/interop/src/test/resources/application-test.yml
```

Expected: file is deleted. This config pointed at H2 which has no JSONB support.

- [ ] **Step 1.4: Verify compile**

```bash
cd services/interop && ./gradlew compileJava compileTestJava
```

Expected: `BUILD SUCCESSFUL`. If compile fails mentioning `hapi-fhir-jpaserver-base` classes, check that no existing source file imports from `ca.uhn.fhir.jpa.*` — the current `TenantInterceptor` and `InterceptorConfig` do not, so this should be clean.

- [ ] **Step 1.5: Commit**

```bash
cd services/interop && git add build.gradle.kts src/main/resources/application.yml
git rm src/test/resources/application-test.yml
git commit -m "chore(interop): fix build deps — add data-jpa + nimbus-jose-jwt, remove hapi-jpa-base and H2"
```

---

## Task 2: Custom Storage Layer

**Files:**
- Create: `src/main/java/com/simintero/enstellar/interop/persistence/FhirResourceEntity.java`
- Create: `src/main/java/com/simintero/enstellar/interop/persistence/FhirResourceRepository.java`

All FHIR resources are stored as JSON text in a single `fhir_resource` table. The `tenant_id` column is the isolation boundary — every query filters on it. The JSONB containment operator (`@>`) in PostgreSQL allows structured search within the stored JSON.

- [ ] **Step 2.1: Create the package directory**

```bash
mkdir -p services/interop/src/main/java/com/simintero/enstellar/interop/persistence
```

- [ ] **Step 2.2: Create `FhirResourceEntity.java`**

```java
package com.simintero.enstellar.interop.persistence;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(
    name = "fhir_resource",
    indexes = {
        @Index(name = "idx_fhir_type_tenant", columnList = "resource_type,tenant_id"),
        @Index(name = "idx_fhir_tenant",      columnList = "tenant_id")
    }
)
public class FhirResourceEntity {

    @Id
    @Column(nullable = false, length = 255)
    private String id;

    @Column(name = "resource_type", nullable = false, length = 100)
    private String resourceType;

    @Column(name = "tenant_id", nullable = false, length = 255)
    private String tenantId;

    @Column(name = "resource_json", nullable = false, columnDefinition = "TEXT")
    private String resourceJson;

    @Column(name = "version_id", nullable = false)
    private long versionId = 1L;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getResourceType() { return resourceType; }
    public void setResourceType(String t) { this.resourceType = t; }
    public String getTenantId() { return tenantId; }
    public void setTenantId(String t) { this.tenantId = t; }
    public String getResourceJson() { return resourceJson; }
    public void setResourceJson(String j) { this.resourceJson = j; }
    public long getVersionId() { return versionId; }
    public void setVersionId(long v) { this.versionId = v; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant t) { this.createdAt = t; }
    public Instant getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(Instant t) { this.updatedAt = t; }
}
```

- [ ] **Step 2.3: Create `FhirResourceRepository.java`**

```java
package com.simintero.enstellar.interop.persistence;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface FhirResourceRepository extends JpaRepository<FhirResourceEntity, String> {

    Optional<FhirResourceEntity> findByIdAndResourceTypeAndTenantId(
            String id, String resourceType, String tenantId);

    List<FhirResourceEntity> findByResourceTypeAndTenantId(
            String resourceType, String tenantId);

    /**
     * PostgreSQL JSONB containment search.
     *
     * The @> operator checks whether the left-side JSON structurally contains
     * the right-side JSON. For arrays, an array element only needs to match a
     * subset of the filter element's fields.
     *
     * Example filter for family name:   {"name":[{"family":"Smith"}]}
     * Example filter for identifier:    {"identifier":[{"system":"http://x","value":"123"}]}
     *
     * Only runs against real PostgreSQL — not H2 (no ::jsonb cast support).
     */
    @Query(value = "SELECT * FROM fhir_resource " +
                   "WHERE resource_type = :type " +
                   "AND tenant_id = :tenantId " +
                   "AND resource_json::jsonb @> CAST(:filter AS jsonb)",
           nativeQuery = true)
    List<FhirResourceEntity> searchByJsonb(
            @Param("type") String type,
            @Param("tenantId") String tenantId,
            @Param("filter") String filter);
}
```

- [ ] **Step 2.4: Verify compile**

```bash
cd services/interop && ./gradlew compileJava
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 2.5: Commit**

```bash
git add services/interop/src/main/java/com/simintero/enstellar/interop/persistence/
git commit -m "feat(interop): add FhirResourceEntity and FhirResourceRepository for FHIR storage"
```

---

## Task 3: FhirCapabilityProperties and CapabilityStatement Provider

**Files:**
- Create: `src/main/java/com/simintero/enstellar/interop/config/FhirCapabilityProperties.java`
- Create: `src/main/java/com/simintero/enstellar/interop/conformance/EnstellarCapabilityStatementProvider.java`

- [ ] **Step 3.1: Create the conformance package**

```bash
mkdir -p services/interop/src/main/java/com/simintero/enstellar/interop/conformance
```

- [ ] **Step 3.2: Create `FhirCapabilityProperties.java`**

```java
package com.simintero.enstellar.interop.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * Typed binding for enstellar.fhir.capability in application.yml.
 * The CapabilityStatement is generated entirely from this class — never hand-edited.
 */
@Component
@ConfigurationProperties(prefix = "enstellar.fhir.capability")
public class FhirCapabilityProperties {

    private String publisher = "Simintero Enstellar";
    private List<ResourceConfig> resources = new ArrayList<>();

    public String getPublisher() { return publisher; }
    public void setPublisher(String p) { this.publisher = p; }
    public List<ResourceConfig> getResources() { return resources; }
    public void setResources(List<ResourceConfig> r) { this.resources = r; }

    public static class ResourceConfig {
        private String type;
        private String profile = "";
        private List<String> interactions = new ArrayList<>();

        public String getType() { return type; }
        public void setType(String t) { this.type = t; }
        public String getProfile() { return profile; }
        public void setProfile(String p) { this.profile = p; }
        public List<String> getInteractions() { return interactions; }
        public void setInteractions(List<String> i) { this.interactions = i; }
    }
}
```

- [ ] **Step 3.3: Create `EnstellarCapabilityStatementProvider.java`**

```java
package com.simintero.enstellar.interop.conformance;

import ca.uhn.fhir.rest.api.server.RequestDetails;
import ca.uhn.fhir.rest.server.RestfulServer;
import ca.uhn.fhir.rest.server.provider.ServerCapabilityStatementProvider;
import com.simintero.enstellar.interop.config.FhirCapabilityProperties;
import jakarta.servlet.http.HttpServletRequest;
import org.hl7.fhir.r4.model.CapabilityStatement;
import org.hl7.fhir.r4.model.Enumerations;

import java.util.Date;

/**
 * Generates /fhir/metadata from {@link FhirCapabilityProperties}.
 *
 * NOT a Spring @Component — constructed manually inside HapiServerConfig.fhirServer()
 * after the RestfulServer instance is created, so the server reference is valid.
 */
public class EnstellarCapabilityStatementProvider extends ServerCapabilityStatementProvider {

    private final FhirCapabilityProperties props;

    public EnstellarCapabilityStatementProvider(RestfulServer server,
                                                FhirCapabilityProperties props) {
        super(server);
        this.props = props;
    }

    @Override
    public CapabilityStatement getServerConformance(HttpServletRequest request,
                                                    RequestDetails requestDetails) {
        CapabilityStatement cs = new CapabilityStatement();
        cs.setStatus(Enumerations.PublicationStatus.ACTIVE);
        cs.setDate(new Date());
        cs.setPublisher(props.getPublisher());
        cs.setKind(CapabilityStatement.CapabilityStatementKind.INSTANCE);
        cs.setFhirVersion(Enumerations.FHIRVersion._4_0_1);
        cs.addFormat("application/fhir+json");
        cs.addFormat("application/fhir+xml");

        CapabilityStatement.CapabilityStatementRestComponent rest =
                cs.addRest().setMode(CapabilityStatement.RestfulCapabilityMode.SERVER);

        for (FhirCapabilityProperties.ResourceConfig rc : props.getResources()) {
            CapabilityStatement.CapabilityStatementRestResourceComponent resource = rest.addResource();
            resource.setType(rc.getType());
            if (rc.getProfile() != null && !rc.getProfile().isBlank()) {
                resource.setProfile(rc.getProfile());
            }
            for (String interaction : rc.getInteractions()) {
                resource.addInteraction()
                        .setCode(CapabilityStatement.TypeRestfulInteraction.fromCode(interaction));
            }
        }

        return cs;
    }
}
```

- [ ] **Step 3.4: Verify compile**

```bash
cd services/interop && ./gradlew compileJava
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 3.5: Commit**

```bash
git add services/interop/src/main/java/com/simintero/enstellar/interop/config/FhirCapabilityProperties.java \
        services/interop/src/main/java/com/simintero/enstellar/interop/conformance/
git commit -m "feat(interop): add FhirCapabilityProperties and EnstellarCapabilityStatementProvider"
```

---

## Task 4: Resource Providers

**Files:**
- Create: `src/main/java/com/simintero/enstellar/interop/providers/PatientResourceProvider.java`
- Create: `src/main/java/com/simintero/enstellar/interop/providers/PractitionerResourceProvider.java`
- Create: `src/main/java/com/simintero/enstellar/interop/providers/CoverageResourceProvider.java`
- Create: `src/main/java/com/simintero/enstellar/interop/providers/OrganizationResourceProvider.java`

All providers follow the same pattern: read `tenantId` from `TenantContext.require()`, serialize/deserialize via `FhirContext.newJsonParser()`, persist via `FhirResourceRepository`.

- [ ] **Step 4.1: Create the providers package**

```bash
mkdir -p services/interop/src/main/java/com/simintero/enstellar/interop/providers
```

- [ ] **Step 4.2: Create `PatientResourceProvider.java`**

```java
package com.simintero.enstellar.interop.providers;

import ca.uhn.fhir.context.FhirContext;
import ca.uhn.fhir.rest.annotation.*;
import ca.uhn.fhir.rest.api.MethodOutcome;
import ca.uhn.fhir.rest.api.server.RequestDetails;
import ca.uhn.fhir.rest.param.StringParam;
import ca.uhn.fhir.rest.param.TokenParam;
import ca.uhn.fhir.rest.server.IResourceProvider;
import ca.uhn.fhir.rest.server.exceptions.ResourceNotFoundException;
import com.simintero.enstellar.interop.auth.TenantContext;
import com.simintero.enstellar.interop.persistence.FhirResourceEntity;
import com.simintero.enstellar.interop.persistence.FhirResourceRepository;
import org.hl7.fhir.instance.model.api.IIdType;
import org.hl7.fhir.r4.model.IdType;
import org.hl7.fhir.r4.model.Patient;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Component
public class PatientResourceProvider implements IResourceProvider {

    private static final String TYPE = "Patient";

    @Autowired private FhirContext fhirContext;
    @Autowired private FhirResourceRepository repo;

    @Override
    public Class<Patient> getResourceType() { return Patient.class; }

    @Read
    public Patient read(@IdParam IIdType id, RequestDetails requestDetails) {
        String tenantId = TenantContext.require();
        return repo.findByIdAndResourceTypeAndTenantId(id.getIdPart(), TYPE, tenantId)
                .map(e -> parse(e.getResourceJson()))
                .orElseThrow(() -> new ResourceNotFoundException(id));
    }

    @Search
    public List<Patient> search(
            @OptionalParam(name = Patient.SP_FAMILY)     StringParam family,
            @OptionalParam(name = Patient.SP_GIVEN)      StringParam given,
            @OptionalParam(name = Patient.SP_IDENTIFIER) TokenParam identifier,
            @OptionalParam(name = Patient.SP_NAME)       StringParam name,
            RequestDetails requestDetails) {

        String tenantId = TenantContext.require();
        List<FhirResourceEntity> entities;

        if (family != null) {
            entities = repo.searchByJsonb(TYPE, tenantId,
                    "{\"name\":[{\"family\":\"" + esc(family.getValue()) + "\"}]}");
        } else if (identifier != null) {
            entities = repo.searchByJsonb(TYPE, tenantId, identifierFilter(identifier));
        } else if (given != null) {
            entities = repo.searchByJsonb(TYPE, tenantId,
                    "{\"name\":[{\"given\":[\"" + esc(given.getValue()) + "\"]}]}");
        } else if (name != null) {
            entities = repo.searchByJsonb(TYPE, tenantId,
                    "{\"name\":[{\"family\":\"" + esc(name.getValue()) + "\"}]}");
        } else {
            entities = repo.findByResourceTypeAndTenantId(TYPE, tenantId);
        }

        return entities.stream().map(e -> parse(e.getResourceJson())).toList();
    }

    @Create
    public MethodOutcome create(@ResourceParam Patient patient, RequestDetails requestDetails) {
        String tenantId = TenantContext.require();
        String id = UUID.randomUUID().toString();
        patient.setId(id);

        FhirResourceEntity entity = new FhirResourceEntity();
        entity.setId(id);
        entity.setResourceType(TYPE);
        entity.setTenantId(tenantId);
        entity.setResourceJson(fhirContext.newJsonParser().encodeResourceToString(patient));
        entity.setVersionId(1L);
        entity.setCreatedAt(Instant.now());
        entity.setUpdatedAt(Instant.now());
        repo.save(entity);

        MethodOutcome outcome = new MethodOutcome();
        outcome.setId(new IdType(TYPE, id, "1"));
        outcome.setCreated(true);
        return outcome;
    }

    private Patient parse(String json) {
        return fhirContext.newJsonParser().parseResource(Patient.class, json);
    }

    private static String identifierFilter(TokenParam tok) {
        String v = esc(tok.getValue());
        String s = tok.getSystem();
        return (s != null && !s.isEmpty())
                ? "{\"identifier\":[{\"system\":\"" + esc(s) + "\",\"value\":\"" + v + "\"}]}"
                : "{\"identifier\":[{\"value\":\"" + v + "\"}]}";
    }

    private static String esc(String v) {
        return v == null ? "" : v.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
```

- [ ] **Step 4.3: Create `PractitionerResourceProvider.java`**

```java
package com.simintero.enstellar.interop.providers;

import ca.uhn.fhir.context.FhirContext;
import ca.uhn.fhir.rest.annotation.*;
import ca.uhn.fhir.rest.api.MethodOutcome;
import ca.uhn.fhir.rest.api.server.RequestDetails;
import ca.uhn.fhir.rest.param.StringParam;
import ca.uhn.fhir.rest.param.TokenParam;
import ca.uhn.fhir.rest.server.IResourceProvider;
import ca.uhn.fhir.rest.server.exceptions.ResourceNotFoundException;
import com.simintero.enstellar.interop.auth.TenantContext;
import com.simintero.enstellar.interop.persistence.FhirResourceEntity;
import com.simintero.enstellar.interop.persistence.FhirResourceRepository;
import org.hl7.fhir.instance.model.api.IIdType;
import org.hl7.fhir.r4.model.IdType;
import org.hl7.fhir.r4.model.Practitioner;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Component
public class PractitionerResourceProvider implements IResourceProvider {

    private static final String TYPE = "Practitioner";

    @Autowired private FhirContext fhirContext;
    @Autowired private FhirResourceRepository repo;

    @Override
    public Class<Practitioner> getResourceType() { return Practitioner.class; }

    @Read
    public Practitioner read(@IdParam IIdType id, RequestDetails requestDetails) {
        String tenantId = TenantContext.require();
        return repo.findByIdAndResourceTypeAndTenantId(id.getIdPart(), TYPE, tenantId)
                .map(e -> parse(e.getResourceJson()))
                .orElseThrow(() -> new ResourceNotFoundException(id));
    }

    @Search
    public List<Practitioner> search(
            @OptionalParam(name = Practitioner.SP_FAMILY)     StringParam family,
            @OptionalParam(name = Practitioner.SP_GIVEN)      StringParam given,
            @OptionalParam(name = Practitioner.SP_IDENTIFIER) TokenParam identifier,
            @OptionalParam(name = Practitioner.SP_NAME)       StringParam name,
            RequestDetails requestDetails) {

        String tenantId = TenantContext.require();
        List<FhirResourceEntity> entities;

        if (family != null) {
            entities = repo.searchByJsonb(TYPE, tenantId,
                    "{\"name\":[{\"family\":\"" + esc(family.getValue()) + "\"}]}");
        } else if (identifier != null) {
            String v = esc(identifier.getValue()), s = identifier.getSystem();
            String filter = (s != null && !s.isEmpty())
                    ? "{\"identifier\":[{\"system\":\"" + esc(s) + "\",\"value\":\"" + v + "\"}]}"
                    : "{\"identifier\":[{\"value\":\"" + v + "\"}]}";
            entities = repo.searchByJsonb(TYPE, tenantId, filter);
        } else {
            entities = repo.findByResourceTypeAndTenantId(TYPE, tenantId);
        }

        return entities.stream().map(e -> parse(e.getResourceJson())).toList();
    }

    @Create
    public MethodOutcome create(@ResourceParam Practitioner practitioner, RequestDetails requestDetails) {
        String tenantId = TenantContext.require();
        String id = UUID.randomUUID().toString();
        practitioner.setId(id);

        FhirResourceEntity entity = new FhirResourceEntity();
        entity.setId(id);
        entity.setResourceType(TYPE);
        entity.setTenantId(tenantId);
        entity.setResourceJson(fhirContext.newJsonParser().encodeResourceToString(practitioner));
        entity.setVersionId(1L);
        entity.setCreatedAt(Instant.now());
        entity.setUpdatedAt(Instant.now());
        repo.save(entity);

        MethodOutcome outcome = new MethodOutcome();
        outcome.setId(new IdType(TYPE, id, "1"));
        outcome.setCreated(true);
        return outcome;
    }

    private Practitioner parse(String json) {
        return fhirContext.newJsonParser().parseResource(Practitioner.class, json);
    }

    private static String esc(String v) {
        return v == null ? "" : v.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
```

- [ ] **Step 4.4: Create `CoverageResourceProvider.java`**

```java
package com.simintero.enstellar.interop.providers;

import ca.uhn.fhir.context.FhirContext;
import ca.uhn.fhir.rest.annotation.*;
import ca.uhn.fhir.rest.api.MethodOutcome;
import ca.uhn.fhir.rest.api.server.RequestDetails;
import ca.uhn.fhir.rest.param.TokenParam;
import ca.uhn.fhir.rest.server.IResourceProvider;
import ca.uhn.fhir.rest.server.exceptions.ResourceNotFoundException;
import com.simintero.enstellar.interop.auth.TenantContext;
import com.simintero.enstellar.interop.persistence.FhirResourceEntity;
import com.simintero.enstellar.interop.persistence.FhirResourceRepository;
import org.hl7.fhir.instance.model.api.IIdType;
import org.hl7.fhir.r4.model.Coverage;
import org.hl7.fhir.r4.model.IdType;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Component
public class CoverageResourceProvider implements IResourceProvider {

    private static final String TYPE = "Coverage";

    @Autowired private FhirContext fhirContext;
    @Autowired private FhirResourceRepository repo;

    @Override
    public Class<Coverage> getResourceType() { return Coverage.class; }

    @Read
    public Coverage read(@IdParam IIdType id, RequestDetails requestDetails) {
        String tenantId = TenantContext.require();
        return repo.findByIdAndResourceTypeAndTenantId(id.getIdPart(), TYPE, tenantId)
                .map(e -> parse(e.getResourceJson()))
                .orElseThrow(() -> new ResourceNotFoundException(id));
    }

    @Search
    public List<Coverage> search(
            @OptionalParam(name = Coverage.SP_IDENTIFIER) TokenParam identifier,
            RequestDetails requestDetails) {

        String tenantId = TenantContext.require();
        List<FhirResourceEntity> entities;

        if (identifier != null) {
            String v = esc(identifier.getValue()), s = identifier.getSystem();
            String filter = (s != null && !s.isEmpty())
                    ? "{\"identifier\":[{\"system\":\"" + esc(s) + "\",\"value\":\"" + v + "\"}]}"
                    : "{\"identifier\":[{\"value\":\"" + v + "\"}]}";
            entities = repo.searchByJsonb(TYPE, tenantId, filter);
        } else {
            entities = repo.findByResourceTypeAndTenantId(TYPE, tenantId);
        }

        return entities.stream().map(e -> parse(e.getResourceJson())).toList();
    }

    @Create
    public MethodOutcome create(@ResourceParam Coverage coverage, RequestDetails requestDetails) {
        String tenantId = TenantContext.require();
        String id = UUID.randomUUID().toString();
        coverage.setId(id);

        FhirResourceEntity entity = new FhirResourceEntity();
        entity.setId(id);
        entity.setResourceType(TYPE);
        entity.setTenantId(tenantId);
        entity.setResourceJson(fhirContext.newJsonParser().encodeResourceToString(coverage));
        entity.setVersionId(1L);
        entity.setCreatedAt(Instant.now());
        entity.setUpdatedAt(Instant.now());
        repo.save(entity);

        MethodOutcome outcome = new MethodOutcome();
        outcome.setId(new IdType(TYPE, id, "1"));
        outcome.setCreated(true);
        return outcome;
    }

    private Coverage parse(String json) {
        return fhirContext.newJsonParser().parseResource(Coverage.class, json);
    }

    private static String esc(String v) {
        return v == null ? "" : v.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
```

- [ ] **Step 4.5: Create `OrganizationResourceProvider.java`**

```java
package com.simintero.enstellar.interop.providers;

import ca.uhn.fhir.context.FhirContext;
import ca.uhn.fhir.rest.annotation.*;
import ca.uhn.fhir.rest.api.MethodOutcome;
import ca.uhn.fhir.rest.api.server.RequestDetails;
import ca.uhn.fhir.rest.param.StringParam;
import ca.uhn.fhir.rest.param.TokenParam;
import ca.uhn.fhir.rest.server.IResourceProvider;
import ca.uhn.fhir.rest.server.exceptions.ResourceNotFoundException;
import com.simintero.enstellar.interop.auth.TenantContext;
import com.simintero.enstellar.interop.persistence.FhirResourceEntity;
import com.simintero.enstellar.interop.persistence.FhirResourceRepository;
import org.hl7.fhir.instance.model.api.IIdType;
import org.hl7.fhir.r4.model.IdType;
import org.hl7.fhir.r4.model.Organization;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Component
public class OrganizationResourceProvider implements IResourceProvider {

    private static final String TYPE = "Organization";

    @Autowired private FhirContext fhirContext;
    @Autowired private FhirResourceRepository repo;

    @Override
    public Class<Organization> getResourceType() { return Organization.class; }

    @Read
    public Organization read(@IdParam IIdType id, RequestDetails requestDetails) {
        String tenantId = TenantContext.require();
        return repo.findByIdAndResourceTypeAndTenantId(id.getIdPart(), TYPE, tenantId)
                .map(e -> parse(e.getResourceJson()))
                .orElseThrow(() -> new ResourceNotFoundException(id));
    }

    @Search
    public List<Organization> search(
            @OptionalParam(name = Organization.SP_NAME)       StringParam name,
            @OptionalParam(name = Organization.SP_IDENTIFIER) TokenParam identifier,
            RequestDetails requestDetails) {

        String tenantId = TenantContext.require();
        List<FhirResourceEntity> entities;

        if (name != null) {
            entities = repo.searchByJsonb(TYPE, tenantId,
                    "{\"name\":\"" + esc(name.getValue()) + "\"}");
        } else if (identifier != null) {
            String v = esc(identifier.getValue()), s = identifier.getSystem();
            String filter = (s != null && !s.isEmpty())
                    ? "{\"identifier\":[{\"system\":\"" + esc(s) + "\",\"value\":\"" + v + "\"}]}"
                    : "{\"identifier\":[{\"value\":\"" + v + "\"}]}";
            entities = repo.searchByJsonb(TYPE, tenantId, filter);
        } else {
            entities = repo.findByResourceTypeAndTenantId(TYPE, tenantId);
        }

        return entities.stream().map(e -> parse(e.getResourceJson())).toList();
    }

    @Create
    public MethodOutcome create(@ResourceParam Organization organization, RequestDetails requestDetails) {
        String tenantId = TenantContext.require();
        String id = UUID.randomUUID().toString();
        organization.setId(id);

        FhirResourceEntity entity = new FhirResourceEntity();
        entity.setId(id);
        entity.setResourceType(TYPE);
        entity.setTenantId(tenantId);
        entity.setResourceJson(fhirContext.newJsonParser().encodeResourceToString(organization));
        entity.setVersionId(1L);
        entity.setCreatedAt(Instant.now());
        entity.setUpdatedAt(Instant.now());
        repo.save(entity);

        MethodOutcome outcome = new MethodOutcome();
        outcome.setId(new IdType(TYPE, id, "1"));
        outcome.setCreated(true);
        return outcome;
    }

    private Organization parse(String json) {
        return fhirContext.newJsonParser().parseResource(Organization.class, json);
    }

    private static String esc(String v) {
        return v == null ? "" : v.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
```

- [ ] **Step 4.6: Verify compile**

```bash
cd services/interop && ./gradlew compileJava
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 4.7: Commit**

```bash
git add services/interop/src/main/java/com/simintero/enstellar/interop/providers/
git commit -m "feat(interop): add Patient/Practitioner/Coverage/Organization resource providers"
```

---

## Task 5: HapiServerConfig — Wire the Server

**Files:**
- Delete: `src/main/java/com/simintero/enstellar/interop/config/InterceptorConfig.java`
- Create: `src/main/java/com/simintero/enstellar/interop/config/HapiServerConfig.java`

The `hapi-fhir-spring-boot-starter` auto-configuration uses `@ConditionalOnMissingBean(RestfulServer.class)`. Because we define our own `RestfulServer` bean here, the starter skips creating a duplicate but still registers it as a servlet at `/fhir/*` via its own `ServletRegistrationBean`.

- [ ] **Step 5.1: Delete `InterceptorConfig.java`**

```bash
rm services/interop/src/main/java/com/simintero/enstellar/interop/config/InterceptorConfig.java
```

- [ ] **Step 5.2: Create `HapiServerConfig.java`**

```java
package com.simintero.enstellar.interop.config;

import ca.uhn.fhir.context.FhirContext;
import ca.uhn.fhir.rest.api.EncodingEnum;
import ca.uhn.fhir.rest.server.RestfulServer;
import com.simintero.enstellar.interop.auth.TenantInterceptor;
import com.simintero.enstellar.interop.conformance.EnstellarCapabilityStatementProvider;
import com.simintero.enstellar.interop.providers.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.List;

/**
 * Wires the HAPI FHIR RestfulServer.
 *
 * Interceptor: TenantInterceptor fires on SERVER_INCOMING_REQUEST_PRE_HANDLED.
 * Spring Security has already validated the JWT before HAPI sees the request,
 * so TenantInterceptor only needs to extract tenant_id and set TenantContext.
 *
 * The hapi-fhir-spring-boot-starter auto-configuration detects this RestfulServer
 * bean (@ConditionalOnMissingBean) and registers it as a servlet at /fhir/*.
 */
@Configuration
public class HapiServerConfig {

    @Autowired private TenantInterceptor tenantInterceptor;
    @Autowired private FhirCapabilityProperties capabilityProperties;
    @Autowired private PatientResourceProvider patientProvider;
    @Autowired private PractitionerResourceProvider practitionerProvider;
    @Autowired private CoverageResourceProvider coverageProvider;
    @Autowired private OrganizationResourceProvider organizationProvider;

    @Bean
    public RestfulServer fhirServer(FhirContext fhirContext) {
        RestfulServer server = new RestfulServer(fhirContext);
        server.setDefaultResponseEncoding(EncodingEnum.JSON);
        server.setDefaultPrettyPrint(false);

        server.registerInterceptor(tenantInterceptor);

        server.registerProviders(List.of(
                patientProvider,
                practitionerProvider,
                coverageProvider,
                organizationProvider
        ));

        server.setServerConformanceProvider(
                new EnstellarCapabilityStatementProvider(server, capabilityProperties));

        return server;
    }
}
```

- [ ] **Step 5.3: Verify compile (both main and test)**

```bash
cd services/interop && ./gradlew compileJava compileTestJava
```

Expected: `BUILD SUCCESSFUL`. If `SecurityIntegrationTest` fails to compile because it references a missing `@ActiveProfiles("test")` with no `application-test.yml`, it will fail at runtime not compile-time — that is fine; we delete it in Task 7.

- [ ] **Step 5.4: Commit**

```bash
git add services/interop/src/main/java/com/simintero/enstellar/interop/config/HapiServerConfig.java
git rm services/interop/src/main/java/com/simintero/enstellar/interop/config/InterceptorConfig.java
git commit -m "feat(interop): replace InterceptorConfig with HapiServerConfig — wires providers + CapabilityStatement"
```

---

## Task 6: Test Infrastructure

**Files:**
- Create: `src/test/java/com/simintero/enstellar/interop/TestSecurityConfig.java`
- Create: `src/test/java/com/simintero/enstellar/interop/FhirTestBase.java`

- [ ] **Step 6.1: Create `TestSecurityConfig.java`**

```java
package com.simintero.enstellar.interop;

import com.nimbusds.jose.jwk.RSAKey;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;

/**
 * Provides a test RSA key pair and a @Primary JwtDecoder so integration tests
 * validate JWTs against a local key, not Keycloak.
 *
 * The static TEST_RSA_KEY is package-private so FhirTestBase.mintJwt() can sign with it.
 */
@TestConfiguration
public class TestSecurityConfig {

    static final RSAKey TEST_RSA_KEY = generateRsaKey();

    @Bean
    @Primary
    public JwtDecoder testJwtDecoder() throws Exception {
        RSAPublicKey publicKey = TEST_RSA_KEY.toRSAPublicKey();
        return NimbusJwtDecoder.withPublicKey(publicKey).build();
    }

    private static RSAKey generateRsaKey() {
        try {
            KeyPairGenerator gen = KeyPairGenerator.getInstance("RSA");
            gen.initialize(2048);
            KeyPair pair = gen.generateKeyPair();
            return new RSAKey.Builder((RSAPublicKey) pair.getPublic())
                    .privateKey((RSAPrivateKey) pair.getPrivate())
                    .keyID("test-key-1")
                    .build();
        } catch (Exception e) {
            throw new RuntimeException("Failed to generate test RSA key", e);
        }
    }
}
```

- [ ] **Step 6.2: Create `FhirTestBase.java`**

```java
package com.simintero.enstellar.interop;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.util.Date;

/**
 * Base class for all FHIR integration tests.
 *
 * - Shared Testcontainers PostgreSQL (static = started once per JVM, reused across test classes).
 * - @DynamicPropertySource wires the datasource URL and disables Keycloak JWKS lookup.
 * - TestSecurityConfig provides the @Primary JwtDecoder that validates test JWTs.
 * - mintJwt() signs JWTs with the test RSA key so TestRestTemplate HTTP calls pass Spring Security.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Testcontainers
@Import(TestSecurityConfig.class)
public abstract class FhirTestBase {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("hapi_test")
            .withUsername("hapi")
            .withPassword("hapi_secret");

    @DynamicPropertySource
    static void configureProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        // Override the Keycloak JWKS URI — TestSecurityConfig.testJwtDecoder() takes priority
        // via @Primary, so this value is never actually fetched.
        registry.add("spring.security.oauth2.resourceserver.jwt.jwk-set-uri",
                () -> "http://test-issuer-not-used");
    }

    @LocalServerPort
    protected int port;

    @Autowired
    protected TestRestTemplate restTemplate;

    /**
     * Mint a signed JWT for use in Bearer token headers.
     *
     * @param tenantId value for the "tenant_id" claim; pass null to omit it (tests 403 path)
     * @param scopes   space-separated SMART scopes, e.g. "patient/*.read patient/*.write"
     */
    protected static String mintJwt(String tenantId, String scopes) {
        try {
            JWTClaimsSet.Builder builder = new JWTClaimsSet.Builder()
                    .issuer("http://test-issuer")
                    .subject("test-user")
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
```

- [ ] **Step 6.3: Verify test compile**

```bash
cd services/interop && ./gradlew compileTestJava
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 6.4: Commit**

```bash
git add services/interop/src/test/java/com/simintero/enstellar/interop/TestSecurityConfig.java \
        services/interop/src/test/java/com/simintero/enstellar/interop/FhirTestBase.java
git commit -m "test(interop): add TestSecurityConfig and FhirTestBase for Testcontainers integration tests"
```

---

## Task 7: Integration Tests + Delete SecurityIntegrationTest

**Files:**
- Create: `src/test/java/com/simintero/enstellar/interop/SmartAuthIT.java`
- Create: `src/test/java/com/simintero/enstellar/interop/CapabilityStatementIT.java`
- Create: `src/test/java/com/simintero/enstellar/interop/TenantIsolationIT.java`
- Create: `src/test/java/com/simintero/enstellar/interop/PatientResourceIT.java`
- Delete: `src/test/java/com/simintero/enstellar/interop/SecurityIntegrationTest.java`

- [ ] **Step 7.1: Create `SmartAuthIT.java`**

```java
package com.simintero.enstellar.interop;

import org.junit.jupiter.api.Test;
import org.springframework.http.*;

import static org.assertj.core.api.Assertions.assertThat;

class SmartAuthIT extends FhirTestBase {

    @Test
    void unauthenticated_GET_Patient_returns_401() {
        ResponseEntity<String> response = restTemplate.getForEntity(
                "http://localhost:" + port + "/fhir/Patient", String.class);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    void unauthenticated_GET_metadata_returns_200() {
        ResponseEntity<String> response = restTemplate.getForEntity(
                "http://localhost:" + port + "/fhir/metadata", String.class);
        assertThat(response.getStatusCode().is2xxSuccessful()).isTrue();
    }

    @Test
    void authenticated_GET_Patient_with_valid_token_returns_200() {
        String token = mintJwt("test-tenant", "patient/*.read");
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(token);
        headers.setAccept(java.util.List.of(MediaType.valueOf("application/fhir+json")));

        ResponseEntity<String> response = restTemplate.exchange(
                "http://localhost:" + port + "/fhir/Patient",
                HttpMethod.GET,
                new HttpEntity<>(headers),
                String.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    }
}
```

- [ ] **Step 7.2: Create `CapabilityStatementIT.java`**

```java
package com.simintero.enstellar.interop;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.http.*;

import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.StreamSupport;

import static org.assertj.core.api.Assertions.assertThat;

class CapabilityStatementIT extends FhirTestBase {

    private static final ObjectMapper JSON = new ObjectMapper();

    @Test
    void metadata_returns_200_with_CapabilityStatement() throws Exception {
        ResponseEntity<String> response = restTemplate.getForEntity(
                "http://localhost:" + port + "/fhir/metadata", String.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        JsonNode cs = JSON.readTree(response.getBody());
        assertThat(cs.path("resourceType").asText()).isEqualTo("CapabilityStatement");
        assertThat(cs.path("publisher").asText()).isEqualTo("Simintero Enstellar");
        assertThat(cs.path("status").asText()).isEqualTo("active");
    }

    @Test
    void metadata_declares_four_resource_types() throws Exception {
        JsonNode cs = JSON.readTree(restTemplate.getForObject(
                "http://localhost:" + port + "/fhir/metadata", String.class));
        JsonNode resources = cs.path("rest").path(0).path("resource");

        Set<String> types = StreamSupport.stream(resources.spliterator(), false)
                .map(r -> r.path("type").asText())
                .collect(Collectors.toSet());

        assertThat(types).containsExactlyInAnyOrder("Patient", "Practitioner", "Coverage", "Organization");
    }

    @Test
    void patient_resource_declares_us_core_profile() throws Exception {
        JsonNode cs = JSON.readTree(restTemplate.getForObject(
                "http://localhost:" + port + "/fhir/metadata", String.class));
        JsonNode resources = cs.path("rest").path(0).path("resource");

        String patientProfile = StreamSupport.stream(resources.spliterator(), false)
                .filter(r -> "Patient".equals(r.path("type").asText()))
                .map(r -> r.path("profile").asText())
                .findFirst().orElse("");

        assertThat(patientProfile)
                .isEqualTo("http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient");
    }

    @Test
    void each_declared_interaction_endpoint_is_reachable() throws Exception {
        JsonNode cs = JSON.readTree(restTemplate.getForObject(
                "http://localhost:" + port + "/fhir/metadata", String.class));
        JsonNode resources = cs.path("rest").path(0).path("resource");

        for (JsonNode resourceNode : resources) {
            String type = resourceNode.path("type").asText();
            for (JsonNode interactionNode : resourceNode.path("interaction")) {
                String code = interactionNode.path("code").asText();
                String url;
                HttpMethod method;
                switch (code) {
                    case "read"        -> { url = "http://localhost:" + port + "/fhir/" + type + "/probe-id"; method = HttpMethod.GET; }
                    case "search-type" -> { url = "http://localhost:" + port + "/fhir/" + type; method = HttpMethod.GET; }
                    case "create"      -> { url = "http://localhost:" + port + "/fhir/" + type; method = HttpMethod.POST; }
                    default            -> { continue; }
                }

                // Without auth we expect 401, not 404. 401 means the endpoint IS registered.
                ResponseEntity<String> probe = restTemplate.exchange(
                        url, method, HttpEntity.EMPTY, String.class);

                assertThat(probe.getStatusCode().value())
                        .as("Interaction '%s' on '%s' must be registered (not 404)", code, type)
                        .isNotEqualTo(404);
            }
        }
    }
}
```

- [ ] **Step 7.3: Create `TenantIsolationIT.java`**

```java
package com.simintero.enstellar.interop;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.http.*;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class TenantIsolationIT extends FhirTestBase {

    private static final ObjectMapper JSON = new ObjectMapper();

    @Test
    void jwt_without_tenant_id_claim_returns_403() {
        String tokenWithoutTenant = mintJwt(null, "patient/*.read");
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(tokenWithoutTenant);
        headers.setAccept(List.of(MediaType.valueOf("application/fhir+json")));

        ResponseEntity<String> response = restTemplate.exchange(
                "http://localhost:" + port + "/fhir/Patient",
                HttpMethod.GET,
                new HttpEntity<>(headers),
                String.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    @Test
    void patient_created_in_tenant_A_is_invisible_to_tenant_B() throws Exception {
        String tokenA = mintJwt("tenant-alpha", "patient/*.read patient/*.write");
        String tokenB = mintJwt("tenant-beta", "patient/*.read");

        HttpHeaders headersA = fhirHeaders(tokenA);
        HttpHeaders headersB = new HttpHeaders();
        headersB.setBearerAuth(tokenB);
        headersB.setAccept(List.of(MediaType.valueOf("application/fhir+json")));

        String patientJson = """
                {
                  "resourceType": "Patient",
                  "identifier": [{"system": "http://example.org/mrn", "value": "ALPHA-ONLY-999"}],
                  "name": [{"family": "AlphaOnly", "given": ["Test"]}],
                  "gender": "unknown",
                  "birthDate": "1990-01-01"
                }
                """;

        // Create in tenant-alpha
        ResponseEntity<String> create = restTemplate.exchange(
                "http://localhost:" + port + "/fhir/Patient",
                HttpMethod.POST,
                new HttpEntity<>(patientJson, headersA),
                String.class);
        assertThat(create.getStatusCode()).isEqualTo(HttpStatus.CREATED);

        // Search from tenant-beta — must return 0 results
        ResponseEntity<String> search = restTemplate.exchange(
                "http://localhost:" + port + "/fhir/Patient?identifier=http://example.org/mrn|ALPHA-ONLY-999",
                HttpMethod.GET,
                new HttpEntity<>(headersB),
                String.class);
        assertThat(search.getStatusCode()).isEqualTo(HttpStatus.OK);

        JsonNode bundle = JSON.readTree(search.getBody());
        // HAPI may omit "total" on empty results; entry array absence also means 0.
        int entryCount = bundle.path("entry").size();
        assertThat(entryCount)
                .as("tenant-beta must not see tenant-alpha's patient").isEqualTo(0);
    }

    private HttpHeaders fhirHeaders(String token) {
        HttpHeaders h = new HttpHeaders();
        h.setBearerAuth(token);
        h.setContentType(MediaType.valueOf("application/fhir+json"));
        h.setAccept(List.of(MediaType.valueOf("application/fhir+json")));
        return h;
    }
}
```

- [ ] **Step 7.4: Create `PatientResourceIT.java`**

```java
package com.simintero.enstellar.interop;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.http.*;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class PatientResourceIT extends FhirTestBase {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String TENANT = "patient-it-tenant";

    @Test
    void create_and_read_patient_by_id() throws Exception {
        HttpHeaders headers = fhirHeaders(mintJwt(TENANT, "patient/*.read patient/*.write"));

        String patientJson = """
                {
                  "resourceType": "Patient",
                  "meta": {"profile": ["http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient"]},
                  "identifier": [{"system": "http://example.org/mrn", "value": "MRN-READ-001"}],
                  "name": [{"family": "Smith", "given": ["Alice"]}],
                  "gender": "female",
                  "birthDate": "1985-03-22"
                }
                """;

        ResponseEntity<String> createResponse = restTemplate.exchange(
                "http://localhost:" + port + "/fhir/Patient",
                HttpMethod.POST,
                new HttpEntity<>(patientJson, headers),
                String.class);
        assertThat(createResponse.getStatusCode()).isEqualTo(HttpStatus.CREATED);

        String location = createResponse.getHeaders().getFirst("Location");
        assertThat(location).isNotNull();
        String id = extractId(location, "Patient");

        ResponseEntity<String> readResponse = restTemplate.exchange(
                "http://localhost:" + port + "/fhir/Patient/" + id,
                HttpMethod.GET,
                new HttpEntity<>(headers),
                String.class);
        assertThat(readResponse.getStatusCode()).isEqualTo(HttpStatus.OK);

        JsonNode patient = JSON.readTree(readResponse.getBody());
        assertThat(patient.path("resourceType").asText()).isEqualTo("Patient");
        assertThat(patient.path("name").path(0).path("family").asText()).isEqualTo("Smith");
    }

    @Test
    void search_patient_by_family_name() throws Exception {
        HttpHeaders headers = fhirHeaders(mintJwt(TENANT, "patient/*.read patient/*.write"));

        createPatient(headers, "Jones", "Bob", "MRN-JONES-01");
        createPatient(headers, "Williams", "Carol", "MRN-WILLIAMS-01");

        ResponseEntity<String> searchResponse = restTemplate.exchange(
                "http://localhost:" + port + "/fhir/Patient?family=Jones",
                HttpMethod.GET,
                new HttpEntity<>(headers),
                String.class);
        assertThat(searchResponse.getStatusCode()).isEqualTo(HttpStatus.OK);

        JsonNode bundle = JSON.readTree(searchResponse.getBody());
        assertThat(bundle.path("resourceType").asText()).isEqualTo("Bundle");
        for (JsonNode entry : bundle.path("entry")) {
            String family = entry.path("resource").path("name").path(0).path("family").asText();
            assertThat(family).isEqualTo("Jones");
        }
    }

    @Test
    void search_patient_by_identifier() throws Exception {
        HttpHeaders headers = fhirHeaders(mintJwt(TENANT, "patient/*.read patient/*.write"));

        createPatient(headers, "Taylor", "David", "MRN-TAYLOR-01");

        ResponseEntity<String> searchResponse = restTemplate.exchange(
                "http://localhost:" + port + "/fhir/Patient?identifier=http://example.org/mrn|MRN-TAYLOR-01",
                HttpMethod.GET,
                new HttpEntity<>(headers),
                String.class);
        assertThat(searchResponse.getStatusCode()).isEqualTo(HttpStatus.OK);

        JsonNode bundle = JSON.readTree(searchResponse.getBody());
        boolean found = false;
        for (JsonNode entry : bundle.path("entry")) {
            for (JsonNode idNode : entry.path("resource").path("identifier")) {
                if ("MRN-TAYLOR-01".equals(idNode.path("value").asText())) {
                    found = true;
                }
            }
        }
        assertThat(found).as("Patient MRN-TAYLOR-01 should appear in search results").isTrue();
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private HttpHeaders fhirHeaders(String token) {
        HttpHeaders h = new HttpHeaders();
        h.setBearerAuth(token);
        h.setContentType(MediaType.valueOf("application/fhir+json"));
        h.setAccept(List.of(MediaType.valueOf("application/fhir+json")));
        return h;
    }

    private void createPatient(HttpHeaders headers, String family, String given, String mrn) {
        String json = """
                {
                  "resourceType": "Patient",
                  "identifier": [{"system": "http://example.org/mrn", "value": "%s"}],
                  "name": [{"family": "%s", "given": ["%s"]}],
                  "gender": "unknown",
                  "birthDate": "2000-01-01"
                }
                """.formatted(mrn, family, given);
        restTemplate.exchange(
                "http://localhost:" + port + "/fhir/Patient",
                HttpMethod.POST,
                new HttpEntity<>(json, headers),
                String.class);
    }

    private String extractId(String location, String resourceType) {
        // Location: http://host:port/fhir/Patient/<id>/_history/1
        String[] segments = location.split("/");
        for (int i = 0; i < segments.length - 1; i++) {
            if (resourceType.equals(segments[i])) {
                return segments[i + 1];
            }
        }
        throw new IllegalArgumentException("Cannot extract ID from Location: " + location);
    }
}
```

- [ ] **Step 7.5: Delete `SecurityIntegrationTest.java`**

```bash
rm services/interop/src/test/java/com/simintero/enstellar/interop/SecurityIntegrationTest.java
```

- [ ] **Step 7.6: Fix `TenantInterceptor` if it throws the wrong exception type**

The test `jwt_without_tenant_id_claim_returns_403` requires HTTP 403. Open `src/main/java/com/simintero/enstellar/interop/auth/TenantInterceptor.java` and verify the missing-tenant-id exception is `ForbiddenOperationException`, not `AuthenticationException`:

Current code in `TenantInterceptor.incomingRequest()`:
```java
throw new ca.uhn.fhir.rest.server.exceptions.AuthenticationException(
    "Token is missing required tenant_id claim"
);
```

Change to `ForbiddenOperationException` (maps to HTTP 403):
```java
throw new ca.uhn.fhir.rest.server.exceptions.ForbiddenOperationException(
    "Token is missing required tenant_id claim"
);
```

`AuthenticationException` maps to HTTP 401; `ForbiddenOperationException` maps to HTTP 403. The distinction matters: 401 = missing/invalid credentials; 403 = valid credentials but missing required claim.

- [ ] **Step 7.7: Run the full test suite**

```bash
cd services/interop && ./gradlew test 2>&1 | tail -40
```

First run downloads `postgres:16-alpine` via Testcontainers (~200 MB). Allow 3-5 minutes.

Expected:
```
SmartAuthIT > unauthenticated_GET_Patient_returns_401 PASSED
SmartAuthIT > unauthenticated_GET_metadata_returns_200 PASSED
SmartAuthIT > authenticated_GET_Patient_with_valid_token_returns_200 PASSED
CapabilityStatementIT > metadata_returns_200_with_CapabilityStatement PASSED
CapabilityStatementIT > metadata_declares_four_resource_types PASSED
CapabilityStatementIT > patient_resource_declares_us_core_profile PASSED
CapabilityStatementIT > each_declared_interaction_endpoint_is_reachable PASSED
TenantIsolationIT > jwt_without_tenant_id_claim_returns_403 PASSED
TenantIsolationIT > patient_created_in_tenant_A_is_invisible_to_tenant_B PASSED
PatientResourceIT > create_and_read_patient_by_id PASSED
PatientResourceIT > search_patient_by_family_name PASSED
PatientResourceIT > search_patient_by_identifier PASSED

12 tests completed, 0 failed
BUILD SUCCESSFUL
```

**Troubleshooting:**

*`authenticated_GET_Patient_with_valid_token_returns_200` returns 403:*
The JWT minted by `mintJwt("test-tenant", "patient/*.read")` includes `tenant_id`. If TenantInterceptor still rejects it, add a debug log in `TenantInterceptor.incomingRequest()` to print what `auth.getPrincipal()` returns. Ensure `TenantContext.set(tenantId)` is called (not thrown) when `tenantId` is present.

*Context fails to start with `spring.datasource.url not set`:*
Ensure `@Testcontainers` + `@Container` on the static field are present in `FhirTestBase`. The container must be `static` so it starts before `@DynamicPropertySource`.

*`NoSuchBeanDefinitionException: IFhirResourceDao`:*
This means a class still imports from `ca.uhn.fhir.jpa.*`. Run `grep -r "IFhirResourceDao\|jpa.api.dao" services/interop/src/main/` — if found, remove those references. The new providers use `FhirResourceRepository`, not HAPI DAOs.

*HAPI spring-boot-starter creates a second `RestfulServer`:*
If the log shows "Ambiguous bean definition for RestfulServer", check that `hapi-fhir-jpaserver-base` is not on the classpath (it can register its own server beans). Confirm it was removed from `build.gradle.kts` in Task 1.

- [ ] **Step 7.8: Commit**

```bash
git add services/interop/src/test/java/com/simintero/enstellar/interop/SmartAuthIT.java \
        services/interop/src/test/java/com/simintero/enstellar/interop/CapabilityStatementIT.java \
        services/interop/src/test/java/com/simintero/enstellar/interop/TenantIsolationIT.java \
        services/interop/src/test/java/com/simintero/enstellar/interop/PatientResourceIT.java \
        services/interop/src/main/java/com/simintero/enstellar/interop/auth/TenantInterceptor.java
git rm services/interop/src/test/java/com/simintero/enstellar/interop/SecurityIntegrationTest.java
git commit -m "test(interop): add SmartAuthIT, CapabilityStatementIT, TenantIsolationIT, PatientResourceIT; fix TenantInterceptor 403"
```

---

## Task 8: Makefile, CI, and Task Graph

**Files:**
- Modify: `Makefile`
- Modify: `.github/workflows/ci.yml`
- Modify: `.claude/task-graph.md`

- [ ] **Step 8.1: Add `interop-test` target to `Makefile`**

Open `Makefile`. After the `test-workflow:` block, insert (use a **tab** before `cd`, not spaces):

```makefile
## Run HAPI FHIR interop tests only (Testcontainers — requires Docker).
interop-test:
	cd services/interop && ./gradlew test
```

Also add `$(MAKE) interop-test` as the final line of the `test:` target so `make test` includes interop:

```makefile
## Run unit, contract, and integration tests across all services.
test:
	cd packages/canonical-model && uv run pytest tests/python/ -v
	cd packages/canonical-model && npm test
	cd packages/canonical-model && ./gradlew test
	cd services/workflow-engine && uv run pytest -v
	$(MAKE) interop-test
```

- [ ] **Step 8.2: Validate the Makefile**

```bash
make --dry-run interop-test
make --dry-run test
```

Expected: prints commands without executing. No errors.

- [ ] **Step 8.3: Replace `test-interop-security` in `.github/workflows/ci.yml`**

Find the block named `test-interop-security` and replace it entirely:

```yaml
  test-interop:
    name: services/interop — HAPI FHIR server tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          java-version: "21"
          distribution: "temurin"
      - name: Cache Gradle
        uses: actions/cache@v4
        with:
          path: |
            ~/.gradle/caches
            ~/.gradle/wrapper
          key: gradle-${{ hashFiles('services/interop/**/*.gradle.kts', 'services/interop/gradle/wrapper/gradle-wrapper.properties') }}
          restore-keys: gradle-
      - name: Run interop tests
        working-directory: services/interop
        run: ./gradlew test
      - name: Publish test report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: interop-test-report
          path: services/interop/build/reports/tests/test/
```

- [ ] **Step 8.4: Validate the CI YAML**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))" && echo "YAML valid"
```

Expected: `YAML valid`. Fix indentation if it fails (YAML requires spaces, not tabs).

- [ ] **Step 8.5: Mark T05 done in `.claude/task-graph.md`**

Find:
```
| T05 fhir-api + CapabilityStatement | JVM/HAPI | T02 | **sensitive (FHIR)** | `[ ]` |
```

Change to:
```
| T05 fhir-api + CapabilityStatement | JVM/HAPI | T02 | **sensitive (FHIR)** | `[x]` |
```

- [ ] **Step 8.6: Final test run to confirm nothing broke**

```bash
cd services/interop && ./gradlew test 2>&1 | grep -E "PASSED|FAILED|tests complete|BUILD"
```

Expected: `12 tests completed, 0 failed` and `BUILD SUCCESSFUL`.

- [ ] **Step 8.7: Commit**

```bash
git add Makefile .github/workflows/ci.yml .claude/task-graph.md
git commit -m "chore: wire T05 interop into Makefile + CI; mark T05 done"
```

---

## Verification Against T05 DoD

| DoD Item | Test |
|---|---|
| US Core Patient readable and searchable | `PatientResourceIT.create_and_read_patient_by_id`, `PatientResourceIT.search_patient_by_family_name` |
| Practitioner, Coverage, Organization readable and searchable | `CapabilityStatementIT.each_declared_interaction_endpoint_is_reachable` |
| `GET /fhir/metadata` returns CapabilityStatement from config | `CapabilityStatementIT.metadata_returns_200_with_CapabilityStatement` |
| Every request without valid SMART token returns 401 | `SmartAuthIT.unauthenticated_GET_Patient_returns_401` |
| Every request without `tenant_id` claim is rejected with 403 | `TenantIsolationIT.jwt_without_tenant_id_claim_returns_403` |
| Resources isolated by tenant | `TenantIsolationIT.patient_created_in_tenant_A_is_invisible_to_tenant_B` |
| CapabilityStatement declared resources match actual endpoints | `CapabilityStatementIT.each_declared_interaction_endpoint_is_reachable` |
| US Core profile declared for Patient/Practitioner/Organization | `CapabilityStatementIT.patient_resource_declares_us_core_profile` |

---

## Key Deviations from the Original T05 Plan

| Original Plan | This Plan | Why |
|---|---|---|
| Resource providers use `@Autowired IFhirResourceDao<Patient>` | Providers use `FhirResourceRepository` (Spring Data JPA) | `IFhirResourceDao<T>` beans are NOT auto-configured — root cause of all Task 7 failures |
| HAPI request partitioning (`RequestPartitionId`) | SQL `tenant_id` column + `TenantContext.require()` | Achieves identical isolation without HAPI JPA setup |
| `hapi-fhir-jpaserver-base` on classpath | Removed | Not needed; was the source of bean conflict errors |
| `SmartAuthInterceptor` (separate class) | Handled by Spring Security filter chain | Already in place from Tasks 1-6 |
| `FhirTestBase.createPartition()` helper | Not needed | No HAPI partitions; isolation is in SQL |
