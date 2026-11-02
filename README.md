<p align="center">
  <img src="front-end/assets/logo.svg" alt="RotaFast Logo" width="280" />
</p>

# RotaFast — Gestão Geográfica e Otimização Inteligente de Rotas

Aplicação web geoespacial desenvolvida para a disciplina de **Banco de Dados II** (Tecnologia em Análise e Desenvolvimento de Sistemas — IFPB), voltada ao gerenciamento de pontos de atendimento em mapa interativo e ao cálculo da melhor rota entre paradas utilizando **PostgreSQL + PostGIS**, **Customizable Contraction Hierarchies (CCH)**, **OSRM** e **Leaflet**.

---

## Sumário

1. [Funcionalidades Principais](#1-funcionalidades-principais)
2. [Tecnologias e Arquitetura](#2-tecnologias-e-arquitetura)
3. [Modelagem e Funções Espaciais no PostGIS](#3-modelagem-e-funções-espaciais-no-postgis)
4. [Motor de Otimização de Rotas (PostGIS + CCH + OSRM)](#4-motor-de-otimização-de-rotas-postgis--cch--osrm)
5. [Endpoints da API REST](#5-endpoints-da-api-rest)
6. [Como Executar Localmente](#6-como-executar-localmente)
7. [Implantação em Nuvem (Render + Supabase)](#7-implantação-em-nuvem-render--supabase)

---

## 1. Funcionalidades Principais

- **Mapa Interativo (Leaflet):** Visualização em tela cheia com alternância entre tema escuro padrão, OpenStreetMap claro e imagem de satélite (Esri), além de geolocalização automática do navegador (`navigator.geolocation`).
- **Geocodificação de Endereços (Nominatim):** Busca de cidades, ruas e estabelecimentos integrada ao OpenStreetMap Nominatim via proxy seguro no back-end.
- **CRUD Geográfico de Pontos de Atendimento:** Cadastro, listagem paginada, edição e exclusão de pontos com coordenadas `GEOMETRY(POINT, 4326)`, tipo de serviço (`Entrega`, `Coleta`, `Manutenção`, `Instalação`, `Visita Técnica`), prioridade (`baixa`, `normal`, `alta`) e status (`pendente`, `em_andamento`, `concluido`).
- **Carregamento Dinâmico por Área Visível (`ST_Intersects`):** Atualização automática dos pontos conforme o usuário navega ou aplica zoom no mapa, com cancelamento de requisições concorrentes via `AbortController`.
- **Busca Espacial por Raio de Distância (`ST_DWithin` + `ST_Distance`):** Filtragem de pontos dentro de um raio configurável (1 km a 25 km) a partir do marcador de referência, retornando a distância geodésica exata em metros.
- **Otimização Multicritério de Rotas (`CCH` + `OSRM`):** Escolha obrigatória do ponto de partida (GPS atual, marcador no mapa ou ponto cadastrado), seleção de paradas intermediárias e otimização por **Prioridade + Tempo Viário**, **Menor Tempo Viário** ou **Menor Distância**.
- **Visualização Vetorial em Camadas e Persistência:** Exibição simultânea da malha de triangulação de Delaunay (`ST_DelaunayTriangles`), rota não-otimizada tracejada para comparação, rota principal com setas direcionais trecho a trecho e gravação do trajeto `GEOMETRY(LINESTRING, 4326)` no PostGIS.

---

## 2. Tecnologias e Arquitetura

| Camada | Tecnologias |
| :--- | :--- |
| **Front-end** | HTML5, CSS3 (Dark Slate Design System), JavaScript ES6+, Leaflet 1.9.4 |
| **Back-end** | Node.js (ES Modules), Express 5, CORS, Dotenv |
| **ORM & Banco Espacial** | Sequelize 6, PostgreSQL + extensão **PostGIS** (hospedado no **Supabase**), WKX |
| **Serviços Geográficos** | **OSRM** (matriz de custos `/table` e geometria viária `/route`), **Nominatim** (geocodificação) |
| **Hospedagem (PaaS)** | **Render** (Web Service unificado servindo API + Front-end) e **Supabase** (PostgreSQL/PostGIS) |

### Estrutura de Diretórios

```text
RotaFast/
├── back-end/
│   ├── controller/
│   │   ├── PontoController.js   # CRUD geográfico e consultas ST_Intersects / ST_DWithin
│   │   └── RotaController.js    # Otimização CCH + Delaunay PostGIS + OSRM e persistência
│   ├── database/
│   │   └── sequelize.js         # Conexão PostgreSQL/Supabase (SSL) e ativação do PostGIS
│   ├── model/
│   │   ├── Ponto.js             # Tabela pontos_atendimento — GEOMETRY(POINT, 4326) + GIST
│   │   └── Rota.js              # Tabela rotas_planejadas — GEOMETRY(LINESTRING, 4326) + GIST
│   ├── router/
│   │   ├── PontoRouter.js       # Rotas /pontos, /pontos/area e /pontos/proximos
│   │   └── RotaRouter.js        # Rotas /rotas e /rotas/otimizar
│   ├── services/
│   │   └── cchService.js        # Algoritmo CCH em 3 fases + refinamento 2-Opt Soft Constraint
│   ├── index.js                 # Servidor Express, proxy Nominatim e arquivos estáticos
│   └── package.json
├── front-end/
│   ├── assets/                  # Logotipo e favicon vetoriais (SVG)
│   ├── index.html               # Interface SPA com mapa e painel lateral em abas
│   ├── style.css                # Estilização responsiva e hierarquia visual de camadas
│   └── script.js                # Lógica de mapa, geocodificação, filtros espaciais e rotas
└── package.json                 # Scripts unificados de build e start para deploy no Render
```

---

## 3. Modelagem e Funções Espaciais no PostGIS

O banco de dados utiliza o sistema de referência espacial **WGS 84 (`SRID 4326`)** com índices espaciais **GIST**:

1. **`pontos_atendimento` (`model/Ponto.js`):**
   - Coluna `localizacao`: `GEOMETRY(POINT, 4326)` indexada com `USING GIST`.
2. **`rotas_planejadas` (`model/Rota.js`):**
   - Colunas `origem` e `destino`: `GEOMETRY(POINT, 4326)`.
   - Coluna `trajeto`: `GEOMETRY(LINESTRING, 4326)` indexada com `USING GIST`.
   - Coluna `paradas`: `JSONB` contendo a ordem otimizada de visita.
3. **Consultas Espaciais Nativas executadas pelo Back-end:**
   - `ST_Intersects(localizacao, ST_MakeEnvelope(minLng, minLat, maxLng, maxLat, 4326))` — filtra pontos contidos no retângulo visível do mapa.
   - `ST_DWithin(localizacao::geography, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, :raio)` — filtra pontos dentro do raio em metros na superfície terrestre.
   - `ST_Distance(localizacao::geography, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography)` — calcula a distância exata em metros até cada ponto retornado.
   - `ST_AsGeoJSON(ST_DelaunayTriangles(ST_GeomFromText(:wkt, 4326), 0.0, 1))` — gera a malha de triangulação de Delaunay entre os pontos da rota diretamente no PostGIS.

---

## 4. Motor de Otimização de Rotas (PostGIS + CCH + OSRM)

O cálculo da melhor rota em `back-end/services/cchService.js` e `back-end/controller/RotaController.js` opera em quatro etapas:

1. **Malha Espacial Base (`ST_DelaunayTriangles`) e Matriz Viária (`OSRM Table`):**
   - O PostGIS gera as arestas da triangulação de Delaunay entre os pontos e o OSRM fornece a matriz de tempos e distâncias reais pelas ruas.
2. **CCH — Fase 1 (Contração Topológica):**
   - Os vértices são contraídos em ordem de grau mínimo sobre a malha esparsa, inserindo atalhos cordais (*shortcuts*) e registrando os triângulos inferiores $(v, u, w)$.
3. **CCH — Fase 2 (Customização de Métricas):**
   - Os arcos ascendentes (`pesoUp`) e descendentes (`pesoDown`) recebem os pesos da métrica escolhida (`prioridade`, `tempo` ou `distancia`) e propagam o relaxamento bottom-up pelos triângulos da hierarquia.
4. **CCH — Fase 3 (Consulta na Árvore de Eliminação + 2-Opt com Penalidade Suave):**
   - A matriz de caminhos mínimos na hierarquia alimenta a construção inicial da sequência, seguida pelo refinamento local **2-Opt com Soft Constraint**:
     $$\Delta_{\text{custo}} = \Delta_{\text{distância}} + \lambda \cdot \sum_{i \le p < q \le k} (\text{prio}_p - \text{prio}_q)$$
   - Por fim, uma chamada unificada ao OSRM (`/route/v1/driving/...?overview=full&geometries=geojson&steps=true&continue_straight=false`) reconstrói a geometria viária real e os trechos direcionados.

---

## 5. Endpoints da API REST

| Método | Rota | Descrição |
| :--- | :--- | :--- |
| `GET` | `/health` | Verifica o status de saúde da API. |
| `GET` | `/geocodificacao?q={termo}` | Busca coordenadas de um endereço via Nominatim. |
| `GET` | `/pontos` | Lista pontos cadastrados (suporta `?status=`, `?tipo=`, `?prioridade=`, `?limit=`, `?page=`). |
| `GET` | `/pontos/area` | Busca pontos na área visível (`?minLng=&minLat=&maxLng=&maxLat=`). |
| `GET` | `/pontos/proximos` | Busca pontos em um raio em metros (`?lat=&lng=&raio=`). |
| `GET` | `/pontos/:id` | Retorna os detalhes de um ponto específico por UUID. |
| `POST` | `/pontos` | Cadastra um novo ponto (`localizacao` GeoJSON Point ou `latitude`/`longitude`). |
| `PATCH` | `/pontos/:id` | Atualiza dados ou localização de um ponto existente. |
| `DELETE` | `/pontos/:id` | Remove um ponto de atendimento do banco. |
| `POST` | `/rotas/otimizar` | Calcula a sequência otimizada via CCH + PostGIS + OSRM. |
| `POST` | `/rotas` | Salva uma rota planejada (`LINESTRING`) na tabela `rotas_planejadas`. |
| `GET` | `/rotas` | Lista o histórico de rotas planejadas salvas no PostGIS. |
| `GET` | `/rotas/:id` | Consulta uma rota planejada específica pelo UUID. |
| `DELETE` | `/rotas/:id` | Exclui uma rota planejada do banco de dados. |

---

## 6. Como Executar Localmente

### Pré-requisitos
- **Node.js** 20+
- Banco de dados **PostgreSQL com extensão PostGIS** (local ou instância gratuita no **Supabase**)

### Passo a Passo

1. Clone o repositório:
   ```bash
   git clone https://github.com/jotaveHub/RotaFast.git
   cd RotaFast
   ```
2. Instale as dependências do back-end:
   ```bash
   npm run build
   ```
3. Crie o arquivo `back-end/.env` com base em `back-end/.env.example`:
   ```env
   PORT=3000
   DATABASE_URL=postgresql://usuario:senha@host.pooler.supabase.com:5432/postgres
   OSRM_BASE_URL=https://router.project-osrm.org
   NOMINATIM_BASE_URL=https://nominatim.openstreetmap.org
   ```
4. Inicie o servidor:
   ```bash
   npm start
   ```
5. Acesse no navegador:
   ```text
   http://localhost:3000
   ```

---

## 7. Implantação em Nuvem (Render + Supabase)

1. No **Supabase**, acesse **Project Settings > Database > Connection string (URI — Session Pooler IPv4)** e copie a URL de conexão (`postgresql://postgres.[ref]:[senha]@aws-0-[regiao].pooler.supabase.com:5432/postgres`).
2. No **Render**, clique em **New + > Web Service** e conecte o repositório GitHub `jotaveHub/RotaFast`.
3. Configure o serviço no Render:
   - **Runtime:** `Node`
   - **Build Command:** `npm run build`
   - **Start Command:** `npm start`
4. Em **Environment Variables**, adicione:
   - `DATABASE_URL`: sua URI do Supabase (com caracteres especiais da senha codificados em URL, se houver)
   - `OSRM_BASE_URL`: `https://router.project-osrm.org`
   - `NOMINATIM_BASE_URL`: `https://nominatim.openstreetmap.org`
5. Clique em **Deploy Web Service**. O Express servirá automaticamente tanto a API REST quanto a interface estática do `front-end/`.
