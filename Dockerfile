FROM node:24-bookworm-slim AS build

WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/app/package.json apps/app/package.json
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
WORKDIR /workspace
LABEL org.opencontainers.image.title="Condui Community" \
      org.opencontainers.image.licenses="PolyForm-Perimeter-1.0.1"
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/apps/app/dist ./apps/app/dist
COPY --from=build /workspace/apps/app/community ./apps/app/community
COPY --from=build /workspace/apps/app/netlify/functions-offline ./apps/app/netlify/functions-offline
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||'8080')+'/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "apps/app/community/server.mjs"]
