/**
 * Constructor visual de certificados (rompecabezas + vista previa).
 * Depende de helpers globales de admin.js: fetchOpts, fetchJson, ModalUtil,
 * searchStudents (si existe), coursesEmitList, loadCoursesIntoSelect, etc.
 */
(function () {
  const state = {
    students: [], // {id, name, dni, universidad, area}
    firmas: [], // {id, nombres, genero}
    doctorsCatalog: [],
  };

  const $ = (id) => document.getElementById(id);

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setPieceFilled(piece, filled, label) {
    const art = document.querySelector(`.puzzle-piece[data-piece="${piece}"]`);
    const status = $(`piece-status-${piece}`);
    if (art) art.classList.toggle("is-filled", !!filled);
    if (status) {
      status.textContent = label || (filled ? "listo" : piece === "cuerpo" ? "opcional" : "vacío");
      status.classList.toggle("ok", !!filled);
    }
  }

  function selectedCourseName() {
    const id = $("input-course-id")?.value;
    if (!id || !window.coursesEmitList) return "";
    const row = window.coursesEmitList.find((c) => String(c.id) === String(id));
    return row ? row.name : $("input-course-search")?.value || "";
  }

  function expandBody(text, curso, tipo) {
    return String(text || "")
      .replace(/\[\[CURSO\]\]/gi, curso || "…")
      .replace(/\[\[TIPO\]\]/gi, tipo || "…");
  }

  function renderStudentsChips() {
    const wrap = $("builder-students-chips");
    const meta = $("builder-students-meta");
    if (!wrap) return;
    wrap.innerHTML = "";
    state.students.forEach((s) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "student-chip";
      chip.title = "Quitar";
      chip.innerHTML = `<span>${escapeHtml(s.name || s.dni || "Alumno")}</span><b>×</b>`;
      chip.addEventListener("click", () => {
        state.students = state.students.filter((x) => x.id !== s.id);
        refreshBuilder();
      });
      wrap.appendChild(chip);
    });
    const unis = [
      ...new Set(
        state.students
          .map((s) => (s.universidad || "").trim())
          .filter(Boolean),
      ),
    ];
    const areas = [
      ...new Set(
        state.students.map((s) => (s.area || "").trim()).filter(Boolean),
      ),
    ];
    if (meta) {
      meta.textContent = `${state.students.length} alumno(s)${
        unis.length ? ` · ${unis.join(", ")}` : " · sin universidad"
      }${areas.length ? ` · ${areas.join(", ")}` : ""}`;
    }
    setPieceFilled(
      "alumnos",
      state.students.length > 0,
      state.students.length ? `${state.students.length} listo` : "vacío",
    );
  }

  function renderFirmasList() {
    const list = $("builder-firmas-list");
    const hidden = $("input-firma-doctor-id");
    if (!list) return;
    list.innerHTML = "";
    state.firmas.forEach((f, idx) => {
      const row = document.createElement("div");
      row.className = "firma-chip";
      const pref =
        f.genero === "Masculino" ? "Dr. " : f.genero === "Femenino" ? "Dra. " : "";
      row.innerHTML = `<span>${idx + 1}. ${escapeHtml(pref + (f.nombres || ""))}</span>
        <button type="button" data-id="${f.id}" aria-label="Quitar firma">×</button>`;
      row.querySelector("button").addEventListener("click", () => {
        state.firmas = state.firmas.filter((x) => x.id !== f.id);
        refreshBuilder();
      });
      list.appendChild(row);
    });
    if (hidden) hidden.value = state.firmas[0] ? String(state.firmas[0].id) : "";
    setPieceFilled(
      "firmas",
      state.firmas.length > 0,
      state.firmas.length ? `${state.firmas.length} firma(s)` : "vacío",
    );
    // refresh picker options (hide already added)
    const picker = $("builder-firma-picker");
    if (picker) {
      const used = new Set(state.firmas.map((f) => String(f.id)));
      picker.innerHTML = `<option value="">Elegir director…</option>`;
      state.doctorsCatalog
        .filter((d) => d.active !== false)
        .forEach((d) => {
          if (used.has(String(d.id))) return;
          const opt = document.createElement("option");
          opt.value = String(d.id);
          opt.textContent = d.nombres || `ID ${d.id}`;
          picker.appendChild(opt);
        });
    }
  }

  function updatePreview() {
    const n = state.students.length;
    const first = state.students[0];
    const nameEl = $("pv-nombre");
    const extraEl = $("pv-alumnos-extra");
    const uniEl = $("pv-universidad");
    if (nameEl) {
      nameEl.textContent = first
        ? String(first.name || "").toUpperCase()
        : "NOMBRE DEL ALUMNO";
      nameEl.classList.toggle("is-placeholder", !first);
    }
    if (extraEl) {
      if (n > 1) {
        extraEl.textContent = `+ ${n - 1} alumno(s) más recibirán el mismo diploma`;
        extraEl.classList.remove("hidden");
      } else {
        extraEl.textContent = "";
        extraEl.classList.add("hidden");
      }
    }
    if (uniEl) {
      const unis = [
        ...new Set(
          state.students.map((s) => (s.universidad || "").trim()).filter(Boolean),
        ),
      ];
      uniEl.textContent = unis.length ? unis.join(" · ") : "";
    }

    const centroSel = $("input-centro-id");
    const tipoSel = $("input-type");
    const inst = centroSel?.selectedOptions?.[0]?.textContent?.trim();
    const tipo = tipoSel?.selectedOptions?.[0]?.textContent?.trim();
    const pvInst = $("pv-institucion");
    const pvTipo = $("pv-tipo");
    if (pvInst) {
      pvInst.textContent = (inst && centroSel.value ? inst : "CENTRO EDUCATIVO").toUpperCase();
      pvInst.classList.toggle("is-placeholder", !centroSel?.value);
    }
    if (pvTipo) {
      pvTipo.textContent = (tipo && tipoSel.value ? tipo : "TIPO DE CREDENCIAL").toUpperCase();
      pvTipo.classList.toggle("is-placeholder", !tipoSel?.value);
    }
    $("pv-logo-right")?.classList.toggle("filled", !!centroSel?.value);

    const curso = selectedCourseName();
    const bodyRaw = $("input-body")?.value?.trim() || "";
    const pvBody = $("pv-cuerpo");
    if (pvBody) {
      if (bodyRaw) {
        pvBody.textContent = expandBody(bodyRaw, curso, tipo && tipoSel.value ? tipo : "");
        pvBody.classList.remove("is-placeholder");
      } else {
        pvBody.textContent = "El texto del cuerpo aparecerá aquí…";
        pvBody.classList.add("is-placeholder");
      }
    }

    const date = $("input-date")?.value || "";
    const pvFecha = $("pv-fecha");
    if (pvFecha) {
      pvFecha.textContent = date
        ? `Fecha de emisión: ${date}`
        : "Fecha de emisión: —";
      pvFecha.classList.toggle("is-placeholder", !date);
    }

    const firmasWrap = $("pv-firmas");
    if (firmasWrap) {
      firmasWrap.innerHTML = "";
      const list = state.firmas.length
        ? state.firmas
        : [{ nombres: "Firma", empty: true }];
      list.forEach((f) => {
        const slot = document.createElement("div");
        slot.className = "cert-firma-slot" + (f.empty ? " empty" : "");
        const pref =
          f.genero === "Masculino"
            ? "Dr. "
            : f.genero === "Femenino"
              ? "Dra. "
              : "";
        slot.innerHTML = `<div class="sig-line"></div><span>${escapeHtml(
          f.empty ? "Firma" : pref + (f.nombres || ""),
        )}</span>`;
        firmasWrap.appendChild(slot);
      });
    }

    setPieceFilled("curso", !!$("input-course-id")?.value);
    setPieceFilled("tipo", !!$("input-type")?.value);
    setPieceFilled("centro", !!$("input-centro-id")?.value);
    setPieceFilled("fecha", !!$("input-date")?.value);
    setPieceFilled("cuerpo", !!bodyRaw, bodyRaw ? "listo" : "opcional");

    const ready =
      state.students.length > 0 &&
      $("input-course-id")?.value &&
      $("input-type")?.value &&
      $("input-centro-id")?.value &&
      $("input-date")?.value &&
      state.firmas.length > 0;

    const btn = $("btn-builder-generate");
    const badge = $("builder-preview-badge");
    const hint = $("builder-generate-hint");
    const txt = $("text-create");
    if (btn) btn.disabled = !ready;
    if (badge) {
      badge.textContent = ready
        ? n > 1
          ? `Listo · ${n} PDFs`
          : "Listo · 1 PDF"
        : "Armando…";
      badge.className =
        "text-xs font-semibold px-2 py-1 rounded-full " +
        (ready
          ? "bg-emerald-100 text-emerald-900"
          : "bg-amber-100 text-amber-900");
    }
    if (txt) {
      txt.textContent =
        n > 1
          ? `Generar ${n} certificados`
          : "Generar certificado";
    }
    if (hint) {
      hint.textContent = ready
        ? n > 1
          ? `Se emitirá un PDF firmado por cada uno de los ${n} alumnos.`
          : "Se emitirá un PDF firmado para el alumno seleccionado."
        : "Complete las piezas obligatorias para habilitar la generación.";
    }
  }

  function refreshBuilder() {
    renderStudentsChips();
    renderFirmasList();
    updatePreview();
  }

  function addStudent(s) {
    if (!s || !s.id) return;
    if (state.students.some((x) => String(x.id) === String(s.id))) return;
    state.students.push({
      id: Number(s.id),
      name: s.name || "",
      dni: s.dni || "",
      universidad: s.universidad || "",
      area: s.area || "",
    });
    refreshBuilder();
  }

  async function fetchStudents(q, universidad, area) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (universidad) params.set("universidad", universidad);
    if (area) params.set("area", area);
    const r = await fetch(`/api/students?${params}`, fetchOpts);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || "No se pudieron cargar alumnos");
    return data.students || [];
  }

  function bindStudentSearch() {
    const input = $("builder-student-search");
    const dd = $("builder-student-dropdown");
    if (!input || !dd) return;
    let timer = null;
    const run = async () => {
      const q = input.value.trim();
      if (q.length < 1) {
        dd.classList.add("hidden");
        dd.innerHTML = "";
        return;
      }
      try {
        const students = await fetchStudents(
          q,
          $("builder-filter-uni")?.value?.trim() || "",
          $("builder-filter-area")?.value?.trim() || "",
        );
        dd.innerHTML = "";
        if (!students.length) {
          dd.innerHTML = `<div class="puzzle-dd-empty">Sin resultados</div>`;
          dd.classList.remove("hidden");
          return;
        }
        students.slice(0, 30).forEach((s) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "puzzle-dd-item";
          btn.innerHTML = `<b>${escapeHtml(s.name)}</b><span>${escapeHtml(
            [s.dni, s.universidad, s.area].filter(Boolean).join(" · "),
          )}</span>`;
          btn.addEventListener("click", () => {
            addStudent(s);
            input.value = "";
            dd.classList.add("hidden");
          });
          dd.appendChild(btn);
        });
        dd.classList.remove("hidden");
      } catch (err) {
        dd.innerHTML = `<div class="puzzle-dd-empty">${escapeHtml(err.message)}</div>`;
        dd.classList.remove("hidden");
      }
    };
    input.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(run, 220);
    });
    document.addEventListener("click", (e) => {
      if (!dd.contains(e.target) && e.target !== input) dd.classList.add("hidden");
    });
  }

  function bindGroupLoad() {
    $("builder-btn-load-group")?.addEventListener("click", async () => {
      const uni = $("builder-filter-uni")?.value?.trim() || "";
      const area = $("builder-filter-area")?.value?.trim() || "";
      if (!uni && !area) {
        alert("Indique universidad y/o área para cargar un grupo.");
        return;
      }
      try {
        const students = await fetchStudents("", uni, area);
        students.forEach(addStudent);
        if (!students.length) alert("No hay alumnos con ese filtro.");
      } catch (err) {
        alert(err.message || "Error al cargar grupo");
      }
    });
    $("builder-btn-clear-students")?.addEventListener("click", () => {
      state.students = [];
      refreshBuilder();
    });
  }

  function bindFirmas() {
    $("builder-btn-add-firma")?.addEventListener("click", () => {
      const picker = $("builder-firma-picker");
      if (!picker || !picker.value) return;
      if (state.firmas.length >= 4) {
        alert("Máximo 4 firmas por certificado.");
        return;
      }
      const doc = state.doctorsCatalog.find(
        (d) => String(d.id) === String(picker.value),
      );
      if (!doc) return;
      if (state.firmas.some((f) => String(f.id) === String(doc.id))) return;
      state.firmas.push({
        id: Number(doc.id),
        nombres: doc.nombres || "",
        genero: doc.genero || "",
      });
      refreshBuilder();
    });
  }

  function bindPreviewWatchers() {
    ["input-type", "input-centro-id", "input-date", "input-body", "select-body-preset"].forEach(
      (id) => {
        $(id)?.addEventListener("change", refreshBuilder);
        $(id)?.addEventListener("input", refreshBuilder);
      },
    );
    $("input-course-id")?.addEventListener("change", refreshBuilder);
    // course search selection is handled in admin.js; observe attribute/value
    const courseId = $("input-course-id");
    if (courseId) {
      const obs = new MutationObserver(refreshBuilder);
      obs.observe(courseId, { attributes: true, attributeFilter: ["value"] });
      // also poll lightly when typing selection changes value programmatically
      let last = courseId.value;
      setInterval(() => {
        if (courseId.value !== last) {
          last = courseId.value;
          refreshBuilder();
        }
      }, 400);
    }
    $("select-body-preset")?.addEventListener("change", () => {
      const sel = $("select-body-preset");
      const id = sel?.value;
      const map = window.__bodyPresetTextById || {};
      if (id && map[Number(id)] !== undefined && $("input-body")) {
        $("input-body").value = map[Number(id)];
      }
      refreshBuilder();
    });
  }

  async function generate() {
    const btn = $("btn-builder-generate");
    const spinner = $("spinner-create");
    const txt = $("text-create");
    const resDiv = $("result-create");
    if (!btn || btn.disabled) return;

    const courseId = $("input-course-id")?.value;
    const typeId = $("input-type")?.value;
    const date = $("input-date")?.value;
    const centroId = $("input-centro-id")?.value;
    const bodyTxt = $("input-body")?.value?.trim() || "";
    const presetSel = $("select-body-preset");
    const firmaIds = state.firmas.map((f) => f.id);

    if (!state.students.length || !courseId || !typeId || !date || !centroId || !firmaIds.length) {
      return;
    }

    btn.disabled = true;
    spinner?.classList.remove("hidden");
    txt?.classList.add("hidden");
    if (resDiv) {
      resDiv.classList.add("hidden");
      resDiv.replaceChildren();
    }

    const common = {
      date,
      course_id: courseId,
      type_id: typeId,
      centro_educativo_id: centroId,
      firma_doctor_id: firmaIds[0],
      firma_doctor_ids: firmaIds,
    };
    if (bodyTxt) common.body_text = bodyTxt;
    if (presetSel?.value) common.body_text_catalog_id = presetSel.value;

    try {
      if (state.students.length === 1) {
        const s = state.students[0];
        const payload = {
          ...common,
          name: s.name,
          recipient_user_id: s.id,
        };
        const response = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          ...fetchOpts,
          body: JSON.stringify(payload),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "Error del servidor");
        if (typeof ModalUtil !== "undefined" && ModalUtil.showCertificateGenerated) {
          await ModalUtil.showCertificateGenerated({
            certId: result.cert.id,
            timeSec: result.time,
            mailSent: Boolean(result.cert?.mailSent),
            studentName: result.cert?.name || s.name,
            courseName: result.cert?.course || "",
            typeName: result.cert?.type || "",
            hasPdf: Boolean(result.cert?.hasPdf),
          });
        } else if (resDiv) {
          resDiv.classList.remove("hidden");
          resDiv.className =
            "mt-3 p-3 rounded-lg text-center text-sm font-medium bg-emerald-100 text-emerald-800";
          resDiv.textContent = `Certificado generado: ${result.cert?.id || ""}`;
        }
      } else {
        const payload = {
          ...common,
          student_ids: state.students.map((s) => s.id),
        };
        const r = await fetch("/api/generate-bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          ...fetchOpts,
          body: JSON.stringify(payload),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || "Error al generar el lote");
        if (resDiv) {
          resDiv.classList.remove("hidden");
          resDiv.className =
            "mt-3 p-3 rounded-lg text-center text-sm font-medium bg-emerald-100 text-emerald-800";
          resDiv.textContent = `Listo: ${data.created || 0} creados, ${data.failed || 0} con error.`;
        }
        if (typeof ModalUtil !== "undefined" && ModalUtil.show) {
          await ModalUtil.show(
            "Emisión en lote",
            `Se generaron ${data.created || 0} certificado(s). Fallidos: ${data.failed || 0}.`,
          );
        }
      }
      if (typeof loadCertificatesData === "function") loadCertificatesData();
      if (typeof loadStatistics === "function") loadStatistics();
    } catch (err) {
      if (resDiv) {
        resDiv.classList.remove("hidden");
        resDiv.className =
          "mt-3 p-3 rounded-lg text-center text-sm font-medium bg-red-100 text-red-800";
        resDiv.textContent = err.message || "Error al generar";
      }
    } finally {
      spinner?.classList.add("hidden");
      txt?.classList.remove("hidden");
      refreshBuilder();
    }
  }

  window.EmitBuilder = {
    refresh: refreshBuilder,
    setDoctorsCatalog(rows) {
      state.doctorsCatalog = Array.isArray(rows) ? rows : [];
      renderFirmasList();
      updatePreview();
    },
    reset() {
      state.students = [];
      state.firmas = [];
      if ($("input-course-id")) $("input-course-id").value = "";
      if ($("input-course-search")) $("input-course-search").value = "";
      if ($("input-type")) $("input-type").value = "";
      if ($("input-centro-id")) $("input-centro-id").value = "";
      if ($("input-date")) $("input-date").value = "";
      if ($("input-body")) $("input-body").value = "";
      if ($("select-body-preset")) $("select-body-preset").value = "";
      refreshBuilder();
    },
  };

  document.addEventListener("DOMContentLoaded", () => {
    if (!$("emit-pieces")) return;
    bindStudentSearch();
    bindGroupLoad();
    bindFirmas();
    bindPreviewWatchers();
    $("btn-builder-generate")?.addEventListener("click", generate);
    refreshBuilder();
  });
})();
