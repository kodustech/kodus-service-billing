module.exports = {
    apps: [
      {
        name: 'kodus-service-billing',
        script: 'lib/src/index.js',
        instances: 1,
        exec_mode: 'fork',
        autorestart: true,
        // The boot is fail-fast now: a database that is missing its schema, or
        // briefly unreachable, exits the process instead of serving a broken
        // one. Without a backoff that turns a transient outage into a
        // PERMANENT outage — pm2 counts sub-second exits against max_restarts
        // (16 by default), gives up in a few seconds, and pm2-runtime holds
        // PID 1 so Docker's `restart: unless-stopped` never fires.
        //
        // The backoff grows the delay between attempts (1s, 2s, 4s, …), so a
        // database that takes a minute to come up is waited out instead of
        // burning the budget, and the ceiling is raised for the same reason.
        // Restart policy belongs to the process manager, not to a retry loop
        // inside the boot path.
        exp_backoff_restart_delay: 1000,
        max_restarts: 50,
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