const fetchOpts = { credentials: "same-origin" };

/** null = aún no cargado; true = OK; false = SQL caído (solo 503 / dbAvailable:false) */
const adminDbHealth = { certificates: null, insights: null };

function syncDbUnavailableBanner() {
  const el = document.getElementById("db-unavailable-banner");
  if (!el) return;
  const show =
    adminDbHealth.certificates === false || adminDbHealth.insights === false;
  el.classList.toggle("hidden", !show);
}

function isDbUnavailablePayload(status, data) {
  return status === 503 || (data && data.dbAvailable === false);
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setupPasswordToggle(inputId, btnId) {
  const input = document.getElementById(inputId);
  const btn = document.getElementById(btnId);
  if (!input || !btn) return;
  btn.addEventListener("click", () => {
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    btn.textContent = showing ? "👁" : "🙈";
    btn.setAttribute(
      "aria-label",
      showing ? "Mostrar contraseña" : "Ocultar contraseña",
    );
  });
}

setupPasswordToggle("admin-new-pass", "toggle-admin-new-pass");

const ModalUtil = {
  show(title, message, isConfirm = false) {
    return new Promise((resolve) => {
      document.getElementById("modal-title").textContent = title;
      const msgBox = document.getElementById("modal-msg");
      msgBox.replaceChildren();
      msgBox.textContent = message;
      const btnCancel = document.getElementById("modal-btn-cancel");
      const btnConfirm = document.getElementById("modal-btn-confirm");
      const overlay = document.getElementById("modal-overlay");
      btnCancel.classList.toggle("hidden", !isConfirm);
      btnConfirm.textContent = "Aceptar";
      btnConfirm.onclick = () => {
        overlay.classList.add("hidden");
        resolve(true);
      };
      btnCancel.onclick = () => {
        overlay.classList.add("hidden");
        resolve(false);
      };
      overlay.classList.remove("hidden");
    });
  },

  showCertificateGenerated(info) {
    return new Promise((resolve) => {
      const {
        certId,
        timeSec,
        mailSent,
        studentName,
        courseName,
        typeName,
        hasPdf,
      } = info;
      document.getElementById("modal-title").textContent = "Certificado generado";
      const box = document.getElementById("modal-msg");
      box.replaceChildren();

      const lead = document.createElement("p");
      lead.className = "text-gray-800 font-semibold";
      lead.textContent =
        "El certificado ha sido generado y registrado correctamente en el sistema.";
      box.appendChild(lead);

      const sent = document.createElement("p");
      sent.className = mailSent ? "text-emerald-800" : "text-amber-800";
      sent.textContent = mailSent
        ? "La notificación se ha enviado por correo electrónico al alumno (incluye el certificado en PDF)."
        : "No se pudo enviar el correo automático. Revise la configuración SMTP o avise al alumno por otro medio.";
      box.appendChild(sent);

      const addLine = (label, value) => {
        const p = document.createElement("p");
        const b = document.createElement("strong");
        b.textContent = `${label}: `;
        p.appendChild(b);
        p.appendChild(document.createTextNode(value == null || value === "" ? "—" : String(value)));
        box.appendChild(p);
      };
      addLine("Identificador", certId);
      addLine("Estudiante", studentName);
      addLine("Curso", courseName);
      addLine("Tipo", typeName);
      addLine("Tiempo de generación (TGC)", `${Number(timeSec).toFixed(4)} s`);

      if (hasPdf === false) {
        const warn = document.createElement("p");
        warn.className = "text-amber-800";
        warn.textContent =
          "Advertencia: el PDF no se generó o no se guardó correctamente; revise el servidor.";
        box.appendChild(warn);
      }

      const foot = document.createElement("p");
      foot.className = "text-gray-600 mt-2";
      foot.textContent =
        "Para descargar el PDF use la pestaña «Certificados» del menú principal; allí encontrará el listado y la opción de descarga.";
      box.appendChild(foot);

      const btnCancel = document.getElementById("modal-btn-cancel");
      const btnConfirm = document.getElementById("modal-btn-confirm");
      const overlay = document.getElementById("modal-overlay");
      btnCancel.classList.add("hidden");
      btnConfirm.textContent = "Aceptar";
      const close = () => {
        overlay.classList.add("hidden");
        resolve(true);
      };
      btnConfirm.onclick = close;
      overlay.classList.remove("hidden");
    });
  },
};

window.alert = (msg) => ModalUtil.show("Notificación", msg);

document.getElementById("btn-logout").addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST", ...fetchOpts });
  window.location.href = "/";
});

// Student search functionality (legado — el builder usa emit_builder.js)
const studentSearch = document.getElementById("input-student-search");
const studentDropdown = document.getElementById("student-dropdown");
const studentIdInput = document.getElementById("input-student-id");
let searchTimeout;

const courseSearch = document.getElementById("input-course-search");
const courseDropdown = document.getElementById("course-dropdown");
const courseHiddenId = document.getElementById("input-course-id");
let coursesEmitList = [];
window.coursesEmitList = coursesEmitList;
let courseSearchTimeout;

async function searchStudents(query) {
  try {
    const response = await fetch(
      `/api/students?q=${encodeURIComponent(query)}`,
      fetchOpts,
    );
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error || "Error al buscar estudiantes");
    return data.students || [];
  } catch (error) {
    console.error("Error searching students:", error);
    return [];
  }
}

function renderStudentDropdown(students) {
  if (!studentDropdown) return;
  studentDropdown.innerHTML = "";
  if (students.length === 0) {
    const noResults = document.createElement("div");
    noResults.className = "p-3 text-gray-500 text-sm";
    noResults.textContent = "No se encontraron estudiantes";
    studentDropdown.appendChild(noResults);
  } else {
    students.forEach((student) => {
      const item = document.createElement("div");
      item.className =
        "p-3 hover:bg-gray-100 cursor-pointer border-b border-gray-100 last:border-b-0";
      item.onclick = () => selectStudent(student);

      const nameDiv = document.createElement("div");
      nameDiv.className = "font-medium text-gray-900";
      nameDiv.textContent = student.name;

      const dniDiv = document.createElement("div");
      dniDiv.className = "text-xs text-gray-500";
      dniDiv.textContent = `DNI: ${student.dni}`;

      item.appendChild(nameDiv);
      item.appendChild(dniDiv);
      studentDropdown.appendChild(item);
    });
  }
  studentDropdown.classList.remove("hidden");
}

function selectStudent(student) {
  if (!studentSearch || !studentIdInput || !studentDropdown) return;
  studentSearch.value = student.name;
  studentIdInput.value = student.id;
  studentDropdown.classList.add("hidden");
  studentSearch.classList.remove("border-red-300");
  studentSearch.classList.add("border-green-300");
}

if (studentSearch && studentDropdown && studentIdInput) {
  studentSearch.addEventListener("input", (e) => {
    const query = e.target.value.trim();
    clearTimeout(searchTimeout);
    if (query.length < 2) {
      studentDropdown.classList.add("hidden");
      studentIdInput.value = "";
      studentSearch.classList.remove("border-green-300", "border-red-300");
      studentSearch.classList.add("border-gray-300");
      return;
    }
    searchTimeout = setTimeout(async () => {
      const students = await searchStudents(query);
      renderStudentDropdown(students);
    }, 300);
  });

  studentSearch.addEventListener("focus", () => {
    if (studentSearch.value.trim().length >= 2) {
      searchStudents(studentSearch.value.trim()).then(renderStudentDropdown);
    }
  });
}
function replaceCursoPlaceholderInBody(courseName) {
  const ta = document.getElementById("input-body");
  if (!ta) return;
  const nm = String(courseName || "").trim();
  if (!nm) return;
  ta.value = ta.value.replace(/\[\[\s*CURSO\s*\]\]/gi, nm);
}

function applyCourseComboboxVisualState(state) {
  const wrap = document.getElementById("course-combobox");
  if (!wrap) return;
  wrap.classList.remove("border-gray-300", "border-green-500", "border-red-400");
  if (state === "ok") wrap.classList.add("border-green-500");
  else if (state === "error") wrap.classList.add("border-red-400");
  else wrap.classList.add("border-gray-300");
}

function setCourseListboxOpen(open) {
  const inp = document.getElementById("input-course-search");
  if (inp) inp.setAttribute("aria-expanded", open ? "true" : "false");
}

function renderCourseEmitDropdown(matches) {
  if (!courseDropdown) return;
  courseDropdown.innerHTML = "";
  if (!matches || matches.length === 0) {
    const noResults = document.createElement("div");
    noResults.className = "p-3 text-gray-500 text-sm";
    noResults.textContent =
      coursesEmitList.length === 0
        ? "No hay cursos activos. Agréguelos en Catálogos."
        : "No hay coincidencias. Siga escribiendo o elija de la lista.";
    courseDropdown.appendChild(noResults);
    courseDropdown.classList.remove("hidden");
    setCourseListboxOpen(true);
    return;
  }
  matches.forEach((c) => {
    const item = document.createElement("div");
    item.className =
      "p-3 hover:bg-gray-100 cursor-pointer border-b border-gray-100 last:border-b-0 text-sm";
    item.textContent = c.name;
    // mousedown + preventDefault: evita que el input pierda el foco antes del clic (blur vaciaba el curso).
    item.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      selectCourseEmit(c);
    });
    courseDropdown.appendChild(item);
  });
  courseDropdown.classList.remove("hidden");
  setCourseListboxOpen(true);
}

function selectCourseEmit(c) {
  if (courseHiddenId) courseHiddenId.value = String(c.id);
  if (courseSearch) courseSearch.value = c.name;
  if (courseDropdown) courseDropdown.classList.add("hidden");
  setCourseListboxOpen(false);
  applyCourseComboboxVisualState("ok");
  replaceCursoPlaceholderInBody(c.name);
  if (window.EmitBuilder) window.EmitBuilder.refresh();
}

