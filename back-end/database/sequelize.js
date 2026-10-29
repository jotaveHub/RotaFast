import { Sequelize } from "sequelize";
import dotenv from "dotenv";
dotenv.config();

const isSupabaseHost = (host = "") => host.includes("supabase.co") || host.includes("supabase.com");

const sequelize = process.env.DATABASE_URL
  ? new Sequelize(process.env.DATABASE_URL, {
      dialect: "postgres",
      logging: false,
      dialectOptions: isSupabaseHost(process.env.DATABASE_URL)
        ? {
            ssl: {
              require: true,
              rejectUnauthorized: false,
            },
          }
        : {},
    })
  : new Sequelize(
      process.env.PG_DATABASE,
      process.env.PG_USER,
      process.env.PG_PASSWORD,
      {
        host: process.env.PG_HOST,
        port: process.env.PG_PORT || 5432,
        dialect: "postgres",
        logging: false,
        dialectOptions: isSupabaseHost(process.env.PG_HOST)
          ? {
              ssl: {
                require: true,
                rejectUnauthorized: false,
              },
            }
          : {},
      }
    );

try {
  await sequelize.authenticate();
  await sequelize.query("CREATE EXTENSION IF NOT EXISTS postgis;");
  console.log("Conexão com PostgreSQL + PostGIS estabelecida com sucesso.");
} catch (error) {
  console.error("Não foi possível conectar ao banco de dados:", error.message);
}

export default sequelize;
