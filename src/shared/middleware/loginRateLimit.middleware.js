import rateLimit, { ipKeyGenerator } from "express-rate-limit";

// Rate limiting de login en dos capas (igual que recomienda OWASP para
// brute-force): ni "solo por IP" ni "por navegador" alcanzan por separado.
// - Por navegador: trivial de evadir (modo incógnito, borrar cookies) — ni
//   se considera un control real.
// - Solo por IP: bloquea a todo el mundo detrás de la misma red/NAT
//   aunque sean personas distintas entrando a SUS PROPIAS cuentas, y un
//   atacante con VPN la rota sin esfuerzo.
//
// Capa 1 — por cédula intentada: protege la cuenta puntual sin importar
// desde dónde la ataquen (ni rotando IP se evade). Es el límite estricto.
// Capa 2 — por IP, más laxo: frena a quien prueba pocas contraseñas
// contra MUCHAS cédulas distintas desde el mismo lugar (password
// spraying), que la Capa 1 sola no detecta porque cada cuenta individual
// recibe pocos intentos.
//
// skipSuccessfulRequests: true en ambas — un login correcto no gasta
// intentos; solo los fallidos cuentan para el bloqueo.

const WINDOW_MS = 15 * 60 * 1000; // 15 minutos

function keyPorCedula(req) {
  const cedula = String(req.body?.cedula ?? "").trim();
  // Sin cédula en el body (payload malformado) cae al límite por IP como
  // respaldo, para no dejar un bucket sin límite. ipKeyGenerator normaliza
  // IPv6 (si no, variar cómo se escribe la misma IP evade el límite).
  return cedula || ipKeyGenerator(req.ip);
}

export const loginLimitPorCedula = rateLimit({
  windowMs: WINDOW_MS,
  max: 5,
  keyGenerator: keyPorCedula,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message:
      "Demasiados intentos fallidos para este usuario. Intenta de nuevo en unos minutos.",
  },
});

export const loginLimitPorIp = rateLimit({
  windowMs: WINDOW_MS,
  max: 30,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message:
      "Demasiados intentos fallidos desde esta red. Intenta de nuevo en unos minutos.",
  },
});
