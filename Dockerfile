FROM node:22-slim

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
COPY scripts/ ./scripts/
COPY vite.config.js svelte.config.js ./

# Build frontend (creates public/ directory with production assets)
RUN npm run build

# Clone and build free-code (non-fatal: if clone fails, app runs without free-code CLI features)
RUN set -e; \
    if git clone --depth 1 https://github.com/paoloanzn/free-code.git /free-code 2>/dev/null; then \
      cd /free-code \
      && bun install 2>/dev/null \
      && bun run build:dev:full 2>/dev/null \
      && chown -R appuser:appuser /free-code \
      && echo "[INFO] free-code built successfully"; \
    else \
      echo "[WARN] free-code clone failed, continuing without CLI features"; \
    fi

# Extract static prompts from free-code for backend prompt loader
RUN set -e; \
    if [ -d "/free-code/src" ]; then \
      printf '\n// BUILD-TIME EXPORTS for prompt extraction\nexport { getSimpleIntroSection,getSimpleSystemSection,getSimpleDoingTasksSection,getSimpleToneAndStyleSection,getOutputEfficiencySection };\n' >> /free-code/src/constants/prompts.ts \
      && cp /app/scripts/dump-static-prompts.ts /free-code/scripts/dump-static-prompts.ts \
      && cd /free-code \
      && printf '\n// BUILD-TIME MACRO definition for prompt extraction\nglobalThis.MACRO = { VERSION: "0.0.0", BUILD_TIME: "2000-01-01T00:00:00.000Z", PACKAGE_URL: "free-code", ISSUES_EXPLAINER: "Report issues at github.com/paoloanzn/free-code", FEEDBACK_CHANNEL: "github", VERSION_CHANGELOG: "local build", NATIVE_PACKAGE_URL: undefined };\n' | cat - /free-code/src/constants/prompts.ts > /tmp/prompts-patched.ts && mv /tmp/prompts-patched.ts /free-code/src/constants/prompts.ts \
      && bun run /free-code/scripts/dump-static-prompts.ts \
      && echo "[INFO] Static prompts extracted successfully"; \
    else \
      echo "[WARN] free-code not available, skipping prompt extraction"; \
    fi

# Copy optional files into /free-code (only if directory has content)
COPY or_proxy.mjs /free-code/or_proxy.mjs
COPY agent-config.json /free-code/agent-config.json

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
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:3000/api/health || exit 1

# Start command
CMD ["node", "src/server/index.js"]
