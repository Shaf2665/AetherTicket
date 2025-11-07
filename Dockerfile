FROM node:20-alpine

WORKDIR /app

# Install build dependencies for sqlite3
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Initialize database
RUN node -e "require('./dist/utils/database').initDatabase().catch(() => {})" || true

# Expose Web UI port
EXPOSE 8080

# Start the bot
CMD ["npm", "start"]

