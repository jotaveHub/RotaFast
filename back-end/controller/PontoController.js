import Ponto from "../model/Ponto.js";
import sequelize from "../database/sequelize.js";
import { Op } from "sequelize";

function normalizarLocalizacao(dados) {
  if (dados.localizacao && dados.localizacao.type === "Point" && Array.isArray(dados.localizacao.coordinates)) {
    return {
      type: "Point",
      coordinates: [
        Number(dados.localizacao.coordinates[0]),
        Number(dados.localizacao.coordinates[1]),
      ],
      crs: { type: "name", properties: { name: "EPSG:4326" } },
    };
  }
  if (dados.latitude !== undefined && dados.longitude !== undefined) {
    return {
      type: "Point",
      coordinates: [Number(dados.longitude), Number(dados.latitude)],
      crs: { type: "name", properties: { name: "EPSG:4326" } },
    };
  }
  return dados.localizacao;
}

export async function getPontos(req, res) {
  try {
    const filtro = {};
    if (req.query.status) filtro.status = req.query.status;
    if (req.query.tipo) filtro.tipo = req.query.tipo;
    if (req.query.prioridade) filtro.prioridade = req.query.prioridade;

    const pontos = await Ponto.findAll({
      where: filtro,
      order: [["createdAt", "DESC"]],
    });
    res.status(200).json(pontos);
  } catch (error) {
    res.status(500).json({
      mensagem: "Erro ao listar pontos de atendimento",
      erro: error.message,
    });
  }
}

export async function createPonto(req, res) {
  try {
    const payload = {
      ...req.body,
      localizacao: normalizarLocalizacao(req.body),
    };
    const ponto = await Ponto.create(payload);
    res.status(201).json(ponto);
  } catch (error) {
    res.status(400).json({
      mensagem: "Erro ao criar ponto de atendimento",
      erro: error.message,
    });
  }
}

export async function getPontoById(req, res) {
  try {
    const ponto = await Ponto.findByPk(req.params.id);
    if (!ponto) {
      res.status(404).json({ mensagem: "Ponto de atendimento não encontrado" });
      return;
    }
    res.status(200).json(ponto);
  } catch (error) {
    res.status(400).json({
      mensagem: "Erro ao buscar ponto de atendimento",
      erro: error.message,
    });
  }
}

export async function updatePonto(req, res) {
  try {
    const id = req.params.id || req.body.id;
    const dadosAtualizacao = { ...req.body };

    if (req.body.localizacao || (req.body.latitude !== undefined && req.body.longitude !== undefined)) {
      dadosAtualizacao.localizacao = normalizarLocalizacao(req.body);
    }

    const [linhasAfetadas, pontosAtualizados] = await Ponto.update(dadosAtualizacao, {
      where: { id },
      returning: true,
    });

    if (linhasAfetadas > 0) {
      res.status(200).json({
        mensagem: "Ponto de atendimento atualizado com sucesso",
        ponto: pontosAtualizados[0],
      });
      return;
    }

    res.status(404).json({
      mensagem: "Ponto de atendimento não encontrado",
    });
  } catch (error) {
    res.status(400).json({
      mensagem: "Erro ao atualizar ponto de atendimento",
      erro: error.message,
    });
  }
}

export async function deletePonto(req, res) {
  try {
    const id = req.params.id || req.body.id;
    const linhasRemovidas = await Ponto.destroy({
      where: { id },
    });

    if (linhasRemovidas > 0) {
      res.status(200).json({
        mensagem: "Ponto de atendimento deletado com sucesso",
      });
      return;
    }

    res.status(404).json({
      mensagem: "Ponto de atendimento não encontrado",
    });
  } catch (error) {
    res.status(400).json({
      mensagem: "Erro ao remover ponto de atendimento",
      erro: error.message,
    });
  }
}

export async function getPontosByArea(req, res) {
  try {
    const minLng = Number(req.query.minLng ?? req.query.minLon);
    const minLat = Number(req.query.minLat);
    const maxLng = Number(req.query.maxLng ?? req.query.maxLon);
    const maxLat = Number(req.query.maxLat);

    if ([minLng, minLat, maxLng, maxLat].some((val) => !Number.isFinite(val))) {
      res.status(400).json({
        mensagem: "Informe os limites da área visível: minLng, minLat, maxLng e maxLat",
      });
      return;
    }

    const condicoes = [
      sequelize.where(
        sequelize.fn(
          "ST_Intersects",
          sequelize.col("localizacao"),
          sequelize.fn("ST_MakeEnvelope", minLng, minLat, maxLng, maxLat, 4326)
        ),
        true
      ),
    ];

    if (req.query.status) condicoes.push({ status: req.query.status });
    if (req.query.tipo) condicoes.push({ tipo: req.query.tipo });
    if (req.query.prioridade) condicoes.push({ prioridade: req.query.prioridade });

    const pontos = await Ponto.findAll({
      where: {
        [Op.and]: condicoes,
      },
      order: [["createdAt", "DESC"]],
    });

    res.status(200).json(pontos);
  } catch (error) {
    res.status(500).json({
      mensagem: "Erro ao buscar pontos na área visível",
      erro: error.message,
    });
  }
}

export async function getPontosProximos(req, res) {
  try {
    const lat = Number(req.query.lat ?? req.query.latitude);
    const lng = Number(req.query.lng ?? req.query.lon ?? req.query.longitude);
    const raio = Number(req.query.raio ?? 2000);

    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(raio) || raio <= 0) {
      res.status(400).json({
        mensagem: "Informe coordenadas válidas (lat, lng) e um raio positivo em metros",
      });
      return;
    }

    const pontoReferenciaGeog = `ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`;
    const distanciaLiteral = sequelize.literal(
      `ROUND(ST_Distance("localizacao"::geography, ${pontoReferenciaGeog})::numeric, 2)`
    );

    const condicoes = [
      sequelize.literal(`ST_DWithin("localizacao"::geography, ${pontoReferenciaGeog}, ${raio})`),
    ];

    if (req.query.status) condicoes.push({ status: req.query.status });
    if (req.query.tipo) condicoes.push({ tipo: req.query.tipo });
    if (req.query.prioridade) condicoes.push({ prioridade: req.query.prioridade });

    const pontos = await Ponto.findAll({
      attributes: {
        include: [[distanciaLiteral, "distancia_metros"]],
      },
      where: {
        [Op.and]: condicoes,
      },
      order: [[distanciaLiteral, "ASC"]],
    });

    res.status(200).json(pontos);
  } catch (error) {
    res.status(500).json({
      mensagem: "Erro ao buscar pontos próximos por raio",
      erro: error.message,
    });
  }
}
