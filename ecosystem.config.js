module.exports = {
    apps: [
      {
        name: 'kodus-service-analytics',
        script: 'lib/src/index.js',
        instances: 1,
        autorestart: true,
        watch: false,
        max_memory_restart: '1G',
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