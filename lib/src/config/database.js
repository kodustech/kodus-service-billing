"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeDatabase = exports.AppDataSource = void 0;
const typeorm_1 = require("typeorm");
require("dotenv/config");
exports.AppDataSource = new typeorm_1.DataSource({
    type: "postgres",
    host: process.env.PG_DB_HOST || "db_postgres",
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
const initializeDatabase = async () => {
    const tempDataSource = new typeorm_1.DataSource({
        type: "postgres",
        host: process.env.PG_DB_HOST || "db_postgres",
        port: parseInt(process.env.PG_DB_PORT || "5432"),
        username: process.env.PG_DB_USERNAME,
        password: process.env.PG_DB_PASSWORD,
        database: process.env.PG_DB_DATABASE,
    });
    await tempDataSource.initialize();
    try {
        const schema = process.env.PG_DB_SCHEMA || "subscription";
        await tempDataSource.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
        console.log(`Schema "${schema}" created or already exists`);
    }
    catch (error) {
        console.error("Error creating schema:", error);
    }
    finally {
        await tempDataSource.destroy();
    }
    await exports.AppDataSource.initialize();
    console.log("Main DataSource initialized successfully");
};
exports.initializeDatabase = initializeDatabase;
//# sourceMappingURL=database.js.map