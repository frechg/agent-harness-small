# Same CLI locally and on a hosted machine.
# Stage 1 is a one-shot command, not a server: `docker run ... "your task"`.

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN npm ci && npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY README.md .env.example ./
# Traces and scratch notes live here. Mount both if you want them on the host.
RUN mkdir -p /app/traces /app/scratch
ENTRYPOINT ["node", "dist/cli.js"]
