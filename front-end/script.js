/**
 * RotaFast — Front-end Interativo (Leaflet + PostGIS + CCH + OSRM + Nominatim)
 */

const API_BASE =
  window.location.protocol === "file:" ||
  (window.location.port && window.location.port !== "3000")
    ? "http://localhost:3000"
    : "";

// Coordenada padrão inicial (Cajazeiras - PB) caso a geolocalização seja negada
const COORD_INICIAL = [-6.8863, -38.5559];

// 1. Inicialização do Mapa Leaflet (Camada 0)
const map = L.map("map", {
  zoomControl: false,
}).setView(COORD_INICIAL, 14);

L.control.zoom({ position: "bottomright" }).addTo(map);

// Mapas Base 100% gratuitos sem necessidade de API Key (OpenStreetMap + Esri)
const tileOSM = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
});

const tileOSMNeutro = L.tileLayer(
  "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  {
    maxZoom: 19,
    className: "map-tiles-neutral",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }
);

const tileOSMEscuro = L.tileLayer(
  "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  {
    maxZoom: 19,
    className: "map-tiles-dark",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }
);

const tileEsriSatelite = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  {
    maxZoom: 19,
    className: "map-tiles-satellite",
    attribution: "Tiles &copy; Esri",
  }
);

tileOSMEscuro.addTo(map);

L.control
  .layers(
    {
      "Mapa Tema Escuro (Padrão)": tileOSMEscuro,
      "OpenStreetMap Padrão": tileOSM,
      "Mapa Claro Neutro": tileOSMNeutro,
      "Satélite (Esri)": tileEsriSatelite,
    },
    {},
    { position: "bottomright" }
  )
  .addTo(map);

// 2. Hierarquia de Renderização em Camadas (Z-Index da Especificação Visual — Seção 2)
map.createPane("paneRaio");
map.getPane("paneRaio").style.zIndex = 410; // Camada 1: Raio / Área de Custo

map.createPane("paneMalha");
map.getPane("paneMalha").style.zIndex = 420; // Camada 2: Malha de Triangulação (PostGIS + CCH)

map.createPane("paneRotaAlternativa");
map.getPane("paneRotaAlternativa").style.zIndex = 430; // Camada 3: Rota Alternativa (Tracejada)

map.createPane("paneRotaAtiva");
map.getPane("paneRotaAtiva").style.zIndex = 440; // Camada 4: Rota Principal Otimizada + Halo

map.createPane("paneMarcadores");
map.getPane("paneMarcadores").style.zIndex = 650; // Camada 5: Marcadores Principais (Topo)

// Grupos de camadas no mapa
const grupoRaio = L.layerGroup().addTo(map);
const grupoMalha = L.layerGroup().addTo(map);
const grupoRotaAlternativa = L.layerGroup().addTo(map);
const grupoRotaAtiva = L.layerGroup().addTo(map);
const grupoPontos = L.layerGroup().addTo(map);

