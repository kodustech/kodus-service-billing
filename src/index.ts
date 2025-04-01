import "reflect-metadata"; // Importante para TypeORM
import express, { Express } from "express";
import bodyParser from "body-parser";
import helmet from "helmet";
import cors from "cors";
import { initializeDatabase } from "./config/database";
import subscriptionRoutes from "./routes/subscription.routes";
import corsOptions from "./config/utils/cors";
import "dotenv/config";

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

app.use("/api/billing", subscriptionRoutes);

app.listen(port, () => {
  console.log(`billing service listening to port ${port}`);
});
