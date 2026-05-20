# Railway: avoid Nixpacks (nix store exhausts builder disk). Node 20 + npm ci only.
FROM node:20-bookworm-slim

WORKDIR /app

# @tensorflow/tfjs-node native addon
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
  && npm cache clean --force

COPY index.cjs ./
COPY middleware ./middleware
COPY lib ./lib
COPY shared ./shared
COPY public ./public

RUN mkdir -p data public/uploads

ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=10s --start-period=180s --retries=5 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/health',(r)=>{let d='';r.on('data',()=>{});r.on('end',()=>process.exit(r.statusCode===200?0:1));}).on('error',()=>process.exit(1))"

CMD ["node", "index.cjs"]
