/**
 * Implementação do algoritmo CCH (Customizable Contraction Hierarchies)
 * aplicado à malha espacial de pontos (Delaunay/PostGIS) + matriz viária (OSRM).
 *
 * O CCH é dividido em 3 fases:
 * 1. Fase Topológica (Métrica-Independente): Ordem de contração (Nested Dissection / Grau Mínimo)
 *    e criação de atalhos (shortcuts) formando triângulos cordais.
 * 2. Fase de Customização: Atribuição de pesos dinâmicos (tempo, distância, prioridade)
 *    e relaxamento ascendente dos triângulos na hierarquia.
 * 3. Fase de Consulta (Query Bidirecional + Sequenciamento): Busca no grafo upward/downward
 *    para obter matriz de custos mínimos e ordenar a sequência ótima de paradas.
 */

const PESO_PRIORIDADE = {
  alta: 0.75,
  normal: 1.0,
  baixa: 1.25,
};

/**
 * Distância geodésica Haversine em metros entre dois nós [lng, lat]
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
 * FASE 1 DO CCH: Construção da Hierarquia Topológica (Métrica-Independente)
 * Recebe a lista de nós e as arestas da malha (vindas do ST_DelaunayTriangles do PostGIS
 * ou grafo de vizinhança) e realiza a contração simbólica gerando shortcuts e triângulos.
 */
export function construirHierarquiaTopologicaCCH(nos, arestasBase) {
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

  // Garante que o grafo de contração contenha todas as conexões de suporte viário
  // enquanto preserva arestasOriginais (Delaunay) para a camada visual da malha
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      adj[i].add(j);
      adj[j].add(i);
      if (arestasOriginais.size === 0 || n <= 3) {
        arestasOriginais.add(chaveAresta(i, j));
      }
    }
  }

  const contraido = new Array(n).fill(false);
  const ordemContracao = [];
  const rank = new Array(n).fill(0);
  const triangulosInferiores = [];
  const atalhosCriados = [];

  const adjSimbolico = adj.map((vizinhos) => new Set(vizinhos));

  for (let passo = 0; passo < n; passo++) {
    let melhorNo = -1;
    let menorGrau = Infinity;

    for (let v = 0; v < n; v++) {
      if (!contraido[v]) {
        const grauAtual = adjSimbolico[v].size;
        if (grauAtual < menorGrau) {
          menorGrau = grauAtual;
          melhorNo = v;
        }
      }
    }

    const v = melhorNo;
    contraido[v] = true;
    ordemContracao.push(v);
    rank[v] = passo;

    // Vizinhos de v ainda não contraídos (terão rank superior a v)
    const vizinhosSuperiores = Array.from(adjSimbolico[v]).filter((u) => !contraido[u]);

    // Cria clique (shortcuts) entre os vizinhos superiores de v e registra os triângulos (v, u, w)
    for (let i = 0; i < vizinhosSuperiores.length; i++) {
      for (let j = i + 1; j < vizinhosSuperiores.length; j++) {
        const u = vizinhosSuperiores[i];
        const w = vizinhosSuperiores[j];
        const ehAtalhoNovo = !adjSimbolico[u].has(w) && !arestasOriginais.has(chaveAresta(u, w));

        adjSimbolico[u].add(w);
        adjSimbolico[w].add(u);
        adj[u].add(w);
        adj[v].add(u);
        adj[u].add(v);
        adj[v].add(w);
        adj[w].add(v);

        if (ehAtalhoNovo) {
          atalhosCriados.push([u, w]);
        }

        triangulosInferiores.push({ v, u, w });
      }
    }
  }

  // Constrói o grafo direcionado ascendente (Upward Graph G^) onde rank[u] < rank[w]
  const adjSuperior = Array.from({ length: n }, () => []);
  for (let u = 0; u < n; u++) {
    for (const w of adj[u]) {
      if (rank[u] < rank[w]) {
        adjSuperior[u].push(w);
      }
    }
  }

  return {
    n,
    ordemContracao,
    rank,
    adjSuperior,
    triangulosInferiores,
    arestasOriginais: Array.from(arestasOriginais).map((k) => k.split("-").map(Number)),
    atalhosCriados,
  };
}

/**
 * FASE 2 DO CCH: Customização de Métrica (Pesos Dinâmicos)
 * Aplica os pesos direcionados (considerando distância/tempo do OSRM e prioridade dos pontos)
 * e propaga o relaxamento nos triângulos na ordem de contração.
 */
export function customizarPesosCCH(hierarquia, nos, matrizBase, modoCriterio = "tempo") {
  const { n, adjSuperior, triangulosInferiores } = hierarquia;

  // Matrizes de pesos upward (subindo na hierarquia) e downward (descendo na hierarquia)
  const pesoUp = Array.from({ length: n }, () => new Array(n).fill(Infinity));
  const pesoDown = Array.from({ length: n }, () => new Array(n).fill(Infinity));

  for (let i = 0; i < n; i++) {
    pesoUp[i][i] = 0;
    pesoDown[i][i] = 0;
  }

  // Inicializa os arcos da hierarquia com a métrica escolhida
  for (let u = 0; u < n; u++) {
    for (const w of adjSuperior[u]) {
      const custoIda = obterCustoArco(u, w, nos, matrizBase, modoCriterio);
      const custoVolta = obterCustoArco(w, u, nos, matrizBase, modoCriterio);
      pesoUp[u][w] = custoIda;
      pesoDown[w][u] = custoVolta;
    }
  }

  // Relaxamento bottom-up dos triângulos inferiores (núcleo da fase de Customização do CCH)
  for (const { v, u, w } of triangulosInferiores) {
    const rankUMenorQueW = hierarquia.rank[u] < hierarquia.rank[w];
    const baixo = rankUMenorQueW ? u : w;
    const alto = rankUMenorQueW ? w : u;

    // Caminho baixo -> v -> alto (sobe para alto passando por v de rank inferior)
    const viaVIda = pesoDown[baixo][v] + pesoUp[v][alto];
    if (viaVIda < pesoUp[baixo][alto]) {
      pesoUp[baixo][alto] = viaVIda;
    }

    // Caminho alto -> v -> baixo (desce de alto para baixo passando por v)
    const viaVVolta = pesoDown[alto][v] + pesoUp[v][baixo];
    if (viaVVolta < pesoDown[alto][baixo]) {
      pesoDown[alto][baixo] = viaVVolta;
    }
  }

  return { pesoUp, pesoDown };
}

