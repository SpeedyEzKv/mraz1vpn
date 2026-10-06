# Сборка mini app и упаковка в Caddy: один контейнер отдаёт HTTPS, статику и проксирует API.
FROM node:22-alpine AS build
WORKDIR /web
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run lint:tokens && npm run build

FROM caddy:2-alpine
COPY --from=build /web/dist /srv/web
