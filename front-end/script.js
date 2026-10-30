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

localizarUsuario();

