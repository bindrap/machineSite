FROM node:20-slim AS base
WORKDIR /app

# Install GPU monitoring tools
RUN apt-get update && apt-get install -y \
    radeontop \
    procps \
    && rm -rf /var/lib/apt/lists/*

# Note: nvtop requires building from source or NVIDIA repos
# For NVIDIA GPU support, install nvtop separately or use NVIDIA container toolkit

COPY package*.json ./
RUN npm install --production

COPY server ./server
COPY public ./public

ENV PORT=3000
EXPOSE 3000

CMD ["npm", "start"]
