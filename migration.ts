import "dotenv/config";
import { AppDataSource } from "./src/config/database";

AppDataSource.initialize().then(() => {
    AppDataSource.runMigrations().then(() => {
        console.log("Migrations executadas com sucesso!");
        process.exit(0);
    }).catch(error => {
        console.error("Erro ao executar migrations:", error);
        process.exit(1);
    });
}).catch(error => {
    console.error("Erro ao conectar ao banco:", error);
    process.exit(1);
}); 