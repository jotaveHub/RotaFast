import Ponto from "../model/Ponto.js";
import Rota from "../model/Rota.js";
import sequelize from "../database/sequelize.js";
import { Op } from "sequelize";
import {
  otimizarSequenciaComCCH,
  calcularDistanciaHaversine,
} from "../services/cchService.js";

const OSRM_BASE_URL = process.env.OSRM_BASE_URL || "https://router.project-osrm.org";

function extrairCoordenadas(pontoOuCoord) {
  if (!pontoOuCoord) return null;
  if (Array.isArray(pontoOuCoord) && pontoOuCoord.length >= 2) {
    return [Number(pontoOuCoord[0]), Number(pontoOuCoord[1])];
  }
  if (
    pontoOuCoord.localizacao &&
    Array.isArray(pontoOuCoord.localizacao.coordinates)
  ) {
    return [
      Number(pontoOuCoord.localizacao.coordinates[0]),
      Number(pontoOuCoord.localizacao.coordinates[1]),
    ];
  }
  if (Array.isArray(pontoOuCoord.coordinates)) {
    return [
      Number(pontoOuCoord.coordinates[0]),
      Number(pontoOuCoord.coordinates[1]),
    ];
  }
  const lat = Number(pontoOuCoord.lat ?? pontoOuCoord.latitude);
  const lng = Number(pontoOuCoord.lng ?? pontoOuCoord.lon ?? pontoOuCoord.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return [lng, lat];
  }
  return null;
}

async function consultarMatrizOSRM(nos, criterio) {
  try {
    const coordsStr = nos.map((n) => `${n.coordinates[0]},${n.coordinates[1]}`).join(";");
    const anotacao = criterio === "distancia" ? "distance,duration" : "duration,distance";
    const url = `${OSRM_BASE_URL}/table/v1/driving/${coordsStr}?annotations=${anotacao}`;

    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.code !== "Ok") return null;

    return criterio === "distancia" ? data.distances : data.durations;
  } catch {
    return null;
  }
}

async function consultarTrajetoViarioOSRM(coordenadasOrdenadas) {
  const coordenadasTotais = [];
  const trechos = [];
  let distanciaTotal = 0;
  let duracaoTotal = 0;

  // Calcula trecho a trecho (1->2, 2->3, 3->4...) de forma independente
  // evitando que o OSRM force retornos/rotatórias artificiais (continue_straight) entre paradas
  for (let i = 0; i < coordenadasOrdenadas.length - 1; i++) {
    const origem = coordenadasOrdenadas[i];
    const destino = coordenadasOrdenadas[i + 1];
    const parStr = `${origem[0]},${origem[1]};${destino[0]},${destino[1]}`;

    let trechoCoords = [origem, destino];
    let distTrecho = calcularDistanciaHaversine(origem, destino);
    let durTrecho = distTrecho / 11.1;

    try {
      const url = `${OSRM_BASE_URL}/route/v1/driving/${parStr}?overview=full&geometries=geojson&continue_straight=false`;
      const resp = await fetch(url);
      if (resp.ok) {
        const data = await resp.json();
        if (data.code === "Ok" && data.routes && data.routes.length > 0) {
          const rotaTrecho = data.routes[0];
          trechoCoords = rotaTrecho.geometry.coordinates;
          distTrecho = rotaTrecho.distance;
          durTrecho = rotaTrecho.duration;
        }
      }
    } catch {
      // Fallback em linha reta caso o OSRM falhe no trecho
    }

    distanciaTotal += distTrecho;
    duracaoTotal += durTrecho;

    trechos.push({
      de_ordem: i + 1,
      para_ordem: i + 2,
      distancia_metros: Math.round(distTrecho),
      duracao_segundos: Math.round(durTrecho),
      coordinates: trechoCoords,
    });

    if (i === 0) {
      coordenadasTotais.push(...trechoCoords);
    } else {
      coordenadasTotais.push(...trechoCoords.slice(1));
    }
  }

  return {
    geometria: {
      type: "LineString",
      coordinates: coordenadasTotais,
    },
    trechos,
    distancia_metros: Math.round(distanciaTotal),
    duracao_segundos: Math.round(duracaoTotal),
  };
}

