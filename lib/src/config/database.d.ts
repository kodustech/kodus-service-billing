import { DataSource } from "typeorm";
import "dotenv/config";
export declare const AppDataSource: DataSource;
export declare const initializeDatabase: () => Promise<void>;