// Ícones SVG Vetoriais Realistas (Lucide / Feather Style)
const ICONES_SVG = {
  cursor: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M12 2v4m0 12v4M2 12h4m12 0h4"></path></svg>`,
  foco: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M12 2v3m0 14v3M2 12h3m14 0h3"></path><circle cx="12" cy="12" r="7"></circle></svg>`,
  editar: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>`,
  excluir: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>`,
  mapa: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"></polygon><line x1="9" y1="3" x2="9" y2="18"></line><line x1="15" y1="6" x2="15" y2="21"></line></svg>`,
  origem: `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg>`,
  destino: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line></svg>`,
};

// Marcador arrastável para seleção de coordenada / origem
const iconeCursor = L.divIcon({
  className: "custom-div-icon",
  html: `<div class="marker-cursor" title="Arraste para escolher a posição">${ICONES_SVG.cursor}</div>`,
  iconSize: [34, 34],
  iconAnchor: [17, 17],
});

const markerCursor = L.marker(COORD_INICIAL, {
  draggable: true,
  icon: iconeCursor,
  pane: "paneMarcadores",
}).addTo(map);

function atualizarTextoCoordenadaCursor() {
  const pos = markerCursor.getLatLng();
  const el = document.getElementById("coordAtualTexto");
  if (el) {
    el.textContent = `Lat: ${pos.lat.toFixed(5)} | Lng: ${pos.lng.toFixed(5)}`;
  }
}

atualizarTextoCoordenadaCursor();

markerCursor.on("dragend", () => {
  atualizarTextoCoordenadaCursor();
});

map.on("click", (evento) => {
  markerCursor.setLatLng(evento.latlng);
  atualizarTextoCoordenadaCursor();
});

// Notificação Toast
function mostrarToast(mensagem) {
  const toast = document.getElementById("toastNotificacao");
  if (!toast) return;
  toast.textContent = mensagem;
  toast.classList.remove("hidden");
  clearTimeout(mostrarToast._timer);
  mostrarToast._timer = setTimeout(() => {
    toast.classList.add("hidden");
  }, 3200);
}

// 3. Geolocalização do Navegador
function localizarUsuario() {
  map.locate({ setView: true, maxZoom: 15 });
}

map.on("locationfound", (evento) => {
  markerCursor.setLatLng(evento.latlng);
  atualizarTextoCoordenadaCursor();
  mostrarToast("Localização atual obtida com sucesso!");
});

map.on("locationerror", () => {
  mostrarToast("Permissão de localização negada — usando posição padrão.");
});

document
  .getElementById("btnMinhaLocalizacao")
  ?.addEventListener("click", localizarUsuario);

// Alternância de Abas no Painel Lateral
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((sec) => sec.classList.add("hidden"));

    btn.classList.add("active");
    const alvo = document.getElementById(btn.dataset.tab);
    if (alvo) alvo.classList.remove("hidden");
  });
});

// 4. Geocodificação de Endereços (Nominatim via Back-end)
const inputBusca = document.getElementById("localBuscar");
const btnBuscar = document.getElementById("btnBuscar");
const listaResultadosBusca = document.getElementById("resultadosBusca");

async function buscarEndereco() {
  const termo = inputBusca?.value?.trim();
  if (!termo) {
    mostrarToast("Digite um endereço ou localidade para buscar.");
    return;
  }

  try {
    btnBuscar.textContent = "Buscando...";
    let dados = [];

    try {
      const resp = await fetch(
        `${API_BASE}/geocodificacao?q=${encodeURIComponent(termo)}`
      );
      if (resp.ok) {
        dados = await resp.json();
      }
    } catch {
      const respDireta = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
          termo
        )}&format=json&limit=5`
      );
      dados = await respDireta.json();
    }

    if (!Array.isArray(dados) || dados.length === 0) {
      listaResultadosBusca.classList.add("hidden");
      mostrarToast("Nenhum local encontrado para essa busca.");
      return;
    }

    listaResultadosBusca.innerHTML = "";
    dados.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item.display_name;
      li.addEventListener("click", () => {
        const lat = parseFloat(item.lat);
        const lon = parseFloat(item.lon);
        map.setView([lat, lon], 16);
        markerCursor.setLatLng([lat, lon]);
        atualizarTextoCoordenadaCursor();

        const campoEnd = document.getElementById("campoEndereco");
        if (campoEnd && !campoEnd.value) {
          campoEnd.value = item.display_name.split(",").slice(0, 3).join(",");
        }
        listaResultadosBusca.classList.add("hidden");
      });
      listaResultadosBusca.appendChild(li);
    });

    listaResultadosBusca.classList.remove("hidden");

    // Move imediatamente para o primeiro resultado mais relevante
    const primeiro = dados[0];
    const lat0 = parseFloat(primeiro.lat);
    const lon0 = parseFloat(primeiro.lon);
    map.setView([lat0, lon0], 15);
    markerCursor.setLatLng([lat0, lon0]);
    atualizarTextoCoordenadaCursor();
  } catch {
    mostrarToast("Erro ao consultar serviço de geocodificação.");
  } finally {
    btnBuscar.textContent = "Buscar";
  }
}

btnBuscar?.addEventListener("click", buscarEndereco);
inputBusca?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    buscarEndereco();
  }
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".search-wrapper")) {
    listaResultadosBusca?.classList.add("hidden");
  }
});

// 5. Estado de Pontos e Carregamento Dinâmico por Área Visível (ST_Intersects)
let pontosAtuais = [];
const idsSelecionadosRota = new Set();
let debounceAreaTimer = null;

function obterLatLngDoPonto(ponto) {
  if (ponto?.localizacao?.coordinates?.length >= 2) {
    // No PostGIS/GeoJSON: coordinates = [longitude, latitude]
    const [lng, lat] = ponto.localizacao.coordinates;
    return [Number(lat), Number(lng)];
  }
  if (ponto?.latitude !== undefined && ponto?.longitude !== undefined) {
    return [Number(ponto.latitude), Number(ponto.longitude)];
  }
  return null;
}

