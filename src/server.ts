import "dotenv/config";
import app from "./app.js";
import { connectDatabase } from "./config/db.js";
import { startWorkers } from "./modules/workers/worker.loop.js";

const PORT = process.env.PORT || 5000;

async function startServer(): Promise<void> {
  await connectDatabase();

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });

  startWorkers();
}

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
