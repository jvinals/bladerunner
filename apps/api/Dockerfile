FROM node:20-alpine
# ffmpeg: encode CDP screencast MJPEG → WebM on the API host (remote browser worker cannot expose Playwright recordVideo files here)
RUN apk add --no-cache ffmpeg
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* .npmrc ./
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/
RUN pnpm install --frozen-lockfile || pnpm install
EXPOSE 3001
CMD ["pnpm", "--filter", "@bladerunner/api", "start:dev"]
