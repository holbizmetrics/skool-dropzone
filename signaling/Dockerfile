# skool-dropzone signaling relay — container image for hosted deployment.
#
# The relay only routes SDP/ICE + ciphertext; it never sees meeting content
# (untrusted-relay model, see ../SECURITY-AUDIT.md). Hosting it publicly is
# therefore safe by design — but bind 0.0.0.0 ONLY on a platform that gives
# you TLS termination (wss://) in front of it.
#
# Build:  docker build -t sdz-relay ./signaling
# Run:    docker run -e HOST=0.0.0.0 -e PORT=8080 -p 8080:8080 sdz-relay
#
# Most PaaS (Fly.io / Render / Railway) inject $PORT and terminate TLS for you,
# so the browser reaches wss://<your-host> while the relay listens on plain ws.

FROM node:22-alpine
WORKDIR /app

# Install only production deps from the committed lockfile.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./

# 0.0.0.0 so the platform's proxy can reach it; TLS is the platform's job.
ENV HOST=0.0.0.0
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
