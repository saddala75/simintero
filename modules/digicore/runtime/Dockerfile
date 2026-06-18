# --- Build stage: compile + package from source (so the image always matches the committed source) ---
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build
COPY pom.xml .
COPY src ./src
RUN mvn -q -B -DskipTests package

# --- Runtime stage ---
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY --from=build /build/target/digicore-runtime-*.jar app.jar

ENV JAVA_OPTS="-Xmx1536m -Xms512m"
ENV SERVER_PORT=8083
EXPOSE 8083

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
