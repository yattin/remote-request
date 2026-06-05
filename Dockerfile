FROM oven/bun:1.3.12

WORKDIR /app
ENV NODE_ENV=production

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY src ./src

EXPOSE 8787

CMD ["bun", "src/index.ts"]
