FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/ms-playwright CHROMIUM_NO_SANDBOX=1
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npx playwright install --with-deps chromium && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/dist ./dist
COPY templates ./templates
COPY fonts ./fonts
COPY public ./public
RUN mkdir -p output && chown -R node:node /app/output /ms-playwright
USER node
EXPOSE 3000
CMD ["node","dist/src/index.js"]
