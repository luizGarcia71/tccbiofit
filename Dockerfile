# Biofit — imagem para publicar online (Railway, Fly.io, Render, VPS com Docker)
FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
COPY public ./public
# /data deve ser um disco permanente (volume): é onde ficam o banco e as fotos.
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data TRUST_PROXY=1
RUN mkdir -p /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:${PORT}/api/saude || exit 1
CMD ["node", "server.js"]
