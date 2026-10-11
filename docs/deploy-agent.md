# Deployment instructions for an AI assistant

You are deploying **Pay Period Budget** on a Linux server with Docker Compose. Follow the
steps in order. Each step ends with a **Check**; do not go on until it passes.

This setup has not been run on a server before. If a check fails, stop, show the owner the
command, its output and the last 100 lines of `docker compose logs app`, and wait. Do not
improvise around a failure.

## Rules

1. **Never run `docker compose down -v`, `docker volume rm`, or `docker system prune
   --volumes`.** The volume `pay-period-budget_data` is the owner's budget. Losing it loses
   everything.
2. **Do not edit the application's code, `Dockerfile` or `compose.yaml`.** Configuration
   goes in `.env` only. If one of those files seems wrong, report it.
3. **Do not touch nginx.** The owner is handling that separately. Step 8 tells you what to
   report so they can.
4. **Do not print the contents of `.env` back or commit it.** It is ignored by git; leave
   it that way.
5. Do not expose port 8787 to the network. It stays on `127.0.0.1`; nginx is the only way in.
6. Use `sudo` only where a step says so.

## What you need from the owner first

Ask for these if you were not given them:

| Name | Meaning | Example |
| --- | --- | --- |
| `DOMAIN` | The address the app will be opened at, without `https://` | `budget.mysite.com` |
| `APP_DIR` | Where the code goes | `/opt/pay-period-budget` |
| `BACKUP_DIR` | Where nightly database copies go | `/var/backups/pay-period-budget` |

The domain does not have to work yet. Steps 1 to 7 only need the name.

## Step 1: Docker is installed and starts at boot

```bash
docker --version && docker compose version && docker buildx version
```

If any of the three is missing, install them. On Arch:

```bash
sudo pacman -S --needed docker docker-compose docker-buildx
```

On Debian or Ubuntu, install Docker Engine with the compose and buildx plugins from
Docker's own repository, following docs.docker.com for that distribution.

```bash
sudo systemctl enable --now docker
```

**Check:** all three version commands print a version, and

```bash
systemctl is-enabled docker && systemctl is-active docker
```

prints `enabled` and `active`. `enabled` is what brings the app back after a reboot.

If `docker` commands fail with "permission denied" on the socket, either prefix them with
`sudo` for the rest of this document or ask the owner whether to add the user to the
`docker` group.

## Step 2: Get the code

The branch to deploy is **`main`**.

```bash
sudo mkdir -p APP_DIR && sudo chown "$USER": APP_DIR
git clone --branch main https://github.com/maximx1/pay-period-budget.git APP_DIR
```

If `APP_DIR` already holds a clone, update it instead:

```bash
git -C APP_DIR pull --ff-only origin main
```

Run every later command from inside `APP_DIR`.

**Check:** `ls` shows `compose.yaml`, `Dockerfile`, `.env.docker.example` and `deploy/`.

## Step 3: Configure

```bash
cp -n .env.docker.example .env
```

Edit `.env` so that it has exactly these two settings (leave the commented lines alone):

```
APP_URL=https://DOMAIN
ALLOW_REGISTRATION=true
```

`APP_URL` must be the address exactly as it will appear in a browser: `https://`, the
domain, no trailing slash, no path. The server refuses changes that come from any other
address.

Make sure nothing else is using the port:

```bash
ss -ltn | grep ':8787 ' || echo "8787 is free"
```

If it is taken, add `APP_PORT=8788` (or another free port) to `.env` and use that number
wherever this document says 8787.

**Check:** `grep -c '^APP_URL=https://' .env` prints `1`.

## Step 4: Build and start

```bash
docker compose up -d --build
```

The first build downloads a Node image and the dependencies; allow several minutes.

Wait for it to report healthy (up to two minutes):

```bash
for i in $(seq 1 24); do s=$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q app)"); echo "$s"; [ "$s" = healthy ] && break; sleep 5; done
```

**Check:** the last line printed is `healthy`, and all three of these succeed:

```bash
curl -fsS http://127.0.0.1:8787/api/health
```

prints `{"ok":true}`.

```bash
curl -fsS http://127.0.0.1:8787/api/auth/config
```

prints `{"registrationOpen":true}`.

```bash
curl -fsS -o /dev/null -w '%{http_code} %{content_type}\n' http://127.0.0.1:8787/
```

prints a line starting `200 text/html`.

If the container keeps restarting or never becomes healthy, stop here and report
`docker compose ps` and `docker compose logs app --tail 100`.

## Step 5: The data survives the container

The database is the file `/data/app.db` inside the container, kept in the Docker volume
`pay-period-budget_data`. Replacing the container must not replace the volume.

```bash
docker volume inspect pay-period-budget_data -f '{{.Mountpoint}}'
docker compose exec -T app ls -l /data
```

Note the size and time of `app.db`. Then replace the container and look again:

```bash
docker compose up -d --force-recreate app
```

Wait for `healthy` as in step 4, then:

```bash
docker compose exec -T app ls -l /data
```

**Check:** `app.db` is still there, and it was not recreated empty (same or larger size).

## Step 6: It comes back by itself

`compose.yaml` already sets `restart: unless-stopped`. Confirm it, then prove it.

```bash
docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$(docker compose ps -q app)"
```

must print `unless-stopped`.

Now simulate a crash. Use the host's `kill` on the container's main process. Do **not** use
`docker kill` or `docker stop` for this test: Docker treats those as "stopped on purpose"
and deliberately does not restart.

