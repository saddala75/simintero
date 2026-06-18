FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY index.js ./
ENV PORT=3060
EXPOSE 3060
CMD ["node", "index.js"]
