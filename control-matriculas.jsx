import { useState, useEffect, useMemo, useRef } from "react";

/* ── tokens ─────────────────────────────────────────────── */
const T = {
  ink: "#0E1419",
  ink2: "#39434D",
  ink3: "#727C86",
  line: "#C9CFD6",
  paper: "#E6EAEE",
  panel: "#FFFFFF",
  eu: "#123C8C",
  red: "#C41E27",
  green: "#0B6B45",
  sign: "#F5C518",
};

const CAT = ["BARCELONA", "GIRONA", "LLEIDA", "TARRAGONA"];
const KEY = "matriculas:registro:v1";

const MODEL = "claude-sonnet-4-6";

/* ── helpers ────────────────────────────────────────────── */
const strip = (s) =>
  (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();

function normProv(p) {
  let v = strip(p).replace(/\.$/, "");
  const map = {
    GERONA: "GIRONA",
    LERIDA: "LLEIDA",
    "ILLES BALEARS": "BALEARES",
    "ISLAS BALEARES": "BALEARES",
    "A CORUNA": "A CORUÑA",
    CORUNA: "A CORUÑA",
    "LA CORUNA": "A CORUÑA",
    ALAVA: "ARABA/ALAVA",
    GUIPUZCOA: "GIPUZKOA",
    VIZCAYA: "BIZKAIA",
    "STA CRUZ DE TENERIFE": "SANTA CRUZ DE TENERIFE",
  };
  return map[v] || v;
}

const normPlate = (p) => strip(p).replace(/[^A-Z0-9]/g, "");
const isCat = (p) => CAT.includes(normProv(p));
const cmp = (a, b) => (a || "").localeCompare(b || "", "es");

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

const isoOf = (d = new Date()) =>
  d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

const today = () => {
  const d = new Date();
  return String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0") + "/" + d.getFullYear();
};

/* "02/08/2026" → "2026-08-02" */
const dmyToIso = (s) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s || "");
  return m ? m[3] + "-" + m[2] + "-" + m[1] : "";
};

const longDate = (iso) => {
  const [y, m, d] = (iso || isoOf()).split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return DIAS[dt.getDay()] + " " + d + " de " + MESES[m - 1] + " de " + y;
};

const monthLabel = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return MESES[m - 1] + " " + y;
};

function rawB64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1]);
    r.onerror = () => rej(new Error("No se ha podido abrir el archivo"));
    r.readAsDataURL(file);
  });
}

/* Reduce la captura antes de enviarla. Si el navegador no puede,
   se envía el archivo original tal cual. */
async function prepare(file, max = 1100) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("canvas"));
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.width * scale));
    c.height = Math.max(1, Math.round(img.height * scale));
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const d = c.toDataURL("image/jpeg", 0.72).split(",")[1];
    if (!d || d.length < 500) throw new Error("canvas");
    return { data: d, media: "image/jpeg" };
  } catch (e) {
    const media = ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)
      ? file.type
      : "image/png";
    return { data: await rawB64(file), media };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const PROMPT = `Estás leyendo una captura de pantalla de apps.fomento.gob.es (Registro de Empresas y Actividades de Transporte, España).

Extrae los datos y devuelve SOLO un objeto JSON, sin texto adicional y sin backticks:
{"plate":"","status":"VIGOR|SIN_TITULO|REPETIR|UNKNOWN","province":"","municipality":"","address":"","holder":"","authorization":"","validUntil":"","notes":""}

Reglas:
- "plate": la matrícula del vehículo, en mayúsculas y sin espacios ni guiones. Si hay una tabla "Datos vehículo/s", usa la matrícula de esa tabla; si no, la que aparece escrita en el campo Matrícula.
- Si aparece una tabla o ficha con "Datos autorización de transporte", status = "VIGOR".
- Si aparece el texto rojo "La matrícula consultada no tiene titulos habilitantes en vigor", status = "SIN_TITULO".
- Si aparece el texto rojo "La verificacion de seguridad ha fallado", status = "REPETIR" (esa consulta no llegó a hacerse).
- "province": SOLO la provincia de "Domicilio del establecimiento" (la última palabra de esa línea, p. ej. "33007 - OVIEDO - ASTURIAS" → ASTURIAS). NUNCA uses la provincia de "Datos del titular".
- "municipality": la localidad de ese mismo domicilio (p. ej. OVIEDO).
- "address": la línea completa del domicilio del establecimiento.
- "authorization": el tipo, abreviado: VTC, VT, MDP, MDL.
- "validUntil": la F. Validez si aparece.
- "holder": déjalo siempre vacío.
- Deja "" en cualquier campo que no se vea. No inventes datos.`;

