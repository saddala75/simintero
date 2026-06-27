# Phase 5B — Inferno FHIR Conformance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire all five Da Vinci Inferno test suites (US Core, SMART App Launch, PAS, CRD, DTR) as a gating CI check on every PR to `main`, and fix the known CapabilityStatement gaps that cause those suites to fail immediately.

**Architecture:** `FhirProxyFilter` already proxies `GET /fhir/metadata` to the upstream HAPI JPA store — no HAPI RestfulServer interceptor ever sees it. A new `CapabilityStatementAugmenter` component is injected into the filter and called on every 200 metadata response to add the missing publisher, implementationGuide references, and four resource entries (Claim+operations, ClaimResponse, Questionnaire, QuestionnaireResponse). Five Inferno test kit Docker containers are added to `docker-compose.yml` under a `conformance` profile; a shell script drives each via its REST API; and `conformance.yml` adds a `pull_request` trigger that calls the script.

**Tech Stack:** Java 23, Spring Boot 3.x, HAPI FHIR 7.4.0, Jackson (already on classpath), Docker Compose profiles, Inferno Framework (Ruby Sinatra, port 4567 per container), Bash + `curl` + `jq`.

## Global Constraints

- HAPI FHIR version: `7.4.0` (all HAPI imports must use this version)
- Inferno images: `ghcr.io/inferno-community/us-core-test-kit:latest`, `ghcr.io/inferno-community/smart-app-launch-test-kit:latest`, `ghcr.io/inferno-framework/davinci-pas-test-kit:latest`, `ghcr.io/inferno-framework/davinci-crd-test-kit:latest`, `ghcr.io/inferno-framework/davinci-dtr-test-kit:latest`
- Inferno internal port: `4567` (Puma default for all Inferno Framework images); host ports: 4545/4546/4547/4548/4549
- Conformance test token: `conformance-test-token` (static, CI only — never used in staging/production)
- No new Gradle dependencies — Jackson (`com.fasterxml.jackson.databind`) is already on classpath via Spring Boot starter
- Run tests: `cd services/enstellar-interop && ./gradlew test --console=plain`
- CapabilityStatement IGs to declare (exact URLs, copied verbatim into augmenter):
  - `http://hl7.org/fhir/us/core/ImplementationGuide/hl7.fhir.us.core|5.0.1`
  - `http://hl7.org/fhir/us/davinci-pas/ImplementationGuide/hl7.fhir.us.davinci-pas|2.0.1`
  - `http://hl7.org/fhir/us/davinci-crd/ImplementationGuide/hl7.fhir.us.davinci-crd|2.0.1`
  - `http://hl7.org/fhir/us/davinci-dtr/ImplementationGuide/hl7.fhir.us.davinci-dtr|2.0.0`
- PAS profile on Claim: `http://hl7.org/fhir/us/davinci-pas/StructureDefinition/profile-claim-pas|2.0.1`
- PAS profile on ClaimResponse: `http://hl7.org/fhir/us/davinci-pas/StructureDefinition/profile-claimresponse-pas|2.0.1`
- DTR profile on Questionnaire: `http://hl7.org/fhir/us/davinci-dtr/StructureDefinition/dtr-questionnaire|2.0.0`
- DTR profile on QuestionnaireResponse: `http://hl7.org/fhir/us/davinci-dtr/StructureDefinition/dtr-questionnaireresponse|2.0.0`

---

### Task 1: CapabilityStatement augmenter

**Files:**
- Create: `services/enstellar-interop/src/main/java/com/simintero/enstellar/interop/proxy/CapabilityStatementAugmenter.java`
- Create: `services/enstellar-interop/src/test/java/com/simintero/enstellar/interop/proxy/CapabilityStatementAugmenterTest.java`
- Modify: `services/enstellar-interop/src/main/java/com/simintero/enstellar/interop/proxy/FhirProxyFilter.java`
- Modify: `services/enstellar-interop/src/test/java/com/simintero/enstellar/interop/CapabilityStatementIT.java`
- Delete: `services/enstellar-interop/src/main/java/com/simintero/enstellar/interop/config/FhirCapabilityProperties.java`
- Modify: `services/enstellar-interop/src/main/resources/application.yml`

