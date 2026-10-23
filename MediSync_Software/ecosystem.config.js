
module.exports = {
  apps: [
    {
      name: "medisync",
      script: "./server.js",
      instances: 1,
      exec_mode: "fork",

      autorestart: true,
      min_uptime: "10s",
      max_restarts: 10,
      restart_delay: 3000,

      max_memory_restart: "300M",

      time: true,
      kill_timeout: 5000,
      exp_backoff_restart_delay: 100,

      env: {
        NODE_ENV: "development",
      },
    },
  ],
};
