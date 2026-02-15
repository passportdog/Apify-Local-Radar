# Use Apify's optimized Playwright image
FROM apify/actor-node-playwright-chrome:20

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev --omit=optional \
    && npm cache clean --force

# Copy source code
COPY . ./

# Build TypeScript
RUN npm run build

# Run the actor
CMD ["npm", "start"]
