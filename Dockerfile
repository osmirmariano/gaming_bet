FROM oven/bun:1.2.0-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
RUN bun install
COPY . .
CMD ["bun", "run", "start"]
