import Ponto from "../model/Ponto.js";

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
