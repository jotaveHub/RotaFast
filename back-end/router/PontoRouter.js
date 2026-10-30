import express from "express";
import {
  getPontos,
  getPontoById,
  createPonto,
  updatePonto,
  deletePonto,
} from "../controller/PontoController.js";

const PontoRouter = express.Router();

PontoRouter.get("/", getPontos);
PontoRouter.get("/:id", getPontoById);
PontoRouter.post("/", createPonto);
PontoRouter.patch("/:id", updatePonto);
PontoRouter.put("/:id", updatePonto);
PontoRouter.delete("/:id", deletePonto);

export default PontoRouter;
