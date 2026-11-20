# Optional: run The Salon App on a small cloud server.
# Data lives in /data — mount a persistent volume there.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
ENV NODE_ENV=production DATA_DIR=/data PORT=4000 HTTPS=0
VOLUME /data
EXPOSE 4000
CMD ["node", "server/index.js"]