function tryCommitCourseEmitFromTypedName() {
  if (!courseSearch || !courseHiddenId) return;
  if (courseHiddenId.value) return;
  const q = courseSearch.value.trim();
  if (!q) return;
  const ql = q.toLowerCase();
  const exact = coursesEmitList.filter(
    (c) => (c.name || "").trim().toLowerCase() === ql,
  );
  if (exact.length === 1) {
    selectCourseEmit(exact[0]);
  }
}

function filterCoursesEmitQuery(query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return [...coursesEmitList];
  return coursesEmitList.filter((c) => (c.name || "").toLowerCase().includes(q));
}

if (courseSearch && courseDropdown && courseHiddenId) {
  courseSearch.addEventListener("input", () => {
    courseHiddenId.value = "";
    applyCourseComboboxVisualState("default");
    const query = courseSearch.value.trim();
    clearTimeout(courseSearchTimeout);
    if (query.length === 0) {
      courseDropdown.classList.add("hidden");
      setCourseListboxOpen(false);
      return;
    }
    courseSearchTimeout = setTimeout(() => {
      renderCourseEmitDropdown(filterCoursesEmitQuery(query));
    }, 200);
  });
  courseSearch.addEventListener("focus", () => {
    const query = courseSearch.value.trim();
    renderCourseEmitDropdown(
      query.length > 0 ? filterCoursesEmitQuery(query) : [...coursesEmitList],
    );
  });
  courseSearch.addEventListener("blur", () => {
    window.setTimeout(() => tryCommitCourseEmitFromTypedName(), 200);
  });

  document.getElementById("btn-course-dropdown")?.addEventListener("mousedown", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    courseSearch.focus();
    const q = courseSearch.value.trim();
    renderCourseEmitDropdown(
      q.length > 0 ? filterCoursesEmitQuery(q) : [...coursesEmitList],
    );
  });
}

let bodyReplaceCursoTimeout;
document.getElementById("input-body")?.addEventListener("input", () => {
  if (!courseHiddenId?.value || !courseSearch?.value?.trim()) return;
  clearTimeout(bodyReplaceCursoTimeout);
  bodyReplaceCursoTimeout = window.setTimeout(() => {
    replaceCursoPlaceholderInBody(courseSearch.value.trim());
  }, 80);
});

function insertBodyMarker(marker) {
  const ta = document.getElementById("input-body");
  if (!ta) return;
  const start = ta.selectionStart ?? ta.value.length;
  const end = ta.selectionEnd ?? ta.value.length;
  const before = ta.value.slice(0, start);
  const after = ta.value.slice(end);
  ta.value = before + marker + after;
  const pos = start + marker.length;
  ta.selectionStart = ta.selectionEnd = pos;
  ta.focus();
}

function insertCursoIntoBody() {
  const hid = document.getElementById("input-course-id");
  const label = courseSearch?.value?.trim();
  if (hid?.value && label) {
    insertBodyMarker(label);
    return;
  }
  insertBodyMarker("[[CURSO]]");
}

document.getElementById("btn-insert-curso-marker")?.addEventListener("click", () => {
  insertCursoIntoBody();
});

document.addEventListener("click", (e) => {
  if (
    studentSearch &&
    studentDropdown &&
    !studentSearch.contains(e.target) &&
    !studentDropdown.contains(e.target)
  ) {
    studentDropdown.classList.add("hidden");
  }
  const courseCombobox = document.getElementById("course-combobox");
  if (
    courseCombobox &&
    courseDropdown &&
    !courseCombobox.contains(e.target) &&
    !courseDropdown.contains(e.target)
  ) {
    courseDropdown.classList.add("hidden");
    setCourseListboxOpen(false);
  }
});

const navBtns = document.querySelectorAll(".nav-btn");
const interfaces = document.querySelectorAll(".interface");
const typeSelect = document.getElementById("input-type");
const centroSelect = document.getElementById("input-centro-id");
const firmaDoctorSelect = document.getElementById("input-firma-doctor-id");

navBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const targetId = btn.dataset.target;
    interfaces.forEach((i) => {
      i.classList.remove("active", "hidden");
      if (i.id !== targetId) i.classList.add("hidden");
    });
    document.getElementById(targetId).classList.add("active");
    navBtns.forEach((b) => {
      b.classList.remove("bg-teal-600", "text-white");
      b.classList.add("bg-gray-200", "text-gray-700");
    });
    btn.classList.remove("bg-gray-200", "text-gray-700");
    btn.classList.add("bg-teal-600", "text-white");

    if (targetId === "manage" || targetId === "dashboard") {
      loadCertificatesData();
      loadStatistics();
      loadDashboardInsights();
    }
    if (targetId === "create") {
      loadCoursesIntoSelect().catch(() => {});
      loadTypesIntoSelect().catch(() => {});
      loadCentrosIntoSelect().catch(() => {});
      loadFirmaDoctoresIntoSelect().catch(() => {});
      loadBodyTextPresetsForEmitForm(null).catch(() => {});
    }
    if (targetId === "catalogs") loadCatalogs();
  });
});

function setMsg(el, ok, text) {
  el.classList.remove("hidden");
  el.className = `text-sm font-medium ${ok ? "text-emerald-700" : "text-red-700"}`;
  el.textContent = text;
}

async function fetchJson(url, opts = {}) {
  const r = await fetch(url, { ...fetchOpts, ...opts });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || "Error del servidor");
  return data;
}

const dashboardState = {
  generated: 0,
  verifications: 0,
  valid: 0,
  invalid: 0,
  avgGen: 0,
  avgVer: 0,
};

const dashboardCharts = {
  drill: null,
};
let selectedDashboardMetric = null;
const dashboardInsights = {
  monthly: [],
  status: { total: 0, active: 0, revoked: 0 },
  topCourses: [],
  topTypes: [],
  tvByCertificate: [],
  genByCertificate: [],
};

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function renderChartKpis(items) {
  const wrap = document.getElementById("dashboard-chart-kpis");
  if (!wrap) return;
  wrap.replaceChildren();
  (items || []).forEach((txt) => {
    const item = document.createElement("div");
    item.className = "p-3 rounded-lg bg-gray-50 border border-gray-100 text-xs text-gray-700";
    item.textContent = txt;
    wrap.appendChild(item);
  });
}

/**
 * Eje Y en segundos, centrado en los datos reales (sin forzar 0–2 s por la meta).
 * Si todos los valores son muy inferiores a la meta, la serie de meta se omite en el gráfico
 * (sigue indicada en los KPI).
 */
function tightDrillYAxis(values) {
  const nums = values.map(toFiniteNumber).filter((n) => Number.isFinite(n) && n >= 0);
  if (nums.length === 0) {
    return { yMin: 0, yMax: 0.1 };
  }
  let vmin = Math.min(...nums);
  let vmax = Math.max(...nums);
  if (vmin === vmax) {
    vmin = Math.max(0, vmin * 0.9);
    vmax = vmax * 1.15 + 0.01;
  }
  const span = Math.max(vmax - vmin, 0.003);
  const pad = Math.max(span * 0.4, vmax * 0.06, 0.003);
  const yMin = Math.max(0, vmin - pad);
  let yMax = vmax + pad;
  if (yMax - yMin < 0.015) {
    yMax = yMin + 0.05;
  }
  return { yMin, yMax };
}

function yTickSecondsLabel(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  if (Math.abs(n) < 10 && !Number.isInteger(n)) return n.toFixed(3);
  return String(n);
}