function renderizarPontosNoMapaELista(pontos) {
  pontosAtuais = Array.isArray(pontos) ? pontos : [];
  grupoPontos.clearLayers();

  const mapaOrdemRota = new Map();
  if (ultimaRotaCalculada && Array.isArray(ultimaRotaCalculada.paradas)) {
    ultimaRotaCalculada.paradas.forEach((parada) => {
      if (parada.id) {
        mapaOrdemRota.set(String(parada.id), parada.ordem);
      }
    });
  }

  const contadorEl = document.getElementById("contadorPontos");
  if (contadorEl) contadorEl.textContent = String(pontosAtuais.length);

  const listaEl = document.getElementById("listaPontos");
  if (listaEl) listaEl.innerHTML = "";

  pontosAtuais.forEach((ponto, idx) => {
    const latlng = obterLatLngDoPonto(ponto);
    if (!latlng) return;

    if (!idsSelecionadosRota.has(ponto.id) && ponto.status !== "concluido") {
      idsSelecionadosRota.add(ponto.id);
    }

    const ordemNaRota = mapaOrdemRota.get(String(ponto.id));
    const numeroExibicao = ordemNaRota !== undefined ? ordemNaRota : idx + 1;

    const classePrioridade = ponto.prioridade === "alta" ? "alta" : "";
    const iconePonto = L.divIcon({
      className: "custom-div-icon",
      html: `<div class="marker-waypoint ${classePrioridade}" title="${ponto.nome}">${numeroExibicao}</div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });

    let m = null;
    // Se o ponto já faz parte da rota otimizada ativa no mapa, evita desenhar marcador duplicado por cima
    if (ordemNaRota === undefined) {
      m = L.marker(latlng, {
        icon: iconePonto,
        pane: "paneMarcadores",
      }).addTo(grupoPontos);

      const distHtml =
        ponto.distancia_metros !== undefined
          ? `<p><strong>Distância:</strong> ${Number(ponto.distancia_metros).toFixed(0)} m</p>`
          : "";

      m.bindPopup(`
        <div class="popup-card">
          <h4>${ponto.nome}</h4>
          <p>${ponto.endereco || "Sem endereço informado"}</p>
          <p>${ponto.descricao || ""}</p>
          <p><strong>Tipo:</strong> ${ponto.tipo || "Entrega"} | <strong>Prioridade:</strong> ${
        ponto.prioridade || "normal"
      }</p>
          ${distHtml}
          <div class="popup-actions">
            <button type="button" class="btn-popup-edit" onclick="window.prepararEdicaoPonto('${
              ponto.id
            }')">Editar</button>
            <button type="button" class="btn-popup-del" onclick="window.removerPonto('${
              ponto.id
            }')">Excluir</button>
          </div>
        </div>
      `);
    }

    if (listaEl) {
      const card = document.createElement("div");
      card.className = "point-item";
      const badgeDist =
        ponto.distancia_metros !== undefined
          ? `<span class="badge badge-dist">${Number(ponto.distancia_metros).toFixed(0)} m</span>`
          : "";

      card.innerHTML = `
        <div class="point-info">
          <h5>${numeroExibicao}. ${ponto.nome}</h5>
          <p>${ponto.endereco || ponto.descricao || "Coordenada registrada"}</p>
          <div class="point-badges">
            <span class="badge badge-${ponto.prioridade || "normal"}">${
        ponto.prioridade || "normal"
      }</span>
            <span class="badge badge-normal">${ponto.tipo || "Entrega"}</span>
            ${badgeDist}
          </div>
        </div>
        <div class="point-actions">
          <button type="button" class="action-btn focus" title="Centralizar no mapa" data-focus="${ponto.id}">${ICONES_SVG.foco}</button>
          <button type="button" class="action-btn edit" title="Editar ponto" onclick="window.prepararEdicaoPonto('${
            ponto.id
          }')">${ICONES_SVG.editar}</button>
          <button type="button" class="action-btn delete" title="Excluir ponto" onclick="window.removerPonto('${
            ponto.id
          }')">${ICONES_SVG.excluir}</button>
        </div>
      `;

      card.querySelector("[data-focus]")?.addEventListener("click", () => {
        map.setView(latlng, 16);
        if (m) m.openPopup();
      });

      listaEl.appendChild(card);
    }
  });

  if (typeof atualizarChecklistParadas === "function") {
    atualizarChecklistParadas();
  }
}

async function carregarPontosPorAreaVisivel() {
  const raioSelecionado = Number(document.getElementById("selectRaio")?.value || 0);
  if (raioSelecionado > 0) {
    if (typeof carregarPontosPorRaio === "function") {
      await carregarPontosPorRaio(raioSelecionado);
    }
    return;
  }

  try {
    const bounds = map.getBounds();
    const minLng = bounds.getWest();
    const minLat = bounds.getSouth();
    const maxLng = bounds.getEast();
    const maxLat = bounds.getNorth();

    const resp = await fetch(
      `${API_BASE}/pontos/area?minLng=${minLng}&minLat=${minLat}&maxLng=${maxLng}&maxLat=${maxLat}`
    );
    if (!resp.ok) return;
    const dados = await resp.json();
    renderizarPontosNoMapaELista(dados);
  } catch {
    // Silencioso caso o back-end esteja reiniciando
  }
}

map.on("moveend", () => {
  clearTimeout(debounceAreaTimer);
  debounceAreaTimer = setTimeout(carregarPontosPorAreaVisivel, 250);
});

// 6. Cadastro de Novo Ponto enviando GeoJSON Point para a API
function limparFormularioPonto() {
  document.getElementById("pontoIdEdicao").value = "";
  document.getElementById("campoNome").value = "";
  document.getElementById("campoEndereco").value = "";
  document.getElementById("campoDescricao").value = "";
  document.getElementById("campoTipo").value = "Entrega";
  document.getElementById("campoPrioridade").value = "normal";
  document.getElementById("campoStatus").value = "pendente";
  document.getElementById("tituloFormPonto").textContent = "Novo Ponto de Atendimento";
  document.getElementById("btnSalvar").textContent = "Salvar Ponto";
  document.getElementById("btnCancelarEdicao")?.classList.add("hidden");
}

async function salvarPonto() {
  const idEdicao = document.getElementById("pontoIdEdicao")?.value?.trim();
  const nome = document.getElementById("campoNome")?.value?.trim();
  const endereco = document.getElementById("campoEndereco")?.value?.trim();
  const descricao = document.getElementById("campoDescricao")?.value?.trim();
  const tipo = document.getElementById("campoTipo")?.value || "Entrega";
  const prioridade = document.getElementById("campoPrioridade")?.value || "normal";
  const status = document.getElementById("campoStatus")?.value || "pendente";

  if (!nome) {
    mostrarToast("Informe o nome do ponto de atendimento.");
    return;
  }

  const pos = markerCursor.getLatLng();
  // No PostGIS (GeoJSON): coordinates = [longitude, latitude]
  const payload = {
    nome,
    endereco,
    descricao,
    tipo,
    prioridade,
    status,
    localizacao: {
      type: "Point",
      coordinates: [pos.lng, pos.lat],
    },
  };

  try {
    const url = idEdicao
      ? `${API_BASE}/pontos/${idEdicao}`
      : `${API_BASE}/pontos`;
    const metodo = idEdicao ? "PATCH" : "POST";

    const resp = await fetch(url, {
      method: metodo,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      mostrarToast("Erro ao salvar ponto no banco de dados.");
      return;
    }

    const salvo = await resp.json();
    const novoId = salvo?.id || salvo?.ponto?.id;
    if (novoId) idsSelecionadosRota.add(novoId);

    mostrarToast(
      idEdicao ? "Ponto atualizado com sucesso!" : "Ponto cadastrado no PostGIS!"
    );
    limparFormularioPonto();
    await carregarPontosPorAreaVisivel();
  } catch {
    mostrarToast("Falha de conexão com o servidor.");
  }
}

document.getElementById("btnSalvar")?.addEventListener("click", salvarPonto);
document
  .getElementById("btnCancelarEdicao")
  ?.addEventListener("click", limparFormularioPonto);

// 7. Edição e Exclusão de Pontos diretamente pelos Marcadores e Lista
window.prepararEdicaoPonto = (id) => {
  const ponto = pontosAtuais.find((p) => p.id === id);
  if (!ponto) return;

  document.getElementById("pontoIdEdicao").value = ponto.id;
  document.getElementById("campoNome").value = ponto.nome || "";
  document.getElementById("campoEndereco").value = ponto.endereco || "";
  document.getElementById("campoDescricao").value = ponto.descricao || "";
  document.getElementById("campoTipo").value = ponto.tipo || "Entrega";
  document.getElementById("campoPrioridade").value = ponto.prioridade || "normal";
  document.getElementById("campoStatus").value = ponto.status || "pendente";

  document.getElementById("tituloFormPonto").textContent = "Editando Ponto";
  document.getElementById("btnSalvar").textContent = "Atualizar Ponto";
  document.getElementById("btnCancelarEdicao")?.classList.remove("hidden");

  const latlng = obterLatLngDoPonto(ponto);
  if (latlng) {
    markerCursor.setLatLng(latlng);
    map.setView(latlng, 16);
    atualizarTextoCoordenadaCursor();
  }

  document.getElementById("tabBtnPontos")?.click();
  mostrarToast("Edite os campos ou arraste o marcador azul e clique em Atualizar.");
};

window.removerPonto = async (id) => {
  try {
    const resp = await fetch(`${API_BASE}/pontos/${id}`, {
      method: "DELETE",
    });

    if (!resp.ok) {
      mostrarToast("Erro ao excluir ponto.");
      return;
    }

    idsSelecionadosRota.delete(id);
    if (document.getElementById("pontoIdEdicao")?.value === id) {
      limparFormularioPonto();
    }

    mostrarToast("Ponto removido do PostGIS!");
    await carregarPontosPorAreaVisivel();
  } catch {
    mostrarToast("Falha ao comunicar com o servidor.");
  }
};

// 8. Busca Espacial por Distância/Raio (ST_DWithin + ST_Distance)
const selectRaioEl = document.getElementById("selectRaio");
const badgeModoEl = document.getElementById("modoBuscaBadge");

async function carregarPontosPorRaio(raioMetros) {
  grupoRaio.clearLayers();
  const pos = markerCursor.getLatLng();

  L.circle(pos, {
    radius: raioMetros,
    pane: "paneRaio",
    color: "#0ea5e9",
    weight: 2,
    dashArray: "6 4",
    fillColor: "#0ea5e9",
    fillOpacity: 0.1,
  }).addTo(grupoRaio);

  if (badgeModoEl) {
    badgeModoEl.textContent = `Raio: ${(raioMetros / 1000).toFixed(1)} km`;
  }

  try {
    const resp = await fetch(
      `${API_BASE}/pontos/proximos?lat=${pos.lat}&lng=${pos.lng}&raio=${raioMetros}`
    );
    if (!resp.ok) return;
    const dados = await resp.json();
    renderizarPontosNoMapaELista(dados);
  } catch {
    mostrarToast("Erro ao consultar pontos por raio.");
  }
}

selectRaioEl?.addEventListener("change", async () => {
  const valor = Number(selectRaioEl.value || 0);
  if (valor === 0) {
    grupoRaio.clearLayers();
    if (badgeModoEl) badgeModoEl.textContent = "Área Visível";
    await carregarPontosPorAreaVisivel();
  } else {
    await carregarPontosPorRaio(valor);
  }
});

markerCursor.on("dragend", async () => {
  const valor = Number(selectRaioEl?.value || 0);
  if (valor > 0) {
    await carregarPontosPorRaio(valor);
  }
});

// 9. Seleção de Paradas, Origem e Solicitação de Otimização de Rota (CCH + OSRM)
let ultimaRotaCalculada = null;

function atualizarChecklistParadas() {
  const container = document.getElementById("listaSelecaoParadas");
  if (!container) return;

  container.innerHTML = "";

  if (pontosAtuais.length === 0) {
    container.innerHTML = `<p style="font-size: 0.76rem; color: var(--text-muted);">Nenhum ponto carregado na área atual.</p>`;
    return;
  }

  pontosAtuais.forEach((ponto) => {
    const label = document.createElement("label");
    label.className = "checkbox-label";
    label.style.padding = "0.3rem 0.4rem";

    const checked = idsSelecionadosRota.has(ponto.id) ? "checked" : "";
    label.innerHTML = `
      <input type="checkbox" value="${ponto.id}" ${checked} />
      <span>${ponto.nome} <small style="color: var(--text-muted);">(${
      ponto.prioridade || "normal"
    })</small></span>
    `;

    const chk = label.querySelector("input");
    chk?.addEventListener("change", () => {
      if (chk.checked) {
        idsSelecionadosRota.add(ponto.id);
      } else {
        idsSelecionadosRota.delete(ponto.id);
      }
    });

    container.appendChild(label);
  });
}

document.getElementById("btnSelecionarTodos")?.addEventListener("click", () => {
  const todosMarcados = pontosAtuais.every((p) => idsSelecionadosRota.has(p.id));
  if (todosMarcados) {
    idsSelecionadosRota.clear();
  } else {
    pontosAtuais.forEach((p) => idsSelecionadosRota.add(p.id));
  }
  atualizarChecklistParadas();
});

async function solicitarOtimizacaoRota() {
  const nome =
    document.getElementById("campoNomeRota")?.value?.trim() || "Rota Otimizada CCH";
  const criterio =
    document.getElementById("campoCriterioCCH")?.value || "prioridade";
  const usarCursorOrigem = document.getElementById("chkUsarPosicaoOrigem")?.checked;
  const pontosIds = Array.from(idsSelecionadosRota);

  if (pontosIds.length === 0) {
    mostrarToast("Selecione ao menos 1 ponto de atendimento para calcular a rota.");
    return;
  }

  const posOrigem = markerCursor.getLatLng();
  const payload = {
    nome,
    criterio,
    pontosIds,
    salvar: false,
  };

  if (usarCursorOrigem) {
    payload.origem = {
      nome: "Ponto de Partida (Marcador)",
      latitude: posOrigem.lat,
      longitude: posOrigem.lng,
    };
  }

  const btnOtimizar = document.getElementById("btnOtimizarRota");
  try {
    if (btnOtimizar) btnOtimizar.textContent = "Calculando CCH...";

    const resp = await fetch(`${API_BASE}/rotas/otimizar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const dados = await resp.json();
    if (!resp.ok) {
      mostrarToast(dados.mensagem || "Não foi possível otimizar a rota.");
      return;
    }

    ultimaRotaCalculada = dados;
    if (typeof renderizarRotaOtimizadaNoMapa === "function") {
      renderizarRotaOtimizadaNoMapa(dados);
    }
    mostrarToast("Rota otimizada com algoritmo CCH + PostGIS + OSRM!");
  } catch {
    mostrarToast("Erro ao comunicar com o servidor de rotas.");
  } finally {
    if (btnOtimizar) btnOtimizar.textContent = "Calcular Melhor Rota";
  }
}