async function gerarMalhaDelaunayPostGIS(nos) {
  if (nos.length < 3) {
    return nos.length === 2 ? [[0, 1]] : [];
  }

  try {
    const multipointWKT = `MULTIPOINT(${nos
      .map((n) => `${Number(n.coordinates[0])} ${Number(n.coordinates[1])}`)
      .join(", ")})`;

    const [resultado] = await sequelize.query(
      `SELECT ST_AsGeoJSON(ST_DelaunayTriangles(ST_GeomFromText(:wkt, 4326), 0.0, 1)) AS geojson`,
      {
        replacements: { wkt: multipointWKT },
        type: sequelize.QueryTypes.SELECT,
      }
    );

    if (!resultado || !resultado.geojson) return [];

    const malhaGeo = JSON.parse(resultado.geojson);
    const linhas =
      malhaGeo.type === "MultiLineString"
        ? malhaGeo.coordinates
        : malhaGeo.type === "LineString"
        ? [malhaGeo.coordinates]
        : [];

    const encontrarIndiceMaisProximo = (coord) => {
      let melhorIdx = 0;
      let menorDist = Infinity;
      for (let i = 0; i < nos.length; i++) {
        const dx = nos[i].coordinates[0] - coord[0];
        const dy = nos[i].coordinates[1] - coord[1];
        const d2 = dx * dx + dy * dy;
        if (d2 < menorDist) {
          menorDist = d2;
          melhorIdx = i;
        }
      }
      return melhorIdx;
    };

    const arestas = [];
    for (const linha of linhas) {
      for (let i = 0; i < linha.length - 1; i++) {
        const u = encontrarIndiceMaisProximo(linha[i]);
        const v = encontrarIndiceMaisProximo(linha[i + 1]);
        if (u !== v) {
          arestas.push([u, v]);
        }
      }
    }

    return arestas;
  } catch {
    return [];
  }
}

export async function calcularMelhorRota(req, res) {
  try {
    const {
      nome = "Rota Otimizada",
      origem,
      destino = null,
      destinoFinal = null,
      pontosIds = [],
      criterio = "tempo",
      salvar = false,
    } = req.body;

    let pontosBanco = [];
    if (Array.isArray(pontosIds) && pontosIds.length > 0) {
      pontosBanco = await Ponto.findAll({
        where: { id: { [Op.in]: pontosIds } },
      });
    } else {
      pontosBanco = await Ponto.findAll({
        where: { status: { [Op.ne]: "concluido" } },
        order: [["createdAt", "ASC"]],
      });
    }

    const coordOrigem = extrairCoordenadas(origem);
    if (!coordOrigem && pontosBanco.length < 2) {
      res.status(400).json({
        mensagem:
          "Informe uma origem e ao menos 1 ponto de atendimento (ou selecione ao menos 2 pontos)",
      });
      return;
    }

    const nos = [];
    let pontosParada = [...pontosBanco];

    if (coordOrigem) {
      nos.push({
        id: "origem",
        nome: origem?.nome || "Ponto de Partida (Origem)",
        tipo: "Origem",
        prioridade: "alta",
        coordinates: coordOrigem,
      });
    } else {
      const primeiro = pontosParada.shift();
      nos.push({
        id: primeiro.id,
        nome: primeiro.nome,
        endereco: primeiro.endereco,
        tipo: primeiro.tipo,
        prioridade: primeiro.prioridade,
        status: primeiro.status,
        coordinates: extrairCoordenadas(primeiro),
      });
    }

    for (const p of pontosParada) {
      const coords = extrairCoordenadas(p);
      if (coords) {
        nos.push({
          id: p.id,
          nome: p.nome,
          descricao: p.descricao,
          endereco: p.endereco,
          tipo: p.tipo,
          prioridade: p.prioridade,
          status: p.status,
          coordinates: coords,
        });
      }
    }

    const coordDestino = extrairCoordenadas(destino || destinoFinal);
    const temDestinoFixo = Boolean(coordDestino);
    if (coordDestino) {
      nos.push({
        id: "destino",
        nome: (destino || destinoFinal)?.nome || "Destino Final",
        tipo: "Destino",
        prioridade: "normal",
        coordinates: coordDestino,
      });
    }

    if (nos.length < 2) {
      res.status(400).json({
        mensagem: "São necessários ao menos 2 vértices válidos para calcular a rota",
      });
      return;
    }

    const matrizCustosBase = await consultarMatrizOSRM(nos, criterio);
    const arestasMalha = await gerarMalhaDelaunayPostGIS(nos);

    const resultadoCCH = otimizarSequenciaComCCH({
      nos,
      arestasMalha,
      matrizCustosBase,
      temDestinoFixo,
      criterio,
    });

    const paradasOrdenadas = resultadoCCH.ordemIndices.map((idx, posicao) => ({
      ordem: posicao + 1,
      ...nos[idx],
    }));

    const coordsOtimizadas = paradasOrdenadas.map((p) => p.coordinates);
    const trajetoOtimizado = await consultarTrajetoViarioOSRM(coordsOtimizadas);

    const coordsOrdemOriginal = nos.map((n) => n.coordinates);
    const trajetoOriginal = await consultarTrajetoViarioOSRM(coordsOrdemOriginal);

    const resposta = {
      nome,
      algoritmo: resultadoCCH.hierarquiaResumo,
      distancia_metros: trajetoOtimizado.distancia_metros,
      duracao_segundos: trajetoOtimizado.duracao_segundos,
      economia_metros: Math.max(
        0,
        trajetoOriginal.distancia_metros - trajetoOtimizado.distancia_metros
      ),
      paradas: paradasOrdenadas,
      trechos: trajetoOtimizado.trechos,
      trajeto: trajetoOtimizado.geometria,
      trajeto_alternativo: trajetoOriginal.geometria,
      malha_triangulacao: resultadoCCH.arestasMalhaGeoJSON,
    };

    if (salvar) {
      const rotaSalva = await Rota.create({
        nome,
        origem: {
          type: "Point",
          coordinates: coordsOtimizadas[0],
          crs: { type: "name", properties: { name: "EPSG:4326" } },
        },
        destino: {
          type: "Point",
          coordinates: coordsOtimizadas[coordsOtimizadas.length - 1],
          crs: { type: "name", properties: { name: "EPSG:4326" } },
        },
        trajeto: {
          ...trajetoOtimizado.geometria,
          crs: { type: "name", properties: { name: "EPSG:4326" } },
        },
        paradas: paradasOrdenadas,
        distancia_metros: trajetoOtimizado.distancia_metros,
        duracao_segundos: trajetoOtimizado.duracao_segundos,
      });
      resposta.rota_id = rotaSalva.id;
    }

    res.status(200).json(resposta);
  } catch (error) {
    res.status(500).json({
      mensagem: "Erro ao calcular e otimizar a rota",
      erro: error.message,
    });
  }
}

