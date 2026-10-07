# The whole local demo in one container, for AWS: anvil fork of Base Sepolia (loaded from the exported state),
# exchange DB (PGlite), exchange-api, fork bridge with the CRE CLI, decoygen, indexer, and the Observatory UI,
# all behind apps/observatory/serve.ts on one port. Same config as localhost (README "Run the demo").
# Runtime state and secrets are NOT in the image: start.py pulls a private bundle from S3 at boot.
FROM oven/bun:1.4.2 AS bun
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl tar git python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/py \
    && /opt/py/bin/pip install --no-cache-dir boto3==1.40.0 numpy==2.2.6 scikit-learn==1.6.1 pycryptodome==3.23.0
ENV PATH="/opt/py/bin:${PATH}"
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN npm install --global pnpm@10.23.0
# anvil (Foundry 1.8.4, the version that exported the fork state) and the CRE CLI (same release and checksum as saladbkp/quorum-2049 infra/runtime)
RUN curl --fail --location --silent --show-error \
      https://github.com/foundry-rs/foundry/releases/download/v1.8.4/foundry_v1.8.4_linux_amd64.tar.gz -o /tmp/foundry.tgz \
    && tar -xzf /tmp/foundry.tgz -C /usr/local/bin anvil && rm /tmp/foundry.tgz \
    && curl --fail --location --silent --show-error \
      https://github.com/smartcontractkit/cre-cli/releases/download/v1.37.0/cre_linux_amd64_ldd2-35.tar.gz -o /tmp/cre.tgz \
    && echo '3c8a73540ed78210ab3ed23d792d8a6bfb4e56deb49bc77d61dfbdd54a147155  /tmp/cre.tgz' | sha256sum --check \
    && mkdir /tmp/cre && tar -xzf /tmp/cre.tgz -C /tmp/cre && install -m 755 /tmp/cre/cre_v1.37.0_linux_amd64 /usr/local/bin/cre \
    && rm -rf /tmp/cre /tmp/cre.tgz
WORKDIR /app
COPY . /app
RUN pnpm install --frozen-lockfile \
    && cd workflows && bun install --frozen-lockfile && cd .. \
    && cd apps/observatory && pnpm install --ignore-workspace --frozen-lockfile
RUN chown -R node:node /app
USER node
# no PORT here: exchange-api and the indexer read PORT too; serve.ts listens on its default 8443
ENV NODE_ENV=production DEPLOY_NAME=base-sepolia-fork
EXPOSE 8443
ENTRYPOINT ["python3", "/app/infra/fork/start.py"]