function getDrillChartConfig(metricKey) {
  const validRate =
    dashboardState.verifications > 0
      ? (dashboardState.valid / dashboardState.verifications) * 100
      : 0;
  const monthly = dashboardInsights.monthly || [];
  const monthLabels = monthly.map((m) => m.label);
  const hasMonthly = monthLabels.length > 0;
  /** Etiqueta única cuando no hay agrupación mensual en BD (sin certificados o sin fechas). */
  const noSeriesLabel = "Sin serie mensual";
  const avgGenSeries = monthly.map((m) => toFiniteNumber(m.avgGen));
  const avgVerSeries = monthly.map((m) => toFiniteNumber(m.avgVer));

  if (metricKey === "valid") {
    return {
      title: "Número de certificados validados",
      subtitle:
        "Resultado acumulado de las verificaciones de autenticidad (correctas frente a incorrectas).",
      kpis: [
        `Verificaciones correctas: ${dashboardState.valid}`,
        `Verificaciones incorrectas: ${dashboardState.invalid}`,
        `Total de intentos: ${dashboardState.verifications}`,
        `Tasa de acierto: ${validRate.toFixed(1)}%`,
      ],
      chart: {
        type: "doughnut",
        data: {
          labels: ["Correctas", "Incorrectas"],
          datasets: [
            {
              data: [dashboardState.valid, dashboardState.invalid],
              backgroundColor: ["#10b981", "#ef4444"],
              borderWidth: 0,
            },
          ],
        },
      },
    };
  }
  if (metricKey === "avgGen") {
    const genList = dashboardInsights.genByCertificate || [];
    if (genList.length > 0) {
      const labels = genList.map((r) => r.label);
      const values = genList.map((r) => toFiniteNumber(r.tgc));
      const maxEntry = genList.reduce((a, b) =>
        toFiniteNumber(a.tgc) >= toFiniteNumber(b.tgc) ? a : b,
      );
      const minEntry = genList.reduce((a, b) =>
        toFiniteNumber(a.tgc) <= toFiniteNumber(b.tgc) ? a : b,
      );
      const { yMin, yMax } = tightDrillYAxis(values);
      const showMetaTgc = yMax >= 2 * 0.55;
      const onePoint = labels.length < 2;
      const metaPt = onePoint ? 4 : 0;
      const tgcDatasets = [
        {
          label: "TGC por certificado (s)",
          data: values,
          borderColor: "#0d9488",
          backgroundColor: "rgba(37,99,235,0.08)",
          borderWidth: 2,
          fill: true,
          tension: 0.2,
          pointRadius: 5,
          pointHoverRadius: 7,
          pointStyle: "rectRot",
          pointBackgroundColor: "#0d9488",
          pointBorderColor: "#1e3a8a",
        },
      ];
      if (showMetaTgc) {
        tgcDatasets.push({
          label: "Meta TGC (2.00 s)",
          data: labels.map(() => 2),
          borderColor: "#64748b",
          borderDash: [6, 6],
          pointRadius: metaPt,
          fill: false,
        });
      }
      return {
        title: "Tiempo de generación de certificados",
        subtitle:
          "Índice por certificado (hasta 50 recientes, orden por emisión). Eje X: alumno abreviado; eje Y: tiempo de generación TGC (s). Escala acotada a los datos; meta 2,00 s solo si entra en el rango visible.",
        kpis: [
          `TGC global (promedio): ${dashboardState.avgGen.toFixed(4)} s`,
          `Mayor TGC en la muestra: ${toFiniteNumber(maxEntry.tgc).toFixed(4)} s — ${maxEntry.name || "(Sin nombre)"}`,
          `Menor TGC en la muestra: ${toFiniteNumber(minEntry.tgc).toFixed(4)} s — ${minEntry.name || "(Sin nombre)"}`,
          `Certificados en el gráfico: ${genList.length}`,
          `TV global: ${dashboardState.avgVer.toFixed(4)} s (meta TV ≤ 1,50 s)`,
        ],
        chart: {
          type: "line",
          data: {
            labels,
            datasets: tgcDatasets,
          },
        },
        extraChartOptions: {
          scales: {
            y: {
              beginAtZero: false,
              min: yMin,
              max: yMax,
              ticks: {
                maxTicksLimit: 8,
                callback: yTickSecondsLabel,
              },
            },
            x: {
              ticks: {
                maxRotation: 55,
                minRotation: 30,
                autoSkip: genList.length > 14,
                maxTicksLimit: 20,
              },
            },
          },
          plugins: {
            tooltip: {
              callbacks: {
                title(items) {
                  const i = items[0]?.dataIndex;
                  const row = genList[i];
                  return row ? `Certificado #${row.id}` : "";
                },
                label(ctx) {
                  if (ctx.datasetIndex > 0) {
                    return `Meta sugerida: ${Number(ctx.raw).toFixed(2)} s`;
                  }
                  const row = genList[ctx.dataIndex];
                  const v = Number(ctx.parsed.y).toFixed(4);
                  if (!row) return `TGC: ${v} s`;
                  if (!row.hasTgc) {
                    return [
                      "TGC: — (sin medición)",
                      row.name || "—",
                      "Este registro no tiene tiempo de generación guardado.",
                    ];
                  }
                  return [`TGC: ${v} s`, row.name || "—"];
                },
              },
            },
          },
        },
      };
    }

    const lineLabels = hasMonthly ? monthLabels : [noSeriesLabel];
    const genPts = hasMonthly ? avgGenSeries : [dashboardState.avgGen];
    const verPts = hasMonthly ? avgVerSeries : [dashboardState.avgVer];
    const metaPoint = hasMonthly ? 0 : 4;
    const combinedMonthly = [...genPts, ...verPts];
    const { yMin: yMMin, yMax: yMMax } = tightDrillYAxis(combinedMonthly);
    const showMetaTgcM = yMMax >= 2 * 0.55;
    const showMetaTvM = yMMax >= 1.5 * 0.55;
    const monthlyDatasets = [
      {
        label: "TGC promedio",
        data: genPts,
        borderColor: "#3b82f6",
        backgroundColor: "rgba(59,130,246,0.15)",
        fill: true,
        tension: 0.35,
        pointRadius: hasMonthly ? 3 : 5,
      },
      {
        label: "TV promedio",
        data: verPts,
        borderColor: "#8b5cf6",
        backgroundColor: "rgba(139,92,246,0.10)",
        fill: true,
        tension: 0.35,
        pointRadius: hasMonthly ? 3 : 5,
      },
    ];
    if (showMetaTgcM) {
      monthlyDatasets.push({
        label: "Meta TGC (2.00 s)",
        data: lineLabels.map(() => 2),
        borderColor: "#94a3b8",
        borderDash: [6, 6],
        pointRadius: metaPoint,
      });
    }
    if (showMetaTvM) {
      monthlyDatasets.push({
        label: "Meta TV (1.50 s)",
        data: lineLabels.map(() => 1.5),
        borderColor: "#cbd5e1",
        borderDash: [4, 4],
        pointRadius: metaPoint,
      });
    }
    return {
      title: "Tiempo de generación de certificados",
      subtitle: hasMonthly
        ? "Evolución mensual de tiempos promedio por mes de creación del certificado. Escala Y acotada a los datos; líneas de meta solo si entran en el rango."
        : "No hay certificados con fecha de creación agrupables por mes. Se muestran los promedios globales actuales (TGC y TV).",
      kpis: [
        `Promedio actual TGC: ${dashboardState.avgGen.toFixed(4)} s`,
        `Promedio actual TV: ${dashboardState.avgVer.toFixed(4)} s`,
        "Meta sugerida TGC <= 2.00 s / TV <= 1.50 s",
        hasMonthly ? `Meses en el gráfico: ${monthLabels.length}` : "Sin puntos mensuales: emita certificados o revise fechas en la base de datos.",
      ],
      chart: {
        type: "line",
        data: {
          labels: lineLabels,
          datasets: monthlyDatasets,
        },
      },
      extraChartOptions: {
        scales: {
          y: {
            beginAtZero: false,
            min: yMMin,
            max: yMMax,
            ticks: {
              maxTicksLimit: 8,
              callback: yTickSecondsLabel,
            },
          },
        },
      },
    };
  }
  if (metricKey === "avgVer") {
    const tvList = dashboardInsights.tvByCertificate || [];
    if (tvList.length === 0) {
      return {
        title: "Tiempo de verificación de certificados (TV)",
        subtitle:
          "Cada punto del gráfico corresponde a un certificado (última verificación medida). Aún no hay registros de TV por certificado; use la verificación pública con PDF para acumular datos.",
        kpis: [
          `TV global: ${dashboardState.avgVer.toFixed(4)} s`,
          "Meta sugerida TV <= 1.50 s",
        ],
        chart: {
          type: "line",
          data: {
            labels: ["—"],
            datasets: [
              {
                label: "TV (s)",
                data: [0],
                borderColor: "#cbd5e1",
                pointRadius: 0,
              },
            ],
          },
        },
      };
    }

    const labels = tvList.map((r) => r.label);
    const values = tvList.map((r) => toFiniteNumber(r.tv));
    const maxEntry = tvList.reduce((a, b) =>
      toFiniteNumber(a.tv) >= toFiniteNumber(b.tv) ? a : b,
    );
    const minEntry = tvList.reduce((a, b) =>
      toFiniteNumber(a.tv) <= toFiniteNumber(b.tv) ? a : b,
    );
    const { yMin: yMinTv, yMax: yMaxTv } = tightDrillYAxis(values);
    const showMetaTv = yMaxTv >= 1.5 * 0.55;
    const onePoint = labels.length < 2;
    const metaPointTv = onePoint ? 4 : 0;
    const tvDatasets = [
      {
        label: "TV por certificado (s)",
        data: values,
        borderColor: "#dc2626",
        backgroundColor: "rgba(220,38,38,0.06)",
        borderWidth: 2,
        fill: true,
        tension: 0.2,
        pointRadius: 5,
        pointHoverRadius: 7,
        pointStyle: "rectRot",
        pointBackgroundColor: "#dc2626",
        pointBorderColor: "#7f1d1d",
      },
    ];
    if (showMetaTv) {
      tvDatasets.push({
        label: "Meta TV (1.50 s)",
        data: labels.map(() => 1.5),
        borderColor: "#64748b",
        borderDash: [6, 6],
        pointRadius: metaPointTv,
        fill: false,
      });
    }

    return {
      title: "Tiempo de verificación de certificados (TV)",
      subtitle:
        "Índice por certificado (hasta 50 recientes, orden por fecha de emisión). Eje X: nombre abreviado del alumno; eje Y: TV (s), escala acotada a los datos; meta 1,50 s solo si entra en el rango visible.",
      kpis: [
        `TV global (promedio): ${dashboardState.avgVer.toFixed(4)} s`,
        `Mayor TV: ${toFiniteNumber(maxEntry.tv).toFixed(4)} s — ${maxEntry.name || "(Sin nombre)"}`,
        `Menor TV: ${toFiniteNumber(minEntry.tv).toFixed(4)} s — ${minEntry.name || "(Sin nombre)"}`,
        `Certificados en el gráfico: ${tvList.length}`,
      ],
      chart: {
        type: "line",
        data: {
          labels,
          datasets: tvDatasets,
        },
      },
      extraChartOptions: {
        scales: {
          y: {
            beginAtZero: false,
            min: yMinTv,
            max: yMaxTv,
            ticks: {
              maxTicksLimit: 8,
              callback: yTickSecondsLabel,
            },
          },
          x: {
            ticks: {
              maxRotation: 55,
              minRotation: 30,
              autoSkip: tvList.length > 14,
              maxTicksLimit: 20,
            },
            grid: {
              display: true,
            },
          },
        },
        plugins: {
          tooltip: {
            callbacks: {
              title(items) {
                const i = items[0]?.dataIndex;
                const row = tvList[i];
                return row ? `Certificado #${row.id}` : "";
              },
              label(ctx) {
                if (ctx.datasetIndex > 0) {
                  return `Meta sugerida: ${Number(ctx.raw).toFixed(2)} s`;
                }
                const row = tvList[ctx.dataIndex];
                const v = Number(ctx.parsed.y).toFixed(4);
                if (!row) return `TV: ${v} s`;
                if (!row.hasTv) {
                  return [
                    "TV: — (sin medición)",
                    row.name || "—",
                    "Verifique el PDF en la página pública para registrar el tiempo.",
                  ];
                }
                const ok = row.valid ? "verificación válida" : "verificación no válida";
                return [`TV: ${v} s`, row.name || "—", `Última medición: ${ok}`];
              },
            },
          },
        },
      },
    };
  }

  return {
    title: "Gráfico",
    subtitle: "Sin configuración para esta métrica.",
    kpis: [],
    chart: {
      type: "line",
      data: {
        labels: ["—"],
        datasets: [{ label: "—", data: [0], borderColor: "#cbd5e1" }],
      },
    },
  };
}

