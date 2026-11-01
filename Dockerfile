# Vela — container image
FROM node:20-alpine
WORKDIR /app

# install production deps first (better layer caching)
COPY package*.json ./
RUN npm install --omit=dev

# app source
COPY . .

# uploaded media + the json "database" live here; mount a volume so they persist
VOLUME ["/app/data", "/app/uploads"]

ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
