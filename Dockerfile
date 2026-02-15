FROM apify/actor-node-playwright-chrome:20

COPY package*.json ./

# Install ALL dependencies (including TypeScript for build)
RUN npm install

COPY . ./

# Build TypeScript
RUN npm run build

# Remove dev dependencies to slim down image
RUN npm prune --production

CMD ["npm", "start"]
