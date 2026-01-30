import jwt from "jsonwebtoken";

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [type, token] = header.split(" ");

  if (type !== "Bearer" || !token) {
    return res.status(401).json({ message: "Token requerido" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // payload: { sub, cargo_id, nombre }
    req.user = {
      firmante_id: payload.sub,
      cargo_id: payload.cargo_id,
      nombre: payload.nombre,
    };
    next();
  } catch (err) {
    return res.status(401).json({ message: "Token inválido o expirado" });
  }
}
