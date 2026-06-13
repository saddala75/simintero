FROM eclipse-temurin:21-jre-alpine
WORKDIR /app

COPY target/fhir-facade-*.jar app.jar

ENV JAVA_OPTS="-Xmx512m -Xms256m"
ENV SERVER_PORT=8081
EXPOSE 8081

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
