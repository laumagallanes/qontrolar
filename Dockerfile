# syntax=docker/dockerfile:1

# --- Dependencias de producción (sin PGlite ni otras devDependencies) ---------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# --- Imagen final -------------------------------------------------------------
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0
WORKDIR /app

# Archivos propiedad de root y de sólo lectura para el usuario que ejecuta la app.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY migrations ./migrations
COPY public ./public
COPY src ./src

USER node
EXPOSE 3000

# /api/v1/health también verifica la conexión a la base de datos.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# El servidor aplica las migraciones pendientes al arrancar.
CMD ["node", "src/server.js"]
