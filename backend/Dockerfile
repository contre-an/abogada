# Etapa 1: compilar dependencias en imagen completa (tiene build tools y headers necesarios)
FROM node:20 AS deps

WORKDIR /app
COPY package*.json ./
RUN npm install

# Etapa 2: imagen de runtime liviana — solo copiamos lo ya compilado
FROM node:20-slim

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

EXPOSE 3001

CMD ["node", "server.js"]
