const msgEl = document.getElementById("msg-global");

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

setupPasswordToggle("login-pass", "toggle-login-pass");
setupPasswordToggle("reg-pass", "toggle-reg-pass");

const REG_INPUT_IDS = [
  "reg-user",
  "reg-doc",
  "reg-email",
  "reg-pass",
  "reg-nombres",
  "reg-apellidos",
  "reg-universidad",
  "reg-area",
];
const REG_ERROR_IDS = [
  "reg-user-error",
  "reg-doc-error",
  "reg-email-error",
  "reg-pass-error",
  "reg-universidad-error",
  "reg-area-error",
];

function clearRegisterFieldErrors() {
  REG_INPUT_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.remove("border-red-500", "ring-1", "ring-red-500");
    }
  });
  REG_ERROR_IDS.forEach((id) => {
    const err = document.getElementById(id);
    if (err) {
      err.textContent = "";
      err.classList.add("hidden");
    }
  });
}

function setRegisterFieldError(fieldId, message) {
  const inp = document.getElementById(fieldId);
  if (inp) {
    inp.classList.add("border-red-500", "ring-1", "ring-red-500");
  }
  const err = document.getElementById(`${fieldId}-error`);
  if (err && message) {
    err.textContent = message;
    err.classList.remove("hidden");
  }
}

function showMsg(text, ok) {
  msgEl.textContent = text;
  msgEl.classList.remove(
    "hidden",
    "bg-red-100",
    "text-red-800",
    "bg-emerald-100",
    "text-emerald-800",
  );
  if (ok) {
    msgEl.classList.add("bg-emerald-100", "text-emerald-800");
  } else {
    msgEl.classList.add("bg-red-100", "text-red-800");
  }
}

document.getElementById("tab-login").addEventListener("click", () => {
  clearRegisterFieldErrors();
  document.getElementById("form-login").classList.remove("hidden");
  document.getElementById("form-register").classList.add("hidden");
  document
    .getElementById("tab-login")
    .classList.add("bg-white", "shadow-sm", "text-blue-800");
  document.getElementById("tab-login").classList.remove("text-gray-600");
  document
    .getElementById("tab-register")
    .classList.remove("bg-white", "shadow-sm", "text-blue-800");
  document.getElementById("tab-register").classList.add("text-gray-600");
});

document.getElementById("tab-register").addEventListener("click", () => {
  clearRegisterFieldErrors();
  document.getElementById("form-register").classList.remove("hidden");
  document.getElementById("form-login").classList.add("hidden");
  document
    .getElementById("tab-register")
    .classList.add("bg-white", "shadow-sm", "text-blue-800");
  document.getElementById("tab-register").classList.remove("text-gray-600");
  document
    .getElementById("tab-login")
    .classList.remove("bg-white", "shadow-sm", "text-blue-800");
  document.getElementById("tab-login").classList.add("text-gray-600");
});

document.getElementById("form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  msgEl.classList.add("hidden");
  try {
    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        username: document.getElementById("login-user").value.trim(),
        password: document.getElementById("login-pass").value,
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      showMsg(
        data.error ||
          (data.message && String(data.message)) ||
          "Usuario o contraseña incorrectos",
        false,
      );
      return;
    }
    if (data.user?.role === "admin") {
      window.location.href = "/app/admin";
    } else {
      window.location.href = "/app/alumno";
    }
  } catch {
    showMsg("No se pudo conectar con el servidor. Intente de nuevo.", false);
  }
});

document
  .getElementById("form-register")
  .addEventListener("submit", async (e) => {
    e.preventDefault();
    msgEl.classList.add("hidden");
    clearRegisterFieldErrors();
    const username = document.getElementById("reg-user").value.trim();
    const email = document.getElementById("reg-email").value.trim();
    const password = document.getElementById("reg-pass").value;
    let data = {};
    try {
      const r = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          username: username,
          documento_identidad: document.getElementById("reg-doc").value.trim(),
          nombres: document.getElementById("reg-nombres").value.trim(),
          apellidos: document.getElementById("reg-apellidos").value.trim(),
          universidad: document.getElementById("reg-universidad").value.trim(),
          area: document.getElementById("reg-area").value.trim(),
          email: email,
          password: password,
        }),
      });
      data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const fe = data.fieldErrors && typeof data.fieldErrors === "object"
          ? data.fieldErrors
          : {};
        Object.entries(fe).forEach(([fieldId, msg]) => {
          if (msg) setRegisterFieldError(fieldId, String(msg));
        });
        const summary =
          data.error ||
          "No se pudo registrar.";
        if (Object.keys(fe).length) {
          showMsg(`${summary} Revise los campos marcados en rojo.`, false);
        } else {
          showMsg(summary, false);
        }
        return;
      }
    } catch {
      showMsg("No se pudo conectar con el servidor. Intente de nuevo.", false);
      return;
    }
    // Auto-login after successful registration
    const loginR = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        username: email, // Use email for login
        password: password,
      }),
    });
    const loginData = await loginR.json().catch(() => ({}));
    if (!loginR.ok) {
      showMsg(
        "Cuenta creada, pero error al iniciar sesión automáticamente. Inicie sesión manualmente.",
        false,
      );
      document.getElementById("tab-login").click();
      return;
    }
    if (loginData.user?.role === "admin") {
      window.location.href = "/app/admin";
    } else {
      window.location.href = "/app/alumno";
    }
  });
