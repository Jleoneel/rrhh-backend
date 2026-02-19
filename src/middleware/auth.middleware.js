import jwt from "jsonwebtoken";

// Middleware: requiere token válido
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [type, token] = header.split(" ");

  if (type !== "Bearer" || !token) {
    return res.status(401).json({ message: "Token requerido" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    // Guardamos TODO lo que venga en el JWT
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

// Middleware: requiere admin
export function requireAdmin(req, res, next) {
  if (req.user?.es_admin === true) {
    return next();
  }
  return res.status(403).json({ message: "No autorizado (admin requerido)" });
}
