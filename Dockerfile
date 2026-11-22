FROM node:24.18.0-bookworm-slim AS frontend-build
WORKDIR /app
COPY frontend/package*.json frontend/
RUN npm ci --prefix frontend
COPY packages/ packages/
COPY frontend/ frontend/
RUN npm run build --prefix frontend

FROM node:24.18.0-bookworm-slim AS runtime
ENV NODE_ENV=production SMART_HOME_API_HOST=0.0.0.0 SMART_HOME_API_PORT=3101 SMART_HOME_DATA_DIR=/data
WORKDIR /app
COPY backend/package*.json backend/
RUN npm ci --omit=dev --prefix backend && npm cache clean --force
COPY backend/ backend/
COPY packages/ packages/
COPY --from=frontend-build /app/frontend/dist/ frontend/dist/
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3101
CMD ["node", "backend/server.mjs"]
