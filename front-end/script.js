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

// Mapas Base Recomendados pela Especificação Visual (Seção 4)
const tileCartoLight = L.tileLayer(
  "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  {
    maxZoom: 20,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
  }
);

const tileCartoDark = L.tileLayer(
  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  {
    maxZoom: 20,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
  }
);

const tileOSM = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
});

tileCartoLight.addTo(map);

L.control
  .layers(
    {
      "Carto Positron (Claro Neutro)": tileCartoLight,
      "Carto Dark Matter (Escuro)": tileCartoDark,
      "OpenStreetMap Padrão": tileOSM,
    },
    {},
    { position: "topright" }
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

// Marcador arrastável para seleção de coordenada / origem
const iconeCursor = L.divIcon({
  className: "custom-div-icon",
  html: `<div class="marker-cursor" title="Arraste para escolher a posição">+</div>`,
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

    const classePrioridade = ponto.prioridade === "alta" ? "alta" : "";
    const iconePonto = L.divIcon({
      className: "custom-div-icon",
      html: `<div class="marker-waypoint ${classePrioridade}" title="${ponto.nome}">${
        idx + 1
      }</div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });

    const m = L.marker(latlng, {
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

    if (listaEl) {
      const card = document.createElement("div");
      card.className = "point-item";
      const badgeDist =
        ponto.distancia_metros !== undefined
          ? `<span class="badge badge-dist">${Number(ponto.distancia_metros).toFixed(0)} m</span>`
          : "";

      card.innerHTML = `
        <div class="point-info">
          <h5>${idx + 1}. ${ponto.nome}</h5>
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
          <button type="button" title="Centralizar" data-focus="${ponto.id}">🎯</button>
          <button type="button" title="Editar" onclick="window.prepararEdicaoPonto('${
            ponto.id
          }')">✏️</button>
          <button type="button" title="Excluir" onclick="window.removerPonto('${
            ponto.id
          }')">🗑️</button>
        </div>
      `;

      card.querySelector("[data-focus]")?.addEventListener("click", () => {
        map.setView(latlng, 16);
        m.openPopup();
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

localizarUsuario();
carregarPontosPorAreaVisivel();

