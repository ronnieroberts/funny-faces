FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY server ./server
COPY scripts ./scripts
COPY index.html ./
RUN node scripts/build.mjs > /dev/null
ENV HOST=0.0.0.0 PORT=8765 FACES_DATA=/data FACES_LAN_CONTROL=1
VOLUME /data
EXPOSE 8765
USER node
CMD ["node", "server/main.js"]
