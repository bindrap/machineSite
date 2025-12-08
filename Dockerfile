FROM node:20-alpine AS base
WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY server ./server
COPY public ./public

ENV PORT=3000
EXPOSE 3000

CMD ["npm", "start"]
