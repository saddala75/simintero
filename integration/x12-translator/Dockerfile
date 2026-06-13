FROM eclipse-temurin:21-jre-alpine
WORKDIR /app

COPY target/x12-translator-*.jar app.jar

ENV JAVA_OPTS="-Xmx512m -Xms256m"
ENV SERVER_PORT=8082
EXPOSE 8082

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