**Interfaces:**
- Produces: `CapabilityStatementAugmenter.augment(byte[]) → byte[]` — takes a raw JSON capability statement from the upstream proxy, returns augmented bytes. `public static final List<String> IMPLEMENTATION_GUIDES` — referenced by tests.

**Background:** `FhirProxyFilter` proxies all `/fhir/**` requests to an upstream HAPI store. `/fhir/metadata` goes through this proxy. In tests, `FhirTestBase.HAPI_MOCK` (WireMock) stubs `GET /fhir/metadata` to return a capability statement with 5 resource types: Patient, Practitioner, Coverage, Organization, DocumentReference. The augmenter runs in `doFilterInternal` after the 200 response arrives, appending 4 more entries before the bytes are written to the servlet response. `FhirCapabilityProperties` is a dead `@ConfigurationProperties` class that is never injected anywhere — it is safe to delete.

- [ ] **Step 1: Write failing unit tests for `CapabilityStatementAugmenter`**

Create `services/enstellar-interop/src/test/java/com/simintero/enstellar/interop/proxy/CapabilityStatementAugmenterTest.java`:

```java
package com.simintero.enstellar.interop.proxy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.StreamSupport;

import static org.assertj.core.api.Assertions.assertThat;

class CapabilityStatementAugmenterTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private final CapabilityStatementAugmenter augmenter = new CapabilityStatementAugmenter();

    @Test
    void augment_sets_publisher() throws Exception {
        JsonNode result = JSON.readTree(augmenter.augment(minimal()));
        assertThat(result.path("publisher").asText()).isEqualTo("Simintero Enstellar");
    }

    @Test
    void augment_adds_all_implementation_guides() throws Exception {
        JsonNode result = JSON.readTree(augmenter.augment(minimal()));
        Set<String> igs = toSet(result.path("implementationGuide"));
        assertThat(igs).containsExactlyInAnyOrderElementsOf(CapabilityStatementAugmenter.IMPLEMENTATION_GUIDES);
    }

    @Test
    void augment_adds_claim_with_submit_and_inquire_operations() throws Exception {
        JsonNode result = JSON.readTree(augmenter.augment(minimal()));
        JsonNode claim = resourceByType(result, "Claim");

        assertThat(claim.path("profile").asText())
            .isEqualTo("http://hl7.org/fhir/us/davinci-pas/StructureDefinition/profile-claim-pas|2.0.1");

        Set<String> ops = toSet(claim.path("operation"), "name");
        assertThat(ops).containsExactlyInAnyOrder("submit", "inquire");
    }

    @Test
    void augment_adds_claimresponse_questionnaire_questionnaireresponse() throws Exception {
        JsonNode result = JSON.readTree(augmenter.augment(minimal()));
        JsonNode resources = result.path("rest").path(0).path("resource");
        Set<String> types = toSet(resources, "type");
        assertThat(types).contains("ClaimResponse", "Questionnaire", "QuestionnaireResponse");
    }

    @Test
    void augment_preserves_existing_resources() throws Exception {
        JsonNode result = JSON.readTree(augmenter.augment(minimal()));
        JsonNode resources = result.path("rest").path(0).path("resource");
        Set<String> types = toSet(resources, "type");
        assertThat(types).contains("Patient");
    }

    // --- helpers ---

    private static byte[] minimal() {
        return """
            {"resourceType":"CapabilityStatement","status":"active",
             "rest":[{"mode":"server","resource":[{"type":"Patient"}]}]}
            """.getBytes();
    }

    private static JsonNode resourceByType(JsonNode cs, String type) {
        return StreamSupport.stream(cs.path("rest").path(0).path("resource").spliterator(), false)
            .filter(r -> type.equals(r.path("type").asText()))
            .findFirst()
            .orElseThrow(() -> new AssertionError(type + " not found in CapabilityStatement resources"));
    }

    private static Set<String> toSet(JsonNode arrayNode) {
        return StreamSupport.stream(arrayNode.spliterator(), false)
            .map(JsonNode::asText)
            .collect(Collectors.toSet());
    }

    private static Set<String> toSet(JsonNode arrayNode, String field) {
        return StreamSupport.stream(arrayNode.spliterator(), false)
            .map(n -> n.path(field).asText())
            .collect(Collectors.toSet());
    }
}
```

