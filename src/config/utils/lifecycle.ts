import { Server } from "http";
import { AppDataSource } from "../database";
import v8 from "v8";
import fs from "fs";
import path from "path";

/**
 * Defines where memory snapshots will be saved.
 * In production (Docker), we want them in the persistent volume.
 */
const SNAPSHOT_DIR = process.env.PM2_HOME
  ? "/app/logs"
  : path.join(process.cwd(), "logs");

export const setupLifecycleHandlers = (server: Server) => {
  // 1. Critical Error Handling (Uncaught Exception)
  process.on("uncaughtException", (err) => {
    console.error("CRITICAL: Uncaught Exception detected!", err);
    takeHeapSnapshot();
    gracefulShutdown(server, 1); // Exit with error
  });

  // 2. Unhandled Promise Rejection Handling
  process.on("unhandledRejection", (reason, promise) => {
    console.error(
      "CRITICAL: Unhandled Rejection at:",
      promise,
      "reason:",
      reason,
    );
    // In newer Node versions, this might crash the app. Better to ensure logging.
  });

  // 3. System Shutdown Signals (SIGINT = Ctrl+C / PM2 stop)
  process.on("SIGINT", () => {
    console.log("SIGINT received. Starting graceful shutdown...");
    gracefulShutdown(server, 0);
  });

  process.on("SIGTERM", () => {
    console.log("SIGTERM received. Starting graceful shutdown...");
    gracefulShutdown(server, 0);
  });
};

/**
 * Takes a snapshot of RAM memory for later debugging
 */
function takeHeapSnapshot() {
  try {
    // Ensure the directory exists
    if (!fs.existsSync(SNAPSHOT_DIR)) {
      fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    }

    const filename = `heap-dump-${new Date().toISOString().replace(/:/g, "-")}.heapsnapshot`;
    const filepath = path.join(SNAPSHOT_DIR, filename);

    console.log(`Taking heap snapshot to: ${filepath}...`);
    v8.writeHeapSnapshot(filepath);
    console.log("Heap snapshot created successfully.");
  } catch (e) {
    console.error("Failed to create heap snapshot:", e);
  }
}

/**
 * Shuts down the server gracefully
 */
async function gracefulShutdown(server: Server, exitCode: number) {
  // Safety timeout: If shutdown hangs, force exit in 45s
  setTimeout(() => {
    console.error("Shutdown timed out! Forcing exit.");
    process.exit(1);
  }, 45000).unref(); // unref allows the process to exit if this is the only timer

  try {
    // 1. Stop accepting new Web requests
    console.log("Closing HTTP server...");
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    console.log("HTTP server closed.");

    // 2. Close Database connection
    if (AppDataSource.isInitialized) {
      console.log("Closing Database connection...");
      await AppDataSource.destroy();
      console.log("Database connection closed.");
    }

    console.log("Graceful shutdown completed. Bye!");
    process.exit(exitCode);
  } catch (err) {
    console.error("Error during graceful shutdown:", err);
    process.exit(1);
  }
}
