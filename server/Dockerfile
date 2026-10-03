# syntax=docker/dockerfile:1
# ---------- build: compila o TypeScript e o argon2 (nativo) ----------
FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---------- runtime ----------
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache tini
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY migrations ./migrations
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:4000/health >/dev/null || exit 1
# tini repassa o SIGTERM do "docker stop" para o Node fechar conexões com calma
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