- [ ] **Step 2: Verify tests fail**

```bash
cd services/enstellar-interop && ./gradlew test --tests "*.CapabilityStatementAugmenterTest" --console=plain
```

Expected: FAILED — `CapabilityStatementAugmenter` class does not exist yet.

- [ ] **Step 3: Write `CapabilityStatementAugmenter`**

Create `services/enstellar-interop/src/main/java/com/simintero/enstellar/interop/proxy/CapabilityStatementAugmenter.java`:

```java
package com.simintero.enstellar.interop.proxy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.List;

@Component
public class CapabilityStatementAugmenter {

    private static final ObjectMapper JSON = new ObjectMapper();

    public static final List<String> IMPLEMENTATION_GUIDES = List.of(
        "http://hl7.org/fhir/us/core/ImplementationGuide/hl7.fhir.us.core|5.0.1",
        "http://hl7.org/fhir/us/davinci-pas/ImplementationGuide/hl7.fhir.us.davinci-pas|2.0.1",
        "http://hl7.org/fhir/us/davinci-crd/ImplementationGuide/hl7.fhir.us.davinci-crd|2.0.1",
        "http://hl7.org/fhir/us/davinci-dtr/ImplementationGuide/hl7.fhir.us.davinci-dtr|2.0.0"
    );

    public byte[] augment(byte[] capabilityStatementBytes) throws IOException {
        ObjectNode cs = (ObjectNode) JSON.readTree(capabilityStatementBytes);

        cs.put("publisher", "Simintero Enstellar");

        ArrayNode igs = cs.putArray("implementationGuide");
        IMPLEMENTATION_GUIDES.forEach(igs::add);

        // Ensure rest[0].resource exists
        if (cs.withArray("rest").isEmpty()) {
            cs.withArray("rest").addObject().put("mode", "server");
        }
        ArrayNode resources = ((ObjectNode) cs.withArray("rest").get(0)).withArray("resource");

        // Claim with $submit and $inquire operations
        ObjectNode claim = JSON.createObjectNode();
        claim.put("type", "Claim");
        claim.put("profile", "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/profile-claim-pas|2.0.1");
        claim.putArray("interaction").addObject().put("code", "create");
        ArrayNode claimOps = claim.putArray("operation");
        claimOps.addObject()
            .put("name", "submit")
            .put("definition", "http://hl7.org/fhir/us/davinci-pas/OperationDefinition/Claim-submit");
        claimOps.addObject()
            .put("name", "inquire")
            .put("definition", "http://hl7.org/fhir/us/davinci-pas/OperationDefinition/Claim-inquire");
        resources.add(claim);

        // ClaimResponse
        ObjectNode claimResponse = JSON.createObjectNode();
        claimResponse.put("type", "ClaimResponse");
        claimResponse.put("profile", "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/profile-claimresponse-pas|2.0.1");
        claimResponse.putArray("interaction");
        resources.add(claimResponse);

        // Questionnaire
        ObjectNode questionnaire = JSON.createObjectNode();
        questionnaire.put("type", "Questionnaire");
        questionnaire.put("profile", "http://hl7.org/fhir/us/davinci-dtr/StructureDefinition/dtr-questionnaire|2.0.0");
        questionnaire.putArray("interaction").addObject().put("code", "read");
        resources.add(questionnaire);

        // QuestionnaireResponse
        ObjectNode qr = JSON.createObjectNode();
        qr.put("type", "QuestionnaireResponse");
        qr.put("profile", "http://hl7.org/fhir/us/davinci-dtr/StructureDefinition/dtr-questionnaireresponse|2.0.0");
        ArrayNode qrInteraction = qr.putArray("interaction");
        qrInteraction.addObject().put("code", "create");
        qrInteraction.addObject().put("code", "read");
        resources.add(qr);

        return JSON.writeValueAsBytes(cs);
    }
}
```

- [ ] **Step 4: Run unit tests — must pass**

```bash
cd services/enstellar-interop && ./gradlew test --tests "*.CapabilityStatementAugmenterTest" --console=plain
```

Expected: `5 tests passed`

- [ ] **Step 5: Wire augmenter into `FhirProxyFilter`**

