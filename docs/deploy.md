# Deploying with Docker Compose

This runs Pay Period Budget as one container on your own server. It was written with an
Arch Linux host in mind, but nothing in it is Arch-specific beyond the install commands.

## What you get

- **One container** running the API and serving the web app on port 8787.
- **One volume** holding the SQLite database. The container itself is disposable.
- **Restarts by itself**: after a crash, and after the server reboots.
- **A health check** that passes only when the server is up and the database answers.
- **Locked down**: runs as a non-root user, read-only filesystem apart from the data
  volume, no Linux capabilities, capped log files.

Two optional extras can be switched on: a bundled Caddy for HTTPS, and a watcher that
restarts the app if it is running but no longer answering.

## 1. Install Docker (Arch)

```bash
sudo pacman -S docker docker-compose docker-buildx
```

```bash
sudo systemctl enable --now docker
```

`enable` is what brings the containers back after a reboot. `docker-buildx` is needed for
`docker compose build`.

## 2. Put the code on the server

Clone the repository onto the server:

```bash
git clone https://github.com/maximx1/pay-period-budget.git /opt/pay-period-budget
```

(Create `/opt/pay-period-budget` and give your user ownership of it first, or clone into a
folder you already own.)

Everything below is run on the server, in that folder.

## 3. Configure

```bash
cp .env.docker.example .env
```

If an AI assistant is doing this for you, give it [deploy-agent.md](deploy-agent.md)
instead: the same steps, written as instructions with a check after each one.

Edit `.env` and set **`APP_URL`** to the address you will type into the browser, for
example `https://budget.example.com`. It has to match exactly (scheme, host, and port if
there is one): the server refuses changes that come from any other address, which is what
stops another website from acting as you.

The Android app's own origin, `https://localhost`, is allowed as well by default, so the
phone app works without further setup. `APP_ALSO_ALLOW` in `.env` changes that.

## 4. Start it

```bash
docker compose up -d --build
```

```bash
docker compose ps
```

After about twenty seconds the status should read `healthy`. The app is now listening on
`127.0.0.1:8787`, reachable only from the server itself until you do the next step.

## 5. Put HTTPS in front of it

The session cookie is only sent over HTTPS, and a phone app will need HTTPS too. Pick one.

### A. You already run a reverse proxy

If the server already has Caddy, nginx or Traefik for other services, add a site that
forwards to `127.0.0.1:8787`.

Caddy:

```
budget.example.com {
	reverse_proxy 127.0.0.1:8787
}
```

nginx:

```nginx
server {
    listen 443 ssl;
    server_name budget.example.com;
    # ssl_certificate / ssl_certificate_key as for your other sites

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

`127.0.0.1` works when the proxy runs on the host or in a container using host networking.
If your proxy runs in its own Docker network instead, attach the `app` service to that
network and forward to `app:8787`.

### B. Use the bundled Caddy

For a server with no proxy yet and a domain whose DNS points at it. Ports 80 and 443 must
be reachable from the internet so Caddy can obtain a certificate.

In `.env`, set `APP_DOMAIN=budget.example.com` (the host part of `APP_URL`), then:

```bash
docker compose --profile caddy up -d
```

### C. Keep it private with Tailscale

A budget does not need to be on the public internet. If the server and your devices are on
a Tailscale network, Tailscale can provide the HTTPS address itself:

```bash
sudo tailscale serve --bg 8787
```

It prints an address like `https://yourserver.your-tailnet.ts.net`. Put that in `APP_URL`
and run `docker compose up -d` again. Only devices signed in to your tailnet can open it.
(Check `tailscale serve --help` if your version's syntax differs.)

### Trying it first without HTTPS

To look at it on your home network before setting any of that up, use these in `.env`:

```
APP_URL=http://yourserver:8787
APP_BIND=0.0.0.0
COOKIE_SECURE=false
TRUST_PROXY=false
```

Do not leave it like this: the password and session travel unencrypted.

## 6. Create your account, then close the door

Open the address, choose **Create account**, and set up your budget. Then stop anyone else
from registering: in `.env` set

```
ALLOW_REGISTRATION=false
```

```bash
docker compose up -d
```

The sign-in page now offers only sign-in.

### Turning assistant access off

An AI assistant reaches the budget with an API token made in Settings (see "Using it from
an AI assistant" in `README.md`). That is allowed unless you say otherwise. To refuse every
API token, set in `.env`

```
ALLOW_API_TOKENS=false
```

and run `docker compose up -d` again. Nothing is deleted: the tokens are still listed in
Settings, which says they are turned off, and they work again when the line is set back to
`true`. Signing in from the web app and the Android app is not affected.

## Reading screenshots

"Add transaction" has a second tab, **From screenshots**, that imports transactions from
screenshots of a bank's list. The server reads them itself with tesseract.js: nothing is
sent anywhere else, and nothing needs setting up. The first screenshot after a start takes
a few seconds longer while the reader loads; it then stays loaded, using some 100 to 200 MB
of memory.

### With a model of your own

If the built-in reader struggles with your bank's layout, a model you run yourself can work
out the transactions instead, through any OpenAI-compatible API (Ollama, LM Studio,
llama.cpp's server, vLLM). In `.env`:

```
SCAN_MODEL_URL=http://host.docker.internal:11434/v1
SCAN_MODEL=qwen2.5:7b
```

and run `docker compose up -d` again. `host.docker.internal` is this machine as seen from
inside the container; a model elsewhere on your network is reached by its own address.
`SCAN_MODEL_KEY` is sent as a bearer token if the API wants one.

By default the model is given the text the built-in reader found, laid out by position,
which any chat model can work with. For a model that can see, `SCAN_MODEL_IMAGES=true`
sends the picture itself. If the model fails or takes longer than
`SCAN_MODEL_TIMEOUT_SECONDS` (90 by default), the built-in reader's rows are used and the
review says so.

To stop using it without losing the settings, set `SCAN_MODEL_ENABLED=false` and run
`docker compose up -d`.

## Advice

An **Advice** section can be added to the side panel: a set list of questions ("Will I
make it to payday?", "What should I cut first?", ...), each answered in a few lines by a
model, from figures the server works out from your budget. It is off unless turned on. In
`.env`:

```
ADVICE_ENABLED=true
ADVICE_MODEL_URL=https://api.openai.com/v1
ADVICE_MODEL=gpt-4o-mini
ADVICE_MODEL_KEY=sk-...
```

and run `docker compose up -d` again. Any OpenAI-compatible API works, including the
local ones above. Each `ADVICE_MODEL_*` left out takes the matching `SCAN_MODEL_*`, so one
model can do both jobs. The two are switched separately: screenshots can use the built-in
reader (`SCAN_MODEL_ENABLED=false`) while Advice uses the model, or the other way round.

Answering a question sends that budget's figures to the model: amounts, dates, and the
names of transactions, bills and categories. With a hosted model such as OpenAI's, that
leaves this machine; with one you run yourself, it does not.

An answer that takes longer than `ADVICE_MODEL_TIMEOUT_SECONDS` (60 by default) is given
up on and the page says so. Each account can ask 30 questions an hour. The voice the
answers come in is chosen per account under Settings. Advice is not offered to an
assistant through the MCP server: an assistant can read the budget itself.

## How it heals itself

| What goes wrong | What happens |
| --- | --- |
| The server process crashes or is killed | Docker starts it again (`restart: unless-stopped`) |
| The machine reboots | Docker starts on boot (step 1) and brings the container back |
| It is running but stuck, no longer answering | The health check turns `unhealthy`. Docker reports this but does not act on it by itself |

For the last case, turn on the watcher:

```bash
docker compose --profile autoheal up -d
```

It restarts any container labelled `autoheal` whose health check is failing. It works by
talking to Docker through its socket, which amounts to root on the host; that is why it is
opt-in. If you would rather not, `docker compose ps` shows the health at a glance.

You stopped it on purpose? `docker compose stop` (or `down`) keeps it stopped;
`unless-stopped` respects that.

## Updating

```bash
deploy/backup.sh
```

```bash
git pull
```

```bash
docker compose up -d --build
```

Database changes are applied
automatically when the new version starts. If the new container does not become healthy,
`docker compose logs app` says why.

## Backups

Everything worth keeping is one SQLite file in the `data` volume.

```bash
deploy/backup.sh /var/backups/pay-period-budget
```

That writes a consistent snapshot named `app-<date>-<time>.db`, safely while the app is
running. Copying the raw file out of the volume while it is in use is not safe; use the
script.

To run it nightly with systemd, create `/etc/systemd/system/budget-backup.service`:

```ini
[Unit]
Description=Back up Pay Period Budget

[Service]
Type=oneshot
WorkingDirectory=/opt/pay-period-budget
ExecStart=/opt/pay-period-budget/deploy/backup.sh /var/backups/pay-period-budget
```

and `/etc/systemd/system/budget-backup.timer`:

```ini
[Unit]
Description=Nightly Pay Period Budget backup

[Timer]
OnCalendar=daily
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl enable --now budget-backup.timer
```

Snapshots accumulate; prune old ones however you prune other backups, and copy them off
the server if the server is the only place they exist.

### Restoring

[restore.md](restore.md) puts a snapshot back, after saving what is there now so the
restore can be undone. It is written so an AI assistant can follow it as well.

## Looking at what it is doing

```bash
docker compose logs -f app
```

```bash
docker compose ps
```

## When something is off

| Symptom | Likely cause |
| --- | --- |
| `Set APP_URL in .env …` when starting | `.env` is missing or has no `APP_URL` |
| Sign-in or any save fails with "Cross-origin request blocked" | `APP_URL` is not exactly the address in the browser. Fix it and run `docker compose up -d` |
| Sign-in appears to work, then you are signed out on the next page | You are on plain `http://` with `COOKIE_SECURE=true`. Use HTTPS, or see "Trying it first without HTTPS" |
| `compose build requires buildx` | Install `docker-buildx` (step 1) |
| Container restarts in a loop | `docker compose logs app`. A volume the `node` user cannot write to is the usual reason if you swapped the named volume for a folder; `chown 1000:1000` that folder |
| "Too many attempts" for everyone at once | Behind a proxy with `TRUST_PROXY=false`, every visitor looks like the proxy. Set it to `true` |

## Without Docker

Docker is not required. With Node 22 installed, `npm ci && npm run build`, then run
`npm start` under systemd with the same environment variables (`README.md` lists them) and
`Restart=on-failure`. The container route is recommended because it pins the Node version
and keeps the app off the host.