function setDashboardCardActive(metricKey) {
  document.querySelectorAll(".dashboard-chart-card").forEach((card) => {
    const isActive = card.dataset.chartKey === metricKey;
    card.classList.toggle("ring-2", isActive);
    card.classList.toggle("ring-teal-300", isActive);
  });
}

function closeDashboardChartModal() {
  const modal = document.getElementById("dashboard-chart-modal");
  if (modal) modal.classList.add("hidden");
  if (dashboardCharts.drill) {
    dashboardCharts.drill.destroy();
    dashboardCharts.drill = null;
  }
  setDashboardCardActive("");
  renderChartKpis([]);
  selectedDashboardMetric = null;
}

function renderDrillChart(metricKey) {
  if (typeof Chart === "undefined") return;
  const canvas = document.getElementById("dashboard-drill-chart");
  const modal = document.getElementById("dashboard-chart-modal");
  if (!canvas || !modal) return;
  const config = getDrillChartConfig(metricKey);
  setText("dashboard-chart-title", config.title);
  setText("dashboard-chart-subtitle", config.subtitle);
  renderChartKpis(config.kpis || []);
  modal.classList.remove("hidden");
  setDashboardCardActive(metricKey);

  if (dashboardCharts.drill) {
    dashboardCharts.drill.destroy();
    dashboardCharts.drill = null;
  }

  const chartType = config.chart.type;
  const plugins = {
    legend: { position: chartType === "doughnut" ? "bottom" : "top" },
  };
  if (config.extraChartOptions?.plugins?.tooltip) {
    plugins.tooltip = config.extraChartOptions.plugins.tooltip;
  }

  let scales;
  if (chartType === "bar") {
    const hasPctAxis = (config.chart.data.datasets || []).some((d) => d.yAxisID === "y1");
    if (!hasPctAxis) {
      scales = { y: { beginAtZero: true, ticks: { precision: 0 } } };
    } else {
      scales = {
        y: { beginAtZero: true, ticks: { precision: 0 } },
        y1: {
          beginAtZero: true,
          position: "right",
          grid: { drawOnChartArea: false },
          ticks: { callback: (v) => `${v}%` },
        },
      };
    }
  } else if (chartType === "line") {
    scales = config.extraChartOptions?.scales || { y: { beginAtZero: true } };
  } else {
    scales = undefined;
  }

  dashboardCharts.drill = new Chart(canvas, {
    type: chartType,
    data: config.chart.data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins,
      scales,
    },
  });
}

function setupDashboardCardInteractions() {
  document.querySelectorAll(".dashboard-chart-card").forEach((card) => {
    card.addEventListener("click", () => {
      const key = card.dataset.chartKey;
      if (!key) return;
      selectedDashboardMetric = key;
      renderDrillChart(selectedDashboardMetric);
    });
  });
  const btnHide = document.getElementById("dashboard-chart-hide");
  if (btnHide) {
    btnHide.addEventListener("click", () => closeDashboardChartModal());
  }
  const backdrop = document.getElementById("dashboard-chart-modal-backdrop");
  if (backdrop) {
    backdrop.addEventListener("click", () => closeDashboardChartModal());
  }
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    const modal = document.getElementById("dashboard-chart-modal");
    if (modal && !modal.classList.contains("hidden")) {
      closeDashboardChartModal();
    }
  });
}

function refreshDashboardVisuals() {
  const validRate =
    dashboardState.verifications > 0
      ? (dashboardState.valid / dashboardState.verifications) * 100
      : 0;

  setText("dash-generated", dashboardState.generated);
  setText("dash-verifications", dashboardState.verifications);
  setText("dash-valid", dashboardState.valid);
  setText("rep-avg-gen", `${dashboardState.avgGen.toFixed(4)} s`);
  setText("rep-avg-ver", `${dashboardState.avgVer.toFixed(4)} s`);

  setText(
    "chart-generated-note",
    `${dashboardState.generated} registros emitidos hasta ahora`,
  );
  setText(
    "chart-verifications-note",
    `${dashboardState.verifications} verificaciones acumuladas`,
  );
  setText(
    "chart-valid-note",
    dashboardState.verifications > 0
      ? `${dashboardState.valid} correctas de ${dashboardState.verifications} verificaciones (${validRate.toFixed(1)}%)`
      : "Sin verificaciones registradas aún",
  );

  setText("chart-avg-gen-note", `Meta sugerida: <= 2.00 s (actual ${dashboardState.avgGen.toFixed(4)} s)`);
  setText("chart-avg-ver-note", `Meta sugerida: <= 1.50 s (actual ${dashboardState.avgVer.toFixed(4)} s)`);

  if (selectedDashboardMetric) {
    renderDrillChart(selectedDashboardMetric);
  }
}

async function exportDashboardExcel() {
  const btn = document.getElementById("btn-dashboard-export-excel");
  if (!btn) return;
  const label = btn.querySelector("span:last-child") || btn;
  const prev = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML =
    '<span class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden="true"></span> Generando…';
  try {
    const r = await fetch("/api/dashboard/export-excel", { ...fetchOpts });
    if (r.status === 401 || r.status === 403) {
      window.location.href = "/";
      return;
    }
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || "Error al generar el Excel");
    }
    const blob = await r.blob();
    const cd = r.headers.get("Content-Disposition") || "";
    const m = /filename\*?=(?:UTF-8'')?["']?([^"';]+)/i.exec(cd);
    const ts = new Date().toISOString().slice(0, 19).replace(/[:-]/g, "").replace("T", "_");
    const name = m ? decodeURIComponent(m[1].trim()) : `panel_certificados_${ts}.xlsx`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert(e.message || "No se pudo descargar el Excel.");
  } finally {
    btn.disabled = false;
    btn.innerHTML = prev;
  }
}

async function loadCoursesIntoSelect() {
  const searchEl = document.getElementById("input-course-search");
  const hiddenEl = document.getElementById("input-course-id");
  const dropdownEl = document.getElementById("course-dropdown");
  if (!searchEl || !hiddenEl) return;
  hiddenEl.value = "";
  searchEl.value = "";
  applyCourseComboboxVisualState("default");
  if (dropdownEl) {
    dropdownEl.classList.add("hidden");
    dropdownEl.innerHTML = "";
  }
  setCourseListboxOpen(false);
  searchEl.placeholder = "Cargando cursos…";
  try {
    const data = await fetchJson("/api/admin/courses");
    coursesEmitList = (data.courses || [])
      .filter((c) => c.active)
      .map((c) => ({ id: c.id, name: String(c.name || "") }));
    window.coursesEmitList = coursesEmitList;
  } catch {
    coursesEmitList = [];
    window.coursesEmitList = coursesEmitList;
  }
  searchEl.placeholder = coursesEmitList.length
    ? "Buscar curso o pulse ▾ para ver todos…"
    : "No hay cursos activos. Agréguelos en Catálogos.";
}

async function loadTypesIntoSelect() {
  if (!typeSelect) return;
  typeSelect.innerHTML = `<option value="">Cargando tipos...</option>`;
  const data = await fetchJson("/api/admin/credential-types");
  const rows = (data.types || []).filter((t) => t.active);
  typeSelect.innerHTML = `<option value="">Seleccione un tipo...</option>`;
  rows.forEach((t) => {
    const opt = document.createElement("option");
    opt.value = String(t.id);
    opt.textContent = t.name;
    typeSelect.appendChild(opt);
  });
}

async function loadCentrosIntoSelect() {
  if (!centroSelect) return;
  centroSelect.innerHTML = `<option value="">Cargando centros...</option>`;
  const data = await fetchJson("/api/admin/centros-educativos");
  const rows = (data.centers || []).filter((c) => c.active);
  centroSelect.innerHTML = `<option value="">Seleccione un centro...</option>`;
  rows.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = String(c.id);
    opt.textContent = c.name;
    centroSelect.appendChild(opt);
  });
}

async function loadFirmaDoctoresIntoSelect() {
  if (!firmaDoctorSelect) return;
  firmaDoctorSelect.innerHTML = `<option value="">Cargando directores...</option>`;
  const data = await fetchJson("/api/admin/firma-doctores");
  const rows = (data.doctors || []).filter((d) => d.active);
  firmaDoctorSelect.innerHTML = `<option value="">Seleccione director...</option>`;
  rows.forEach((d) => {
    const opt = document.createElement("option");
    opt.value = String(d.id);
    opt.textContent = d.nombres || `ID ${d.id}`;
    firmaDoctorSelect.appendChild(opt);
  });
  if (window.EmitBuilder && typeof window.EmitBuilder.setDoctorsCatalog === "function") {
    window.EmitBuilder.setDoctorsCatalog(rows);
  }
}

async function loadBodyTextPresetsForEmitForm(presetsFromCatalog) {
  const sel = document.getElementById("select-body-preset");
  if (!sel) return;
  let list = presetsFromCatalog;
  if (list == null) {
    try {
      const data = await fetchJson("/api/admin/body-text-presets");
      list = data.presets || [];
    } catch {
      sel.innerHTML = '<option value="">— Textos guardados no disponibles —</option>';
      return;
    }
  }
  const active = (list || []).filter((p) => p.active);
  window.__bodyPresetTextById = {};
  active.forEach((p) => {
    window.__bodyPresetTextById[p.id] = p.text || "";
  });
  const prev = sel.value;
  sel.innerHTML = '<option value="">— Escribir manualmente —</option>';
  active.forEach((p) => {
    const o = document.createElement("option");
    o.value = String(p.id);
    o.textContent = p.name;
    sel.appendChild(o);
  });
  if (prev && window.__bodyPresetTextById[Number(prev)] !== undefined) {
    sel.value = prev;
  }
}

