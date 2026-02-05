import "reflect-metadata"; // Importante para TypeORM
import express, { Express } from "express";
import bodyParser from "body-parser";
import helmet from "helmet";
import cors from "cors";
import { initializeDatabase, AppDataSource } from "./config/database";
import subscriptionRoutes from "./routes/subscription.routes";
import corsOptions from "./config/utils/cors";
import { setupLifecycleHandlers } from "./config/utils/lifecycle";
import "dotenv/config";
import { registerApiDocs } from "./config/docs/registerDocs";

const app: Express = express();
const port = process.env.API_PORT || 3992;

// Inicializa o banco de dados com o schema
initializeDatabase()
  .then(() => {
    console.log("Database initialized successfully!");

    // Iniciar cron jobs após conexão com o banco
    console.log("Starting cron jobs...");
    import("./cron");
  })
  .catch((err) => {
    console.error("Error during database initialization", err);
  });

app.use(helmet());
app.use(cors(corsOptions));

// Configuração para processar o corpo bruto das requisições para webhooks
// Isso deve vir ANTES dos parsers de JSON
app.use((req, res, next) => {
  if (req.originalUrl === "/api/billing/webhook") {
    express.raw({ type: "application/json" })(req, res, next);
  } else {
    next();
  }
});

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json({ limit: "10mb" }));

registerApiDocs(app);

app.use("/api/billing", subscriptionRoutes);

/**
 * @openapi
 * /health:
 *   get:
 *     tags: [Health]
 *     summary: Liveness probe
 *     description: Returns basic service status and uptime.
 *     security: []
 *     responses:
 *       "200":
 *         description: Service is alive.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/HealthResponseDto"
 *       "400":
 *         description: Bad request.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "401":
 *         description: Unauthorized.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "403":
 *         description: Forbidden.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "500":
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

/**
 * @openapi
 * /health/ready:
 *   get:
 *     tags: [Health]
 *     summary: Readiness probe
 *     description: Checks database and Stripe readiness.
 *     security: []
 *     responses:
 *       "200":
 *         description: Service is ready.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/HealthReadyResponseDto"
 *       "503":
 *         description: Service is not ready.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/HealthReadyResponseDto"
 *       "400":
 *         description: Bad request.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "401":
 *         description: Unauthorized.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "403":
 *         description: Forbidden.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "500":
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 */
app.get("/health/ready", async (req, res) => {
  const isDatabaseReady = AppDataSource.isInitialized;
  const isStripeConfigured = !!process.env.STRIPE_SECRET_KEY;

  const ready = isDatabaseReady && isStripeConfigured;

  const statusCode = ready ? 200 : 503;
  res.status(statusCode).json({
    status: ready ? "ready" : "not ready",
    timestamp: new Date().toISOString(),
    dependencies: {
      database: isDatabaseReady ? "connected" : "disconnected",
      stripe: isStripeConfigured ? "configured" : "not configured",
    },
  });
});

const server = app.listen(port, () => {
  console.log(`billing service listening to port ${port}`);
});

setupLifecycleHandlers(server);
