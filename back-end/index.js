import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import PontoRouter from "./router/PontoRouter.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const port = process.env.PORT || process.env.API_PORT || 3000;

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", servico: "RotaFast API" });
});

app.use("/pontos", PontoRouter);
app.use("/api/v1/pontos", PontoRouter);

app.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
});
