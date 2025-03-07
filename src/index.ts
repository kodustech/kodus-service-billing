import express, { Express } from "express";
import bodyParser from "body-parser";
import helmet from "helmet";
import cors from "cors";
import "reflect-metadata"; // Importante para TypeORM
import { initializeDatabase } from "./config/database";
import subscriptionRoutes from "./routes/subscription.routes";
import corsOptions from "./config/utils/cors";
import cron from "./cron";
import "dotenv/config";

const app: Express = express();
const port = process.env.API_PORT || 3992;

// Inicializa o banco de dados com o schema
initializeDatabase()
  .then(() => {
    console.log("Database initialized successfully!");
    
    // Iniciar cron jobs após conexão com o banco
    cron;
  })
  .catch((err) => {
    console.error("Error during database initialization", err);
  });

app.use(helmet());
app.use(cors(corsOptions));

app.post("/webhook", express.raw({ type: "application/json" }));

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json({ limit: "10mb" }));

app.use("/api/subscription", subscriptionRoutes);

app.listen(port, () => {
  console.log(`Subscription service listening to port ${port}`);
});
