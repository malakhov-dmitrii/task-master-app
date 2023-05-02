const config = {
  bot_username: process.env.NODE_ENV === "development" ? "taskmaster_va_dev_bot" : "taskmaster_va_bot",
  web_app_url:
    process.env.NODE_ENV === "development"
      ? "https://1a73-61-19-77-58.ngrok-free.app"
      : "https://task-master-app-production.up.railway.app",
  author_username: "hennessy81",
};

export default config;
