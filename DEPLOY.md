# Host Dust & Dynamite on Render

The included `render.yaml` defines a single free Node web service. It serves both the game and its authoritative Socket.IO server. No database, secret key, separate frontend service, or paid domain is required.

## Publish

1. Upload the contents of this project folder to a GitHub repository. `render.yaml`, `package.json`, `package-lock.json`, `server.js`, and the `client` folder must be at the repository root. Do not upload `node_modules`.
2. Sign in to Render and create a **Blueprint** using that repository.
3. Review the service: **dust-and-dynamite**, Node runtime, **Free** compute plan, `npm ci --omit=dev` build command, `npm start` start command, and `/health` health check.
4. Deploy and wait for Render to report a live deployment. Open the actual `https://…onrender.com` address shown by Render.
5. Both players open that same address. Create a private room, share the five-character code, and ready up after your friend joins.

Alternatively, create a **Web Service** from the repository and enter the same commands manually. Leave Root Directory blank when the files are at the repository root. The server already listens on `0.0.0.0` and Render's `PORT` environment variable; no server code change is needed.

## Operation

- Keep exactly one service instance. Multiple independent instances would have different room lists.
- Automatic deploys are disabled in the Blueprint to avoid interrupting games on every source push. Deploy changes manually from Render after games finish.
- Free services sleep after 15 minutes without incoming traffic and may take about a minute to wake. Free resource and monthly usage limits apply.
- Restarts and deployments end active rounds and clear all room codes and scores. Players create a new room afterward.
- Use the assigned Render address first. A custom domain can be added after you own the domain and configure its DNS.
- Verify the deployment by opening the game, checking `/health` returns `ok: true`, and joining the same lobby in two browsers before readying up.

This configuration prepares the source; a public game URL exists only after a successful deployment in your Render account.

Official documentation:

- https://render.com/docs/blueprint-spec
- https://render.com/docs/deploy-node-express-app
- https://render.com/docs/free
- https://render.com/docs/websocket
