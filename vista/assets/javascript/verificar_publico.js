function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatOfficialBlock(official) {
  if (!official || typeof official !== "object") return "";
  const lines = [
    official.studentName && `<div><span class="text-slate-500">Nombre oficial:</span> ${escapeHtml(official.studentName)}</div>`,
    official.course && `<div><span class="text-slate-500">Programa / curso:</span> ${escapeHtml(official.course)}</div>`,
    official.credentialType && `<div><span class="text-slate-500">Tipo:</span> ${escapeHtml(official.credentialType)}</div>`,
    official.issueDate && `<div><span class="text-slate-500">Fecha emisión:</span> ${escapeHtml(official.issueDate)}</div>`,
  ].filter(Boolean);
  if (!lines.length) return "";
  return `<div class="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-left text-xs text-slate-800">${lines.join("")}</div>`;
}

function visualIntegrityNote(vi) {
  if (vi === "no_text_layer") {
    return `<p class="mt-2 text-xs text-amber-800">No se pudo leer texto en el PDF (p. ej. solo imagen escaneada). Compare usted el impreso con los datos oficiales abajo.</p>`;
  }
  if (vi === "name_mismatch") {
    return `<p class="mt-2 text-xs text-rose-900">El nombre impreso no coincide con el registro firmado. Posible documento adulterado.</p>`;
  }
  if (vi === "course_mismatch") {
    return `<p class="mt-2 text-xs text-rose-900">El programa o curso impreso no coincide con el registro firmado. Posible documento adulterado.</p>`;
  }
  return "";
}

document.getElementById("btn-verify-pdf").addEventListener("click", async () => {
  const inp = document.getElementById("input-pdf-verify");
  const res = document.getElementById("result-verify");
  res.classList.remove("hidden", "bg-emerald-100", "text-emerald-800", "bg-rose-100", "text-rose-800", "bg-amber-50", "text-amber-900", "bg-red-100", "text-red-800");
  if (!inp.files?.length) {
    res.classList.add("bg-amber-50", "text-amber-900");
    res.textContent = "Seleccione un archivo PDF.";
    return;
  }
  res.classList.add("bg-slate-100", "text-slate-700");
  res.textContent = "Analizando PDF…";
  const fd = new FormData();
  fd.append("file", inp.files[0]);
  try {
    const r = await fetch("/api/verify-pdf", { method: "POST", body: fd });
    const data = await r.json().catch(() => ({}));
    res.classList.remove("bg-slate-100", "text-slate-700");
    if (data.error && !data.time && data.isValid === false) {
      res.classList.add("bg-amber-50", "text-amber-900");
      res.textContent = data.error;
      return;
    }
    const d = data.data || {};
    const official = d.official;
    const vi = d.visualIntegrity;
    const officialHtml = formatOfficialBlock(official);
    const viHtml = visualIntegrityNote(vi);
    if (data.isValid) {
      res.classList.add("bg-emerald-100", "text-emerald-800");
      res.innerHTML = `✅ <strong>Documento auténtico</strong><br><span class="text-xs">Tiempo de verificación: ${Number(data.time || 0).toFixed(4)} s</span>${viHtml}${officialHtml}`;
    } else {
      res.classList.add("bg-rose-100", "text-rose-800");
      const reason =
        vi === "name_mismatch"
          ? "Firma correcta frente al servidor, pero el texto visible del PDF no coincide con el nombre oficial."
          : vi === "course_mismatch"
            ? "Firma correcta frente al servidor, pero el texto visible del PDF no coincide con el curso o programa oficial."
            : data.error || "";
      res.innerHTML = `❌ <strong>No válido o revocado</strong>${reason ? `<br><span class="text-xs">${escapeHtml(reason)}</span>` : ""}<br><span class="text-xs">TV: ${Number(data.time || 0).toFixed(4)} s</span>${viHtml}${officialHtml}`;
    }
  } catch {
    res.classList.remove("bg-slate-100", "text-slate-700");
    res.classList.add("bg-red-100", "text-red-800");
    res.textContent = "No se pudo contactar al servidor.";
  }
});
