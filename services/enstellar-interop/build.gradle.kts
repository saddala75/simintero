plugins {
    java
    id("org.springframework.boot") version "3.3.0"
    id("io.spring.dependency-management") version "1.1.5"
    id("org.owasp.dependencycheck") version "10.0.3"
}

group = "com.simintero.enstellar"
version = "0.1.0"

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(21)
    }
}

tasks.withType<JavaCompile> {
    options.compilerArgs.add("-parameters")
}

repositories {
    mavenCentral()
    mavenLocal()
}

dependencies {
    implementation("io.simintero:simintero-tenant-context:1.0.0")
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter-security")
    implementation("org.springframework.boot:spring-boot-starter-oauth2-resource-server")
    implementation("org.springframework.boot:spring-boot-starter-data-jpa")

    // HAPI FHIR R4 — plain RestfulServer only (no HAPI JPA DAOs)
    implementation("ca.uhn.hapi.fhir:hapi-fhir-spring-boot-starter:7.4.0")
    implementation("ca.uhn.hapi.fhir:hapi-fhir-server:7.4.0")
    implementation("ca.uhn.hapi.fhir:hapi-fhir-structures-r4:7.4.0")

    // CH6: Apache HttpClient 5 for FHIR proxy
    implementation("org.apache.httpcomponents.client5:httpclient5:5.3.1")

    // T06: Kafka, MinIO, WebClient
    implementation("org.springframework.kafka:spring-kafka")
    implementation("io.minio:minio:8.5.10")
    implementation("org.springframework.boot:spring-boot-starter-webflux")
    implementation("com.fasterxml.jackson.core:jackson-databind")

    // T11: Flyway schema migration
    implementation("org.flywaydb:flyway-core")
    implementation("org.flywaydb:flyway-database-postgresql")

    runtimeOnly("org.postgresql:postgresql")

    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("org.springframework.security:spring-security-test")
    testImplementation("org.testcontainers:junit-jupiter:1.20.1")
    testImplementation("org.testcontainers:postgresql:1.20.1")
    testImplementation("com.nimbusds:nimbus-jose-jwt:9.40")

    // T06 test additions
    testImplementation("org.springframework.kafka:spring-kafka-test")
    testImplementation("org.testcontainers:kafka:1.20.1")
    testImplementation("org.testcontainers:minio:1.20.1")
    testImplementation("org.wiremock:wiremock-standalone:3.9.1")

    // T11 test additions
    testImplementation("org.awaitility:awaitility:4.2.1")

    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.test {
    useJUnitPlatform {
        if (!project.hasProperty("includeIntegration")) {
            excludeTags("integration")
        }
    }
}

dependencyCheck {
    failBuildOnCVSS = 7.0f          // CVSS 7.0+ = HIGH or CRITICAL
    suppressionFile = "dependency-check-suppress.xml"
    nvd.apiKey = System.getenv("NVD_API_KEY") ?: ""
    analyzers.assemblyEnabled = false   // no .NET on this JVM project
    analyzers.nodeEnabled = false       // JS scanned separately via npm audit
}