document
  .getElementById("btnOtimizarRota")
  ?.addEventListener("click", solicitarOtimizacaoRota);

// 10. Renderização Vetorial Multicamadas (Hierarquia Z-Index da Especificação Visual)
function limparCamadasDeRota() {
  grupoMalha.clearLayers();
  grupoRotaAlternativa.clearLayers();
  grupoRotaAtiva.clearLayers();
  document.getElementById("painelMetricasRota")?.classList.add("hidden");
}

function renderizarRotaOtimizadaNoMapa(dados) {
  grupoMalha.clearLayers();
  grupoRotaAlternativa.clearLayers();
  grupoRotaAtiva.clearLayers();

  const mostrarMalha = document.getElementById("chkMostrarMalha")?.checked ?? true;
  const mostrarAlternativa =
    document.getElementById("chkMostrarAlternativa")?.checked ?? true;

  // Camada 2: Malha de Triangulação (PostGIS ST_DelaunayTriangles + Atalhos CCH) — #0EA5E9
  if (mostrarMalha && dados.malha_triangulacao) {
    L.geoJSON(dados.malha_triangulacao, {
      pane: "paneMalha",
      style: (feature) => ({
        color: "#0ea5e9",
        weight: feature?.properties?.tipo === "atalho_cch" ? 2.2 : 1.5,
        opacity: 0.45,
        dashArray: feature?.properties?.tipo === "atalho_cch" ? "4 4" : null,
      }),
    }).addTo(grupoMalha);
  }

  // Camada 3: Rota Alternativa / Ordem Não-Otimizada — #64748B tracejada
  if (
    mostrarAlternativa &&
    dados.trajeto_alternativo &&
    Array.isArray(dados.trajeto_alternativo.coordinates)
  ) {
    const latlngsAlt = dados.trajeto_alternativo.coordinates.map(([lng, lat]) => [
      lat,
      lng,
    ]);
    L.polyline(latlngsAlt, {
      pane: "paneRotaAlternativa",
      color: "#64748b",
      weight: 3.5,
      opacity: 0.7,
      dashArray: "6 6",
    }).addTo(grupoRotaAlternativa);
  }

  // Camada 4: Rota Principal Otimizada (#2563EB) com Halo/Contorno de Contraste Branco
  if (dados.trajeto && Array.isArray(dados.trajeto.coordinates)) {
    const latlngsRota = dados.trajeto.coordinates.map(([lng, lat]) => [lat, lng]);

    // Halo de contraste (Seção 3.2 e 5.2 da Especificação Visual)
    L.polyline(latlngsRota, {
      pane: "paneRotaAtiva",
      color: "#ffffff",
      weight: 9,
      opacity: 0.85,
      lineCap: "round",
      lineJoin: "round",
    }).addTo(grupoRotaAtiva);

    // Traço principal ativo (#2563EB)
    const linhaPrincipal = L.polyline(latlngsRota, {
      pane: "paneRotaAtiva",
      color: "#2563eb",
      weight: 5.5,
      opacity: 1.0,
      lineCap: "round",
      lineJoin: "round",
    }).addTo(grupoRotaAtiva);

    map.fitBounds(linhaPrincipal.getBounds(), { padding: [55, 55] });
  }

  // Camada 5: Marcadores Acessíveis WCAG 2.1 AA com Numeração Idêntica à Sequência
  if (Array.isArray(dados.paradas)) {
    dados.paradas.forEach((parada, idx) => {
      if (!Array.isArray(parada.coordinates)) return;
      const [lng, lat] = parada.coordinates;
      const ehOrigem = idx === 0;
      const ehDestino = idx === dados.paradas.length - 1 && dados.paradas.length > 1;
      const classePrioridade = parada.prioridade === "alta" ? "alta" : "";

      let htmlMarcador;
      if (ehOrigem) {
        htmlMarcador = `<div class="marker-origin" title="${parada.ordem}ª Parada (Origem): ${parada.nome}"><span>${parada.ordem}</span></div>`;
      } else if (ehDestino) {
        htmlMarcador = `<div class="marker-destination" title="${parada.ordem}ª Parada (Destino Final): ${parada.nome}"><span>${parada.ordem}</span></div>`;
      } else {
        htmlMarcador = `<div class="marker-waypoint ${classePrioridade}" title="${parada.ordem}ª Parada: ${parada.nome}">${parada.ordem}</div>`;
      }

      const icone = L.divIcon({
        className: "custom-div-icon",
        html: htmlMarcador,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });

      L.marker([lat, lng], {
        icon: icone,
        pane: "paneMarcadores",
      })
        .bindPopup(
          `<div class="popup-card"><h4>${parada.ordem}ª Parada — ${parada.nome}</h4><p>${
            parada.endereco || ""
          }</p></div>`
        )
        .addTo(grupoRotaAtiva);
    });
  }

  // Re-sincroniza os marcadores gerais para não sobrepor os marcadores numerados da rota
  renderizarPontosNoMapaELista(pontosAtuais);

  // Atualização do Painel de Telemetria
  const painel = document.getElementById("painelMetricasRota");
  if (painel) {
    painel.classList.remove("hidden");
    const distKm = ((dados.distancia_metros || 0) / 1000).toFixed(2).replace(".", ",");
    const durMin = Math.max(1, Math.round((dados.duracao_segundos || 0) / 60));
    const econM = Math.round(dados.economia_metros || 0);
    const atalhos =
      dados.algoritmo?.atalhosCriadosCCH ??
      dados.algoritmo?.arestasMalhaBase ??
      0;

    document.getElementById("metricaDistancia").textContent = `${distKm} km`;
    document.getElementById("metricaDuracao").textContent = `${durMin} min`;
    document.getElementById("metricaEconomia").textContent = `${econM} m`;
    document.getElementById("metricaAtalhosCCH").textContent = String(atalhos);

    const listaSeq = document.getElementById("listaSequenciaParadas");
    if (listaSeq && Array.isArray(dados.paradas)) {
      listaSeq.innerHTML = "";
      dados.paradas.forEach((p, idx) => {
        const ehOrigem = idx === 0;
        const ehDestino = idx === dados.paradas.length - 1 && dados.paradas.length > 1;
        const classeBadge = ehOrigem
          ? "seq-badge origin"
          : ehDestino
          ? "seq-badge destination"
          : "seq-badge";

        const li = document.createElement("li");
        li.style.cursor = "pointer";
        li.innerHTML = `
          <span class="${classeBadge}">${p.ordem}</span>
          <span>${p.nome}</span>
        `;
        li.addEventListener("click", () => {
          if (Array.isArray(p.coordinates)) {
            map.setView([p.coordinates[1], p.coordinates[0]], 16);
          }
        });
        listaSeq.appendChild(li);
      });
    }
  }
}