In `services/enstellar-interop/src/main/java/com/simintero/enstellar/interop/proxy/FhirProxyFilter.java`:

a) Add the field (after the existing `private final CloseableHttpClient httpClient;` declaration):

```java
private final CapabilityStatementAugmenter csAugmenter;
```

b) Update the constructor from:

```java
public FhirProxyFilter(HapiProperties props) {
    this.props = props;
    this.hapiBaseUrl = props.getBaseUrl();
    this.httpClient = HttpClients.createDefault();
}
```

to:

```java
public FhirProxyFilter(HapiProperties props, CapabilityStatementAugmenter csAugmenter) {
    this.props = props;
    this.hapiBaseUrl = props.getBaseUrl();
    this.httpClient = HttpClients.createDefault();
    this.csAugmenter = csAugmenter;
}
```

c) In `doFilterInternal`, after the `byte[] responseBody = ...` assignment (currently lines 127–129), add augmentation before the relay block:

```java
// Augment capability statement before relaying — adds publisher, implementationGuide,
// and Da Vinci resource entries (Claim/$submit/$inquire, ClaimResponse, Questionnaire, QR).
if (isMetadata && hapiResponse.getCode() == 200 && responseBody.length > 0) {
    try {
        responseBody = csAugmenter.augment(responseBody);
    } catch (IOException e) {
        logger.warn("Failed to augment CapabilityStatement; returning upstream response unmodified", e);
    }
}
```

Add `import java.io.IOException;` at the top of the file if not already present.

- [ ] **Step 6: Add/update `CapabilityStatementIT` assertions**

In `services/enstellar-interop/src/test/java/com/simintero/enstellar/interop/CapabilityStatementIT.java`:

a) Add imports at the top (after existing imports):

```java
import com.simintero.enstellar.interop.proxy.CapabilityStatementAugmenter;
```

b) Update `metadata_declares_required_resource_types` — change `containsExactlyInAnyOrder` to include the 4 new augmented types:

```java
@Test
void metadata_declares_required_resource_types() throws Exception {
    JsonNode cs = JSON.readTree(restTemplate.getForObject(
        "http://localhost:" + port + "/fhir/metadata", String.class));
    JsonNode resources = cs.path("rest").path(0).path("resource");

    Set<String> types = StreamSupport.stream(resources.spliterator(), false)
        .map(r -> r.path("type").asText())
        .collect(Collectors.toSet());

    assertThat(types).containsExactlyInAnyOrder(
        "Patient", "Practitioner", "Coverage", "Organization", "DocumentReference",
        "Claim", "ClaimResponse", "Questionnaire", "QuestionnaireResponse");
}
```

c) Add two new test methods at the end of the class (before the closing `}`):

```java
@Test
void metadata_augments_claim_resource_with_pas_operations() throws Exception {
    JsonNode cs = JSON.readTree(restTemplate.getForObject(
        "http://localhost:" + port + "/fhir/metadata", String.class));
    JsonNode resources = cs.path("rest").path(0).path("resource");

    JsonNode claim = StreamSupport.stream(resources.spliterator(), false)
        .filter(r -> "Claim".equals(r.path("type").asText()))
        .findFirst()
        .orElseThrow(() -> new AssertionError("Claim not found in CapabilityStatement resources"));

    assertThat(claim.path("profile").asText())
        .isEqualTo("http://hl7.org/fhir/us/davinci-pas/StructureDefinition/profile-claim-pas|2.0.1");

    Set<String> ops = StreamSupport.stream(claim.path("operation").spliterator(), false)
        .map(o -> o.path("name").asText())
        .collect(Collectors.toSet());
    assertThat(ops).contains("submit", "inquire");
}

@Test
void metadata_augments_implementation_guides() throws Exception {
    JsonNode cs = JSON.readTree(restTemplate.getForObject(
        "http://localhost:" + port + "/fhir/metadata", String.class));

    Set<String> igs = StreamSupport.stream(cs.path("implementationGuide").spliterator(), false)
        .map(JsonNode::asText)
        .collect(Collectors.toSet());

    assertThat(igs).containsAll(CapabilityStatementAugmenter.IMPLEMENTATION_GUIDES);
}
```

- [ ] **Step 7: Delete dead code — `FhirCapabilityProperties`**

