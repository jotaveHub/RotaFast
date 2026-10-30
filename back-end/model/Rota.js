import sequelize from "../database/sequelize.js";
import { DataTypes } from "sequelize";

const Rota = sequelize.define(
  "Rota",
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
    origem: {
      type: DataTypes.GEOMETRY("POINT", 4326),
      allowNull: false,
    },
    destino: {
      type: DataTypes.GEOMETRY("POINT", 4326),
      allowNull: true,
    },
    trajeto: {
      type: DataTypes.GEOMETRY("LINESTRING", 4326),
      allowNull: true,
    },
    paradas: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
    },
    distancia_metros: {
      type: DataTypes.FLOAT,
      defaultValue: 0,
    },
    duracao_segundos: {
      type: DataTypes.FLOAT,
      defaultValue: 0,
    },
  },
  {
    tableName: "rotas_planejadas",
    indexes: [
      {
        name: "idx_rotas_trajeto",
        fields: ["trajeto"],
        using: "gist",
      },
    ],
  }
);

Rota.sync().catch((err) => {
  console.error("Erro ao sincronizar tabela Rota:", err.message);
});

export default Rota;
