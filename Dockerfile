FROM node:20-slim

# Install Bun
RUN apt-get update && apt-get install -y curl unzip git \
    && curl -fsSL https://bun.sh/install | bash \
    && ln -s /root/.bun/bin/bun /usr/local/bin/bun

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies
RUN npm install

# Copy app files
COPY src/ ./src/
COPY public/ ./public/

# Clone and build free-code
RUN git clone https://github.com/paoloanzn/free-code.git /free-code \
    && cd /free-code \
    && bun install \
    && bun run build:dev:full

# Create workspace directory
RUN mkdir -p /workspace

# Expose port
EXPOSE 3000

# Environment
ENV PORT=3000
ENV HOST=0.0.0.0
ENV WORKSPACE_DIR=/workspace

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/api/health || exit 1

# Start command
CMD ["node", "src/server/index.js"]
