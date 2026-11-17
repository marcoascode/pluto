# syntax=docker/dockerfile:1
# ---------- build do Vite ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# produção sempre fala com a API real (nada de mock)
ENV VITE_API_MOCK=false
# ID público do App Meta (vem do META_APP_ID do .env via docker-compose build.args)
ARG VITE_META_APP_ID=
ENV VITE_META_APP_ID=$VITE_META_APP_ID
RUN npm run build

# ---------- Nginx servindo o dist/ ----------
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1