Delete the file:
```bash
rm services/enstellar-interop/src/main/java/com/simintero/enstellar/interop/config/FhirCapabilityProperties.java
```

- [ ] **Step 8: Remove dead YAML block from `application.yml`**

In `services/enstellar-interop/src/main/resources/application.yml`, remove the entire `enstellar.fhir.capability` block (publisher + resources list):

```yaml
# REMOVE this entire block:
enstellar:
  fhir:
    capability:
      publisher: "Simintero Enstellar"
      resources:
        - type: Patient
          profile: "http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient|5.0.1"
          interactions: [read, search-type, create]
        - type: Practitioner
          profile: "http://hl7.org/fhir/us/core/StructureDefinition/us-core-practitioner|5.0.1"
          interactions: [read, search-type, create]
        - type: Coverage
          profile: "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/profile-coverage-pas|2.0.1"
          interactions: [read, search-type, create]
        - type: Organization
          profile: "http://hl7.org/fhir/us/core/StructureDefinition/us-core-organization|5.0.1"
          interactions: [read, search-type, create]
        - type: DocumentReference
          profile: "http://hl7.org/fhir/us/core/StructureDefinition/us-core-documentreference|5.0.1"
          interactions: [read, search-type, create]
```

Keep all other `enstellar.*` properties (`security`, `pas`, `digicore`, etc.).

- [ ] **Step 9: Run full interop test suite — all must pass**

```bash
cd services/enstellar-interop && ./gradlew test --console=plain
```

Expected output ends with: `BUILD SUCCESSFUL` — no test failures.

If `FhirCapabilityProperties` was referenced anywhere besides its own file, the compiler will tell you here. Grep with `grep -r "FhirCapabilityProperties" services/enstellar-interop/src` to confirm it's truly unreferenced before deleting — it should only appear in the class file itself.

- [ ] **Step 10: Commit**

```bash
git add services/enstellar-interop/src/main/java/com/simintero/enstellar/interop/proxy/CapabilityStatementAugmenter.java \
        services/enstellar-interop/src/test/java/com/simintero/enstellar/interop/proxy/CapabilityStatementAugmenterTest.java \
        services/enstellar-interop/src/main/java/com/simintero/enstellar/interop/proxy/FhirProxyFilter.java \
        services/enstellar-interop/src/test/java/com/simintero/enstellar/interop/CapabilityStatementIT.java \
        services/enstellar-interop/src/main/resources/application.yml
git rm services/enstellar-interop/src/main/java/com/simintero/enstellar/interop/config/FhirCapabilityProperties.java
git commit -m "feat(interop): augment CapabilityStatement with Da Vinci ops and IGs"
```

---

### Task 2: docker-compose conformance profile

**Files:**
- Modify: `docker-compose.yml`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: five `inferno-*` services under `profiles: [conformance]`; `interop` service gains `INTEROP_CONFORMANCE_TEST_MODE` and `INTEROP_CONFORMANCE_TEST_TOKEN` env vars

**Background:** The five Inferno test kit Docker images are standalone Ruby Sinatra apps. Each exposes port `4567` internally (Puma default). Verify with a quick local pull before committing; if a kit uses a different port, update the mapping. The `interop` service must have `INTEROP_CONFORMANCE_TEST_MODE: "${INTEROP_CONFORMANCE_TEST_MODE:-false}"` so CI can set it without affecting local dev (default is `false`, meaning the filter bean does not activate).

- [ ] **Step 1: Verify Inferno image ports locally**

Pull and inspect one image to confirm the internal port:

```bash
docker pull ghcr.io/inferno-community/us-core-test-kit:latest
docker inspect ghcr.io/inferno-community/us-core-test-kit:latest \
  --format='{{json .ContainerConfig.ExposedPorts}}'
```

Expected: `{"4567/tcp":{}}` — if the port differs, substitute the correct port in all five mappings in the next step. Do the same for the Da Vinci images (`ghcr.io/inferno-framework/davinci-pas-test-kit:latest`, etc.).

- [ ] **Step 2: Add conformance env vars to `interop` service**

In `docker-compose.yml`, inside the `interop:` service's `environment:` block, add two lines after `EXPECTED_AUDIENCE`:

```yaml
      INTEROP_CONFORMANCE_TEST_MODE: "${INTEROP_CONFORMANCE_TEST_MODE:-false}"
      INTEROP_CONFORMANCE_TEST_TOKEN: "${INTEROP_CONFORMANCE_TEST_TOKEN:-conformance-test-token}"
```

- [ ] **Step 3: Add five Inferno containers at end of `services:` section**

In `docker-compose.yml`, add after the last existing service definition (before the `networks:` block):

```yaml
  inferno-us-core:
    image: ghcr.io/inferno-community/us-core-test-kit:latest
    profiles: [conformance]
    ports:
      - "4545:4567"
    environment:
      FHIR_SERVER_URL: http://interop:8080/fhir
    depends_on:
      interop:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-sf", "http://localhost:4567/"]
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 90s
    networks:
      - sim-net

  inferno-smart:
    image: ghcr.io/inferno-community/smart-app-launch-test-kit:latest
    profiles: [conformance]
    ports:
      - "4546:4567"
    environment:
      FHIR_SERVER_URL: http://interop:8080/fhir
    depends_on:
      interop:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-sf", "http://localhost:4567/"]
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 90s
    networks:
      - sim-net

  inferno-pas:
    image: ghcr.io/inferno-framework/davinci-pas-test-kit:latest
    profiles: [conformance]
    ports:
      - "4547:4567"
    environment:
      FHIR_SERVER_URL: http://interop:8080/fhir
    depends_on:
      interop:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-sf", "http://localhost:4567/"]
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 90s
    networks:
      - sim-net

  inferno-crd:
    image: ghcr.io/inferno-framework/davinci-crd-test-kit:latest
    profiles: [conformance]
    ports:
      - "4548:4567"
    environment:
      FHIR_SERVER_URL: http://interop:8080/fhir
    depends_on:
      interop:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-sf", "http://localhost:4567/"]
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 90s
    networks:
      - sim-net

  inferno-dtr:
    image: ghcr.io/inferno-framework/davinci-dtr-test-kit:latest
    profiles: [conformance]
    ports:
      - "4549:4567"
    environment:
      FHIR_SERVER_URL: http://interop:8080/fhir
    depends_on:
      interop:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-sf", "http://localhost:4567/"]
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 90s
    networks:
      - sim-net
```

- [ ] **Step 4: Verify `docker compose config` parses without errors**

```bash
docker compose config --quiet
```

Expected: exits 0, no YAML parse errors.

- [ ] **Step 5: Discover actual Inferno suite IDs**

Pull one kit and run it temporarily to check the suite IDs reported by its API:

```bash
docker run --rm -d -p 4545:4567 \
  -e FHIR_SERVER_URL=http://host.docker.internal:8080/fhir \
  --name tmp-inferno-us-core \
  ghcr.io/inferno-community/us-core-test-kit:latest
sleep 10
curl -sf http://localhost:4545/api/test_suites | jq '[.[] | {id, title}]'
docker stop tmp-inferno-us-core
```

Expected output: JSON array with objects like `{"id": "us_core_v501", "title": "US Core v5.0.1"}`. Record the `id` values for all five kits — these are the `SUITE_ID` values used in the CI script (Task 3). If the IDs differ from `us_core_v501`, `smart_app_launch`, `davinci_pas_v201`, `davinci_crd`, `davinci_dtr`, update Task 3's script accordingly.

Repeat for each image that differs.

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add Inferno conformance profile to docker-compose"
```

---

### Task 3: CI script and conformance.yml update

**Files:**
- Create: `scripts/run-inferno-suites.sh`
- Modify: `.github/workflows/conformance.yml`

**Interfaces:**
- Consumes: five `inferno-*` containers from Task 2 at `localhost:4545`–`4549`; `interop` at `localhost:8080`; suite IDs confirmed in Task 2 Step 5
- Produces: `scripts/run-inferno-suites.sh` executable; `conformance.yml` gating on `pull_request`

**Important:** Suite IDs in the script below use the expected values (`us_core_v501`, `smart_app_launch`, `davinci_pas_v201`, `davinci_crd`, `davinci_dtr`). If Task 2 Step 5 found different IDs, substitute them here before committing.

- [ ] **Step 1: Create `scripts/run-inferno-suites.sh`**

```bash
#!/usr/bin/env bash
# Run all five Inferno conformance suites and report results.
# Exit code = number of failing suites (0 = all pass/skip, >=1 = failures).
# Requires: curl, jq
set -euo pipefail

