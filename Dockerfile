FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

# Run the 24/7 daemon
CMD ["node", "standalone-worker.mjs"]