document.getElementById("chkMostrarMalha")?.addEventListener("change", () => {
  if (ultimaRotaCalculada) renderizarRotaOtimizadaNoMapa(ultimaRotaCalculada);
});

document.getElementById("chkMostrarAlternativa")?.addEventListener("change", () => {
  if (ultimaRotaCalculada) renderizarRotaOtimizadaNoMapa(ultimaRotaCalculada);
});

document.getElementById("btnLimparRota")?.addEventListener("click", () => {
  ultimaRotaCalculada = null;
  limparCamadasDeRota();
  renderizarPontosNoMapaELista(pontosAtuais);
  mostrarToast("Camadas de rota limpas do mapa.");
});

// 11. Persistência e Histórico de Rotas Planejadas no PostGIS
let rotasSalvasCache = [];

async function carregarRotasSalvas() {
  const container = document.getElementById("listaRotasSalvas");
  if (!container) return;

  try {
    const resp = await fetch(`${API_BASE}/rotas`);
    if (!resp.ok) return;
    rotasSalvasCache = await resp.json();

    container.innerHTML = "";
    if (!Array.isArray(rotasSalvasCache) || rotasSalvasCache.length === 0) {
      container.innerHTML = `<p style="font-size: 0.76rem; color: var(--text-muted);">Nenhuma rota salva ainda.</p>`;
      return;
    }

    rotasSalvasCache.forEach((rota) => {
      const distKm = ((rota.distancia_metros || 0) / 1000).toFixed(2).replace(".", ",");
      const durMin = Math.max(1, Math.round((rota.duracao_segundos || 0) / 60));
      const qtdParadas = Array.isArray(rota.paradas) ? rota.paradas.length : 0;

      const card = document.createElement("div");
      card.className = "point-item";
      card.innerHTML = `
        <div class="point-info">
          <h5>${rota.nome}</h5>
          <p>${qtdParadas} paradas • ${distKm} km • ~${durMin} min</p>
        </div>
        <div class="point-actions">
          <button type="button" class="action-btn focus" title="Desenhar rota no mapa" onclick="window.visualizarRotaSalva('${rota.id}')">${ICONES_SVG.mapa}</button>
          <button type="button" class="action-btn delete" title="Excluir rota" onclick="window.excluirRotaSalva('${rota.id}')">${ICONES_SVG.excluir}</button>
        </div>
      `;
      container.appendChild(card);
    });
  } catch {
    // Silencioso caso o servidor esteja reiniciando
  }
}

