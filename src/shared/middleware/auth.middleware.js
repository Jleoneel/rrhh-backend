import jwt from "jsonwebtoken";

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [type, token] = header.split(" ");

  // ← Acepta token por query param (necesario para EventSource/SSE)
  const finalToken = (type === "Bearer" && token) ? token : req.query.token;

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
    };

    next();
  } catch (err) {
    return res.status(401).json({ message: "Token inválido o expirado" });
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.es_admin === true) {
    return next();
  }
  return res.status(403).json({ message: "No autorizado (admin requerido)" });
}