export async function createRota(req, res) {
  try {
    const {
      nome = "Rota Planejada",
      origem,
      destino = null,
      trajeto = null,
      paradas = [],
      distancia_metros = 0,
      duracao_segundos = 0,
    } = req.body;

    const coordOrigem = extrairCoordenadas(origem) ||
      (paradas.length > 0 ? extrairCoordenadas(paradas[0]) : null);

    if (!coordOrigem) {
      res.status(400).json({
        mensagem: "Informe uma localização de origem válida para salvar a rota",
      });
      return;
    }

    const coordDestino = extrairCoordenadas(destino) ||
      (paradas.length > 1 ? extrairCoordenadas(paradas[paradas.length - 1]) : null);

    const novaRota = await Rota.create({
      nome,
      origem: {
        type: "Point",
        coordinates: coordOrigem,
        crs: { type: "name", properties: { name: "EPSG:4326" } },
      },
      destino: coordDestino
        ? {
            type: "Point",
            coordinates: coordDestino,
            crs: { type: "name", properties: { name: "EPSG:4326" } },
          }
        : null,
      trajeto:
        trajeto && trajeto.type === "LineString"
          ? {
              ...trajeto,
              crs: { type: "name", properties: { name: "EPSG:4326" } },
            }
          : null,
      paradas,
      distancia_metros: Number(distancia_metros) || 0,
      duracao_segundos: Number(duracao_segundos) || 0,
    });

    res.status(201).json(novaRota);
  } catch (error) {
    res.status(400).json({
      mensagem: "Erro ao salvar rota planejada",
      erro: error.message,
    });
  }
}

export async function getRotas(req, res) {
  try {
    const rotas = await Rota.findAll({
      order: [["createdAt", "DESC"]],
    });
    res.status(200).json(rotas);
  } catch (error) {
    res.status(500).json({
      mensagem: "Erro ao listar rotas planejadas",
      erro: error.message,
    });
  }
}

export async function getRotaById(req, res) {
  try {
    const rota = await Rota.findByPk(req.params.id);
    if (!rota) {
      res.status(404).json({ mensagem: "Rota planejada não encontrada" });
      return;
    }
    res.status(200).json(rota);
  } catch (error) {
    res.status(400).json({
      mensagem: "Erro ao buscar rota planejada",
      erro: error.message,
    });
  }
}

export async function deleteRota(req, res) {
  try {
    const id = req.params.id || req.body.id;
    const removidas = await Rota.destroy({
      where: { id },
    });

    if (removidas > 0) {
      res.status(200).json({
        mensagem: "Rota planejada deletada com sucesso",
      });
      return;
    }

    res.status(404).json({
      mensagem: "Rota planejada não encontrada",
    });
  } catch (error) {
    res.status(400).json({
      mensagem: "Erro ao remover rota planejada",
      erro: error.message,
    });
  }
}
