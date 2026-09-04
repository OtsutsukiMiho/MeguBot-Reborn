# 🛡️ Discord Reverse Proxy Setup (Plan B)

This setup allows MeguBot's web server and bot REST calls to bypass Cloudflare IP blocks caused by shared hosting providers (such as Render.com free/shared tiers).

Instead of sending HTTP requests directly from Render's shared egress IP to `discord.com`, traffic is routed through a lightweight, free **Cloudflare Worker** running on Cloudflare's global edge network. Cloudflare WAF never blocks its own edge worker IP addresses.

---

## ⚡ Quick 2-Minute Setup

### Step 1: Create the Cloudflare Worker
1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com/) (Free account).
2. On the left sidebar, click **Compute (Workers & Pages)** -> Click **Create application** -> **Create Worker**.
3. Name your worker (e.g. `megubot-discord-proxy`) and click **Deploy**.
4. Click **Edit code**.
5. Replace all code with the contents of [`scripts/cloudflare-discord-proxy.js`](./scripts/cloudflare-discord-proxy.js) and click **Deploy**.

---

### Step 2: (Optional but Recommended) Add Secret Protection
To prevent unauthorized users from discovering and using your proxy:
1. In your Worker dashboard, go to **Settings** -> **Variables and Secrets**.
2. Under **Secrets**, click **Add**.
3. Name: `PROXY_SECRET`
4. Value: `<create any secure string, e.g. megu_proxy_sec_778899>`
5. Click **Deploy**.

---

### Step 3: Configure Render Environment Variables
In your [Render.com Dashboard](https://dashboard.render.com/):
1. Go to your **MeguBot Web Service** -> **Environment**.
2. Add the following environment variable:
   ```env
   DISCORD_API_ENDPOINT = https://<your-worker-name>.<your-subdomain>.workers.dev/api/v10
   ```
3. If you configured `PROXY_SECRET` in Step 2, also add:
   ```env
   DISCORD_PROXY_SECRET = <the same secret string you entered in Cloudflare>
   ```
4. Save and let Render redeploy.

---

## 🧪 How to Verify
1. Visit `https://<your-worker-name>.<your-subdomain>.workers.dev/health` in your browser.
   - It should return: `{"status":"healthy","proxy":"megu-discord-proxy"}`
2. Log in to your MeguBot website with Discord.
   - The token exchange (`POST /oauth2/token`) and profile fetches (`GET /users/@me`) will route through the Cloudflare Worker.
   - Discord receives the requests from Cloudflare's edge network and responds `200 OK`, completely bypassing the Render IP block!
