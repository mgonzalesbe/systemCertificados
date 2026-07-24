const fetchOpts = { credentials: "same-origin" };

document.getElementById("btn-logout").addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST", ...fetchOpts });
  window.location.href = "/";
});

let allCerts = [];

async function loadMyCerts() {
  const list = document.getElementById("cert-list");
  const empty = document.getElementById("empty-list");
  list.replaceChildren();
  try {
    const r = await fetch("/api/my/certificates", fetchOpts);
    if (r.status === 401 || r.status === 403) {
      window.location.href = "/";
      return;
    }
    if (!r.ok) throw new Error();
    allCerts = await r.json();
    renderFiltered();
  } catch {
    list.innerHTML = '<li class="text-red-600 font-semibold">No se pudo cargar la lista.</li>';
    empty.classList.add("hidden");
  }
}

function renderFiltered() {
  const list = document.getElementById("cert-list");
  const empty = document.getElementById("empty-list");
  const q = (document.getElementById("filter-certs").value || "").toLowerCase().trim();
  list.replaceChildren();
  const filtered = allCerts.filter((c) => {
    if (!q) return true;
    return `${c.id} ${c.name} ${c.course} ${c.type}`.toLowerCase().includes(q);
  });
  if (filtered.length === 0) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  filtered.forEach((c) => {
    const li = document.createElement("li");
    li.className = "border border-gray-100 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-gray-50";
    const left = document.createElement("div");
    const t = document.createElement("p");
    t.className = "font-bold text-gray-900";
    t.textContent = c.name;
    const sub = document.createElement("p");
    sub.className = "text-sm text-gray-600";
    sub.textContent = `${c.course} · ${c.type}`;
    const meta = document.createElement("p");
    meta.className = "text-xs text-gray-400 mt-1";
    meta.textContent = `${c.id} · ${c.issueDate} · ${c.status}`;
    left.appendChild(t);
    left.appendChild(sub);
    left.appendChild(meta);
    const right = document.createElement("div");
    if (c.hasPdf) {
      const a = document.createElement("a");
      a.href = `/api/certificates/${encodeURIComponent(c.id)}/pdf`;
      a.className = "inline-block text-center px-4 py-2 bg-blue-600 text-white rounded-lg font-bold text-sm hover:bg-blue-700";
      a.textContent = "Descargar PDF";
      a.setAttribute("download", "");
      right.appendChild(a);
    } else {
      const sp = document.createElement("span");
      sp.className = "text-xs text-gray-400";
      sp.textContent = "Sin PDF";
      right.appendChild(sp);
    }
    li.appendChild(left);
    li.appendChild(right);
    list.appendChild(li);
  });
}

document.getElementById("filter-certs").addEventListener("input", renderFiltered);

document.addEventListener("DOMContentLoaded", loadMyCerts);