```bash
c=$(docker compose ps -q app); sudo kill -9 "$(docker inspect -f '{{.State.Pid}}' "$c")"
```

Wait for `healthy` as in step 4, then:

```bash
docker inspect -f '{{.RestartCount}} {{.State.Health.Status}}' "$(docker compose ps -q app)"
```

**Check:** it prints a restart count of `1` or more followed by `healthy`, and
`curl -fsS http://127.0.0.1:8787/api/health` prints `{"ok":true}` again.

What now happens without anyone doing anything:

| Event | Result |
| --- | --- |
| The server process crashes or is killed | Docker starts it again within seconds |
| The machine reboots | Docker starts at boot (step 1) and starts the container |
| Someone runs `docker compose stop` | It stays stopped until `docker compose start`. That is intended |
| It is running but frozen, not answering | The health check turns `unhealthy`. Docker reports that but does not act on it |

For the last row there is an optional watcher. **Ask the owner before enabling it**: it is a
third-party container that is given the Docker socket, which is equivalent to root on the
server.

```bash
docker compose --profile autoheal up -d
```

## Step 7: Nightly backups

```bash
sudo mkdir -p BACKUP_DIR && sudo chown "$USER": BACKUP_DIR
deploy/backup.sh BACKUP_DIR
```

**Check:** it prints `Saved BACKUP_DIR/app-<date>-<time>.db` and that file exists and is not
empty.

Schedule it. Create `/etc/systemd/system/budget-backup.service` (replace `APP_DIR`,
`BACKUP_DIR` and `USERNAME` with the real values; `USERNAME` is the user who can run
`docker`):

```ini
[Unit]
Description=Back up Pay Period Budget
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
User=USERNAME
WorkingDirectory=APP_DIR
ExecStart=APP_DIR/deploy/backup.sh BACKUP_DIR
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
sudo systemctl daemon-reload && sudo systemctl enable --now budget-backup.timer
sudo systemctl start budget-backup.service
```

**Check:** `systemctl is-enabled budget-backup.timer` prints `enabled`, and a second
`app-*.db` file has appeared in `BACKUP_DIR`.

Tell the owner: these copies are on the same server as the app. They protect against a bad
update or a mistake, not against losing the server. They also pile up; nothing deletes old
ones.

## Step 8: Report to the owner

Stop here and report. The owner sets up DNS and nginx; you do not. Tell them:

- The app is listening on `http://127.0.0.1:8787` on this server (or the port chosen in
  step 3), reachable only from the server itself.
- nginx needs a site for `DOMAIN` with a TLS certificate that forwards everything to that
  address. The `location` block must be:

  ```nginx
  location / {
      proxy_pass http://127.0.0.1:8787;
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
  }
  ```

  Plain `http://DOMAIN` should redirect to `https://`. No WebSocket or upload settings are
  needed.
- If nginx runs inside Docker rather than on the host, `127.0.0.1` will not reach the app
  from it. Say so; that needs a decision from the owner.
- The results of steps 4 to 7, including the restart count from the crash test.

## Step 9: After nginx is in place

When the owner says the domain is live:

```bash
curl -fsS https://DOMAIN/api/health
```

**Check:** prints `{"ok":true}`, with no certificate warning.

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://DOMAIN/api/auth/logout -H 'Origin: https://not-the-app.example'
```

**Check:** prints `403`. The server is refusing a request made from another website, which
is what `APP_URL` is for.

```bash
curl -s -o /dev/null -D - -X OPTIONS https://DOMAIN/api/auth/login -H 'Origin: https://localhost' -H 'Access-Control-Request-Method: POST' | grep -i 'access-control-allow-origin'
```

**Check:** prints `access-control-allow-origin: https://localhost`. That is the Android app
being allowed in.

Then the owner opens `https://DOMAIN` in a browser and creates their account. If saving
anything there fails with "Cross-origin request blocked", `APP_URL` in `.env` does not
match the address in the browser exactly; fix it and run `docker compose up -d`.

## Step 10: Close registration

Do this as soon as the owner confirms their account exists. Until then anyone who finds the
address can create an account of their own.

In `.env` change the line to:

```
ALLOW_REGISTRATION=false
```

```bash
docker compose up -d
```

**Check:** after it is `healthy` again,

```bash
curl -fsS https://DOMAIN/api/auth/config
```

prints `{"registrationOpen":false}`.

## Updating later

```bash
deploy/backup.sh BACKUP_DIR
git pull --ff-only origin main
docker compose up -d --build
```

Wait for `healthy` as in step 4. Database changes are applied automatically when the new
version starts. If it does not become healthy, report the logs; the backup just taken is
the way back.

## If something is wrong

| Symptom | Cause |
| --- | --- |
| `Set APP_URL in .env …` when starting | `.env` is missing or has no `APP_URL` |
| `compose build requires buildx` | `docker-buildx` is not installed (step 1) |
| Container restarts in a loop | Read `docker compose logs app`. Report it |
| "Cross-origin request blocked" in the browser | `APP_URL` is not exactly the address in the address bar |
| Signs in, then is signed out on the next page | The site is being opened over `http://`. It must be `https://` |
| "Too many attempts" for everyone at once | nginx is not sending `X-Forwarded-For`; check the block in step 8 |
| `502 Bad Gateway` from nginx | The container is not running or not on the port nginx forwards to: `docker compose ps` |

The longer explanation of every part is in `docs/deploy.md`.
