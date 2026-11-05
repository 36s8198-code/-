// ===== 설정 =====
const SCHOOLS_URL = "/api/schools";
const SCHOOLS_FALLBACK = "data/closed-schools.json";
const KOSIS_URL = "/api/kosis";
const POLICY_URL = "data/policy.json";

// API 필드명 후보 (실제 응답에 맞게 필요 시 추가/수정)
const FIELDS = {
  name:      { names: ["schoolNm", "schlNm", "schNm", "학교명"], re: /(sch|school|학교).*(nm|name|명)/i },
  lat:       { names: ["latitude", "lat", "위도"], re: /(^lat|latitude|위도)/i },
  lon:       { names: ["longitude", "lon", "lng", "경도"], re: /(^lo?n|longitude|경도)/i },
  roadAddr:  { names: ["rdnmadr", "소재지도로명주소"], re: /(rdn|도로명)/i },
  lotAddr:   { names: ["lnmadr", "소재지지번주소"], re: /(lnm|지번)/i },
  closeDate: { names: ["clsDate", "closeDate", "폐교일자"], re: /(cls|clos|폐교).*(dt|date|일)/i },
  level:     { names: ["schoolSe", "학교급구분"], re: /(se$|급)/i },
  use:       { names: ["utlztnSttus", "활용현황"], re: /(utl|활용)/i },
  refDate:   { names: ["referenceDate", "데이터기준일자"], re: /(reference|기준).*(date|일)/i },
};

const state = { schools: [], policy: null, noCoord: 0, fieldsOk: true };
const $ = (id) => document.getElementById(id);

