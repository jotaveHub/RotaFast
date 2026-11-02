/**
 * Implementação do algoritmo CCH (Customizable Contraction Hierarchies)
 * aplicado à malha espacial de pontos (Delaunay/PostGIS) + matriz de custos viários (OSRM).
 *
 * O CCH é dividido em 3 fases clássicas:
 * 1. Fase Topológica (Métrica-Independente): Ordem de contração (eliminação simbólica)
 *    e inserção de atalhos (shortcuts) para preservar caminhos mínimos entre vizinhos superiores.
 *    O grafo ascendente (Upward Graph) é estritamente formado pelas arestas da malha e atalhos válidos.
 * 2. Fase de Customização: Atribuição de pesos dinâmicos (tempo/distância OSRM e fator de prioridade)
 *    e relaxamento ascendente bottom-up dos triângulos inferiores da hierarquia.
 * 3. Fase de Consulta (Query Bidirecional): Busca ascendente simultânea a partir da origem (forward)
 *    e do destino (backward) até o nó de encontro (meeting node) de rank máximo.
 *
 * Sequenciamento de Múltiplas Paradas (TSP com Prioridades):
 * - Heurística gulosa (Nearest Neighbor) orientada pela função objetivo unificada.
 * - Refinamento local 2-Opt direcionado (suporta matrizes assimétricas e respeita a mesma função objetivo).
 */

export const PESO_PRIORIDADE = {
  alta: 0.6,
  normal: 1.0,
  baixa: 1.4,
};

/**
 * Distância geodésica Haversine em metros entre dois pontos [lng, lat]
 */
