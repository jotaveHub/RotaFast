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
const nominatimBaseUrl =
  process.env.NOMINATIM_BASE_URL || "https://nominatim.openstreetmap.org";

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", servico: "RotaFast API" });
});

async function buscarEnderecoNominatim(req, res) {
  try {
    const termo = (req.query.q || req.query.endereco || "").trim();
    if (!termo) {
      res.status(400).json({ mensagem: "Informe o parâmetro de busca q" });
      return;
    }

    const url = `${nominatimBaseUrl}/search?format=json&addressdetails=1&limit=5&q=${encodeURIComponent(
      termo
    )}`;
    const resposta = await fetch(url, {
      headers: {
        "User-Agent": "RotaFast-BD2-Academico/1.0",
        "Accept-Language": "pt-BR,pt;q=0.9",
      },
    });

    if (!resposta.ok) {
      res.status(502).json({ mensagem: "Falha ao consultar serviço Nominatim" });
      return;
    }

    const dados = await resposta.json();
    res.status(200).json(dados);
  } catch (error) {
    res.status(502).json({
      mensagem: "Erro ao consultar geocodificação",
      erro: error.message,
    });
  }
}

app.get("/geocodificacao", buscarEnderecoNominatim);
app.get("/api/v1/geocodificacao", buscarEnderecoNominatim);

app.use("/pontos", PontoRouter);
app.use("/api/v1/pontos", PontoRouter);
app.use("/rotas", RotaRouter);
app.use("/api/v1/rotas", RotaRouter);

app.use(express.static(path.join(__dirname, "../front-end")));

app.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
});
