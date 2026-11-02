import Ponto from "../model/Ponto.js";
import sequelize from "../database/sequelize.js";
import { Op } from "sequelize";

const CAMPOS_EDITAVEIS = [
  "nome",
  "descricao",
  "endereco",
  "tipo",
  "prioridade",
  "status",
];

const MENSAGEM_COORDENADA_INVALIDA =
  "Coordenadas geográficas inválidas: latitude deve estar entre -90 e 90 e longitude entre -180 e 180";

function filtrarCamposEditaveis(dados = {}) {
  const filtrado = {};
  for (const campo of CAMPOS_EDITAVEIS) {
    if (dados[campo] !== undefined) {
      filtrado[campo] = dados[campo];
    }
  }
  return filtrado;
}

function validarCoordenadas(lng, lat) {
  if (
    !Number.isFinite(lng) ||
    !Number.isFinite(lat) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    throw new Error(MENSAGEM_COORDENADA_INVALIDA);
  }
}

function normalizarLocalizacao(dados = {}) {
  if (
    dados.localizacao &&
    dados.localizacao.type === "Point" &&
    Array.isArray(dados.localizacao.coordinates)
  ) {
    const lng = Number(dados.localizacao.coordinates[0]);
    const lat = Number(dados.localizacao.coordinates[1]);
    validarCoordenadas(lng, lat);
    return {
      type: "Point",
      coordinates: [lng, lat],
      crs: { type: "name", properties: { name: "EPSG:4326" } },
    };
  }
  if (dados.latitude !== undefined && dados.longitude !== undefined) {
    const lng = Number(dados.longitude);
    const lat = Number(dados.latitude);
    validarCoordenadas(lng, lat);
    return {
      type: "Point",
      coordinates: [lng, lat],
      crs: { type: "name", properties: { name: "EPSG:4326" } },
    };
  }
  return null;
}

function extrairPaginacao(query = {}) {
  const limit = Math.min(Math.max(1, Number(query.limit) || 200), 500);
  const page = Math.max(1, Number(query.page) || 1);
  const offset =
    query.offset !== undefined
      ? Math.max(0, Number(query.offset) || 0)
      : (page - 1) * limit;
  return { limit, offset, page };
}

export async function getPontos(req, res) {
  try {
    const filtro = {};
    if (req.query.status) filtro.status = req.query.status;
    if (req.query.tipo) filtro.tipo = req.query.tipo;
    if (req.query.prioridade) filtro.prioridade = req.query.prioridade;

    const { limit, offset, page } = extrairPaginacao(req.query);

    const pontos = await Ponto.findAll({
      where: filtro,
      order: [["createdAt", "DESC"]],
      limit,
      offset,
    });
    res.set("X-Page", String(page));
    res.set("X-Limit", String(limit));
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
    const localizacao = normalizarLocalizacao(req.body);
    if (!localizacao) {
      res.status(400).json({ mensagem: MENSAGEM_COORDENADA_INVALIDA });
      return;
    }
    const ponto = await Ponto.create({ ...filtrarCamposEditaveis(req.body), localizacao });
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
    const id = req.params.id;
    const dadosAtualizacao = filtrarCamposEditaveis(req.body);

    if (req.body.localizacao || (req.body.latitude !== undefined && req.body.longitude !== undefined)) {
      const localizacao = normalizarLocalizacao(req.body);
      if (!localizacao) {
        res.status(400).json({ mensagem: MENSAGEM_COORDENADA_INVALIDA });
        return;
      }
      dadosAtualizacao.localizacao = localizacao;
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
    const id = req.params.id;
    if (!id) {
      res.status(400).json({ mensagem: "ID do ponto é obrigatório nos parâmetros da rota" });
      return;
    }
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
    const minLngRaw = Number(req.query.minLng ?? req.query.minLon);
    const minLatRaw = Number(req.query.minLat);
    const maxLngRaw = Number(req.query.maxLng ?? req.query.maxLon);
    const maxLatRaw = Number(req.query.maxLat);

    if ([minLngRaw, minLatRaw, maxLngRaw, maxLatRaw].some((val) => !Number.isFinite(val))) {
      res.status(400).json({
        mensagem: "Informe os limites da área visível: minLng, minLat, maxLng e maxLat",
      });
      return;
    }

    const minLng = Math.min(minLngRaw, maxLngRaw);
    const maxLng = Math.max(minLngRaw, maxLngRaw);
    const minLat = Math.min(minLatRaw, maxLatRaw);
    const maxLat = Math.max(minLatRaw, maxLatRaw);

    if (minLat < -90 || maxLat > 90 || minLng < -180 || maxLng > 180) {
      res.status(400).json({
        mensagem: "Limites geográficos fora do intervalo WGS84 (-90 a 90 para latitude e -180 a 180 para longitude)",
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

    const { limit, offset, page } = extrairPaginacao(req.query);

    const pontos = await Ponto.findAll({
      where: {
        [Op.and]: condicoes,
      },
      order: [["createdAt", "DESC"]],
      limit,
      offset,
    });

    res.set("X-Page", String(page));
    res.set("X-Limit", String(limit));
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

    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180 ||
      !Number.isFinite(raio) ||
      raio <= 0
    ) {
      res.status(400).json({
        mensagem: "Informe coordenadas válidas (lat, lng) e um raio positivo em metros",
      });
      return;
    }

    const pontoReferenciaGeog = `ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography`;
    const distanciaLiteral = sequelize.literal(
      `ROUND(ST_Distance("localizacao"::geography, ${pontoReferenciaGeog})::numeric, 2)`
    );

    const condicoes = [
      sequelize.literal(`ST_DWithin("localizacao"::geography, ${pontoReferenciaGeog}, :raio)`),
    ];

    if (req.query.status) condicoes.push({ status: req.query.status });
    if (req.query.tipo) condicoes.push({ tipo: req.query.tipo });
    if (req.query.prioridade) condicoes.push({ prioridade: req.query.prioridade });

    const { limit, offset, page } = extrairPaginacao(req.query);

    const pontos = await Ponto.findAll({
      attributes: {
        include: [[distanciaLiteral, "distancia_metros"]],
      },
      where: {
        [Op.and]: condicoes,
      },
      replacements: { lng, lat, raio },
      order: [[distanciaLiteral, "ASC"]],
      limit,
      offset,
    });

    res.set("X-Page", String(page));
    res.set("X-Limit", String(limit));
    res.status(200).json(pontos);
  } catch (error) {
    res.status(500).json({
      mensagem: "Erro ao buscar pontos próximos por raio",
      erro: error.message,
    });
  }
}
