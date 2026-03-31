import jwt from "jsonwebtoken";

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [type, token] = header.split(" ");

  const finalToken = type === "Bearer" && token ? token : req.query.token;

  if (!finalToken) {
    return res.status(401).json({ message: "Token requerido" });
  }

  try {
    const payload = jwt.verify(finalToken, process.env.JWT_SECRET);

    req.user = {
      firmante_id: payload.sub,
      cargo_id: payload.cargo_id,
      nombre: payload.nombre,
      es_admin: payload.es_admin || false,
      tipo_usuario: payload.tipo_usuario || "FIRMANTE",
      servidor_id: payload.servidor_id || null,
      unidad_organica_id: payload.unidad_organica_id || null,
      es_jefe: payload.es_jefe || false, // ← nuevo
    };

    next();
  } catch (err) {
    return res.status(401).json({ message: "Token inválido o expirado" });
  }
}

// Solo firmantes UATH y jefes pueden acceder
export function requireFirmante(req, res, next) {
  if (req.user?.tipo_usuario === "FIRMANTE") {
    return next();
  }
  return res
    .status(403)
    .json({ message: "Acceso restringido al personal UATH" });
}

// Solo servidores pueden acceder
export function requireServidor(req, res, next) {
  if (req.user?.tipo_usuario === "SERVIDOR") {
    return next();
  }
  return res.status(403).json({ message: "Acceso restringido a servidores" });
}

export function requireAdmin(req, res, next) {
  if (req.user?.es_admin === true) {
    return next();
  }
  return res.status(403).json({ message: "No autorizado (admin requerido)" });
}
