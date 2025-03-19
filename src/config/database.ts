import { DataSource } from "typeorm";
import "dotenv/config";

export const AppDataSource = new DataSource({
  type: "postgres",
  host: process.env.NODE_ENV === "development" 
    ? "localhost" 
    : process.env.PG_DB_HOST,
  port: parseInt(process.env.PG_DB_PORT || "5432"),
  username: process.env.PG_DB_USERNAME,
  password: process.env.PG_DB_PASSWORD,
  database: process.env.PG_DB_DATABASE,
  schema: process.env.PG_DB_SCHEMA || "subscription",
  synchronize: process.env.NODE_ENV === "development",
  logging: process.env.NODE_ENV === "development",
  entities: ["src/entities/**/*.ts"],
  migrations: ["src/migrations/**/*.ts"],
  subscribers: ["src/subscribers/**/*.ts"],
});

// Função para inicializar o banco com o schema
export const initializeDatabase = async () => {
  // Primeiro, conecte sem especificar o schema
  const tempDataSource = new DataSource({
    type: "postgres",
    host: process.env.PG_DB_HOST || "db_postgres",
    port: parseInt(process.env.PG_DB_PORT || "5432"),
    username: process.env.PG_DB_USERNAME,
    password: process.env.PG_DB_PASSWORD,
    database: process.env.PG_DB_DATABASE,
  });

  await tempDataSource.initialize();

  try {
    // Cria o schema se não existir
    const schema = process.env.PG_DB_SCHEMA || "subscription";
    await tempDataSource.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    console.log(`Schema "${schema}" created or already exists`);
  } catch (error) {
    console.error("Error creating schema:", error);
  } finally {
    // Fecha a conexão temporária
    await tempDataSource.destroy();
  }

  // Agora inicializa o AppDataSource com o schema
  await AppDataSource.initialize();
  console.log("Main DataSource initialized successfully");
};
