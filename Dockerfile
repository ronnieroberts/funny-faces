FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY server ./server
COPY scripts ./scripts
COPY index.html ./
RUN node scripts/build.mjs > /dev/null
ENV FACES_NO_BUILD=1 HOST=0.0.0.0 PORT=8765 FACES_DATA=/data FACES_LAN_CONTROL=1
# Create the data folder owned by the unprivileged user BEFORE declaring it a volume: a new named volume copies this
# ownership, so the server can write auth.json and sessions.json.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 8765
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8765)+'/api/info').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "server/main.js"]