// ===== 유틸 =====
function pick(item, key) {
  const f = FIELDS[key];
  for (const n of f.names) if (item[n] !== undefined && item[n] !== "") return item[n];
  const k = Object.keys(item).find((x) => f.re.test(x) && item[x] !== "");
  return k ? item[k] : "";
}
function showNotice(type, text) {
  const p = document.createElement("p");
  p.className = type;
  p.textContent = text;
  $("notice").appendChild(p);
}
function el(tag, text, cls) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}
async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} 요청 실패 (HTTP ${res.status})`);
  return res.json();
}
function sidoOf(addr) {
  const first = String(addr || "").trim().split(/\s+/)[0];
  return first || "주소 없음";
}

// ===== 폐교 데이터 =====
function normalize(raw) {
  const out = [];
  let noCoord = 0;
  for (const item of raw) {
    const lat = parseFloat(pick(item, "lat"));
    const lon = parseFloat(pick(item, "lon"));
    const s = {
      name: pick(item, "name"),
      roadAddr: pick(item, "roadAddr"),
      lotAddr: pick(item, "lotAddr"),
      closeDate: pick(item, "closeDate"),
      level: pick(item, "level"),
      use: pick(item, "use"),
      refDate: pick(item, "refDate"),
      lat, lon,
      hasCoord: lat >= 33 && lat <= 39 && lon >= 124 && lon <= 132,
    };
    if (!s.hasCoord) noCoord++;
    out.push(s);
  }
  state.noCoord = noCoord;
  return out;
}

async function loadSchools() {
  let data;
  try {
    data = await fetchJson(SCHOOLS_URL);
  } catch (e1) {
    try {
      data = await fetchJson(SCHOOLS_FALLBACK);
      showNotice("info", "실시간 API 호출에 실패해 저장된 스냅샷 데이터를 표시합니다.");
    } catch (e2) {
      showNotice("error", "폐교 데이터를 불러오지 못했습니다. 서버 함수와 API 키 설정을 확인해 주세요. (" + e1.message + ")");
      $("ref-schools").textContent = "불러오기 실패";
      return;
    }
  }
  const raw = Array.isArray(data) ? data : data.items || [];
  if (!raw.length) {
    showNotice("info", "표시할 폐교 데이터가 없습니다. (API 응답이 비어 있음)");
    $("ref-schools").textContent = "데이터 없음";
    return;
  }
  state.schools = normalize(raw);
  const withName = state.schools.filter((s) => s.name).length;
  if (withName === 0 || state.noCoord === state.schools.length) {
    state.fieldsOk = false;
    showNotice("error", "응답 필드를 인식하지 못했습니다. 실제 필드명: " + Object.keys(raw[0]).join(", ") + " → app.js의 FIELDS를 수정해 주세요.");
  }
  const ref = state.schools.map((s) => s.refDate).filter(Boolean).sort().pop();
  $("ref-schools").textContent = (ref ? "데이터 기준일: " + ref + " / " : "") + "조회 시각: " + new Date().toLocaleString("ko-KR");
}

// ===== 지도 =====
function initMap() {
  const map = L.map("map").setView([36.3, 127.8], 7);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  const canvas = L.canvas({ padding: 0.5 });
  let shown = 0;
  for (const s of state.schools) {
    if (!s.hasCoord) continue;
    const m = L.circleMarker([s.lat, s.lon], { renderer: canvas, radius: 5, color: "#b23a2e", weight: 1, fillOpacity: 0.7 });
    m.bindPopup(() => popupContent(s));
    m.addTo(map);
    shown++;
  }
  const total = state.schools.length;
  $("map-summary").textContent = total
    ? `전체 ${total}개교 중 ${shown}개교를 지도에 표시했습니다.` + (state.noCoord ? ` 좌표가 없거나 범위를 벗어난 ${state.noCoord}개교는 제외되었습니다.` : "")
    : "표시할 폐교가 없습니다.";
}

function popupContent(s) {
  const box = document.createElement("div");
  box.appendChild(el("strong", s.name || "(학교명 없음)"));
  const rows = [
    ["주소", s.roadAddr || s.lotAddr],
    ["학교급", s.level],
    ["폐교일", s.closeDate],
    ["활용현황", s.use],
  ];
  for (const [k, v] of rows) if (v) box.appendChild(el("div", `${k}: ${v}`));
  return box;
}

// ===== 챗봇 =====
function addMsg(title, nodes, source) {
  const m = el("div", undefined, "msg");
  m.appendChild(el("h4", title));
  nodes.forEach((n) => m.appendChild(n));
  if (source) m.appendChild(el("div", "출처: " + source, "src"));
  const log = $("chat-log");
  log.appendChild(m);
  log.scrollTop = log.scrollHeight;
}

function table(headers, rows) {
  const t = document.createElement("table");
  const tr = document.createElement("tr");
  headers.forEach((h) => tr.appendChild(el("th", h)));
  t.appendChild(tr);
  rows.forEach((r) => {
    const row = document.createElement("tr");
    r.forEach((c) => row.appendChild(el("td", String(c))));
    t.appendChild(row);
  });
  return t;
}

function answerSchools() {
  if (!state.schools.length) {
    return addMsg("폐교 현황", [el("p", "폐교 데이터를 불러오지 못해 현황을 계산할 수 없습니다.")]);
  }
  const counts = {};
  state.schools.forEach((s) => {
    const k = sidoOf(s.roadAddr || s.lotAddr);
    counts[k] = (counts[k] || 0) + 1;
  });
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  addMsg(
    "폐교 현황",
    [el("p", `불러온 데이터 기준 전체 폐교는 ${state.schools.length}개교입니다. 시도별 현황:`), table(["시도", "폐교 수"], rows)],
    "공공데이터포털 전국폐교현황표준데이터"
  );
}

async function answerBirth() {
  const wait = el("p", "KOSIS 데이터를 불러오는 중...");
  addMsg("저출산 현황", [wait]);
  const msgBody = $("chat-log").lastChild;
  try {
    const data = await fetchJson(KOSIS_URL);
    if (data.err || !Array.isArray(data) || !data.length) {
      throw new Error(data.errMsg || data.error || "KOSIS 응답이 비어 있습니다.");
    }
    const rows = data
      .sort((a, b) => String(a.PRD_DE).localeCompare(String(b.PRD_DE)))
      .map((r) => [r.PRD_DE, r.C1_NM || "", r.ITM_NM, r.DT + (r.UNIT_NM ? " " + r.UNIT_NM : "")]);
    wait.replaceWith(table(["시점", "구분", "항목", "값"], rows));
    const tbl = data[0].TBL_NM || "KOSIS";
    msgBody.appendChild(el("div", "출처: 통계청 KOSIS - " + tbl, "src"));
    $("ref-kosis").textContent = "최신 시점: " + data.map((r) => r.PRD_DE).sort().pop();
  } catch (e) {
    wait.replaceWith(el("p", "저출산 통계를 불러오지 못했습니다. KOSIS 키와 통계표 설정을 확인해 주세요. (" + e.message + ")"));
    $("ref-kosis").textContent = "불러오기 실패";
  }
}

function answerPolicy() {
  const p = state.policy;
  if (!p || !p.culture) return addMsg("문화시설 관련 정책 추천", [el("p", "정책 자료를 불러오지 못했습니다.")]);
  const nodes = [el("p", p.culture.intro)];
  p.culture.sections.forEach((sec) => {
    nodes.push(el("strong", sec.title));
    if (sec.text) nodes.push(el("p", sec.text));
    if (sec.items) {
      const ul = document.createElement("ul");
      sec.items.forEach((i) => ul.appendChild(el("li", i)));
      nodes.push(ul);
    }
  });
  addMsg("문화시설 관련 정책 추천", nodes, p.culture.source);
}

const HANDLERS = { schools: answerSchools, kosis: answerBirth, policy: answerPolicy };

function initChat() {
  const box = $("keywords");
  if (!state.policy || !state.policy.keywords || !state.policy.keywords.length) {
    box.appendChild(el("p", "키워드 목록을 불러오지 못했습니다.", "meta"));
    return;
  }
  state.policy.keywords.forEach((k) => {
    const b = el("button", k.keyword);
    b.type = "button";
    b.addEventListener("click", () => {
      box.querySelectorAll("button").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      HANDLERS[k.handler]();
    });
    box.appendChild(b);
  });
}

// ===== 시작 =====
(async function main() {
  try {
    state.policy = await fetchJson(POLICY_URL);
  } catch (e) {
    showNotice("error", "정책 키워드 자료를 불러오지 못했습니다. (" + e.message + ")");
  }
  initChat();
  await loadSchools();
  initMap();
})();