async function loadCatalogs() {
  const coursesBody = document.getElementById("table-courses");
  const typesBody = document.getElementById("table-ctypes");
  const centrosBody = document.getElementById("table-centros");
  if (!coursesBody || !typesBody) {
    await loadCoursesIntoSelect().catch(() => {});
    await loadTypesIntoSelect().catch(() => {});
    await loadCentrosIntoSelect().catch(() => {});
    await loadFirmaDoctoresIntoSelect().catch(() => {});
    await loadBodyTextPresetsForEmitForm(null).catch(() => {});
    return;
  }
  const courses = (await fetchJson("/api/admin/courses")).courses || [];
  const types = (await fetchJson("/api/admin/credential-types")).types || [];
  let bodyPresets = [];
  try {
    bodyPresets = (await fetchJson("/api/admin/body-text-presets")).presets || [];
  } catch {
    bodyPresets = [];
  }
  const centros = (await fetchJson("/api/admin/centros-educativos")).centers || [];
  const doctors = (await fetchJson("/api/admin/firma-doctores")).doctors || [];

  coursesBody.replaceChildren();
  courses.forEach((c) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="px-4 py-3 text-sm font-semibold">${c.name}</td>
      <td class="px-4 py-3 text-center text-sm">${c.active ? "Sí" : "No"}</td>
      <td class="px-4 py-3 text-center text-sm"></td>
    `;
    const actionsTd = tr.lastElementChild;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = c.active
      ? "px-3 py-1 rounded-lg font-semibold text-white bg-red-600 hover:bg-red-700"
      : "px-3 py-1 rounded-lg font-semibold text-white bg-green-600 hover:bg-green-700";
    btn.textContent = c.active ? "Deshabilitar" : "Habilitar";
    btn.addEventListener("click", () =>
      changeCatalogStatus({
        kind: "course",
        id: c.id,
        name: c.name,
        currentActive: c.active,
      }),
    );
    actionsTd.appendChild(btn);
    coursesBody.appendChild(tr);
  });

  typesBody.replaceChildren();
  types.forEach((t) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="px-4 py-3 text-sm font-semibold">${t.name}</td>
      <td class="px-4 py-3 text-center text-sm">${t.active ? "Sí" : "No"}</td>
      <td class="px-4 py-3 text-center text-sm"></td>
    `;
    const actionsTd = tr.lastElementChild;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = t.active
      ? "px-3 py-1 rounded-lg font-semibold text-white bg-red-600 hover:bg-red-700"
      : "px-3 py-1 rounded-lg font-semibold text-white bg-green-600 hover:bg-green-700";
    btn.textContent = t.active ? "Deshabilitar" : "Habilitar";
    btn.addEventListener("click", () =>
      changeCatalogStatus({
        kind: "type",
        id: t.id,
        name: t.name,
        currentActive: t.active,
      }),
    );
    actionsTd.appendChild(btn);
    typesBody.appendChild(tr);
  });

  const presetsBody = document.getElementById("table-body-text-presets");
  if (presetsBody) {
    presetsBody.replaceChildren();
    bodyPresets.forEach((p) => {
      const tr = document.createElement("tr");
      const tdName = document.createElement("td");
      tdName.className = "px-4 py-3 text-sm font-semibold";
      tdName.textContent = p.name || "";
      const tdPrev = document.createElement("td");
      tdPrev.className = "px-4 py-3 text-xs text-gray-600";
      const full = p.text || "";
      tdPrev.textContent = full.length > 80 ? `${full.slice(0, 80)}…` : full;
      const tdAct = document.createElement("td");
      tdAct.className = "px-4 py-3 text-center text-sm";
      tdAct.textContent = p.active ? "Sí" : "No";
      const actionsTd = document.createElement("td");
      actionsTd.className = "px-4 py-3 text-center text-sm";
      tr.appendChild(tdName);
      tr.appendChild(tdPrev);
      tr.appendChild(tdAct);
      tr.appendChild(actionsTd);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = p.active
        ? "px-3 py-1 rounded-lg font-semibold text-white bg-red-600 hover:bg-red-700"
        : "px-3 py-1 rounded-lg font-semibold text-white bg-green-600 hover:bg-green-700";
      btn.textContent = p.active ? "Deshabilitar" : "Habilitar";
      btn.addEventListener("click", () =>
        changeCatalogStatus({
          kind: "body_preset",
          id: p.id,
          name: p.name,
          currentActive: p.active,
        }),
      );
      actionsTd.appendChild(btn);
      presetsBody.appendChild(tr);
    });
  }


  await loadBodyTextPresetsForEmitForm(bodyPresets);

  if (centrosBody) {
    centrosBody.replaceChildren();
    centros.forEach((c) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="px-4 py-3 text-sm font-semibold">${c.name}</td>
        <td class="px-4 py-3 text-center text-sm">${c.hasLogoDerecho ? "Sí" : "No"}</td>
        <td class="px-4 py-3 text-center text-sm">${c.active ? "Sí" : "No"}</td>
        <td class="px-4 py-3 text-center text-sm"></td>
      `;
      const actionsTd = tr.lastElementChild;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = c.active
        ? "px-3 py-1 rounded-lg font-semibold text-white bg-red-600 hover:bg-red-700"
        : "px-3 py-1 rounded-lg font-semibold text-white bg-green-600 hover:bg-green-700";
      btn.textContent = c.active ? "Deshabilitar" : "Habilitar";
      btn.addEventListener("click", () =>
        changeCatalogStatus({
          kind: "centro",
          id: c.id,
          name: c.name,
          currentActive: c.active,
        }),
      );
      actionsTd.appendChild(btn);
      centrosBody.appendChild(tr);
    });
  }

  const doctorsBody = document.getElementById("table-firma-doctores");
  if (doctorsBody) {
    doctorsBody.replaceChildren();
    doctors.forEach((d) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="px-4 py-3 text-sm font-semibold">${d.nombres || ""}</td>
        <td class="px-4 py-3 text-center text-sm">${d.genero || ""}</td>
        <td class="px-4 py-3 text-center text-sm">${d.hasFirma ? "Sí" : "No"}</td>
        <td class="px-4 py-3 text-center text-sm">${d.active ? "Sí" : "No"}</td>
        <td class="px-4 py-3 text-center text-sm"></td>
      `;
      const actionsTd = tr.lastElementChild;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = d.active
        ? "px-3 py-1 rounded-lg font-semibold text-white bg-red-600 hover:bg-red-700"
        : "px-3 py-1 rounded-lg font-semibold text-white bg-green-600 hover:bg-green-700";
      btn.textContent = d.active ? "Deshabilitar" : "Habilitar";
      btn.addEventListener("click", () =>
        changeCatalogStatus({
          kind: "doctor",
          id: d.id,
          name: d.nombres || String(d.id),
          currentActive: d.active,
        }),
      );
      actionsTd.appendChild(btn);
      doctorsBody.appendChild(tr);
    });
  }

  await loadCoursesIntoSelect();
  await loadTypesIntoSelect();
  await loadCentrosIntoSelect();
  await loadFirmaDoctoresIntoSelect();
}

async function changeCatalogStatus({ kind, id, name, currentActive }) {
  const nextActive = !currentActive;
  const entityLabel =
    kind === "course"
      ? "curso"
      : kind === "centro"
        ? "centro educativo"
        : kind === "doctor"
          ? "director"
          : kind === "body_preset"
            ? "texto guardado"
            : "tipo de credencial";
  const actionLabel = nextActive ? "habilitar" : "deshabilitar";
  const endpoint =
    kind === "course"
      ? `/api/admin/courses/${id}/active`
      : kind === "centro"
        ? `/api/admin/centros-educativos/${id}/active`
        : kind === "doctor"
          ? `/api/admin/firma-doctores/${id}/active`
          : kind === "body_preset"
            ? `/api/admin/body-text-presets/${id}/active`
            : `/api/admin/credential-types/${id}/active`;
  const msgEl = document.getElementById(
    kind === "course"
      ? "courses-msg"
      : kind === "centro"
        ? "centros-msg"
        : kind === "doctor"
          ? "firma-doctor-msg"
          : kind === "body_preset"
            ? "body-presets-msg"
            : "ctypes-msg",
  );

  const accepted = await ModalUtil.show(
    "Confirmar cambio",
    `¿Desea ${actionLabel} "${name}"?`,
    true,
  );
  if (!accepted) return;

  if (msgEl) msgEl.classList.add("hidden");
  try {
    await fetchJson(endpoint, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: nextActive }),
    });
    if (msgEl) {
      setMsg(
        msgEl,
        true,
        `Estado del ${entityLabel} actualizado a ${nextActive ? "Sí" : "No"}.`,
      );
    }
    await loadCatalogs();
  } catch (err) {
    if (msgEl) {
      setMsg(msgEl, false, err.message || "No se pudo actualizar el estado.");
    }
  }
}

function showCreateResultError(resDiv, message) {
  resDiv.replaceChildren();
  const s = document.createElement("strong");
  s.textContent = "Error: ";
  resDiv.appendChild(s);
  resDiv.appendChild(document.createTextNode(message));
}

