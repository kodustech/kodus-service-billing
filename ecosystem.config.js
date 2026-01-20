module.exports = {
    apps: [
      {
        name: 'kodus-service-billing',
        script: 'lib/src/index.js',
        instances: 1,
        exec_mode: 'fork',
        autorestart: true,
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