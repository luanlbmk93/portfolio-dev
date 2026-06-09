module.exports = {
  apps: [
    {
      name: 'odevcwb-disparador',
      cwd: '../disparador-gmail/server',
      script: 'index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        PORT: 3100,
        BASE_PATH: '/disparador-gmail',
      },
    },
  ],
};