async function callOnce(img) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1000,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: img.media, data: img.data } },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    }),
  });

  const bodyText = await r.text();
  let data = null;
  try {
    data = JSON.parse(bodyText);
  } catch (e) {
    /* la respuesta no era JSON */
  }

  if (!r.ok) {
    const detail = data?.error?.message || bodyText.slice(0, 90);
    const err = new Error("HTTP " + r.status + ": " + detail);
    err.retry = r.status === 429 || r.status >= 500 || /internal|overload|timeout|unavailable/i.test(detail);
    throw err;
  }

  /* La respuesta puede llegar en varias formas: se aceptan todas. */
  let txt = "";
  if (data && Array.isArray(data.content)) {
    txt = data.content.filter((c) => c && c.type === "text").map((c) => c.text).join("\n");
  } else if (data && typeof data.completion === "string") {
    txt = data.completion;
  } else if (data && typeof data.content === "string") {
    txt = data.content;
  } else if (data?.error?.message) {
    const err = new Error(String(data.error.message).slice(0, 90));
    err.retry = /overload|rate|timeout|unavailable/i.test(data.error.message);
    throw err;
  } else {
    txt = bodyText;
  }

  txt = txt.replace(/```json|```/g, "").trim();
  const s = txt.indexOf("{");
  const e = txt.lastIndexOf("}");
  if (s < 0 || e < s) {
    const err = new Error("Sin datos legibles" + (txt ? ": " + txt.slice(0, 60) : " (respuesta vacía)"));
    err.retry = true;
    err.shrink = true;
    throw err;
  }
  try {
    return JSON.parse(txt.slice(s, e + 1));
  } catch (err2) {
    const err = new Error("JSON roto en la respuesta");
    err.retry = true;
    throw err;
  }
}

async function readShot(file) {
  let last;
  /* Cada intento espera más y envía la imagen algo más pequeña.
     El error 500 del servidor suele resolverse esperando. */
  const tamanos = [900, 900, 700, 550];
  const esperas = [1500, 3000, 5000];
  for (let a = 0; a < tamanos.length; a++) {
    try {
      const img = await prepare(file, tamanos[a]);
      return await callOnce(img);
    } catch (e) {
      last = e;
      const reintentable = e.retry || /Failed to fetch|NetworkError|Load failed/i.test(e.message || "");
      if (a < tamanos.length - 1 && reintentable) {
        await wait(esperas[a]);
        continue;
      }
      throw e;
    }
  }
  throw last;
}

/* ── pieces ─────────────────────────────────────────────── */
function Plate({ text, dim }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "stretch",
        border: `1.5px solid ${dim ? T.ink3 : T.ink}`,
        borderRadius: 3,
        overflow: "hidden",
        background: "#fff",
        opacity: dim ? 0.65 : 1,
      }}
    >
      <span
        style={{
          background: T.eu,
          color: "#fff",
          fontSize: 9,
          fontWeight: 700,
          padding: "0 4px",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center",
          lineHeight: 1.8,
        }}
      >
        E
      </span>
      <span
        style={{
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontWeight: 700,
          fontSize: 14,
          letterSpacing: "0.06em",
          color: T.ink,
          padding: "3px 8px",
        }}
      >
        {text || "—"}
      </span>
    </span>
  );
}

