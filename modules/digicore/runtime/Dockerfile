FROM eclipse-temurin:21-jre-alpine
WORKDIR /app

COPY target/digicore-runtime-*.jar app.jar

ENV JAVA_OPTS="-Xmx1536m -Xms512m"
ENV SERVER_PORT=8083
EXPOSE 8083

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
