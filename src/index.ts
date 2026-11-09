import "dotenv/config";
import { createApp } from "./app.js";
import { loadEnvFile } from "node:process";

try {
  loadEnvFile();
} catch (error) {
  // Docker and shell environments can supply configuration without a .env file.
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const app = await createApp();
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
try {
  await app.listen({ port: Number(process.env.PORT ?? 3000), host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  await app.close();
  process.exit(1);
}