const formCreateEl = document.getElementById("form-create");
if (formCreateEl) formCreateEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  const btnSpinner = document.getElementById("spinner-create");
  const btnText = document.getElementById("text-create");
  const resDiv = document.getElementById("result-create");
  const btnSubmit = document.getElementById("btn-create");
  btnSpinner.classList.remove("hidden");
  btnText.classList.add("hidden");
  btnSubmit.disabled = true;

  const bodyTxt = document.getElementById("input-body").value.trim();
  const studentId = document.getElementById("input-student-id").value;
  const studentName = document
    .getElementById("input-student-search")
    .value.trim();

  if (!studentId || !studentName) {
    const resDiv = document.getElementById("result-create");
    resDiv.classList.remove("hidden", "bg-emerald-100", "text-emerald-800");
    resDiv.classList.add("bg-red-100", "text-red-800");
    showCreateResultError(resDiv, "Debe seleccionar un estudiante de la lista");
    btnSpinner.classList.add("hidden");
    btnText.classList.remove("hidden");
    btnSubmit.disabled = false;
    return;
  }

  const courseId = document.getElementById("input-course-id").value;
  if (!courseId) {
    const resDiv = document.getElementById("result-create");
    resDiv.classList.remove("hidden", "bg-emerald-100", "text-emerald-800");
    resDiv.classList.add("bg-red-100", "text-red-800");
    showCreateResultError(
      resDiv,
      "Debe seleccionar un curso de la lista (escriba para filtrar y pulse una opción).",
    );
    btnSpinner.classList.add("hidden");
    btnText.classList.remove("hidden");
    btnSubmit.disabled = false;
    applyCourseComboboxVisualState("error");
    return;
  }

  const payload = {
    name: studentName,
    date: document.getElementById("input-date").value,
    recipient_user_id: studentId,
  };
  payload.course_id = document.getElementById("input-course-id").value;
  payload.type_id = document.getElementById("input-type").value;
  payload.centro_educativo_id = document.getElementById("input-centro-id").value;
  payload.firma_doctor_id = document.getElementById("input-firma-doctor-id").value;
  if (bodyTxt) payload.body_text = bodyTxt;
  const presetSel = document.getElementById("select-body-preset");
  if (presetSel && presetSel.value) {
    payload.body_text_catalog_id = presetSel.value;
  }

  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      ...fetchOpts,
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    resDiv.classList.remove(
      "hidden",
      "bg-emerald-100",
      "text-emerald-800",
      "bg-red-100",
      "text-red-800",
    );
    if (!response.ok) {
      resDiv.classList.remove("hidden");
      resDiv.classList.add("bg-red-100", "text-red-800");
      showCreateResultError(resDiv, result.error || "Error del servidor");
      return;
    }
    resDiv.classList.add("hidden");
    resDiv.replaceChildren();
    await ModalUtil.showCertificateGenerated({
      certId: result.cert.id,
      timeSec: result.time,
      mailSent: Boolean(result.cert?.mailSent),
      studentName: result.cert?.name || studentName,
      courseName: result.cert?.course || "",
      typeName: result.cert?.type || "",
      hasPdf: Boolean(result.cert?.hasPdf),
    });
    e.target.reset();
    document.getElementById("input-student-search").value = "";
    document.getElementById("input-student-id").value = "";
    document
      .getElementById("input-student-search")
      .classList.remove("border-green-300", "border-red-300");
    document
      .getElementById("input-student-search")
      .classList.add("border-gray-300");
    loadCoursesIntoSelect().catch(() => {});
  } catch (err) {
    console.error(err);
    resDiv.classList.remove("hidden");
    resDiv.classList.add("bg-red-100", "text-red-800");
    showCreateResultError(resDiv, "No se pudo conectar al servidor.");
  } finally {
    btnSpinner.classList.add("hidden");
    btnText.classList.remove("hidden");
    btnSubmit.disabled = false;
  }
});

function appendCertRow(tbody, cert) {
  const isActive = cert.status === "Activo";
  const tr = document.createElement("tr");
  const tdId = document.createElement("td");
  tdId.className = "px-6 py-4";
  const d1 = document.createElement("div");
  d1.className = "text-sm font-bold text-gray-900";
  d1.textContent = cert.id;
  tdId.appendChild(d1);

  const tdData = document.createElement("td");
  tdData.className = "px-6 py-4";
  const n = document.createElement("div");
  n.className = "text-sm text-gray-900";
  n.textContent = cert.name;
  const c = document.createElement("div");
  c.className = "text-xs text-gray-500";
  c.textContent = cert.course;
  tdData.appendChild(n);
  tdData.appendChild(c);

  const tdMetrics = document.createElement("td");
  tdMetrics.className = "px-6 py-4 text-center";
  const tgcDiv = document.createElement("div");
  tgcDiv.className = "text-xs text-teal-600 font-semibold";
  tgcDiv.textContent = `TGC: ${Number(cert.tgc || 0).toFixed(4)}s`;
  const tvDiv = document.createElement("div");
  tvDiv.className = "text-xs text-teal-600 font-semibold";
  tvDiv.textContent = `TV: ${Number(cert.tv || 0).toFixed(4)}s`;
  const valDiv = document.createElement("div");
  valDiv.className = `text-[10px] uppercase font-bold ${cert.isValid ? "text-emerald-600" : "text-gray-400"}`;
  valDiv.textContent = cert.isValid ? "Validado" : "Pendiente/Inval";
  tdMetrics.appendChild(tgcDiv);
  tdMetrics.appendChild(tvDiv);
  tdMetrics.appendChild(valDiv);

  const tdPdf = document.createElement("td");
  tdPdf.className = "px-6 py-4 text-center";
  if (cert.hasPdf) {
    const a = document.createElement("a");
    a.href = `/api/certificates/${encodeURIComponent(cert.id)}/pdf`;
    a.className = "text-teal-600 font-bold underline text-sm";
    a.textContent = "Descargar";
    a.setAttribute("download", "");
    tdPdf.appendChild(a);
  } else {
    const sp = document.createElement("span");
    sp.className = "text-xs text-gray-400";
    sp.textContent = "—";
    tdPdf.appendChild(sp);
  }

  const tdState = document.createElement("td");
  tdState.className = "px-6 py-4 text-center";
  const span = document.createElement("span");
  span.className = `px-3 py-1 inline-flex text-xs font-bold rounded-full ${
    isActive ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
  }`;
  span.textContent = cert.status;
  tdState.appendChild(span);

  const tdAct = document.createElement("td");
  tdAct.className = "px-6 py-4 text-right";
  const b = document.createElement("button");
  b.type = "button";
  b.className = `font-bold text-sm ${isActive ? "text-rose-600" : "text-emerald-600"}`;
  b.textContent = isActive ? "Revocar" : "Activar";
  b.addEventListener("click", () => toggleStatus(cert.id));
  tdAct.appendChild(b);

  tr.appendChild(tdId);
  tr.appendChild(tdData);
  tr.appendChild(tdMetrics);
  tr.appendChild(tdPdf);
  tr.appendChild(tdState);
  tr.appendChild(tdAct);
  tbody.appendChild(tr);
}

// --- Certificados: búsqueda, paginación y renderizado ---
let certPage = 1;
let certPageSize = 5;
let certSearch = "";
let certTotalPages = 1;

async function loadCertificatesData() {
  const tbody = document.getElementById("table-body-certs");
  const emptyMsg = document.getElementById("empty-certs");
  const search = certSearch;
  const page = certPage;
  const page_size = certPageSize;
  try {
    const url = `/api/certificates?q=${encodeURIComponent(search)}&page=${page}&page_size=${page_size}`;
    const response = await fetch(url, fetchOpts);
    if (response.status === 401 || response.status === 403) {
      window.location.href = "/";
      return;
    }
    const data = await response.json().catch(() => ({}));
    if (isDbUnavailablePayload(response.status, data)) {
      adminDbHealth.certificates = false;
      syncDbUnavailableBanner();
      const msg =
        data.error ||
        "Base de datos no disponible. Pulse «Reintentar» o espere unos segundos.";
      tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-amber-800 font-semibold">${escapeHtml(msg)}</td></tr>`;
      emptyMsg.classList.add("hidden");
      renderCertPagination();
      return;
    }
    if (!response.ok) {
      // Fallo de red/ruta (p. ej. Render en frío) — no confundir con SQL caído
      adminDbHealth.certificates = null;
      syncDbUnavailableBanner();
      tbody.innerHTML =
        '<tr><td colspan="6" class="p-4 text-center text-amber-800 font-semibold">No se pudo cargar el listado. Pulse «Reintentar» (a veces Render tarda en responder tras inactividad).</td></tr>';
      emptyMsg.classList.add("hidden");
      renderCertPagination();
      return;
    }
    adminDbHealth.certificates = true;
    syncDbUnavailableBanner();
    const certs = data.certificates || [];
    certTotalPages = data.total_pages || 1;
    tbody.replaceChildren();
    dashboardState.generated = toFiniteNumber(data.total || 0);
    refreshDashboardVisuals();
    if (certs.length === 0) {
      emptyMsg.classList.remove("hidden");
    } else {
      emptyMsg.classList.add("hidden");
      certs.forEach((cert) => appendCertRow(tbody, cert));
    }
    renderCertPagination();
  } catch {
    adminDbHealth.certificates = null;
    syncDbUnavailableBanner();
    tbody.innerHTML =
      '<tr><td colspan="6" class="p-4 text-center text-red-500 font-bold">Error al cargar certificados. Pulse «Reintentar».</td></tr>';
    emptyMsg.classList.add("hidden");
    renderCertPagination();
  }
}

function renderCertPagination() {
  const pag = document.getElementById("cert-pagination");
  pag.innerHTML = "";
  if (certTotalPages <= 1) return;
  const prev = document.createElement("button");
  prev.textContent = "←";
  prev.className = "px-3 py-1 rounded bg-gray-200 hover:bg-gray-300 font-bold";
  prev.disabled = certPage <= 1;
  prev.onclick = () => {
    if (certPage > 1) {
      certPage--;
      loadCertificatesData();
    }
  };
  pag.appendChild(prev);
  // Page numbers (show max 5)
  let start = Math.max(1, certPage - 2);
  let end = Math.min(certTotalPages, start + 4);
  if (end - start < 4) start = Math.max(1, end - 4);
  for (let i = start; i <= end; i++) {
    const btn = document.createElement("button");
    btn.textContent = i;
    btn.className = `px-3 py-1 rounded font-bold ${i === certPage ? "bg-teal-600 text-white" : "bg-gray-200 hover:bg-gray-300"}`;
    btn.disabled = i === certPage;
    btn.onclick = () => {
      certPage = i;
      loadCertificatesData();
    };
    pag.appendChild(btn);
  }
  const next = document.createElement("button");
  next.textContent = "→";
  next.className = "px-3 py-1 rounded bg-gray-200 hover:bg-gray-300 font-bold";
  next.disabled = certPage >= certTotalPages;
  next.onclick = () => {
    if (certPage < certTotalPages) {
      certPage++;
      loadCertificatesData();
    }
  };
  pag.appendChild(next);
}