window.visualizarRotaSalva = (id) => {
  const rota = rotasSalvasCache.find((r) => r.id === id);
  if (!rota) return;
  ultimaRotaCalculada = rota;
  renderizarRotaOtimizadaNoMapa(rota);
  mostrarToast(`Exibindo rota salva: ${rota.nome}`);
};

window.excluirRotaSalva = async (id) => {
  try {
    const resp = await fetch(`${API_BASE}/rotas/${id}`, {
      method: "DELETE",
    });
    if (!resp.ok) {
      mostrarToast("Erro ao excluir rota salva.");
      return;
    }
    mostrarToast("Rota removida do PostGIS!");
    await carregarRotasSalvas();
  } catch {
    mostrarToast("Falha de conexão com o servidor.");
  }
};

async function salvarRotaAtualNoBanco() {
  if (!ultimaRotaCalculada) {
    mostrarToast("Calcule uma rota primeiro antes de salvar.");
    return;
  }

  const paradas = ultimaRotaCalculada.paradas || [];
  const coordOrigem = paradas[0]?.coordinates;
  const coordDestino = paradas[paradas.length - 1]?.coordinates;

  const payload = {
    nome:
      document.getElementById("campoNomeRota")?.value?.trim() ||
      ultimaRotaCalculada.nome ||
      "Rota Planejada",
    origem: coordOrigem ? { type: "Point", coordinates: coordOrigem } : null,
    destino: coordDestino ? { type: "Point", coordinates: coordDestino } : null,
    trajeto: ultimaRotaCalculada.trajeto,
    paradas,
    distancia_metros: ultimaRotaCalculada.distancia_metros,
    duracao_segundos: ultimaRotaCalculada.duracao_segundos,
  };

  try {
    const resp = await fetch(`${API_BASE}/rotas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      mostrarToast("Erro ao salvar rota no PostGIS.");
      return;
    }

    mostrarToast("Rota salva com sucesso na tabela rotas_planejadas!");
    await carregarRotasSalvas();
  } catch {
    mostrarToast("Erro ao conectar com o servidor.");
  }
}

document
  .getElementById("btnSalvarRotaBanco")
  ?.addEventListener("click", salvarRotaAtualNoBanco);

localizarUsuario();
carregarPontosPorAreaVisivel();
carregarRotasSalvas();

