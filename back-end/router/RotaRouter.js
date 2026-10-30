import express from "express";
import {
  calcularMelhorRota,
  createRota,
  getRotas,
  getRotaById,
  deleteRota,
} from "../controller/RotaController.js";

const RotaRouter = express.Router();

RotaRouter.post("/otimizar", calcularMelhorRota);
RotaRouter.get("/", getRotas);
RotaRouter.get("/:id", getRotaById);
RotaRouter.post("/", createRota);
RotaRouter.delete("/:id", deleteRota);

export default RotaRouter;
