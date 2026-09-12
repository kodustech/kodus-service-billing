module.exports = {
    apps: [
      {
        name: 'kodus-service-billing',
        script: 'lib/src/index.js',
        instances: 1,
        exec_mode: 'fork',
        autorestart: true,
        // The boot is fail-fast now: a database missing its schema, or briefly
        // unreachable, exits the process instead of serving a broken one. Two
        // things then matter, and they pull in opposite directions.
        //
        // A backoff, so sub-second exits do not burn the restart budget in
        // seconds. pm2 grows the delay by ~1.5x from this value up to a 15s
        // ceiling (NOT 1s/2s/4s).
        //
        // And a SHORT window, so the retry ends up belonging to the CONTAINER.
        // pm2 restarting the process in place cannot fix the failure this
        // config is about: the pending migrations run in the entrypoint, which
        // only re-executes when the container does. Ten attempts is around a
        // minute of backoff — enough to ride out a database that is still
        // starting, short enough that Docker's `restart: unless-stopped` takes
        // over quickly, entrypoint and migrations included.
        //
        // `min_uptime` keeps this scoped to BOOT failures: a process that ran
        // for ten seconds and then crashed is restarted in place, with the
        // counter reset, exactly as before.
        exp_backoff_restart_delay: 1000,
        max_restarts: 10,
        min_uptime: 10000,
        watch: false,
        error_file: '/app/logs/pm2-error.log',
        out_file: '/app/logs/pm2-out.log',
        log_file: '/app/logs/pm2-combined.log',
        time: true,
        merge_logs: true,
        log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
        env: {
          NODE_ENV: 'development'
        },
        env_homolog: {
          NODE_ENV: 'homolog'
        },
        env_production: {
          NODE_ENV: 'production'
        }
      }
    ]
  }; 