function Tag({ children, bg, fg }) {
  return (
    <span
      style={{
        background: bg,
        color: fg,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.08em",
        padding: "2px 6px",
        borderRadius: 2,
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function Stat({ n, label, color }) {
  return (
    <div style={{ flex: "1 1 90px", background: T.panel, border: `1px solid ${T.line}`, padding: "8px 10px" }}>
      <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 22, fontWeight: 700, color: color || T.ink, lineHeight: 1 }}>
        {n}
      </div>
      <div style={{ fontSize: 10, color: T.ink3, letterSpacing: "0.08em", textTransform: "uppercase", marginTop: 4 }}>
        {label}
      </div>
    </div>
  );
}

/* ── app ────────────────────────────────────────────────── */
export default function App() {
  const [rows, setRows] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [queue, setQueue] = useState([]);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState({ plate: "", province: "", municipality: "", holder: "" });
  const [manual, setManual] = useState(false);
  const [pegar, setPegar] = useState(false);
  const [bulk, setBulk] = useState("");
  const [copied, setCopied] = useState("");
  const [detail, setDetail] = useState(false);
  const [modo, setModo] = useState("dia");
  const fileRef = useRef(null);

  /* load */
  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get(KEY);
        if (r && r.value) {
          const raw = JSON.parse(r.value);
          /* fichas antiguas: se les añaden las fechas que faltan */
          setRows(
            raw.map((x) => ({
              ...x,
              firstIso: x.firstIso || dmyToIso(x.date) || isoOf(),
              lastIso: x.lastIso || x.firstIso || dmyToIso(x.date) || isoOf(),
              sentAt: x.sentAt || null,
            }))
          );
        }
      } catch (e) {
        /* primera vez: no hay nada guardado */
      }
      setLoaded(true);
    })();
  }, []);

  const save = async (next) => {
    setRows(next);
    try {
      await window.storage.set(KEY, JSON.stringify(next));
    } catch (e) {
      console.error("No se ha podido guardar", e);
    }
  };

  /* intake */
  const onFiles = async (files) => {
    const list = Array.from(files || []).filter(
      (f) => f && (!f.type || f.type.startsWith("image/") || /\.(png|jpe?g|webp|heic|gif)$/i.test(f.name || ""))
    );
    if (!list.length) return;

    /* Cada captura guarda su miniatura para poder identificarla luego. */
    const items = list.map((f, i) => ({
      n: i + 1,
      file: f,
      url: URL.createObjectURL(f),
      state: "espera",
      msg: "",
      plate: "",
    }));
    setQueue(items.map((x) => ({ ...x })));
    setBusy(true);

    const found = [];
    const sync = () => setQueue(items.map((x) => ({ ...x })));

    /* Dos vueltas: la segunda reintenta sola las que hayan fallado. */
    for (let vuelta = 0; vuelta < 2; vuelta++) {
      const pendientes = items.filter((it) => it.state === "espera" || it.state === "error");
      if (!pendientes.length) break;
      if (vuelta > 0) {
        pendientes.forEach((it) => {
          it.state = "espera";
          it.msg = "reintentando…";
        });
        sync();
        await wait(4000);
      }
      for (const it of pendientes) {
        it.state = "leyendo";
        it.msg = "";
        sync();
        try {
          const d = await readShot(it.file);
          const st = ["VIGOR", "SIN_TITULO", "REPETIR"].includes(d.status) ? d.status : "UNKNOWN";
          const rec = {
            id: Date.now() + "-" + it.n,
            plate: normPlate(d.plate),
            province: st === "VIGOR" ? normProv(d.province) : "",
            municipality: st === "VIGOR" ? strip(d.municipality) : "",
            address: d.address || "",
            holder: "",
            authorization: strip(d.authorization),
            validUntil: d.validUntil || "",
            status: st,
            date: today(),
            firstIso: isoOf(),
            lastIso: isoOf(),
            sentAt: null,
          };
          found.push(rec);
          it.plate = rec.plate;
          it.state = st === "REPETIR" ? "repetir consulta" : rec.plate ? "ok" : "revisar";
        } catch (err) {
          it.state = "error";
          it.msg = String(err.message || err);
        }
        sync();
        await wait(700);
      }
    }

    /* Una matrícula ya vista no se duplica: se actualizan sus datos
       pero se conserva la fecha en que apareció por primera vez. */
    const merged = [...rows];
    found.forEach((f) => {
      const k = merged.findIndex((r) => r.plate && r.plate === f.plate);
      if (k >= 0)
        merged[k] = {
          ...f,
          id: merged[k].id,
          date: merged[k].date,
          firstIso: merged[k].firstIso,
          lastIso: isoOf(),
          sentAt: merged[k].sentAt,
        };
      else merged.push(f);
    });
    await save(merged);
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  useEffect(() => {
    const h = (e) => {
      const items = Array.from(e.clipboardData?.items || []);
      const imgs = items.filter((i) => i.type.startsWith("image/")).map((i) => i.getAsFile());
      if (imgs.length) onFiles(imgs);
    };
    window.addEventListener("paste", h);
    return () => window.removeEventListener("paste", h);
  });

  /* buckets */
  const { fuera, dins, sense, revisar } = useMemo(() => {
    const g = { fuera: {}, dins: {}, sense: [], revisar: [] };
    rows.forEach((r) => {
      if (r.status === "SIN_TITULO") return g.sense.push(r);
      if (!r.province || !r.plate) return g.revisar.push(r);
      const b = isCat(r.province) ? g.dins : g.fuera;
      (b[r.province] = b[r.province] || []).push(r);
    });
    const sortG = (o) =>
      Object.keys(o)
        .sort(cmp)
        .map((p) => [p, o[p].sort((a, b) => cmp(a.plate, b.plate))]);
    return {
      fuera: sortG(g.fuera),
      dins: sortG(g.dins),
      sense: g.sense.sort((a, b) => cmp(a.plate, b.plate)),
      revisar: g.revisar,
    };
  }, [rows]);

  const nFuera = fuera.reduce((s, [, v]) => s + v.length, 0);

  /* ── informes ─────────────────────────────────────────── */
  const nuevas = useMemo(() => rows.filter((r) => !r.sentAt), [rows]);

  const meses = useMemo(() => {
    const m = {};
    rows.forEach((r) => {
      const ym = (r.firstIso || "").slice(0, 7);
      if (ym) (m[ym] = m[ym] || []).push(r);
    });
    return Object.keys(m)
      .sort()
      .reverse()
      .map((ym) => [ym, m[ym]]);
  }, [rows]);

  /* Lista agrupada: provincia A→Z, matrícula A→Z dentro de cada provincia */
  const listar = (set, L, numerar) => {
    const g = {};
    set.forEach((r) => (g[r.province || "SIN PROVINCIA"] = [...(g[r.province || "SIN PROVINCIA"] || []), r]));
    Object.keys(g)
      .sort(cmp)
      .forEach((p) => {
        L.push("▪️ " + p + "  (" + g[p].length + ")");
        g[p]
          .sort((a, b) => cmp(a.plate, b.plate))
          .forEach((r, i) => {
            const extra = detail && r.municipality ? "  ·  " + r.municipality : "";
            L.push("      " + (numerar ? i + 1 + ". " : "") + r.plate + extra);
          });
        L.push("");
      });
  };

  const reporteDiario = () => {
    const L = [];
    L.push("🚕 *CONTROL DE MATRÍCULAS*");
    L.push("📅 " + longDate(isoOf()));
    L.push("");
    L.push("━━━━━━━━━━━━━━━━━");
    L.push("🆕 *NUEVAS DE HOY: " + nuevas.length + "*");
    L.push("━━━━━━━━━━━━━━━━━");
    if (!nuevas.length) L.push("Hoy no hay matrículas nuevas.");
    else {
      const nf = nuevas.filter((r) => r.status !== "SIN_TITULO" && r.province && !isCat(r.province));
      const nc = nuevas.filter((r) => r.status !== "SIN_TITULO" && r.province && isCat(r.province));
      const ns = nuevas.filter((r) => r.status === "SIN_TITULO");
      if (nf.length) {
        L.push("");
        L.push("🚨 *De fuera de Catalunya* (" + nf.length + ")");
        listar(nf, L, true);
      }
      if (nc.length) {
        L.push("✅ *De Catalunya* (" + nc.length + ")");
        listar(nc, L, true);
      }
      if (ns.length) {
        L.push("❌ *Sin títulos en vigor* (" + ns.length + ")");
        ns.sort((a, b) => cmp(a.plate, b.plate)).forEach((r, i) => L.push("      " + (i + 1) + ". " + r.plate));
        L.push("");
      }
    }
    L.push("━━━━━━━━━━━━━━━━━");
    L.push("📊 *TOTAL ACUMULADO: " + rows.length + "*");
    L.push("━━━━━━━━━━━━━━━━━");
    L.push("🚨 Fuera de Catalunya:  " + nFuera);
    L.push("✅ Catalunya:  " + dins.reduce((s, [, v]) => s + v.length, 0));
    L.push("❌ Sin títulos en vigor:  " + sense.length);
    if (revisar.length) L.push("⚠️ Pendientes de revisar:  " + revisar.length);
    if (meses.length) {
      L.push("");
      L.push("📈 Este mes (" + monthLabel(meses[0][0]) + "): " + meses[0][1].length + " nuevas");
    }
    if (fuera.length) {
      L.push("");
      L.push("🔝 Provincias de fuera con más vehículos:");
      [...fuera]
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 5)
        .forEach(([p, v]) => L.push("      " + p + " — " + v.length));
    }
    L.push("");
    L.push("_Datos de la consulta pública del Ministerio (apps.fomento.gob.es). Solo información de flota._");
    return L.join("\n");
  };

  const reporteMes = () => {
    const L = [];
    const [ym, set] = meses[0] || [isoOf().slice(0, 7), []];
    L.push("🚕 *CONTROL DE MATRÍCULAS*");
    L.push("🗓️ *RESUMEN DE " + monthLabel(ym).toUpperCase() + "*");
    L.push("");
    L.push("Nuevas este mes: *" + set.length + "*   ·   Acumulado: *" + rows.length + "*");
    L.push("");
    L.push("━━━ *POR DÍA* ━━━");
    const dias = {};
    set.forEach((r) => (dias[r.firstIso] = (dias[r.firstIso] || 0) + 1));
    Object.keys(dias)
      .sort()
      .forEach((d) => L.push("   " + d.slice(8) + "/" + d.slice(5, 7) + "  —  " + dias[d] + " matrículas"));
    L.push("");
    L.push("━━━ *DE FUERA DE CATALUNYA* ━━━");
    const f = set.filter((r) => r.status !== "SIN_TITULO" && r.province && !isCat(r.province));
    if (!f.length) L.push("Ninguna este mes.");
    else listar(f, L, true);
    const s = set.filter((r) => r.status === "SIN_TITULO");
    L.push("━━━ *SIN TÍTULOS EN VIGOR* (" + s.length + ") ━━━");
    s.sort((a, b) => cmp(a.plate, b.plate)).forEach((r, i) => L.push("      " + (i + 1) + ". " + r.plate));
    L.push("");
    L.push("_Consulta pública del Ministerio · apps.fomento.gob.es_");
    return L.join("\n");
  };

  const reporteTotal = () => {
    const L = [];
    L.push("🚕 *CONTROL DE MATRÍCULAS — LISTA COMPLETA*");
    L.push("📅 Actualizada el " + longDate(isoOf()) + "  ·  " + rows.length + " matrículas");
    L.push("");
    L.push("━━━━━━━━━━━━━━━━━");
    L.push("🚨 *FUERA DE CATALUNYA* (" + nFuera + ")");
    L.push("━━━━━━━━━━━━━━━━━");
    if (!fuera.length) L.push("Ninguna.");
    fuera.forEach(([p, v]) => {
      L.push("▪️ " + p + "  (" + v.length + ")");
      v.forEach((r, i) => L.push("      " + (i + 1) + ". " + r.plate + (detail && r.municipality ? "  ·  " + r.municipality : "")));
      L.push("");
    });
    L.push("━━━━━━━━━━━━━━━━━");
    L.push("✅ *CATALUNYA* (" + dins.reduce((s, [, v]) => s + v.length, 0) + ")");
    L.push("━━━━━━━━━━━━━━━━━");
    if (!dins.length) L.push("Ninguna.");
    dins.forEach(([p, v]) => {
      L.push("▪️ " + p + "  (" + v.length + ")");
      v.forEach((r, i) => L.push("      " + (i + 1) + ". " + r.plate));
      L.push("");
    });
    L.push("━━━━━━━━━━━━━━━━━");
    L.push("❌ *SIN TÍTULOS HABILITANTES EN VIGOR* (" + sense.length + ")");
    L.push("━━━━━━━━━━━━━━━━━");
    if (!sense.length) L.push("Ninguna.");
    sense.forEach((r, i) => L.push("      " + (i + 1) + ". " + r.plate));
    if (revisar.length) {
      L.push("");
      L.push("⚠️ *PENDIENTES DE REVISAR* (" + revisar.length + ")");
      revisar.forEach((r) => L.push("      " + (r.plate || "sin matrícula")));
    }
    L.push("");
    L.push("━━━━━━━━━━━━━━━━━");
    L.push("ℹ️ *Cómo leer esta lista*");
    L.push("🚨 = domicilio de la empresa fuera de Catalunya");
    L.push("❌ = la consulta no muestra títulos en vigor");
    L.push("Los datos salen de la consulta pública del Ministerio (apps.fomento.gob.es) y pueden cambiar. Es información de flota, no una acusación a ningún conductor.");
    return L.join("\n");
  };

  const informe = () => (modo === "dia" ? reporteDiario() : modo === "mes" ? reporteMes() : reporteTotal());

  const copy = async (text, tag) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(tag);
    setTimeout(() => setCopied(""), 1800);
  };

  const csv = () => {
    const head = ["Fecha alta", "Provincia", "Matricula", "Municipio", "Titular", "Autorizacion", "Estado", "Fuera de Catalunya", "Enviado", "Domicilio"];
    const body = [...rows]
      .sort((a, b) => cmp(a.province, b.province) || cmp(a.plate, b.plate))
      .map((r) =>
        [
          r.firstIso || dmyToIso(r.date),
          r.province,
          r.plate,
          r.municipality,
          r.holder,
          r.authorization,
          r.status === "SIN_TITULO" ? "SIN TITULOS EN VIGOR" : r.status === "VIGOR" ? "EN VIGOR" : "REVISAR",
          r.province && !isCat(r.province) ? "SI" : "",
          r.sentAt || "NUEVA",
          r.address,
        ]
          .map((c) => '"' + String(c || "").replace(/"/g, '""') + '"')
          .join(",")
      );
    const blob = new Blob(["\uFEFF" + [head.join(","), ...body].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "matriculas-" + new Date().toISOString().slice(0, 10) + ".csv";
    a.click();
  };

  /* Importar una lista escrita, una matrícula por línea:
     8330LZB ; ASTURIAS ; OVIEDO ; VTC ; 30-04-2028
     5718LHM ; SIN                                    */
  const importar = () => {
    const nuevos = [];
    bulk.split(/\r?\n/).forEach((linea, i) => {
      const partes = linea.split(/[;|\t]|\s{2,}/).map((x) => x.trim()).filter(Boolean);
      if (!partes.length) return;
      const plate = normPlate(partes[0]);
      if (plate.length < 6) return;
      const resto = partes.slice(1).join(" ").toUpperCase();
      const sinTitulo = /\bSIN\b|NO TIENE|SIN_TITULO/.test(resto);
      const repetir = /REPETIR|VERIFICACION/.test(resto);
      nuevos.push({
        id: Date.now() + "-i" + i,
        plate,
        province: sinTitulo || repetir ? "" : normProv(partes[1]),
        municipality: sinTitulo || repetir ? "" : strip(partes[2]),
        address: "",
        holder: "",
        authorization: sinTitulo || repetir ? "" : strip(partes[3]),
        validUntil: partes[4] || "",
        status: sinTitulo ? "SIN_TITULO" : repetir ? "REPETIR" : normProv(partes[1]) ? "VIGOR" : "UNKNOWN",
        date: today(),
        firstIso: isoOf(),
        lastIso: isoOf(),
        sentAt: null,
      });
    });
    if (!nuevos.length) return;
    const merged = [...rows];
    nuevos.forEach((f) => {
      const k = merged.findIndex((r) => r.plate === f.plate);
      if (k >= 0) merged[k] = { ...f, id: merged[k].id, firstIso: merged[k].firstIso, sentAt: merged[k].sentAt };
      else merged.push(f);
    });
    save(merged);
    setBulk("");
    setPegar(false);
  };

  /* edit */
  const startEdit = (r) => {
    setEditing(r.id);
    setDraft({ plate: r.plate, province: r.province, municipality: r.municipality, holder: r.holder });
  };
  const commit = () => {
    save(
      rows.map((r) =>
        r.id === editing
          ? { ...r, plate: normPlate(draft.plate), province: normProv(draft.province), municipality: strip(draft.municipality), holder: draft.holder }
          : r
      )
    );
    setEditing(null);
  };
  const addManual = () => {
    if (!normPlate(draft.plate)) return;
    save([
      ...rows,
      {
        id: Date.now() + "-m",
        plate: normPlate(draft.plate),
        province: normProv(draft.province),
        municipality: strip(draft.municipality),
        holder: draft.holder,
        address: "",
        authorization: "",
        status: normProv(draft.province) ? "VIGOR" : "UNKNOWN",
        date: today(),
        firstIso: isoOf(),
        lastIso: isoOf(),
        sentAt: null,
      },
    ]);
    setDraft({ plate: "", province: "", municipality: "", holder: "" });
    setManual(false);
  };

  const Row = ({ r, dim }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderTop: `1px solid ${T.paper}` }}>
      <Plate text={r.plate} dim={dim} />
      <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: T.ink2 }}>
        <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {r.municipality || r.province || ""}
          {r.holder ? " · " + r.holder : ""}
        </div>
      </div>
      {r.authorization ? <Tag bg={T.paper} fg={T.ink2}>{r.authorization}</Tag> : null}
      <button onClick={() => startEdit(r)} style={btnGhost}>editar</button>
      <button onClick={() => save(rows.filter((x) => x.id !== r.id))} style={{ ...btnGhost, color: T.red }}>×</button>
    </div>
  );

  const Group = ({ title, count, color, children }) => (
    <section style={{ marginTop: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, borderBottom: `2px solid ${color}`, paddingBottom: 4 }}>
        <h2 style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: T.ink, margin: 0 }}>
          {title}
        </h2>
        <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: color, fontWeight: 700 }}>{count}</span>
      </div>
      {children}
    </section>
  );

  if (!loaded)
    return <div style={{ padding: 24, fontFamily: "system-ui", color: T.ink3 }}>Abriendo el registro…</div>;

  return (
    <div style={{ minHeight: "100vh", background: T.paper, fontFamily: "system-ui, -apple-system, sans-serif", color: T.ink }}>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "16px 14px 60px" }}>
        {/* header */}
        <header style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <div style={{ width: 6, alignSelf: "stretch", background: T.sign }} />
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.01em", margin: 0 }}>Control de matrículas</h1>
            <p style={{ fontSize: 11.5, color: T.ink3, margin: "2px 0 0" }}>
              Capturas de apps.fomento.gob.es → provincia y matrícula ordenadas → texto listo para WhatsApp.
            </p>
          </div>
        </header>

        {/* stats */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Stat n={rows.length} label="acumuladas" />
          <Stat n={nuevas.length} label="sin enviar" color={T.sign === "#F5C518" ? "#946B00" : T.ink} />
          <Stat n={nFuera} label="fuera de Cat." color={T.eu} />
          <Stat n={sense.length} label="sin título" color={T.red} />
        </div>

        {/* intake */}
        <div style={{ marginTop: 12, background: T.panel, border: `1px dashed ${T.line}`, padding: 14, textAlign: "center" }}>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: "none" }}
            onChange={(e) => onFiles(e.target.files)}
          />
          <button onClick={() => fileRef.current?.click()} disabled={busy} style={btnMain}>
            {busy
              ? "Leyendo " + (queue.filter((q) => q.state !== "espera" && q.state !== "leyendo").length + 1) + " de " + queue.length + "…"
              : "Añadir capturas"}
          </button>
          <div style={{ fontSize: 11, color: T.ink3, marginTop: 8 }}>
            Puedes seleccionar 20 de golpe. En ordenador también puedes pegar con Ctrl+V.
          </div>
          <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 6, flexWrap: "wrap" }}>
            <button onClick={() => setManual((v) => !v)} style={btnGhost}>
              {manual ? "cerrar" : "escribir una a mano"}
            </button>
            <button onClick={() => setPegar((v) => !v)} style={btnGhost}>
              {pegar ? "cerrar" : "pegar una lista"}
            </button>
          </div>
          {pegar && (
            <div style={{ marginTop: 8, textAlign: "left" }}>
              <textarea
                value={bulk}
                onChange={(e) => setBulk(e.target.value)}
                rows={6}
                placeholder={"8330LZB ; ASTURIAS ; OVIEDO ; VTC ; 30-04-2028\n0264KYD ; LA RIOJA ; LOGROÑO ; VTC\n5718LHM ; SIN"}
                style={{
                  width: "100%",
                  border: `1px solid ${T.line}`,
                  padding: 8,
                  fontSize: 12,
                  fontFamily: "ui-monospace, monospace",
                  borderRadius: 2,
                  boxSizing: "border-box",
                }}
              />
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
                <button onClick={importar} style={btnMain}>Importar</button>
                <span style={{ fontSize: 10.5, color: T.ink3 }}>
                  Una matrícula por línea, separada por «;». Escribe SIN si no tiene títulos en vigor.
                </span>
              </div>
            </div>
          )}
          {manual && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
              <input placeholder="Matrícula" value={draft.plate} onChange={(e) => setDraft({ ...draft, plate: e.target.value })} style={inp} />
              <input placeholder="Provincia" value={draft.province} onChange={(e) => setDraft({ ...draft, province: e.target.value })} style={inp} />
              <input placeholder="Municipio" value={draft.municipality} onChange={(e) => setDraft({ ...draft, municipality: e.target.value })} style={inp} />
              <button onClick={addManual} style={btnMain}>Guardar</button>
            </div>
          )}
        </div>

        {/* queue */}
        {queue.length > 0 && (
          <div style={{ marginTop: 10, background: T.panel, border: `1px solid ${T.line}`, padding: 10 }}>
            {queue.map((q, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  padding: "6px 0",
                  borderTop: i ? `1px solid ${T.paper}` : "none",
                  background: q.state === "error" ? "#FFF5F5" : "transparent",
                }}
              >
                <span
                  style={{
                    fontFamily: "ui-monospace, monospace",
                    fontSize: 11,
                    color: T.ink3,
                    width: 20,
                    textAlign: "right",
                  }}
                >
                  {q.n}
                </span>
                <img
                  src={q.url}
                  alt={"captura " + q.n}
                  onClick={() => window.open(q.url, "_blank")}
                  style={{
                    width: 34,
                    height: 46,
                    objectFit: "cover",
                    objectPosition: "top",
                    border: `1px solid ${q.state === "error" ? T.red : T.line}`,
                    borderRadius: 2,
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: "ui-monospace, monospace",
                      fontSize: 12,
                      fontWeight: 600,
                      color: q.state === "error" ? T.red : q.state === "ok" ? T.green : T.ink3,
                    }}
                  >
                    {q.state === "ok" ? q.plate || "leída" : q.state}
                  </div>
                  {q.msg && (
                    <div style={{ fontSize: 10, color: q.state === "error" ? T.red : T.ink3, wordBreak: "break-word" }}>
                      {q.msg}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <div style={{ fontSize: 10.5, color: T.ink3, marginTop: 6 }}>
                Si el servidor falla, lo reintenta solo hasta 4 veces y hace una segunda vuelta al final. Deja la pantalla
                abierta.
              </div>
            )}
            {!busy && (
              <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
                {queue.some((q) => q.state === "error") ? (
                  <>
                    <button
                      onClick={() => onFiles(queue.filter((q) => q.state === "error").map((q) => q.file))}
                      style={btnMain}
                    >
                      Reintentar ({queue.filter((q) => q.state === "error").length})
                    </button>
                    <span style={{ fontSize: 10.5, color: T.ink3, flex: 1 }}>
                      Toca una miniatura roja para ver qué captura ha fallado.
                    </span>
                  </>
                ) : (
                  <span style={{ fontSize: 11, color: T.green, fontWeight: 600 }}>Todas leídas ✓</span>
                )}
                <button onClick={() => setQueue([])} style={btnGhost}>ocultar</button>
              </div>
            )}
          </div>
        )}

        {/* editor */}
        {editing && (
          <div style={{ marginTop: 10, background: T.panel, border: `2px solid ${T.eu}`, padding: 10 }}>
            <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3, marginBottom: 6 }}>
              Corregir ficha
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <input value={draft.plate} onChange={(e) => setDraft({ ...draft, plate: e.target.value })} placeholder="Matrícula" style={inp} />
              <input value={draft.province} onChange={(e) => setDraft({ ...draft, province: e.target.value })} placeholder="Provincia" style={inp} />
              <input value={draft.municipality} onChange={(e) => setDraft({ ...draft, municipality: e.target.value })} placeholder="Municipio" style={inp} />
              <input value={draft.holder} onChange={(e) => setDraft({ ...draft, holder: e.target.value })} placeholder="Titular" style={inp} />
              <button onClick={commit} style={btnMain}>Guardar cambios</button>
              <button onClick={() => setEditing(null)} style={btnGhost}>cancelar</button>
            </div>
          </div>
        )}

        {/* lists */}
        {rows.length === 0 ? (
          <div style={{ marginTop: 24, textAlign: "center", color: T.ink3, fontSize: 13 }}>
            Todavía no hay matrículas. Añade la primera captura y aparecerá aquí, agrupada por provincia.
          </div>
        ) : (
          <>
            <Group title="Fuera de Catalunya" count={nFuera} color={T.eu}>
              {fuera.length === 0 && <p style={emptyTxt}>Ninguna de momento.</p>}
              {fuera.map(([p, v]) => (
                <div key={p} style={{ marginTop: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Tag bg={T.sign} fg={T.ink}>{p}</Tag>
                    <span style={{ fontSize: 11, color: T.ink3, fontFamily: "ui-monospace, monospace" }}>{v.length}</span>
                  </div>
                  {v.map((r) => <Row key={r.id} r={r} />)}
                </div>
              ))}
            </Group>

            <Group title="Catalunya" count={dins.reduce((s, [, v]) => s + v.length, 0)} color={T.green}>
              {dins.length === 0 && <p style={emptyTxt}>Ninguna de momento.</p>}
              {dins.map(([p, v]) => (
                <div key={p} style={{ marginTop: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Tag bg={T.paper} fg={T.ink2}>{p}</Tag>
                    <span style={{ fontSize: 11, color: T.ink3, fontFamily: "ui-monospace, monospace" }}>{v.length}</span>
                  </div>
                  {v.map((r) => <Row key={r.id} r={r} />)}
                </div>
              ))}
            </Group>

            <Group title="Sin títulos habilitantes en vigor" count={sense.length} color={T.red}>
              {sense.length === 0 && <p style={emptyTxt}>Ninguna de momento.</p>}
              {sense.map((r) => <Row key={r.id} r={r} dim />)}
            </Group>

            {revisar.length > 0 && (
              <Group title="Pendiente de revisar" count={revisar.length} color={T.ink3}>
                <p style={emptyTxt}>
                  O la web falló la verificación de seguridad, o falta el domicilio. Vuelve a consultar esa matrícula en la
                  web y sube la captura del resultado; también puedes corregirla a mano.
                </p>
                {revisar.map((r) => <Row key={r.id} r={r} dim />)}
              </Group>
            )}
          </>
        )}

        {/* informe */}
        <section style={{ marginTop: 24, background: T.panel, border: `1px solid ${T.line}`, padding: 12 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: T.ink3, marginBottom: 8 }}>
            Mensaje para el grupo
          </div>

          <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
            {[
              ["dia", "Hoy", nuevas.length],
              ["mes", "Este mes", meses[0] ? meses[0][1].length : 0],
              ["todo", "Lista completa", rows.length],
            ].map(([k, label, n]) => (
              <button
                key={k}
                onClick={() => setModo(k)}
                style={{
                  flex: 1,
                  background: modo === k ? T.ink : "transparent",
                  color: modo === k ? "#fff" : T.ink2,
                  border: `1px solid ${modo === k ? T.ink : T.line}`,
                  padding: "8px 4px",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  borderRadius: 2,
                }}
              >
                {label}
                <span style={{ display: "block", fontFamily: "ui-monospace, monospace", fontSize: 11, opacity: 0.7 }}>{n}</span>
              </button>
            ))}
          </div>

          <p style={{ fontSize: 11.5, color: T.ink3, margin: "0 0 10px", lineHeight: 1.5 }}>
            {modo === "dia"
              ? "Novedades desde el último envío, con los totales acumulados debajo. Es el mensaje del día a día."
              : modo === "mes"
              ? "Resumen del mes en curso: cuántas por día y el listado de fuera de Catalunya."
              : "Todo lo acumulado, por provincia y matrícula, con una leyenda al final para quien lo lea por primera vez."}
          </p>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <button onClick={() => copy(informe(), "wa")} style={btnMain}>
              {copied === "wa" ? "✓ Copiado" : "Copiar para WhatsApp"}
            </button>
            {modo === "dia" && nuevas.length > 0 && (
              <button
                onClick={() => save(rows.map((r) => (r.sentAt ? r : { ...r, sentAt: isoOf() })))}
                style={btnGhost}
              >
                marcar como enviado
              </button>
            )}
            <button onClick={csv} style={btnGhost}>CSV</button>
            <label style={{ fontSize: 11.5, color: T.ink2, display: "flex", alignItems: "center", gap: 4 }}>
              <input type="checkbox" checked={detail} onChange={(e) => setDetail(e.target.checked)} />
              con municipio
            </label>
          </div>

          {modo === "dia" && (
            <p style={{ fontSize: 10.5, color: T.ink3, margin: "8px 0 0", lineHeight: 1.5 }}>
              Después de enviarlo, pulsa <b>marcar como enviado</b>: mañana solo aparecerán como nuevas las que añadas a partir
              de ahora, y el acumulado seguirá creciendo.
            </p>
          )}

          {rows.length > 0 && (
            <pre
              style={{
                marginTop: 10,
                background: T.paper,
                border: `1px solid ${T.line}`,
                padding: 10,
                fontSize: 11,
                lineHeight: 1.55,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                color: T.ink2,
                maxHeight: 300,
                overflow: "auto",
              }}
            >
              {informe()}
            </pre>
          )}
        </section>

        <div style={{ marginTop: 12, display: "flex" }}>
          <button
            onClick={() => {
              if (confirm("¿Borrar todas las matrículas guardadas?")) save([]);
            }}
            style={{ ...btnGhost, color: T.red, marginLeft: "auto" }}
          >
            vaciar registro
          </button>
        </div>

        <p style={{ fontSize: 10.5, color: T.ink3, marginTop: 16, lineHeight: 1.6 }}>
          Los datos se guardan solo en tu sesión de esta app. Proceden de la consulta pública del Registro de Empresas y
          Actividades de Transporte; compártelos como información de flota, no como acusación a personas concretas.
        </p>
      </div>
    </div>
  );
}

const btnMain = {
  background: T.ink,
  color: "#fff",
  border: "none",
  padding: "9px 14px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  borderRadius: 2,
};
const btnGhost = {
  background: "transparent",
  color: T.ink2,
  border: `1px solid ${T.line}`,
  padding: "6px 9px",
  fontSize: 11.5,
  cursor: "pointer",
  borderRadius: 2,
};
const inp = {
  border: `1px solid ${T.line}`,
  padding: "7px 8px",
  fontSize: 13,
  flex: "1 1 120px",
  minWidth: 100,
  borderRadius: 2,
  fontFamily: "ui-monospace, monospace",
};
const emptyTxt = { fontSize: 12, color: T.ink3, margin: "8px 0 0" };
