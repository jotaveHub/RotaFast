import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import PontoRouter from "./router/PontoRouter.js";
import RotaRouter from "./router/RotaRouter.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const port = process.env.PORT || process.env.API_PORT || 3000;

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", servico: "RotaFast API" });
});

app.use("/pontos", PontoRouter);
app.use("/api/v1/pontos", PontoRouter);
app.use("/rotas", RotaRouter);
app.use("/api/v1/rotas", RotaRouter);

app.use(express.static(path.join(__dirname, "../front-end")));

app.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
});