function obterCustoArco(origemIdx, destinoIdx, nos, matrizBase, modoCriterio) {
  let custoBase;
  if (
    matrizBase &&
    matrizBase[origemIdx] &&
    Number.isFinite(matrizBase[origemIdx][destinoIdx])
  ) {
    custoBase = matrizBase[origemIdx][destinoIdx];
  } else {
    custoBase = calcularDistanciaHaversine(
      nos[origemIdx].coordinates,
      nos[destinoIdx].coordinates
    );
  }

  if (modoCriterio === "prioridade") {
    const prioridadeDestino = nos[destinoIdx].prioridade || "normal";
    const multiplicador = PESO_PRIORIDADE[prioridadeDestino] ?? 1.0;
    return custoBase * multiplicador;
  }

  return custoBase;
}

/**
 * FASE 3 DO CCH: Consulta Bidirecional na Hierarquia (Upward/Downward Search)
 * Calcula o menor custo entre origem (s) e destino (t) subindo apenas para ancestrais na árvore de eliminação.
 */
export function consultarCaminhoMinimoCCH(s, t, hierarquia, pesosCustomizados) {
  if (s === t) return 0;

  const { n, ordemContracao, adjSuperior } = hierarquia;
  const { pesoUp, pesoDown } = pesosCustomizados;

  const distForward = new Array(n).fill(Infinity);
  const distBackward = new Array(n).fill(Infinity);

  distForward[s] = 0;
  distBackward[t] = 0;

  // Varredura ascendente na ordem de contração (Elimination Tree Walk do CCH)
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

  // Encontra o vértice de encontro (meeting node) de maior hierarquia que minimiza d_f(v) + d_b(v)
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
 * Sequenciamento ótimo de paradas usando a matriz de custos consultada via CCH
 * Combina Vizinho Mais Próximo ponderado por prioridade + refinamento local 2-Opt.
 */
export function otimizarSequenciaComCCH({
  nos,
  arestasMalha,
  matrizCustosBase,
  temDestinoFixo = false,
  criterio = "tempo",
}) {
  const hierarquia = construirHierarquiaTopologicaCCH(nos, arestasMalha);
  const pesosCustomizados = customizarPesosCCH(
    hierarquia,
    nos,
    matrizCustosBase,
    criterio
  );

  const n = nos.length;
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

  // Índice 0 é sempre a Origem; se temDestinoFixo=true, o último índice (n - 1) é o Destino Final fixo.
  const indiceFimFixo = temDestinoFixo ? n - 1 : -1;
  const intermediarios = [];
  for (let i = 1; i < n; i++) {
    if (i !== indiceFimFixo) intermediarios.push(i);
  }

  // Construção gulosa inicial guiada pelos custos reais CCH
  // (A prioridade desempata paradas próximas em até 15%, sem mandar ir a outra cidade distante antes de concluir a cidade atual)
  const PESO_SUAVE_PRIORIDADE = {
    alta: 0.88,
    normal: 1.0,
    baixa: 1.12,
  };

  const visitados = new Set([0]);
  const rotaIndices = [0];
  let atual = 0;

  while (rotaIndices.length < intermediarios.length + 1) {
    let melhorProximo = -1;
    let melhorCusto = Infinity;

    for (const candidato of intermediarios) {
      if (!visitados.has(candidato)) {
        const fatorPrioridade =
          criterio === "prioridade"
            ? PESO_SUAVE_PRIORIDADE[nos[candidato].prioridade || "normal"] ?? 1.0
            : 1.0;
        const custo = matrizCCH[atual][candidato] * fatorPrioridade;
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

  // Refinamento 2-Opt sobre a sequência usando a matriz CCH (preservando origem e destino fixo)
  const limiteFim = temDestinoFixo ? rotaIndices.length - 2 : rotaIndices.length - 1;
  let melhorou = true;
  while (melhorou) {
    melhorou = false;
    for (let i = 1; i < limiteFim; i++) {
      for (let k = i + 1; k <= limiteFim; k++) {
        const ganho = calcularGanho2Opt(rotaIndices, i, k, matrizCCH);
        if (ganho < -1e-6) {
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

function calcularGanho2Opt(rota, i, k, matriz) {
  const a = rota[i - 1];
  const b = rota[i];
  const c = rota[k];
  const d = k + 1 < rota.length ? rota[k + 1] : null;

  let custoAtual = matriz[a][b];
  let custoNovo = matriz[a][c];

  for (let idx = i; idx < k; idx++) {
    custoAtual += matriz[rota[idx]][rota[idx + 1]];
    custoNovo += matriz[rota[idx + 1]][rota[idx]];
  }

  if (d !== null) {
    custoAtual += matriz[c][d];
    custoNovo += matriz[b][d];
  }

  return custoNovo - custoAtual;
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
