FROM node:20-slim

# Install Bun + build deps for node-pty
RUN apt-get update && apt-get install -y curl unzip git build-essential python3 socat \
    && curl -fsSL https://bun.sh/install | bash \
    && ln -s /root/.bun/bin/bun /usr/local/bin/bun \
    && groupadd -r appuser && useradd -r -g appuser -m -d /home/appuser appuser \
    && mkdir -p /workspace /free-code /app \
    && chown appuser:appuser /workspace /free-code /app \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies (includes node-pty)
RUN npm ci

# Copy app files
COPY src/ ./src/
COPY vite.config.js svelte.config.js ./

# Build frontend (creates public/ directory with production assets)
RUN npm run build

# Clone and build free-code
RUN git clone https://github.com/paoloanzn/free-code.git /free-code \
    && cd /free-code \
    && bun install \
    && bun run build:dev:full \
    && chown -R appuser:appuser /free-code

# Add OpenRouter proxy (translates Anthropic API format to OpenRouter)
COPY or_proxy.mjs /free-code/or_proxy.mjs

# Create workspace directory
RUN mkdir -p /workspace

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 3000

# Environment
ENV PORT=3000
ENV HOST=0.0.0.0
ENV WORKSPACE_DIR=/workspace
ENV FREE_CODE_DIR=/free-code

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/api/health || exit 1

# Start command
CMD ["node", "src/server/index.js"]