FHIR_URL="${FHIR_URL:-http://localhost:8080/fhir}"
TOKEN="${INFERNO_CONFORMANCE_TOKEN:-conformance-test-token}"
FAILURES=0

run_suite() {
  local NAME="$1" BASE_URL="$2" SUITE_ID="$3"

  echo "==> [$NAME] creating session (suite=$SUITE_ID) ..."
  local SESSION_ID
  SESSION_ID=$(curl -sf -X POST "$BASE_URL/api/test_sessions" \
    -H "Content-Type: application/json" \
    -d "{\"test_suite_id\":\"$SUITE_ID\",
         \"inputs\":[{\"name\":\"url\",\"value\":\"$FHIR_URL\"},
                     {\"name\":\"additional_headers\",\"value\":\"Authorization: Bearer $TOKEN\"}]}" \
    | jq -r '.id')

  echo "    session_id=$SESSION_ID"

  curl -sf -X POST "$BASE_URL/api/test_sessions/$SESSION_ID/run" > /dev/null
  echo "    run started"

  local RESULT="running" i=0
  while [[ "$RESULT" == "running" && $i -lt 60 ]]; do
    sleep 5
    i=$((i + 1))
    RESULT=$(curl -sf "$BASE_URL/api/test_sessions/$SESSION_ID" | jq -r '.result // "running"')
  done

  echo "    result=$RESULT"
  if [[ "$RESULT" != "pass" ]]; then
    echo "  --- FAILURES ---"
    curl -sf "$BASE_URL/api/test_sessions/$SESSION_ID/results" \
      | jq -r '.[] | select(.result == "fail") | "  FAIL: \(.title)"' 2>/dev/null || true
    FAILURES=$((FAILURES + 1))
  fi
}

# Suite IDs must match GET /api/test_suites on each kit (verified in Task 2 Step 5).
run_suite "us-core" "http://localhost:4545" "us_core_v501"
run_suite "smart"   "http://localhost:4546" "smart_app_launch"
run_suite "pas"     "http://localhost:4547" "davinci_pas_v201"
run_suite "crd"     "http://localhost:4548" "davinci_crd"
run_suite "dtr"     "http://localhost:4549" "davinci_dtr"

echo ""
echo "$FAILURES suite(s) failed."
exit $FAILURES
```

- [ ] **Step 2: Make the script executable**

```bash
chmod +x scripts/run-inferno-suites.sh
```

- [ ] **Step 3: Smoke-test the script syntax**

```bash
bash -n scripts/run-inferno-suites.sh
```

Expected: no output, exits 0. (Bash syntax check only — does not require running Inferno containers.)

- [ ] **Step 4: Replace `conformance.yml` with the updated version**

Overwrite `.github/workflows/conformance.yml` with:

```yaml
name: Conformance
on:
  pull_request:
    branches: [main]
  schedule:
    - cron: "0 4 * * 1"  # Weekly Monday 4am UTC
  workflow_dispatch:

env:
  INTEROP_CONFORMANCE_TEST_MODE: "true"
  INTEROP_CONFORMANCE_TEST_TOKEN: "conformance-test-token"

jobs:
  fhir-conformance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Bring up interop + Inferno kits
        run: |
          docker compose --profile conformance up -d --wait \
            postgres keycloak hapi redpanda minio digicore-runtime interop \
            inferno-us-core inferno-smart inferno-pas inferno-crd inferno-dtr
      - name: Run Inferno suites
        run: bash scripts/run-inferno-suites.sh
      - name: Tear down
        if: always()
        run: docker compose --profile conformance down -v
```

- [ ] **Step 5: Validate the workflow YAML**

```bash
# Check that GitHub Actions can parse it (requires actionlint if available, or just yamllint)
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/conformance.yml'))"
```

Expected: exits 0 — no YAML parse errors.

- [ ] **Step 6: Commit**

```bash
git add scripts/run-inferno-suites.sh .github/workflows/conformance.yml
git commit -m "feat: gate Inferno PAS/CRD/DTR/US Core/SMART suites on every PR"
```
