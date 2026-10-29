import sequelize from "../database/sequelize.js";
import { DataTypes } from "sequelize";

const Ponto = sequelize.define(
  "Ponto",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    nome: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    descricao: {
      type: DataTypes.TEXT,
    },
    endereco: {
      type: DataTypes.STRING,
    },
    tipo: {
      type: DataTypes.STRING,
      defaultValue: "Entrega",
      validate: {
        isIn: [["Entrega", "Coleta", "Manutenção", "Instalação", "Visita Técnica"]],
      },
    },
    prioridade: {
      type: DataTypes.STRING,
      defaultValue: "normal",
      validate: {
        isIn: [["baixa", "normal", "alta"]],
      },
    },
    status: {
      type: DataTypes.STRING,
      defaultValue: "pendente",
      validate: {
        isIn: [["pendente", "em_andamento", "concluido"]],
      },
    },
    localizacao: {
      type: DataTypes.GEOMETRY("POINT", 4326),
      allowNull: false,
    },
  },
  {
    tableName: "pontos_atendimento",
    indexes: [
      {
        name: "idx_pontos_localizacao",
        fields: ["localizacao"],
        using: "gist",
      },
      {
        name: "idx_pontos_status",
        fields: ["status"],
      },
    ],
  }
);

Ponto.sync().catch((err) => {
  console.error("Erro ao sincronizar tabela Ponto:", err.message);
});

export default Ponto;
