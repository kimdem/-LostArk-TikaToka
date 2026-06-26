FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm install --omit=dev --ignore-scripts

COPY public ./public
COPY src ./src
COPY server.js ./server.js

EXPOSE 5173
CMD ["npm", "start"]