document.getElementById("cert-search").addEventListener("input", (e) => {
  certSearch = e.target.value.trim();
  certPage = 1;
  loadCertificatesData();
});
document.getElementById("cert-page-size").addEventListener("change", (e) => {
  certPageSize = parseInt(e.target.value, 10) || 5;
  certPage = 1;
  loadCertificatesData();
});

document
  .getElementById("form-new-admin")
  .addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = document.getElementById("admin-msg");
    msg.classList.add("hidden");
    const r = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      ...fetchOpts,
      body: JSON.stringify({
        username: document.getElementById("admin-new-user").value.trim(),
        email: document.getElementById("admin-new-email").value.trim(),
        password: document.getElementById("admin-new-pass").value,
      }),
    });
    const data = await r.json().catch(() => ({}));
    msg.classList.remove("hidden");
    if (!r.ok) {
      msg.className = "mt-4 text-sm font-medium text-red-700";
      msg.textContent = data.error || "Error";
      return;
    }
    msg.className = "mt-4 text-sm font-medium text-emerald-700";
    msg.textContent = data.mailSent
      ? "Administrador creado y credenciales enviadas por correo."
      : "Administrador creado. No se pudo enviar el correo de credenciales.";
    e.target.reset();
  });

function loadStatistics() {
  fetch("/api/dashboard/operativo", fetchOpts)
    .then(async (r) => {
      if (r.status === 401 || r.status === 403) {
        window.location.href = "/";
        return null;
      }
      const data = await r.json().catch(() => ({}));
      return { status: r.status, ok: r.ok, data };
    })
    .then((res) => {
      if (!res) return;
      const { status, ok, data } = res;
      if (isDbUnavailablePayload(status, data)) {
        adminDbHealth.insights = false;
        syncDbUnavailableBanner();
        return;
      }
      if (!ok || typeof data.emitidos === "undefined") {
        // Error de carga (Render frío / 404 puntual): no marcar SQL como caído
        adminDbHealth.insights = null;
        syncDbUnavailableBanner();
        return;
      }
      adminDbHealth.insights = true;
      syncDbUnavailableBanner();
      dashboardState.generated = toFiniteNumber(data.emitidos || 0);
      setText("dash-generated", data.emitidos || 0);
      setText("dash-activos", data.activos || 0);
      setText("dash-revocados", data.revocados || 0);
      setText("dash-alumnos", data.alumnos || 0);
      setText("dash-universidades", data.universidades || 0);
      setText("dash-areas", data.areas || 0);

      const ulUni = document.getElementById("dash-list-universidades");
      if (ulUni) {
        const items = Array.isArray(data.porUniversidad) ? data.porUniversidad : [];
        ulUni.innerHTML = items.length
          ? items.map((i) => `<li class="flex justify-between gap-2"><span>${escapeHtml(i.nombre)}</span><b>${i.total}</b></li>`).join("")
          : '<li class="text-gray-400">Sin datos aún</li>';
      }
      const ulArea = document.getElementById("dash-list-areas");
      if (ulArea) {
        const items = Array.isArray(data.porArea) ? data.porArea : [];
        ulArea.innerHTML = items.length
          ? items.map((i) => `<li class="flex justify-between gap-2"><span>${escapeHtml(i.nombre)}</span><b>${i.total}</b></li>`).join("")
          : '<li class="text-gray-400">Sin datos aún</li>';
      }
      const mens = document.getElementById("dash-mensual");
      if (mens) {
        const items = Array.isArray(data.mensual) ? data.mensual : [];
        mens.innerHTML = items.length
          ? items.map((i) => `<span class="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-teal-50 border border-teal-100 text-sm"><b>${escapeHtml(i.label)}</b> ${i.emitidos} emitidos</span>`).join("")
          : '<span class="text-gray-400 text-sm">Sin emisiones recientes</span>';
      }

      renderOperativoCharts(data);
    })
    .catch(() => {
      adminDbHealth.insights = null;
      syncDbUnavailableBanner();
    });
}

const operativoCharts = { estado: null, mensual: null, universidades: null, areas: null };

function destroyChart(key) {
  if (operativoCharts[key]) {
    operativoCharts[key].destroy();
    operativoCharts[key] = null;
  }
}

function chartOrEmpty(canvasId, emptyMsg) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === "undefined") return null;
  const wrap = canvas.parentElement;
  let empty = wrap?.querySelector(".chart-empty-msg");
  if (!empty && wrap) {
    empty = document.createElement("p");
    empty.className = "chart-empty-msg absolute inset-0 flex items-center justify-center text-sm text-gray-400";
    wrap.style.position = wrap.style.position || "relative";
    wrap.appendChild(empty);
  }
  if (empty) empty.textContent = emptyMsg || "";
  return { canvas, empty };
}

function renderOperativoCharts(data) {
  if (typeof Chart === "undefined") return;

  const activos = toFiniteNumber(data.activos || 0);
  const revocados = toFiniteNumber(data.revocados || 0);
  const estadoUi = chartOrEmpty("chart-estado", "");
  if (estadoUi) {
    destroyChart("estado");
    const hasEstado = activos + revocados > 0;
    if (estadoUi.empty) estadoUi.empty.textContent = hasEstado ? "" : "Sin certificados aún";
    estadoUi.canvas.classList.toggle("opacity-0", !hasEstado);
    if (hasEstado) {
      operativoCharts.estado = new Chart(estadoUi.canvas.getContext("2d"), {
        type: "doughnut",
        data: {
          labels: ["Activos", "Revocados"],
          datasets: [{
            data: [activos, revocados],
            backgroundColor: ["#0d9488", "#e11d48"],
            borderWidth: 0,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: "bottom" } },
        },
      });
    }
  }

  const mensual = Array.isArray(data.mensual) ? data.mensual.slice().reverse() : [];
  const mensUi = chartOrEmpty("chart-mensual", "");
  if (mensUi) {
    destroyChart("mensual");
    const hasMens = mensual.length > 0;
    if (mensUi.empty) mensUi.empty.textContent = hasMens ? "" : "Sin emisiones recientes";
    mensUi.canvas.classList.toggle("opacity-0", !hasMens);
    if (hasMens) {
      operativoCharts.mensual = new Chart(mensUi.canvas.getContext("2d"), {
        type: "line",
        data: {
          labels: mensual.map((i) => i.label),
          datasets: [{
            label: "Emitidos",
            data: mensual.map((i) => toFiniteNumber(i.emitidos || 0)),
            borderColor: "#0f766e",
            backgroundColor: "rgba(13, 148, 136, 0.18)",
            fill: true,
            tension: 0.35,
            pointRadius: 4,
            pointBackgroundColor: "#0d9488",
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true, ticks: { precision: 0 } },
            x: { grid: { display: false } },
          },
        },
      });
    }
  }

  const porUni = Array.isArray(data.porUniversidad) ? data.porUniversidad : [];
  const uniUi = chartOrEmpty("chart-universidades", "");
  if (uniUi) {
    destroyChart("universidades");
    const hasUni = porUni.length > 0;
    if (uniUi.empty) uniUi.empty.textContent = hasUni ? "" : "Sin alumnos con universidad";
    uniUi.canvas.classList.toggle("opacity-0", !hasUni);
    if (hasUni) {
      operativoCharts.universidades = new Chart(uniUi.canvas.getContext("2d"), {
        type: "bar",
        data: {
          labels: porUni.map((i) => i.nombre),
          datasets: [{
            label: "Alumnos",
            data: porUni.map((i) => toFiniteNumber(i.total || 0)),
            backgroundColor: "#0d9488",
            borderRadius: 6,
          }],
        },
        options: {
          indexAxis: "y",
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { beginAtZero: true, ticks: { precision: 0 } },
            y: { grid: { display: false } },
          },
        },
      });
    }
  }

  const porArea = Array.isArray(data.porArea) ? data.porArea : [];
  const areaUi = chartOrEmpty("chart-areas", "");
  if (areaUi) {
    destroyChart("areas");
    const hasArea = porArea.length > 0;
    if (areaUi.empty) areaUi.empty.textContent = hasArea ? "" : "Sin alumnos con área";
    areaUi.canvas.classList.toggle("opacity-0", !hasArea);
    if (hasArea) {
      const palette = ["#0f766e", "#0d9488", "#14b8a6", "#2dd4bf", "#5eead4", "#99f6e4", "#134e4a", "#115e59"];
      operativoCharts.areas = new Chart(areaUi.canvas.getContext("2d"), {
        type: "bar",
        data: {
          labels: porArea.map((i) => i.nombre),
          datasets: [{
            label: "Alumnos",
            data: porArea.map((i) => toFiniteNumber(i.total || 0)),
            backgroundColor: porArea.map((_, idx) => palette[idx % palette.length]),
            borderRadius: 6,
          }],
        },
        options: {
          indexAxis: "y",
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { beginAtZero: true, ticks: { precision: 0 } },
            y: { grid: { display: false } },
          },
        },
      });
    }
  }
}

function loadDashboardInsights() {
  // Compat: el resumen operativo ya se carga en loadStatistics().
  loadStatistics();
}

