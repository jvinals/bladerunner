FROM node:20-alpine
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* .npmrc ./
COPY packages/ ./packages/
COPY apps/web/ ./apps/web/
RUN pnpm install --frozen-lockfile || pnpm install
EXPOSE 5173
CMD ["pnpm", "--filter", "@pilot/web", "dev", "--host", "0.0.0.0"]
