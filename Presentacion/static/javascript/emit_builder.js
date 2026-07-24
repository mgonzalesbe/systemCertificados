/**
 * Constructor visual sobre fondo_certificado.png
 * Zonas clicables + modos alumnos / manual + firmas catálogo/manual.
 */
(function () {
  const state = {
    mode: "alumnos", // alumnos | manual
    activeZone: null,
    students: [],
    manualName: "",
    manualCargo: "",
    firmas: [], // {id, nombres, genero, cargo, image?}
    doctorsCatalog: [],
    logosCatalog: [],
    logoIzqId: null,
    logoDerId: null,
    logoDerSource: "centro", // centro | catalogo
    logoImageCache: {},
    centroLogoCache: {},
    imageCache: {},
  };

  const $ = (id) => document.getElementById(id);

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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

  function setMode(mode) {
    state.mode = mode === "manual" ? "manual" : "alumnos";
    document.querySelectorAll(".emit-mode-btn").forEach((b) => {
      b.classList.toggle("is-active", b.dataset.mode === state.mode);
    });
    $("editor-dest-alumnos")?.classList.toggle("hidden", state.mode !== "alumnos");
    $("editor-dest-manual")?.classList.toggle("hidden", state.mode !== "manual");
    refresh();
  }

  function openZone(zone) {
    state.activeZone = zone;
    document.querySelectorAll(".cert-zone").forEach((z) => {
      z.classList.toggle("is-active", z.dataset.zone === zone);
    });
    $("cert-editor-empty")?.classList.add("hidden");
    document.querySelectorAll(".cert-editor-block").forEach((b) => {
      b.classList.toggle("hidden", b.dataset.editor !== zone);
    });
    // tipo editor also covers curso
    if (zone === "tipo") {
      // already shown
    }
  }

  function destinatariosList() {
    if (state.mode === "manual") {
      const name = (state.manualName || $("builder-manual-name")?.value || "").trim();
      if (!name) return [];
      return [{ id: null, name, dni: "", universidad: "", area: state.manualCargo || "" }];
    }
    return state.students;
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
      chip.innerHTML = `<span>${escapeHtml(s.name || s.dni || "Alumno")}</span><b>×</b>`;
      chip.addEventListener("click", () => {
        state.students = state.students.filter((x) => x.id !== s.id);
        refresh();
      });
      wrap.appendChild(chip);
    });
    if (meta) meta.textContent = `${state.students.length} alumno(s) seleccionados`;
  }

  async function ensureLogoImage(id) {
    if (!id) return null;
    if (state.logoImageCache[id]) return state.logoImageCache[id];
    try {
      const r = await fetch(`/api/admin/logos/${id}/image`, fetchOpts);
      const data = await r.json().catch(() => ({}));
      if (r.ok && data.image) {
        state.logoImageCache[id] = data.image;
        return data.image;
      }
    } catch (_) {}
    return null;
  }

  async function ensureCentroLogo(centroId) {
    if (!centroId) return null;
    if (state.centroLogoCache[centroId]) return state.centroLogoCache[centroId];
    try {
      const r = await fetch(
        `/api/admin/centros-educativos/${centroId}/logo`,
        fetchOpts,
      );
      const data = await r.json().catch(() => ({}));
      if (r.ok && data.image) {
        state.centroLogoCache[centroId] = data.image;
        return data.image;
      }
    } catch (_) {}
    return null;
  }

  function fillLogoSelects() {
    const izq = $("builder-logo-izq");
    const der = $("builder-logo-der");
    const fill = (sel, selectedId) => {
      if (!sel) return;
      const prev = selectedId != null ? String(selectedId) : sel.value;
      sel.innerHTML =
        sel.id === "builder-logo-izq"
          ? `<option value="">— Sin logo / predeterminado —</option>`
          : `<option value="">— Elegir del catálogo —</option>`;
      state.logosCatalog
        .filter((l) => l.active !== false)
        .forEach((l) => {
          const opt = document.createElement("option");
          opt.value = String(l.id);
          const cat = l.categoria ? ` (${l.categoria})` : "";
          opt.textContent = `${l.name || "Logo"}${cat}`;
          sel.appendChild(opt);
        });
      if (prev) sel.value = prev;
    };
    fill(izq, state.logoIzqId);
    fill(der, state.logoDerId);
  }

  async function updateLogoPreview() {
    const imgIzq = $("pv-logo-izq");
    const phIzq = $("pv-logo-izq-ph");
    const imgDer = $("pv-logo-der");
    const phDer = $("pv-logo-der-ph");

    let leftUrl = null;
    if (state.logoIzqId) leftUrl = await ensureLogoImage(state.logoIzqId);
    if (imgIzq && phIzq) {
      if (leftUrl) {
        imgIzq.src = leftUrl;
        imgIzq.classList.remove("hidden");
        phIzq.classList.add("hidden");
      } else {
        imgIzq.classList.add("hidden");
        phIzq.classList.remove("hidden");
        phIzq.textContent = "Logo izq.";
      }
    }

    let rightUrl = null;
    if (state.logoDerSource === "catalogo" && state.logoDerId) {
      rightUrl = await ensureLogoImage(state.logoDerId);
    } else {
      const centroId = $("input-centro-id")?.value;
      if (centroId) rightUrl = await ensureCentroLogo(centroId);
    }
    if (imgDer && phDer) {
      if (rightUrl) {
        imgDer.src = rightUrl;
        imgDer.classList.remove("hidden");
        phDer.classList.add("hidden");
      } else {
        imgDer.classList.add("hidden");
        phDer.classList.remove("hidden");
        phDer.textContent =
          state.logoDerSource === "centro"
            ? "Logo univ. / centro"
            : "Logo der.";
      }
    }
  }

  async function renderFirmasList() {
    const list = $("builder-firmas-list");
    const hidden = $("input-firma-doctor-id");
    if (!list) return;
    list.innerHTML = "";
    for (const f of state.firmas) {
      const row = document.createElement("div");
      row.className = "firma-chip";
      const pref =
        f.genero === "Masculino" ? "Dr. " : f.genero === "Femenino" ? "Dra. " : "";
      row.innerHTML = `<div><b>${escapeHtml(pref + (f.nombres || ""))}</b>
        <div class="text-[10px] font-medium text-teal-800/80">${escapeHtml(f.cargo || "")}</div></div>
        <button type="button" aria-label="Quitar">×</button>`;
      row.querySelector("button").addEventListener("click", () => {
        state.firmas = state.firmas.filter((x) => x.id !== f.id);
        refresh();
      });
      list.appendChild(row);
      if (f.id && !f.image) {
        ensureFirmaImage(f.id).then((img) => {
          if (img) {
            f.image = img;
            updatePreview();
          }
        });
      }
    }
    if (hidden) hidden.value = state.firmas[0] ? String(state.firmas[0].id) : "";

    const picker = $("builder-firma-picker");
    if (picker) {
      const used = new Set(state.firmas.map((f) => String(f.id)));
      picker.innerHTML = `<option value="">Elegir…</option>`;
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
    const dests = destinatariosList();
    const first = dests[0];
    const nameEl = $("pv-nombre");
    const extraEl = $("pv-alumnos-extra");
    if (nameEl) {
      nameEl.textContent = first
        ? String(first.name || "").toUpperCase()
        : "NOMBRE DEL DESTINATARIO";
      nameEl.classList.toggle("is-placeholder", !first);
    }
    if (extraEl) {
      if (dests.length > 1) {
        extraEl.textContent = `+ ${dests.length - 1} más (mismo diploma)`;
        extraEl.classList.remove("hidden");
      } else if (state.mode === "manual" && state.manualCargo) {
        extraEl.textContent = state.manualCargo;
        extraEl.classList.remove("hidden");
      } else {
        extraEl.textContent = "";
        extraEl.classList.add("hidden");
      }
    }

    const centroSel = $("input-centro-id");
    const tipoSel = $("input-type");
    const inst = centroSel?.selectedOptions?.[0]?.textContent?.trim();
    const tipo = tipoSel?.selectedOptions?.[0]?.textContent?.trim();
    const pvInst = $("pv-institucion");
    const pvTipo = $("pv-tipo");
    if (pvInst) {
      pvInst.textContent = (
        inst && centroSel.value ? inst : "HOSPITAL DISTRITAL DE LAREDO"
      ).toUpperCase();
      pvInst.classList.toggle("is-placeholder", !centroSel?.value);
    }
    if (pvTipo) {
      pvTipo.textContent = (
        tipo && tipoSel.value ? tipo : "RECONOCIMIENTO"
      ).toUpperCase();
      pvTipo.classList.toggle("is-placeholder", !tipoSel?.value);
    }

    const curso = selectedCourseName();
    const bodyRaw = $("input-body")?.value?.trim() || "";
    const pvBody = $("pv-cuerpo");
    if (pvBody) {
      if (bodyRaw) {
        pvBody.textContent = expandBody(
          bodyRaw,
          curso,
          tipo && tipoSel.value ? tipo : "",
        );
        pvBody.classList.remove("is-placeholder");
      } else {
        pvBody.textContent = "Pulse para escribir el cuerpo del diploma…";
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
        : [{ empty: true }];
      list.forEach((f) => {
        const slot = document.createElement("div");
        slot.className = "cert-firma-slot" + (f.empty ? " empty" : "");
        if (f.empty) {
          slot.innerHTML = "<span>Pulse para agregar firma</span>";
        } else {
          const pref =
            f.genero === "Masculino"
              ? "Dr. "
              : f.genero === "Femenino"
                ? "Dra. "
                : "";
          const img = f.image
            ? `<img src="${f.image}" alt="Firma" class="cert-firma-img" />`
            : `<div class="sig-line"></div>`;
          slot.innerHTML = `${img}<span class="cert-firma-name">${escapeHtml(
            pref + (f.nombres || ""),
          )}</span><span class="cert-firma-cargo">${escapeHtml(
            (f.cargo || "").toUpperCase(),
          )}</span>`;
        }
        firmasWrap.appendChild(slot);
      });
    }

    const ready =
      dests.length > 0 &&
      $("input-course-id")?.value &&
      $("input-type")?.value &&
      $("input-centro-id")?.value &&
      $("input-date")?.value &&
      state.firmas.length > 0;

    const btn = $("btn-builder-generate");
    const hint = $("builder-generate-hint");
    const txt = $("text-create");
    if (btn) btn.disabled = !ready;
    if (txt) {
      txt.textContent =
        dests.length > 1
          ? `Generar ${dests.length} certificados`
          : "Generar certificado";
    }
    if (hint) {
      hint.textContent = ready
        ? dests.length > 1
          ? `Se emitirá un PDF por cada uno de los ${dests.length} destinatarios.`
          : "Listo para generar el PDF firmado."
        : "Pulse las zonas del certificado para completar los datos.";
    }

    // Mark zones filled
    document.querySelectorAll(".cert-zone").forEach((z) => {
      const zone = z.dataset.zone;
      let filled = false;
      if (zone === "destinatario") filled = dests.length > 0;
      if (zone === "institucion") filled = !!$("input-centro-id")?.value;
      if (zone === "tipo")
        filled = !!$("input-type")?.value && !!$("input-course-id")?.value;
      if (zone === "cuerpo") filled = !!bodyRaw;
      if (zone === "fecha") filled = !!date;
      if (zone === "firmas") filled = state.firmas.length > 0;
      if (zone === "logo-izq") filled = !!state.logoIzqId;
      if (zone === "logo-der") {
        filled =
          (state.logoDerSource === "catalogo" && !!state.logoDerId) ||
          (state.logoDerSource === "centro" && !!$("input-centro-id")?.value);
      }
      z.classList.toggle("is-filled", filled);
    });

    updateLogoPreview();
  }

  function refresh() {
    if (state.mode === "manual") {
      state.manualName = $("builder-manual-name")?.value || "";
      state.manualCargo = $("builder-manual-cargo")?.value || "";
    }
    renderStudentsChips();
    renderFirmasList();
    fillLogoSelects();
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
    refresh();
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

  function bindZones() {
    document.querySelectorAll(".cert-zone").forEach((z) => {
      z.addEventListener("click", () => openZone(z.dataset.zone));
    });
  }

  function bindMode() {
    document.querySelectorAll(".emit-mode-btn").forEach((b) => {
      b.addEventListener("click", () => setMode(b.dataset.mode));
    });
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

    $("builder-btn-load-group")?.addEventListener("click", async () => {
      const uni = $("builder-filter-uni")?.value?.trim() || "";
      const area = $("builder-filter-area")?.value?.trim() || "";
      if (!uni && !area) {
        alert("Indique universidad y/o área.");
        return;
      }
      try {
        const students = await fetchStudents("", uni, area);
        students.forEach(addStudent);
        if (!students.length) alert("No hay alumnos con ese filtro.");
      } catch (err) {
        alert(err.message || "Error");
      }
    });
    $("builder-btn-clear-students")?.addEventListener("click", () => {
      state.students = [];
      refresh();
    });
  }

  function bindFirmas() {
    $("builder-btn-add-firma")?.addEventListener("click", async () => {
      const picker = $("builder-firma-picker");
      if (!picker?.value) return;
      if (state.firmas.length >= 4) {
        alert("Máximo 4 firmas.");
        return;
      }
      const doc = state.doctorsCatalog.find(
        (d) => String(d.id) === String(picker.value),
      );
      if (!doc) return;
      if (state.firmas.some((f) => String(f.id) === String(doc.id))) return;
      const entry = {
        id: Number(doc.id),
        nombres: doc.nombres || "",
        genero: doc.genero || "",
        cargo: doc.cargo || "",
        image: null,
      };
      state.firmas.push(entry);
      refresh();
      const img = await ensureFirmaImage(entry.id);
      if (img) {
        entry.image = img;
        updatePreview();
      }
    });

    $("builder-btn-save-firma")?.addEventListener("click", async () => {
      const msg = $("new-firma-msg");
      const nombres = $("new-firma-nombres")?.value?.trim() || "";
      const genero = $("new-firma-genero")?.value || "Masculino";
      const cargo = $("new-firma-cargo")?.value?.trim() || "";
      const file = $("new-firma-file")?.files?.[0];
      if (!nombres) {
        if (msg) {
          msg.className = "text-xs mt-2 text-red-600";
          msg.textContent = "Ingrese el nombre.";
          msg.classList.remove("hidden");
        }
        return;
      }
      if (state.firmas.length >= 4) {
        alert("Máximo 4 firmas.");
        return;
      }
      let firma_base64 = null;
      let previewDataUrl = null;
      if (file) {
        if (file.size > 5 * 1024 * 1024) {
          alert("La imagen no puede superar 5 MB.");
          return;
        }
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = "";
        bytes.forEach((b) => {
          binary += String.fromCharCode(b);
        });
        firma_base64 = btoa(binary);
        previewDataUrl = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result || ""));
          r.onerror = reject;
          r.readAsDataURL(file);
        });
      }
      try {
        const r = await fetch("/api/admin/firma-doctores", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          ...fetchOpts,
          body: JSON.stringify({
            nombres,
            genero,
            cargo,
            estado: "Activo",
            firma_base64,
          }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || "No se pudo guardar");
        const entry = {
          id: data.id,
          nombres: data.nombres || nombres,
          genero: data.genero || genero,
          cargo: data.cargo || cargo,
          image: previewDataUrl,
        };
        if (entry.id) state.imageCache[entry.id] = previewDataUrl;
        state.doctorsCatalog.push({
          id: entry.id,
          nombres: entry.nombres,
          genero: entry.genero,
          cargo: entry.cargo,
          active: true,
          hasFirma: !!firma_base64,
        });
        state.firmas.push(entry);
        if ($("new-firma-nombres")) $("new-firma-nombres").value = "";
        if ($("new-firma-cargo")) $("new-firma-cargo").value = "";
        if ($("new-firma-file")) $("new-firma-file").value = "";
        if (msg) {
          msg.className = "text-xs mt-2 text-emerald-700";
          msg.textContent = "Firmante guardado y agregado al diploma.";
          msg.classList.remove("hidden");
        }
        refresh();
      } catch (err) {
        if (msg) {
          msg.className = "text-xs mt-2 text-red-600";
          msg.textContent = err.message || "Error";
          msg.classList.remove("hidden");
        }
      }
    });
  }

  function bindWatchers() {
    [
      "input-type",
      "input-centro-id",
      "input-date",
      "input-body",
      "builder-manual-name",
      "builder-manual-cargo",
    ].forEach((id) => {
      $(id)?.addEventListener("change", refresh);
      $(id)?.addEventListener("input", refresh);
    });
    $("builder-logo-izq")?.addEventListener("change", () => {
      const v = $("builder-logo-izq")?.value;
      state.logoIzqId = v ? Number(v) : null;
      refresh();
    });
    $("builder-logo-der")?.addEventListener("change", () => {
      const v = $("builder-logo-der")?.value;
      state.logoDerId = v ? Number(v) : null;
      refresh();
    });
    document.querySelectorAll('input[name="logo-der-source"]').forEach((r) => {
      r.addEventListener("change", () => {
        const checked = document.querySelector(
          'input[name="logo-der-source"]:checked',
        );
        state.logoDerSource = checked?.value === "catalogo" ? "catalogo" : "centro";
        const derSel = $("builder-logo-der");
        if (derSel) derSel.disabled = state.logoDerSource !== "catalogo";
        refresh();
      });
    });
    const courseId = $("input-course-id");
    if (courseId) {
      let last = courseId.value;
      setInterval(() => {
        if (courseId.value !== last) {
          last = courseId.value;
          refresh();
        }
      }, 350);
    }
    $("select-body-preset")?.addEventListener("change", () => {
      const id = $("select-body-preset")?.value;
      const map = window.__bodyPresetTextById || {};
      if (id && map[Number(id)] !== undefined && $("input-body")) {
        $("input-body").value = map[Number(id)];
      }
      refresh();
    });
  }

  async function generate() {
    const btn = $("btn-builder-generate");
    const spinner = $("spinner-create");
    const txt = $("text-create");
    const resDiv = $("result-create");
    if (!btn || btn.disabled) return;

    const dests = destinatariosList();
    const courseId = $("input-course-id")?.value;
    const typeId = $("input-type")?.value;
    const date = $("input-date")?.value;
    const centroId = $("input-centro-id")?.value;
    const bodyTxt = $("input-body")?.value?.trim() || "";
    const presetSel = $("select-body-preset");
    const firmaIds = state.firmas.map((f) => f.id).filter(Boolean);

    if (
      !dests.length ||
      !courseId ||
      !typeId ||
      !date ||
      !centroId ||
      !firmaIds.length
    ) {
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
      logo_derecho_source: state.logoDerSource,
    };
    if (state.logoIzqId) common.logo_izquierdo_id = state.logoIzqId;
    if (state.logoDerSource === "catalogo" && state.logoDerId) {
      common.logo_derecho_id = state.logoDerId;
    }
    if (bodyTxt) common.body_text = bodyTxt;
    if (presetSel?.value) common.body_text_catalog_id = presetSel.value;

    try {
      if (state.mode === "manual" || dests.length === 1) {
        const s = dests[0];
        const payload = {
          ...common,
          name: s.name,
        };
        if (s.id) payload.recipient_user_id = s.id;
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
        }
      } else {
        const payload = {
          ...common,
          student_ids: dests.map((s) => s.id),
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
      refresh();
    }
  }

  window.EmitBuilder = {
    refresh,
    setDoctorsCatalog(rows) {
      state.doctorsCatalog = Array.isArray(rows) ? rows : [];
      renderFirmasList();
      updatePreview();
    },
    setLogosCatalog(rows) {
      state.logosCatalog = Array.isArray(rows) ? rows : [];
      fillLogoSelects();
      updateLogoPreview();
      updatePreview();
    },
    reset() {
      state.students = [];
      state.firmas = [];
      state.manualName = "";
      state.manualCargo = "";
      state.logoIzqId = null;
      state.logoDerId = null;
      state.logoDerSource = "centro";
      refresh();
    },
  };

  document.addEventListener("DOMContentLoaded", () => {
    if (!$("cert-canvas")) return;
    bindZones();
    bindMode();
    bindStudentSearch();
    bindFirmas();
    bindWatchers();
    $("btn-builder-generate")?.addEventListener("click", generate);
    setMode("alumnos");
    openZone("destinatario");
    refresh();
  });
})();
