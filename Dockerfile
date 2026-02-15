FROM apify/actor-node-playwright-chrome:20

COPY package*.json ./

RUN npm install

COPY . ./

RUN npx tsc

CMD ["npm", "start"]