export function calcularDistanciaHaversine(coordA, coordB) {
  const R = 6371000;
  const toRad = (g) => (g * Math.PI) / 180;
  const dLat = toRad(coordB[1] - coordA[1]);
  const dLng = toRad(coordB[0] - coordA[0]);
  const lat1 = toRad(coordA[1]);
  const lat2 = toRad(coordB[1]);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Avalia o custo de um trecho direcionado sob a função objetivo unificada:
 * Custo(origem -> destino) = CustoBase(origem, destino) * FatorPrioridade(destino)
 */
export function calcularCustoObjetivoTrecho(origemIdx, destinoIdx, nos, matrizCustosBase, criterio = "prioridade_distancia") {
  let custoBase;
  if (
    matrizCustosBase &&
    matrizCustosBase[origemIdx] &&
    Number.isFinite(matrizCustosBase[origemIdx][destinoIdx])
  ) {
    custoBase = matrizCustosBase[origemIdx][destinoIdx];
  } else {
    custoBase = calcularDistanciaHaversine(
      nos[origemIdx].coordinates,
      nos[destinoIdx].coordinates
    );
  }

  const aplicaPrioridade =
    criterio === "prioridade" ||
    criterio === "prioridade_distancia" ||
    criterio === "prioridade_tempo";

  if (aplicaPrioridade) {
    const prioridadeDestino = nos[destinoIdx]?.prioridade || "normal";
    const multiplicador = PESO_PRIORIDADE[prioridadeDestino] ?? 1.0;
    return custoBase * multiplicador;
  }

  return custoBase;
}

/**
 * FASE 1 DO CCH: Construção da Hierarquia Topológica (Métrica-Independente)
 *
 * Regras corrigidas conforme o plano técnico:
 * - Apenas arestas reais da malha Delaunay e atalhos (shortcuts) gerados pela eliminação
 *   são preservados na estrutura contraída.
 * - O grafo ascendente (adjSuperior) contém estritamente os arcos {u, w} onde rank[u] < rank[w].
 * - Não cria arcos indiscriminadamente entre todos os pares com rank[u] < rank[w].
 * - Registra os atalhos com seus nós intermediários decompostos para rastreabilidade.
 */
export function construirHierarquiaTopologicaCCH(nos, arestasBase = []) {
  const n = nos.length;
  const adj = Array.from({ length: n }, () => new Set());
  const arestasOriginais = new Set();
  const chaveAresta = (u, v) => (u < v ? `${u}-${v}` : `${v}-${u}`);

  for (const [u, v] of arestasBase) {
    if (u !== v && u >= 0 && v >= 0 && u < n && v < n) {
      adj[u].add(v);
      adj[v].add(u);
      arestasOriginais.add(chaveAresta(u, v));
    }
  }

  // Se algum vértice estiver desconectado na malha, conecta aos 2 vizinhos mais próximos
  for (let i = 0; i < n; i++) {
    if (adj[i].size === 0 && n > 1) {
      const dists = [];
      for (let j = 0; j < n; j++) {
        if (i !== j) {
          dists.push({
            idx: j,
            d: calcularDistanciaHaversine(nos[i].coordinates, nos[j].coordinates),
          });
        }
      }
      dists.sort((a, b) => a.d - b.d);
      const limite = Math.min(2, dists.length);
      for (let k = 0; k < limite; k++) {
        const viz = dists[k].idx;
        adj[i].add(viz);
        adj[viz].add(i);
        arestasOriginais.add(chaveAresta(i, viz));
      }
    }
  }

  const contraido = new Array(n).fill(false);
  const ordemContracao = [];
  const rank = new Array(n).fill(0);
  const triangulosInferiores = [];
  const atalhosDetalhados = [];
  const chavesAtalhos = new Set();

  // Grafo enriquecido (grafo cordal CCH) que acumula arestas originais + atalhos
  const adjCordal = adj.map((vizinhos) => new Set(vizinhos));

  for (let passo = 0; passo < n; passo++) {
    let melhorNo = -1;
    let menorGrauAtivo = Infinity;

    // Ordem de contração por grau mínimo de vizinhos não contraídos
    for (let v = 0; v < n; v++) {
      if (!contraido[v]) {
        let grauAtivo = 0;
        for (const u of adjCordal[v]) {
          if (!contraido[u]) grauAtivo++;
        }
        if (grauAtivo < menorGrauAtivo) {
          menorGrauAtivo = grauAtivo;
          melhorNo = v;
        }
      }
    }

    const v = melhorNo;
    contraido[v] = true;
    ordemContracao.push(v);
    rank[v] = passo;

    // Vizinhos de v ainda ativos no momento da contração
    const vizinhosSuperiores = [];
    for (const u of adjCordal[v]) {
      if (!contraido[u]) {
        vizinhosSuperiores.push(u);
      }
    }

    // Cria clique (atalhos cordais) entre todos os pares de vizinhos superiores de v
    for (let i = 0; i < vizinhosSuperiores.length; i++) {
      for (let j = i + 1; j < vizinhosSuperiores.length; j++) {
        const u = vizinhosSuperiores[i];
        const w = vizinhosSuperiores[j];
        const chaveUW = chaveAresta(u, w);

        const ehNovoAtalho =
          !arestasOriginais.has(chaveUW) && !chavesAtalhos.has(chaveUW);

        adjCordal[u].add(w);
        adjCordal[w].add(u);

        if (ehNovoAtalho) {
          chavesAtalhos.add(chaveUW);
          atalhosDetalhados.push({
            u,
            w,
            intermediario: v,
          });
        }

        triangulosInferiores.push({ v, u, w });
      }
    }
  }

  // Construção CORRETA do Grafo Ascendente (Upward Graph G^):
  // Contém estritamente os arcos existentes no grafo cordal onde rank[u] < rank[w]
  const adjSuperior = Array.from({ length: n }, () => []);
  for (let u = 0; u < n; u++) {
    for (const w of adjCordal[u]) {
      if (rank[u] < rank[w]) {
        adjSuperior[u].push(w);
      }
    }
    // Ordena vizinhos por rank ascendente
    adjSuperior[u].sort((a, b) => rank[a] - rank[b]);
  }

  return {
    n,
    ordemContracao,
    rank,
    adjSuperior,
    triangulosInferiores,
    arestasOriginais: Array.from(arestasOriginais).map((k) => k.split("-").map(Number)),
    atalhosCriados: atalhosDetalhados.map((a) => [a.u, a.w]),
    atalhosDetalhados,
    adjCordal,
  };
}

/**
 * FASE 2 DO CCH: Customização de Métrica (Pesos Dinâmicos)
 * Atribui os custos direcionados aos arcos da hierarquia e realiza
 * o relaxamento bottom-up dos triângulos inferiores na ordem de contração.
 */
export function customizarPesosCCH(hierarquia, nos, matrizBase, modoCriterio = "tempo") {
  const { n, adjSuperior, triangulosInferiores, rank } = hierarquia;

  const pesoUp = Array.from({ length: n }, () => new Array(n).fill(Infinity));
  const pesoDown = Array.from({ length: n }, () => new Array(n).fill(Infinity));

  for (let i = 0; i < n; i++) {
    pesoUp[i][i] = 0;
    pesoDown[i][i] = 0;
  }

  // 1. Inicializa arestas ascendentes e descendentes com os custos dos arcos
  for (let u = 0; u < n; u++) {
    for (const w of adjSuperior[u]) {
      const custoIda = calcularCustoObjetivoTrecho(u, w, nos, matrizBase, modoCriterio);
      const custoVolta = calcularCustoObjetivoTrecho(w, u, nos, matrizBase, modoCriterio);
      pesoUp[u][w] = custoIda;
      pesoDown[w][u] = custoVolta;
    }
  }

  // 2. Relaxamento bottom-up de cada triângulo inferior (v, u, w) onde rank[v] < rank[u] e rank[v] < rank[w]
  for (const { v, u, w } of triangulosInferiores) {
    const baixo = rank[u] < rank[w] ? u : w;
    const alto = rank[u] < rank[w] ? w : u;

    // Caminho baixo -> v -> alto (subindo para alto via v de rank inferior)
    const viaVIda = pesoDown[baixo][v] + pesoUp[v][alto];
    if (viaVIda < pesoUp[baixo][alto]) {
      pesoUp[baixo][alto] = viaVIda;
    }

    // Caminho alto -> v -> baixo (descendo de alto para baixo via v)
    const viaVVolta = pesoDown[alto][v] + pesoUp[v][baixo];
    if (viaVVolta < pesoDown[alto][baixo]) {
      pesoDown[alto][baixo] = viaVVolta;
    }
  }

  return { pesoUp, pesoDown };
}

/**
 * FASE 3 DO CCH: Consulta Bidirecional na Hierarquia (Upward / Downward Search)
 * Retorna o menor custo entre origem (s) e destino (t) caminhando apenas pelos arcos ascendentes
 */
export function consultarCaminhoMinimoCCH(s, t, hierarquia, pesosCustomizados) {
  if (s === t) return 0;

  const { n, ordemContracao, adjSuperior } = hierarquia;
  const { pesoUp, pesoDown } = pesosCustomizados;

  const distForward = new Array(n).fill(Infinity);
  const distBackward = new Array(n).fill(Infinity);

  distForward[s] = 0;
  distBackward[t] = 0;

  // Varredura ascendente na ordem de eliminação do CCH
  for (const u of ordemContracao) {
    if (distForward[u] < Infinity) {
      for (const w of adjSuperior[u]) {
        const novoCusto = distForward[u] + pesoUp[u][w];
        if (novoCusto < distForward[w]) {
          distForward[w] = novoCusto;
        }
      }
    }

    if (distBackward[u] < Infinity) {
      for (const w of adjSuperior[u]) {
        const novoCusto = distBackward[u] + pesoDown[w][u];
        if (novoCusto < distBackward[w]) {
          distBackward[w] = novoCusto;
        }
      }
    }
  }

  // Encontra o nó de encontro (meeting node) que minimiza distForward[v] + distBackward[v]
  let menorCusto = Infinity;
  for (let v = 0; v < n; v++) {
    const soma = distForward[v] + distBackward[v];
    if (soma < menorCusto) {
      menorCusto = soma;
    }
  }

  return menorCusto;
}

/**
 * Algoritmo de Dijkstra clássico de referência para validação e testes comparativos com CCH
 */
export function calcularMenorCaminhoDijkstra(origem, destino, n, matrizCustosDirecionada) {
  if (origem === destino) return 0;

  const dist = new Array(n).fill(Infinity);
  const visitado = new Array(n).fill(false);
  dist[origem] = 0;

  for (let step = 0; step < n; step++) {
    let u = -1;
    let menorDist = Infinity;
    for (let i = 0; i < n; i++) {
      if (!visitado[i] && dist[i] < menorDist) {
        menorDist = dist[i];
        u = i;
      }
    }

    if (u === -1 || dist[u] === Infinity) break;
    if (u === destino) return dist[destino];

    visitado[u] = true;

    for (let v = 0; v < n; v++) {
      if (!visitado[v]) {
        const pesoArco = matrizCustosDirecionada[u]?.[v];
        if (Number.isFinite(pesoArco) && dist[u] + pesoArco < dist[v]) {
          dist[v] = dist[u] + pesoArco;
        }
      }
    }
  }

  return dist[destino];
}

/**
 * Avalia o custo total de uma sequência de rota sob a função objetivo unificada
 */
export function calcularCustoTotalSequencia(rotaIndices, matrizCustos) {
  let custoTotal = 0;
  for (let i = 0; i < rotaIndices.length - 1; i++) {
    const u = rotaIndices[i];
    const v = rotaIndices[i + 1];
    custoTotal += matrizCustos[u][v];
  }
  return custoTotal;
}

/**
 * Otimização da sequência de visitas:
 * 1. Constrói a hierarquia CCH restrita à malha Delaunay + atalhos válidos;
 * 2. Customiza com a matriz OSRM e função de prioridade;
 * 3. Monta a matriz de distâncias mínimas consultadas pelo CCH;
 * 4. Aplica Nearest Neighbor sob a função objetivo;
 * 5. Refina a sequência com 2-Opt direcionado respeitando exatamente a mesma função objetivo.
 */
export function otimizarSequenciaComCCH({
  nos,
  arestasMalha = [],
  matrizCustosBase,
  temDestinoFixo = false,
  criterio = "tempo",
}) {
  const n = nos.length;

  // 1. Hierarquia CCH
  const hierarquia = construirHierarquiaTopologicaCCH(nos, arestasMalha);

  // 2. Customização
  const pesosCustomizados = customizarPesosCCH(
    hierarquia,
    nos,
    matrizCustosBase,
    criterio
  );

  // 3. Matriz de custos mínimos consultada via CCH
  const matrizCCH = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      matrizCCH[i][j] = consultarCaminhoMinimoCCH(
        i,
        j,
        hierarquia,
        pesosCustomizados
      );
    }
  }

  // 4. Construção inicial gulosa (Nearest Neighbor)
  const indiceFimFixo = temDestinoFixo ? n - 1 : -1;
  const intermediarios = [];
  for (let i = 1; i < n; i++) {
    if (i !== indiceFimFixo) intermediarios.push(i);
  }

  const visitados = new Set([0]);
  const rotaIndices = [0];
  let atual = 0;

  while (rotaIndices.length < intermediarios.length + 1) {
    let melhorProximo = -1;
    let melhorCusto = Infinity;

    for (const candidato of intermediarios) {
      if (!visitados.has(candidato)) {
        const custo = matrizCCH[atual][candidato];
        if (custo < melhorCusto) {
          melhorCusto = custo;
          melhorProximo = candidato;
        }
      }
    }

    visitados.add(melhorProximo);
    rotaIndices.push(melhorProximo);
    atual = melhorProximo;
  }

  if (temDestinoFixo && indiceFimFixo > 0) {
    rotaIndices.push(indiceFimFixo);
  }

  // 5. Refinamento 2-Opt Direcionado (suporte a matrizes assimétricas)
  // Utiliza a exata mesma função de avaliação de custo da rota
  const limiteFim = temDestinoFixo ? rotaIndices.length - 2 : rotaIndices.length - 1;
  let melhorou = true;
  let iteracoes = 0;
  const maxIteracoes = 100;

  while (melhorou && iteracoes < maxIteracoes) {
    melhorou = false;
    iteracoes++;

    for (let i = 1; i < limiteFim; i++) {
      for (let k = i + 1; k <= limiteFim; k++) {
        // Custo atual do trecho afetado: a -> b ... c -> d
        const a = rotaIndices[i - 1];
        const b = rotaIndices[i];
        const c = rotaIndices[k];
        const d = k + 1 < rotaIndices.length ? rotaIndices[k + 1] : null;

        let custoAtualTrecho = matrizCCH[a][b];
        for (let idx = i; idx < k; idx++) {
          custoAtualTrecho += matrizCCH[rotaIndices[idx]][rotaIndices[idx + 1]];
        }
        if (d !== null) {
          custoAtualTrecho += matrizCCH[c][d];
        }

        // Custo com segmento invertido [i..k]: a -> c ... b -> d
        let custoNovoTrecho = matrizCCH[a][c];
        for (let idx = k; idx > i; idx--) {
          custoNovoTrecho += matrizCCH[rotaIndices[idx]][rotaIndices[idx - 1]];
        }
        if (d !== null) {
          custoNovoTrecho += matrizCCH[b][d];
        }

        const deltaCusto = custoNovoTrecho - custoAtualTrecho;
        if (deltaCusto < -1e-6) {
          inverterSegmento(rotaIndices, i, k);
          melhorou = true;
        }
      }
    }
  }

  return {
    ordemIndices: rotaIndices,
    hierarquiaResumo: {
      algoritmo: "CCH (Customizable Contraction Hierarchies)",
      criterioCustomizacao: criterio,
      totalVertices: n,
      arestasMalhaBase: hierarquia.arestasOriginais.length,
      atalhosCriadosCCH: hierarquia.atalhosCriados.length,
      triangulosRelaxados: hierarquia.triangulosInferiores.length,
    },
    arestasMalhaGeoJSON: converterArestasParaGeoJSON(
      nos,
      hierarquia.arestasOriginais,
      hierarquia.atalhosCriados
    ),
  };
}

function inverterSegmento(arr, inicio, fim) {
  while (inicio < fim) {
    const temp = arr[inicio];
    arr[inicio] = arr[fim];
    arr[fim] = temp;
    inicio++;
    fim--;
  }
}

function converterArestasParaGeoJSON(nos, arestasOriginais, atalhosCriados) {
  const features = [];

  for (const [u, v] of arestasOriginais) {
    features.push({
      type: "Feature",
      properties: { tipo: "malha_delaunay" },
      geometry: {
        type: "LineString",
        coordinates: [nos[u].coordinates, nos[v].coordinates],
      },
    });
  }

  for (const [u, v] of atalhosCriados) {
    features.push({
      type: "Feature",
      properties: { tipo: "atalho_cch" },
      geometry: {
        type: "LineString",
        coordinates: [nos[u].coordinates, nos[v].coordinates],
      },
    });
  }

  return {
    type: "FeatureCollection",
    features,
  };
}
