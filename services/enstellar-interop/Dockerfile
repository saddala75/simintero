# syntax=docker/dockerfile:1
# Build context = repo root (compose: context: .).
# interop's gradle build needs (a) the simintero-tenant-context Maven lib in ~/.m2
# and (b) includeBuild("../../contracts/java-canonical"), which compiles ../generated/java.

# Stage 1: build + install the tenant-context Maven lib into ~/.m2
FROM maven:3.9-eclipse-temurin-21 AS lib
WORKDIR /lib
COPY platform/libs/tenant-context/java ./tenant-context
RUN mvn -f tenant-context/pom.xml install -DskipTests

# Stage 2: gradle build interop
# RUN steps in the gradle:8.7-jdk21 image execute as root (HOME=/root), so
# mavenLocal() resolves from /root/.m2 — copy the installed lib there.
FROM gradle:8.7-jdk21 AS build
COPY --from=lib /root/.m2 /root/.m2
WORKDIR /src
COPY contracts/java-canonical /src/contracts/java-canonical
COPY contracts/generated/java /src/contracts/generated/java
COPY services/enstellar-interop /src/services/enstellar-interop
WORKDIR /src/services/enstellar-interop
RUN gradle bootJar --no-daemon -x test

# Stage 3: runtime
FROM eclipse-temurin:21-jre AS runtime
WORKDIR /app
RUN useradd -r -u 1001 -m appuser
COPY --from=build /src/services/enstellar-interop/build/libs/interop-0.1.0.jar /app/app.jar
ADD https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/download/v2.6.0/opentelemetry-javaagent.jar /app/opentelemetry-javaagent.jar
RUN chown appuser:appuser /app/opentelemetry-javaagent.jar
ENV JAVA_TOOL_OPTIONS="-javaagent:/app/opentelemetry-javaagent.jar"
USER appuser
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
