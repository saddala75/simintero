# syntax=docker/dockerfile:1
# Build context MUST be the repo root (compose sets context: ../..) because
# settings.gradle.kts does includeBuild("../../packages/canonical-model").
FROM gradle:8.7-jdk21 AS build
WORKDIR /src
COPY packages/canonical-model /src/packages/canonical-model
COPY services/interop /src/services/interop
WORKDIR /src/services/interop
RUN gradle bootJar --no-daemon

FROM eclipse-temurin:21-jre AS runtime
WORKDIR /app
RUN useradd -r -u 1001 -m appuser
COPY --from=build /src/services/interop/build/libs/interop-0.1.0.jar /app/app.jar
USER appuser
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