document.addEventListener("DOMContentLoaded", () => {
  setupDashboardCardInteractions();
  refreshDashboardVisuals();
  loadCertificatesData();
  loadStatistics();
  loadDashboardInsights();
  loadCatalogs().catch(() => {});
  const btnXlsx = document.getElementById("btn-dashboard-export-excel");
  if (btnXlsx) {
    btnXlsx.addEventListener("click", () => {
      exportDashboardExcel();
    });
  }
  const btnRetryDb = document.getElementById("btn-retry-db-load");
  if (btnRetryDb) {
    btnRetryDb.addEventListener("click", () => {
      adminDbHealth.certificates = null;
      adminDbHealth.insights = null;
      syncDbUnavailableBanner();
      loadCertificatesData();
      loadStatistics();
      loadDashboardInsights();
      loadCatalogs().catch(() => {});
    });
  }
  setupBulkGeneration();
  if (window.EmitBuilder) window.EmitBuilder.refresh();
});

function updateBulkSelectedCount() {
  const n = document.querySelectorAll(".bulk-student-check:checked").length;
  const el = document.getElementById("bulk-selected-count");
  if (el) el.textContent = `${n} seleccionados`;
}

function setupBulkGeneration() {
  const listEl = document.getElementById("bulk-students-list");
  if (!listEl) return;

  document.getElementById("btn-bulk-load")?.addEventListener("click", async () => {
    const uni = document.getElementById("bulk-filter-universidad")?.value.trim() || "";
    const area = document.getElementById("bulk-filter-area")?.value.trim() || "";
    const params = new URLSearchParams();
    if (uni) params.set("universidad", uni);
    if (area) params.set("area", area);
    try {
      const r = await fetch(`/api/students?${params.toString()}`, fetchOpts);
      const data = await r.json().catch(() => ({}));
      const students = Array.isArray(data.students) ? data.students : [];
      if (!students.length) {
        listEl.innerHTML = '<p class="text-gray-500 p-2">No hay alumnos para este filtro.</p>';
        updateBulkSelectedCount();
        return;
      }
      listEl.innerHTML = students
        .map(
          (s) => `
        <label class="flex items-start gap-2 p-2 hover:bg-teal-50 rounded cursor-pointer border-b border-gray-50">
          <input type="checkbox" class="bulk-student-check mt-1" value="${s.id}" checked />
          <span>
            <b>${escapeHtml(s.name || "Sin nombre")}</b>
            <span class="text-gray-500"> · DNI ${escapeHtml(s.dni || "—")}</span><br/>
            <span class="text-xs text-teal-800">${escapeHtml(s.universidad || "Sin universidad")} · ${escapeHtml(s.area || "Sin área")}</span>
          </span>
        </label>`
        )
        .join("");
      listEl.querySelectorAll(".bulk-student-check").forEach((cb) => {
        cb.addEventListener("change", updateBulkSelectedCount);
      });
      updateBulkSelectedCount();
    } catch {
      listEl.innerHTML = '<p class="text-red-600 p-2">Error al cargar alumnos.</p>';
    }
  });

  document.getElementById("btn-bulk-select-all")?.addEventListener("click", () => {
    const boxes = listEl.querySelectorAll(".bulk-student-check");
    const allChecked = [...boxes].every((b) => b.checked);
    boxes.forEach((b) => {
      b.checked = !allChecked;
    });
    updateBulkSelectedCount();
  });

  document.getElementById("btn-bulk-generate")?.addEventListener("click", async () => {
    const resultEl = document.getElementById("bulk-result");
    const ids = [...listEl.querySelectorAll(".bulk-student-check:checked")].map((c) => Number(c.value));
    if (!ids.length) {
      if (resultEl) resultEl.textContent = "Seleccione al menos un alumno.";
      return;
    }
    const courseId = document.getElementById("input-course-id")?.value;
    const typeId = document.getElementById("input-type")?.value;
    const date = document.getElementById("input-date")?.value;
    const centroId = document.getElementById("input-centro-id")?.value;
    const firmaId = document.getElementById("input-firma-doctor-id")?.value;
    if (!courseId || !typeId || !date || !centroId || !firmaId) {
      if (resultEl) {
        resultEl.textContent =
          "Complete fecha, curso, tipo, centro y firma (mismos campos del formulario de emisión).";
      }
      return;
    }
    const bodyTxt = document.getElementById("input-body")?.value?.trim() || "";
    const presetSel = document.getElementById("select-body-preset");
    const payload = {
      student_ids: ids,
      date,
      course_id: courseId,
      type_id: typeId,
      centro_educativo_id: centroId,
      firma_doctor_id: firmaId,
    };
    if (bodyTxt) payload.body_text = bodyTxt;
    if (presetSel && presetSel.value) payload.body_text_catalog_id = presetSel.value;

    if (resultEl) resultEl.textContent = `Generando ${ids.length} certificados…`;
    try {
      const r = await fetch("/api/generate-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        ...fetchOpts,
        body: JSON.stringify(payload),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (resultEl) resultEl.textContent = data.error || "Error al generar el lote.";
        return;
      }
      if (resultEl) {
        resultEl.textContent = `Listo: ${data.created || 0} creados, ${data.failed || 0} con error.`;
      }
      loadCertificatesData();
      loadStatistics();
    } catch {
      if (resultEl) resultEl.textContent = "No se pudo conectar con el servidor.";
    }
  });
}

// --- Catálogos: alta de cursos y tipos ---
const courseForm = document.getElementById("form-new-course");
if (courseForm) {
  courseForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = document.getElementById("courses-msg");
    msg.classList.add("hidden");
    try {
      await fetchJson("/api/admin/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: document.getElementById("course-name").value.trim(),
        }),
      });
      setMsg(msg, true, "Curso agregado correctamente.");
      e.target.reset();
      await loadCatalogs();
    } catch (err) {
      setMsg(msg, false, err.message || "Error");
    }
  });
}

const ctypeForm = document.getElementById("form-new-ctype");
if (ctypeForm) {
  ctypeForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = document.getElementById("ctypes-msg");
    msg.classList.add("hidden");
    try {
      await fetchJson("/api/admin/credential-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: document.getElementById("ctype-name").value.trim(),
        }),
      });
      setMsg(msg, true, "Tipo de credencial agregado correctamente.");
      e.target.reset();
      await loadCatalogs();
    } catch (err) {
      setMsg(msg, false, err.message || "Error");
    }
  });
}

const bodyPresetForm = document.getElementById("form-new-body-preset");
if (bodyPresetForm) {
  bodyPresetForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = document.getElementById("body-presets-msg");
    msg.classList.add("hidden");
    const name = document.getElementById("body-preset-name").value.trim();
    const text = document.getElementById("body-preset-text").value.trim();
    try {
      await fetchJson("/api/admin/body-text-presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, text }),
      });
      setMsg(msg, true, "Texto guardado correctamente.");
      e.target.reset();
      await loadCatalogs();
    } catch (err) {
      setMsg(msg, false, err.message || "Error");
    }
  });
}

const selectBodyPreset = document.getElementById("select-body-preset");
if (selectBodyPreset) {
  selectBodyPreset.addEventListener("change", () => {
    const id = selectBodyPreset.value;
    const ta = document.getElementById("input-body");
    if (!ta || !id) return;
    const m = window.__bodyPresetTextById || {};
    if (m[Number(id)] !== undefined) ta.value = m[Number(id)];
    if (window.EmitBuilder) window.EmitBuilder.refresh();
  });
}

const centroForm = document.getElementById("form-new-centro");
if (centroForm) {
  centroForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = document.getElementById("centros-msg");
    msg.classList.add("hidden");
    const payload = {
      name: document.getElementById("centro-name").value.trim(),
      estado: document.getElementById("centro-estado").value,
    };
    const fileDer = document.getElementById("centro-logo-derecho");
    const fileD = fileDer && fileDer.files && fileDer.files[0];
    if (fileD) {
      if (fileD.size > 5 * 1024 * 1024) {
        setMsg(msg, false, "El logo derecho no puede superar 5 MB.");
        return;
      }
      const b64d = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => {
          const s = String(r.result || "");
          const i = s.indexOf(",");
          resolve(i >= 0 ? s.slice(i + 1) : s);
        };
        r.onerror = () => reject(new Error("No se pudo leer el archivo"));
        r.readAsDataURL(fileD);
      });
      payload.logo_derecho_base64 = b64d;
    }
    try {
      await fetchJson("/api/admin/centros-educativos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setMsg(msg, true, "Centro educativo agregado correctamente.");
      e.target.reset();
      document.getElementById("centro-estado").value = "Activo";
      const ld = document.getElementById("centro-logo-derecho");
      if (ld) ld.value = "";
      await loadCatalogs();
    } catch (err) {
      setMsg(msg, false, err.message || "Error");
    }
  });
}

const firmaDoctorForm = document.getElementById("form-new-firma-doctor");
if (firmaDoctorForm) {
  firmaDoctorForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = document.getElementById("firma-doctor-msg");
    msg.classList.add("hidden");
    const payload = {
      nombres: document.getElementById("firma-doctor-nombres").value.trim(),
      genero: document.getElementById("firma-doctor-genero").value,
      estado: document.getElementById("firma-doctor-estado").value,
    };
    if (!payload.genero) {
      setMsg(msg, false, "Seleccione el género.");
      msg.classList.remove("hidden");
      return;
    }
    const fin = document.getElementById("firma-doctor-archivo");
    const f = fin && fin.files && fin.files[0];
    if (f) {
      if (f.size > 5 * 1024 * 1024) {
        setMsg(msg, false, "La imagen no puede superar 5 MB.");
        msg.classList.remove("hidden");
        return;
      }
      const b64 = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => {
          const s = String(r.result || "");
          const i = s.indexOf(",");
          resolve(i >= 0 ? s.slice(i + 1) : s);
        };
        r.onerror = () => reject(new Error("No se pudo leer el archivo"));
        r.readAsDataURL(f);
      });
      payload.firma_base64 = b64;
    }
    try {
      await fetchJson("/api/admin/firma-doctores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setMsg(msg, true, "Director registrado correctamente.");
      msg.classList.remove("hidden");
      e.target.reset();
      document.getElementById("firma-doctor-estado").value = "Activo";
      await loadCatalogs();
    } catch (err) {
      setMsg(msg, false, err.message || "Error");
      msg.classList.remove("hidden");
    }
  });
}
