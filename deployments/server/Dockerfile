FROM node:24-alpine
WORKDIR /app
COPY dist-server/server.mjs /app/server.mjs
ENV SHOWAI_SERVER_HOME=/data SHOWAI_SERVER_HOST=0.0.0.0 SHOWAI_SERVER_PORT=8788
EXPOSE 8788
VOLUME ["/data"]
USER node
CMD ["node", "/app/server.mjs"]
