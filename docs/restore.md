# Restoring a backup

How to put the budget back to one of the snapshots `deploy/backup.sh` writes. Taking those
snapshots is covered in [deploy-agent.md](deploy-agent.md) (step 7 and "Updating later")
and [deploy.md](deploy.md#backups).

Restoring **replaces everything in the live database** with the snapshot. Whatever was
added since the snapshot was taken is gone from the app. Step 2 keeps a copy of it, so a
restore can itself be undone.

## If you are an AI assistant

Do this only when the owner has asked for a restore **in this conversation** and named the
snapshot, or picked it from the list in step 1. Never restore on your own judgement, for
example because an update failed: report the failure and wait.

Follow the steps in order; each ends with a **Check**, and you do not go on until it
passes. If one fails, stop and show the owner the command and its output.

The rules in [deploy-agent.md](deploy-agent.md#rules) still apply. In particular, never run
`docker compose down -v`, `docker volume rm` or `docker system prune --volumes`.

Run everything from `APP_DIR`, the folder that holds `compose.yaml`. `BACKUP_DIR` is where
the snapshots are (`/var/backups/pay-period-budget` in the guide's example).

## Step 1: Choose the snapshot

```bash
ls -lh BACKUP_DIR
```

Snapshots are named `app-<date>-<time>.db`, for example `app-20261014-030000.db`, taken at
3 a.m. on 14 October 2026. Show the owner the list and confirm which one; below it is
called `SNAPSHOT`.

**Check:** `BACKUP_DIR/SNAPSHOT` exists and is not empty.

## Step 2: Save what is there now

The app must still be running for this.

```bash
deploy/backup.sh BACKUP_DIR
```

**Check:** it prints `Saved BACKUP_DIR/app-<date>-<time>.db`, and that file exists and is
not empty. Tell the owner its name: it is the way back if the restore was a mistake. If
the app is not running, so this cannot work, say so and ask the owner whether to go on
without it.

## Step 3: Stop the app

```bash
docker compose stop app
```

**Check:** `docker compose ps app` no longer lists it as running.

## Step 4: Copy the snapshot in

```bash
docker compose run --rm -v BACKUP_DIR:/backups:ro app \
  sh -c 'cp /backups/SNAPSHOT /data/app.db && rm -f /data/app.db-wal /data/app.db-shm'
```

The two `rm`s matter: the `-wal` and `-shm` files belong to the database being replaced,
and SQLite would apply them to the snapshot if they were left.

**Check:** the command exits without an error.

## Step 5: Start it again

```bash
docker compose start app
```

**Check:** within about twenty seconds `docker compose ps` shows `healthy`. If it does
not, run `docker compose logs --tail 100 app` and report it.

## Step 6: The owner looks

Ask the owner to open the app and confirm the budget is as it was when the snapshot was
taken. Remind them of the step 2 file in case it is not.

## Restoring after a failed update

If a snapshot is being restored because an update went wrong, the code being run is still
the new version. On start it applies its database changes to the snapshot again, which may
fail the same way. Going back to the previous version of the code as well is a decision
for the owner; ask before changing what is checked out.
